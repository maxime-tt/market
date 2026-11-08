// The bidder's own Cashu wallet.
//
// This is the piece that makes the funding claim true. The bidder mints real
// proofs from the mint, locks them to the committee with a NUT-11 P2PK
// condition, and KEEPS them. Nothing here ever hands a bearer proof, a secret,
// or a blinding factor to the server: what goes out is a set of proof
// references (Y points), a token digest, and a refund public key.
//
// That is the whole difference from the custodial path. There, the server
// asserted a reservation against nothing and could invent value. Here the
// server can only look up references the bidder already controls and confirm
// them with the mint, and the value stays with the bidder until settlement.
//
// The Nostr identity is the AUTHORIZATION layer; this wallet owns its value.
// The refund key is a wallet-owned Cashu spend key, generated here and kept in
// wallet storage, never derived from the Nostr key. A NIP-07 signer exposes no
// raw Schnorr primitive, so a key derived from the Nostr identity would hand
// back proofs nobody could spend. The two layers are linked by an
// authorization: the signed KindRefund event names the bid, and a signature by
// the wallet spend key proves the returned value belongs to this wallet.

import {
  Wallet,
  MintQuoteState,
  P2PKBuilder,
  hashToCurve,
  serializeProofs,
  signP2PKProofs,
  type Proof,
} from "@cashu/cashu-ts";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  SIGALL_DEPOSIT_SCHEMA,
  SIGALL_TEMPLATES_SCHEMA,
  buildP2PKOutputSecret,
  randomBlindingHex,
  signDigest,
  sigAllTemplateDigest,
  type SigAllBidCommitment,
  type SigAllDepositReceipt,
  type SigAllDepositTemplates,
  type SigAllSignedTemplate,
} from "./sigall";

/** A storage shim so the same code runs in a browser and under a test runner. */
export interface WalletStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function memoryStorage(): WalletStorage {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
  };
}

export function browserStorage(namespace: string): WalletStorage {
  return {
    get: (key) => window.localStorage.getItem(`${namespace}:${key}`),
    set: (key, value) => window.localStorage.setItem(`${namespace}:${key}`, value),
  };
}

export interface BidFunding {
  /** NUT-07 references (compressed Y points) of the proofs backing this bid. */
  proofStateRefs: string[];
  /** sha256 over the serialized locked proofs; identifies the token. */
  tokenSha256: string;
  /** The bidder's refund key in compressed form, as the receipt requires. */
  refundPublicKey: string;
  amount: number;
  mintUrl: string;
  /**
   * Each locked proof with its DLEQ proof. This is what makes the amount
   * provable rather than asserted: it lets the engine check, with no mint call,
   * that the mint signed this exact point for this exact amount. It still
   * carries nothing that can spend it.
   */
  proofs: Array<{ amount: number; id: string; Y: string; C: string;
                  dleq: { e: string; s: string; r: string } }>;
  /**
   * The exact proofs that were locked, kept in memory so the browser can hand
   * them to the cooperative refund endpoint later. They are already in
   * `locked` storage; this is the bid association, not a second copy.
   */
  lockedProofs: Proof[];
  /** The wallet spend key these proofs are locked to, compressed. */
  spendPublicKey: string;
}

/** One bid's locked proofs and the wallet spend key that owns them. */
export interface LockedBid {
  proofs: Proof[];
  spendPublicKey: string;
  /** The auction the bid belongs to, so a settlement can find its lock. */
  auctionId?: string;
}

/**
 * The deterministic message a refund claim signs with the wallet spend key.
 *
 * It binds the bid id and the exact output pubkeys the coordinator will lock
 * the returned proofs to, so a signature cannot be replayed against another
 * bid or redirected to another key. The Go coordinator builds the same bytes
 * (demoMintRefundClaimMessage) and refuses any mismatch.
 */
export function refundClaimMessage(bidId: string, outputPublicKeys: string[]): Uint8Array {
  if (!bidId) throw new Error("a refund claim must name a bid");
  const outputs = [...outputPublicKeys].sort();
  for (const key of outputs) {
    if (!/^0[23][0-9a-f]{64}$/.test(key)) {
      throw new Error("refund claim output keys must be compressed secp256k1 points");
    }
  }
  return new TextEncoder().encode(
    `PlebeianAuctionsCashuRefundClaimV1\nbid_id=${bidId}\noutputs=${outputs.join(",")}`,
  );
}

/**
 * The deterministic message a settlement claim signs with the wallet spend key.
 *
 * It binds the auction id and the exact input proof set (sorted Y references),
 * which is what the signer owns. Unlike the refund claim it does not name the
 * output keys: the destination is the seller's payout key committed in the
 * create event, so the winner has no say in it. The Go coordinator builds the
 * same bytes (demoMintSettleClaimMessage) and refuses any mismatch.
 */
export function settleClaimMessage(auctionId: string, proofRefs: string[]): Uint8Array {
  if (!auctionId) throw new Error("a settlement claim must name an auction");
  const refs = [...proofRefs].sort();
  for (const ref of refs) {
    if (!/^0[23][0-9a-f]{64}$/.test(ref)) {
      throw new Error("settlement claim proof references must be compressed secp256k1 points");
    }
  }
  return new TextEncoder().encode(
    `PlebeianAuctionsCashuSettleClaimV1\nauction_id=${auctionId}\nproofs=${refs.join(",")}`,
  );
}

/**
 * The deterministic message a PRE-AUTHORIZED refund consent signs with the
 * wallet spend key (V2).
 *
 * The old V1 (refundClaimMessage) bound the bid event id, which does not exist
 * yet when the bid is being signed, so it could only be signed while a refund
 * was already in progress -- a live signature. V2 binds only what is known at
 * bid time: the auction, the exact input proof set, and the one output key per
 * proof the returned proofs will be locked to. Both the live refund and the
 * pre-authorized refund use it. Keep this byte-for-byte aligned with
 * bidOutcomeRefundClaimMessageV2 in internal/poc/model.go.
 */
export function refundClaimMessageV2(auctionId: string, proofRefs: string[], outputPublicKeys: string[]): Uint8Array {
  if (!auctionId) throw new Error("a refund claim must name an auction");
  const refs = [...proofRefs].sort();
  for (const ref of refs) {
    if (!/^0[23][0-9a-f]{64}$/.test(ref)) {
      throw new Error("refund claim proof references must be compressed secp256k1 points");
    }
  }
  const outputs = [...outputPublicKeys].sort();
  for (const key of outputs) {
    if (!/^0[23][0-9a-f]{64}$/.test(key)) {
      throw new Error("refund claim output keys must be compressed secp256k1 points");
    }
  }
  return new TextEncoder().encode(
    `PlebeianAuctionsCashuRefundClaimV2\nauction_id=${auctionId}\nproofs=${refs.join(",")}\noutputs=${outputs.join(",")}`,
  );
}

/**
 * The bid content the wallet publishes alongside a mint-backed lock: the settle
 * and refund consent signatures the coordinator stores so it can act at close
 * without this wallet online. Shape matches outcome_authorizations in
 * internal/poc/model.go and the coordinator's admission verifier.
 */
export interface OutcomeAuthorizations {
  schema: string;
  settle_spend_signature: string;
  refund_spend_signature: string;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) throw new Error("expected lowercase hex");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function xOnly(compressedHex: string): string {
  if (!/^0[23][0-9a-f]{64}$/.test(compressedHex)) {
    throw new Error("expected a compressed secp256k1 public key");
  }
  return compressedHex.slice(2);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The claim message hashed once, as the coordinator's verifier expects.
 *
 * The Go side verifies over sha256(message) (demoMintRefundClaimMessage +
 * sha256Sum in internal/poc/demo_mint_spend.go), and every other signature in
 * this codebase is over a 32-byte digest too. Signing the raw message instead
 * makes the two sides disagree on the signed bytes, and the coordinator then
 * refuses every genuine claim with "does not verify over the bid id and output
 * keys" -- which is exactly what happened before this helper existed.
 */
async function sha256Bytes(value: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return new Uint8Array(digest);
}

export class BidderWallet {
  private readonly wallet: Wallet;
  private readonly storage: WalletStorage;
  private readonly mintUrl: string;
  private loaded = false;

  constructor(mintUrl: string, storage: WalletStorage) {
    this.mintUrl = mintUrl.replace(/\/+$/, "");
    this.wallet = new Wallet(this.mintUrl);
    this.storage = storage;
  }

  /** Loads the mint's keys and info once, before any operation that needs it. */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.wallet.loadMint();
    this.loaded = true;
  }

  private read(key: string, fallback: Proof[]): Proof[] {
    const raw = this.storage.get(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as Proof[];
    } catch {
      return fallback;
    }
  }

  /** Spendable proofs held by the bidder. */
  spendable(): Proof[] {
    return this.read("spendable", []);
  }

  /** Proofs already locked to the committee for a bid. */
  locked(): Proof[] {
    return this.read("locked", []);
  }

  /**
   * The wallet's own Cashu spend key, generated once and persisted.
   *
   * This is the key the refund path locks returned proofs to and signs claims
   * with. It is deliberately NOT the Nostr key: the Nostr identity authorizes,
   * the wallet owns value, and a NIP-07 signer cannot produce a Cashu
   * signature anyway.
   */
  private spendSecretKey(): Uint8Array {
    const stored = this.storage.get("spendKey");
    if (stored) {
      if (!/^[0-9a-f]{64}$/.test(stored)) throw new Error("the stored wallet spend key is malformed");
      return hexToBytes(stored);
    }
    const { secretKey } = schnorr.keygen();
    this.storage.set("spendKey", bytesToHex(secretKey));
    return secretKey;
  }

  /**
   * The wallet spend public key, compressed (33 bytes, 02/03 prefixed).
   *
   * schnorr.getPublicKey returns the 32-byte BIP-340 x-only form, which is the
   * even-Y point. The Cashu lock and the coordinator both want the compressed
   * encoding, so the even-Y prefix is restored here rather than assumed
   * downstream.
   */
  spendPublicKey(): string {
    return `02${bytesToHex(schnorr.getPublicKey(this.spendSecretKey()))}`;
  }

  /** The bid id -> locked proofs association, so a refund can name its bid. */
  private readLockedBids(): Record<string, LockedBid> {
    const raw = this.storage.get("lockedBids");
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, LockedBid>;
    } catch {
      return {};
    }
  }

  /** Records which locked proofs back a committed bid, and the key owning them. */
  recordLockedBid(bidId: string, proofs: Proof[], spendPublicKey = this.spendPublicKey(), auctionId?: string): void {
    if (!bidId || !proofs.length) return;
    const bids = this.readLockedBids();
    bids[bidId] = { proofs, spendPublicKey, ...(auctionId ? { auctionId } : {}) };
    this.storage.set("lockedBids", JSON.stringify(bids));
  }

  /** The bid this browser locked proofs for in one auction, if any. */
  private lockedBidForAuction(auctionId: string): { bidId: string; locked: LockedBid } | null {
    for (const [bidId, locked] of Object.entries(this.readLockedBids())) {
      if (locked.auctionId === auctionId) return { bidId, locked };
    }
    return null;
  }

  /** The proofs this browser locked for one bid, or an empty list. */
  lockedForBid(bidId: string): Proof[] {
    return this.readLockedBids()[bidId]?.proofs ?? [];
  }

  // cashu-ts carries Proof.amount as a string, so these must coerce: `0 + "128"`
  // is "0128", and a balance that silently becomes a string breaks every
  // comparison against it.
  balance(): number {
    return this.spendable().reduce((total, proof) => total + Number(proof.amount), 0);
  }

  lockedBalance(): number {
    return this.locked().reduce((total, proof) => total + Number(proof.amount), 0);
  }

  /**
   * Mints real proofs from the mint. The demo mint is a FakeWallet mint, so the
   * quote settles without a Lightning payment; this still polls rather than
   * assuming, because a real mint would not.
   */
  async mint(amount: number, onProgress?: (state: string) => void): Promise<number> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error("mint amount must be a positive whole number of sats");
    }
    await this.ensureLoaded();
    onProgress?.("requesting a mint quote");
    const quote = await this.wallet.createMintQuoteBolt11(amount);

    // FakeWallet settles immediately, but poll anyway: a mint that has not said
    // PAID must never be treated as paid.
    let state: string = (quote as { state?: string }).state ?? MintQuoteState.UNPAID;
    for (let attempt = 0; attempt < 20 && state !== MintQuoteState.PAID && state !== MintQuoteState.ISSUED; attempt++) {
      onProgress?.(`waiting for the mint to confirm (${state})`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const checked = (await this.wallet.checkMintQuoteBolt11(quote.quote)) as { state?: string };
      state = checked.state ?? state;
    }
    if (state !== MintQuoteState.PAID && state !== MintQuoteState.ISSUED) {
      throw new Error(`mint quote was not paid (state ${state})`);
    }

    onProgress?.("minting proofs");
    const proofs = await this.wallet.mintProofsBolt11(amount, quote);
    this.storage.set("spendable", JSON.stringify([...this.spendable(), ...proofs]));
    return this.balance();
  }

  /**
   * Locks `amount` of the bidder's own proofs to the committee, keeping the
   * refund key. The proofs never leave this wallet.
   *
   * The refund key is this wallet's own spend key, so the lock names a key the
   * wallet can actually sign with. It is never derived from the Nostr identity.
   */
  async lockForBid(
    amount: number,
    committeePublicKey: string,
    locktime: number,
    onProgress?: (state: string) => void,
  ): Promise<BidFunding> {
    const refundPublicKey = this.spendPublicKey();
    const proofs = this.spendable();
    if (!proofs.length) {
      // Say what is actually true. A wallet whose proofs are all locked is not
      // an empty wallet, and telling the bidder to mint more when a previous
      // bid is sitting on their whole balance sends them to spend again for no
      // reason.
      const locked = this.lockedBalance();
      throw new Error(locked > 0
        ? `all ${locked} sats are locked to a previous bid; release them first, or mint more`
        : "the wallet holds no proofs; mint some first");
    }
    if (this.balance() < amount) {
      const locked = this.lockedBalance();
      throw new Error(`the wallet holds ${this.balance()} spendable sats${locked > 0 ? ` and ${locked} locked` : ""}, less than the ${amount} needed`);
    }

    await this.ensureLoaded();
    onProgress?.("locking proofs to the committee");
    // Proofs handed back by a refund are P2PK-locked to THIS wallet's spend key,
    // so spending them needs a NUT-11 witness over the input. cashu-ts does not
    // produce one on its own, and the mint refuses the swap with "Witness is
    // missing for p2pk signature" -- a refund would return money the bidder can
    // never reuse. Sign the ones that are ours before selecting.
    const spendKeyHex = bytesToHex(this.spendSecretKey());
    const ownSuffix = this.spendPublicKey().slice(2);
    const spendable = proofs.map((proof) => (
      String(proof.secret).includes(ownSuffix)
        ? signP2PKProofs([proof], spendKeyHex)[0]
        : proof
    ));
    const builder = new P2PKBuilder()
      .addMainPubkey(xOnly(committeePublicKey))
      .addRefundPubkey(xOnly(refundPublicKey))
      .lockUntil(locktime);

    const { send, keep } = await this.wallet.send(amount, spendable, {}, {
      send: { type: "p2pk", options: builder.toOptions() },
    });

    this.storage.set("spendable", JSON.stringify(keep ?? []));
    // Locked proofs accumulate: a raise locks more, and older locks are only
    // released by an explicit reclaim, never silently dropped. The locktime is
    // recorded because the proofs are NOT spendable by the bidder until it
    // passes -- the NUT-11 lock gives the committee sole spending authority
    // before then, which is the point of the lock.
    this.storage.set("locked", JSON.stringify([...this.locked(), ...send]));
    this.storage.set("lockedUntil", String(locktime));

    const bindings = send.map((proof) => ({
      amount: Number(proof.amount),
      id: proof.id,
      Y: hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true),
      C: proof.C,
      dleq: { e: proof.dleq!.e, s: proof.dleq!.s, r: proof.dleq!.r },
    }));
    if (bindings.some((b) => !b.dleq.e || !b.dleq.s || !b.dleq.r)) {
      throw new Error("the mint returned no DLEQ proof, so the locked value cannot be proven");
    }
    const refs = bindings.map((b) => b.Y).sort();
    const tokenSha256 = await sha256Hex(JSON.stringify(serializeProofs(send)));

    return {
      proofStateRefs: refs,
      tokenSha256,
      refundPublicKey,
      amount,
      mintUrl: this.mintUrl,
      proofs: bindings,
      lockedProofs: send,
      spendPublicKey: refundPublicKey,
    };
  }

  /**
   * Locks `amount` of the bidder's own proofs to a 2-of-2 SIG_ALL condition:
   * main keys [this wallet's spend key, the committee], n_sigs = 2,
   * sigflag = SIG_ALL, with this wallet's spend key as the single refund key.
   *
   * This is the lock shape the SIG_ALL route replaces cashu_lock_v1 with. The
   * difference that matters: a SIG_ALL spend signature covers the whole
   * transaction, so the coordinator's power is exactly "submit one of the two
   * outcomes this wallet pre-authorized" -- it cannot redirect the money. The
   * returned BidFunding is the same shape as lockForBid, so the existing lock
   * receipt, refs, DLEQ and locked-proofs plumbing is reused unchanged; only
   * the funding_mode the page posts differs.
   */
  async lockForBidSigAll(
    amount: number,
    committeePublicKey: string,
    locktime: number,
    onProgress?: (state: string) => void,
  ): Promise<BidFunding & { fundingMode: string }> {
    const refundPublicKey = this.spendPublicKey();
    const proofs = this.spendable();
    if (!proofs.length) {
      const locked = this.lockedBalance();
      throw new Error(locked > 0
        ? `all ${locked} sats are locked to a previous bid; release them first, or mint more`
        : "the wallet holds no proofs; mint some first");
    }
    if (this.balance() < amount) {
      const locked = this.lockedBalance();
      throw new Error(`the wallet holds ${this.balance()} spendable sats${locked > 0 ? ` and ${locked} locked` : ""}, less than the ${amount} needed`);
    }

    await this.ensureLoaded();
    onProgress?.("locking proofs to the bidder and the committee (SIG_ALL)");
    // Same refund-handling nuance as lockForBid: a proof handed back by an
    // earlier refund is P2PK-locked to this wallet's spend key, so it must be
    // witnessed before the mint will accept it as an input again.
    const spendKeyHex = bytesToHex(this.spendSecretKey());
    const ownSuffix = this.spendPublicKey().slice(2);
    const spendable = proofs.map((proof) => (
      String(proof.secret).includes(ownSuffix)
        ? signP2PKProofs([proof], spendKeyHex)[0]
        : proof
    ));
    // main key set [bidder, committee], n_sigs = 2, sigflag = SIG_ALL; refund
    // [bidder], n_sigs = 1. cashu-ts emits the canonical NUT-11 secret:
    // data = first main key (bidder), pubkeys = the rest (committee).
    const builder = new P2PKBuilder()
      .addMainPubkey(xOnly(this.spendPublicKey()))
      .addMainPubkey(xOnly(committeePublicKey))
      .requireMainSignatures(2)
      .addRefundPubkey(xOnly(refundPublicKey))
      .requireRefundSignatures(1)
      .sigAll()
      .lockUntil(locktime);

    const { send, keep } = await this.wallet.send(amount, spendable, {}, {
      send: { type: "p2pk", options: builder.toOptions() },
    });

    this.storage.set("spendable", JSON.stringify(keep ?? []));
    this.storage.set("locked", JSON.stringify([...this.locked(), ...send]));
    this.storage.set("lockedUntil", String(locktime));

    const bindings = send.map((proof) => ({
      amount: Number(proof.amount),
      id: proof.id,
      Y: hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true),
      C: proof.C,
      dleq: { e: proof.dleq!.e, s: proof.dleq!.s, r: proof.dleq!.r },
    }));
    if (bindings.some((b) => !b.dleq.e || !b.dleq.s || !b.dleq.r)) {
      throw new Error("the mint returned no DLEQ proof, so the locked value cannot be proven");
    }
    const refs = bindings.map((b) => b.Y).sort();
    const tokenSha256 = await sha256Hex(JSON.stringify(serializeProofs(send)));

    return {
      proofStateRefs: refs,
      tokenSha256,
      refundPublicKey,
      amount,
      mintUrl: this.mintUrl,
      proofs: bindings,
      lockedProofs: send,
      spendPublicKey: refundPublicKey,
      fundingMode: "cashu_sigall_v1",
    };
  }

  /**
   * Builds the two exact outcome transactions for the locked proofs and signs
   * both with this wallet's spend key: `settle` pays the auction's committed
   * seller payout key, `refund` returns to this wallet's own refund key. Both
   * conserve the locked amount exactly.
   *
   * The result is the off-chain deposit payload (it carries the bearer C values
   * and the output openings), which the coordinator verifies and stores under a
   * deposit id. Only the compact digests and signatures go on chain.
   */
  async buildOutcomeTemplates(
    auction: { id: string; seller_coco_payment_public_key: string },
    funding: BidFunding,
  ): Promise<SigAllDepositTemplates> {
    if (!auction?.id) throw new Error("outcome templates must name an auction");
    const sellerKey = auction.seller_coco_payment_public_key;
    if (!/^0[23][0-9a-f]{64}$/.test(sellerKey)) {
      throw new Error("the auction committed no seller payout key, so settle has no destination");
    }
    if (!funding.lockedProofs.length) {
      throw new Error("outcome templates need the locked proofs");
    }
    const spendKey = this.spendSecretKey();
    const build = (recipient: string): SigAllSignedTemplate => {
      const inputs = funding.lockedProofs.map((proof) => ({
        amount: Number(proof.amount),
        id: proof.id,
        secret: String(proof.secret),
        C: String(proof.C),
      }));
      const outputs = funding.lockedProofs.map((proof) => {
        const nonce = randomBlindingHex().slice(0, 32);
        return {
          amount: Number(proof.amount),
          id: proof.id,
          secret: buildP2PKOutputSecret(recipient, nonce),
          r: randomBlindingHex(),
        };
      });
      const unsigned: SigAllSignedTemplate = { inputs, outputs, digest: "", bidder_signature: "" };
      const digest = sigAllTemplateDigest(unsigned);
      return { inputs, outputs, digest, bidder_signature: signDigest(digest, spendKey) };
    };
    return { settle: build(sellerKey), refund: build(this.spendPublicKey()) };
  }

  /**
   * The compact on-chain commitment: the two digests and the bidder's
   * signatures, plus the coordinator's signed deposit receipt. This is what the
   * bid content publishes alongside the (off-chain) deposit.
   */
  outcomeTemplateCommitment(
    deposit: { deposit_id: string; settle_digest: string; refund_digest: string; signer: string; signature: string },
    templates: SigAllDepositTemplates,
    auctionId: string,
    bidder: string,
  ): SigAllBidCommitment {
    if (templates.settle.digest !== deposit.settle_digest || templates.refund.digest !== deposit.refund_digest) {
      throw new Error("the deposit receipt digests do not match the signed templates");
    }
    return {
      outcome_templates: {
        schema: SIGALL_TEMPLATES_SCHEMA,
        deposit_id: deposit.deposit_id,
        settle: { digest: templates.settle.digest, bidder_signature: templates.settle.bidder_signature },
        refund: { digest: templates.refund.digest, bidder_signature: templates.refund.bidder_signature },
      },
      sigall_deposit: {
        schema: SIGALL_DEPOSIT_SCHEMA,
        deposit_id: deposit.deposit_id,
        auction_id: auctionId,
        bidder,
        settle_digest: deposit.settle_digest,
        refund_digest: deposit.refund_digest,
        signer: deposit.signer,
        signature: deposit.signature,
      },
    };
  }

  /**
   * Builds the outcome templates and posts them to the coordinator's deposit
   * endpoint, returning the on-chain commitment the bid will carry. The
   * endpoint stores the bearer templates and returns the signed deposit receipt;
   * this method never stores the templates on chain.
   */
  async depositOutcomeTemplates(
    auction: { id: string; seller_coco_payment_public_key: string },
    funding: BidFunding,
    bidder: string,
    endpoint = "/api/demo/sigall-deposit",
  ): Promise<SigAllBidCommitment> {
    const templates = await this.buildOutcomeTemplates(auction, funding);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auction_id: auction.id, bidder, templates }),
    });
    const data = (await response.json().catch(() => ({}))) as Partial<SigAllDepositReceipt> & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || `sigall deposit failed (HTTP ${response.status})`);
    }
    if (!data.deposit_id || !data.settle_digest || !data.refund_digest || !data.signer || !data.signature) {
      throw new Error("the coordinator returned an incomplete sigall deposit receipt");
    }
    return this.outcomeTemplateCommitment(data as SigAllDepositReceipt, templates, auction.id, bidder);
  }

  /**
   * Pre-signs the two outcome consents the coordinator will need after the
   * bidder has gone offline: the settle consent (winner pays the seller) and
   * the V2 refund consent (displaced bidder gets the proofs back).
   *
   * Both are signed by the wallet spend key the lock commits as the refund key,
   * over the exact messages the coordinator verifies -- the settle message over
   * the auction and the sorted proof references, and the V2 refund message over
   * the auction, the references, and one output key per proof (the wallet spend
   * key itself, the only key this wallet can spend a returned proof with).
   *
   * The result is published with the bid so the bidder never has to be online
   * again. It is consent, not custody: the committee key could already spend the
   * lock alone during the window, so this removes liveness, not trust.
   */
  async preauthorizeOutcome(auctionId: string, proofStateRefs: string[], lockedProofs: Proof[]): Promise<OutcomeAuthorizations> {
    if (!auctionId) throw new Error("outcome authorizations must name an auction");
    const refs = [...proofStateRefs].sort();
    for (const ref of refs) {
      if (!/^0[23][0-9a-f]{64}$/.test(ref)) {
        throw new Error("outcome authorization proof references must be compressed secp256k1 points");
      }
    }
    // One output per locked proof, all the wallet spend key, matching what the
    // coordinator reconstructs from the receipt's proof references.
    if (lockedProofs.length !== refs.length) {
      throw new Error("outcome authorizations need one locked proof per proof reference");
    }
    const outputs = refs.map(() => this.spendPublicKey());
    const spendKey = this.spendSecretKey();
    const settleSignature = bytesToHex(schnorr.sign(await sha256Bytes(settleClaimMessage(auctionId, refs)), spendKey));
    const refundSignature = bytesToHex(schnorr.sign(await sha256Bytes(refundClaimMessageV2(auctionId, refs, outputs)), spendKey));
    return {
      schema: "PlebeianAuctionsPOCBidOutcomesV1",
      settle_spend_signature: settleSignature,
      refund_spend_signature: refundSignature,
    };
  }

  /**
   * Claims a displaced bid's locked proofs through the coordinator's
   * cooperative swap.
   *
   * Two independent proofs travel with the request. The signed KindRefund
   * event is the AUTHORIZATION: it names the bid and proves the caller holds
   * the bidder's Nostr key. The wallet spend-key signature is OWNERSHIP: it
   * covers the bid id and the exact output pubkeys the coordinator will lock
   * the returned proofs to, so the value comes back to a key this wallet can
   * spend. The coordinator verifies both and locks the fresh proofs to the
   * wallet spend key. They are imported into `spendable` and the old proofs
   * leave `locked`.
   *
   * The event is NOT submitted to consensus: a legacy KindRefund for a
   * mint-backed bid is refused at admission precisely because it would issue a
   * second, note-shaped payout for the same value.
   */
  async refundBid(bidId: string, event: unknown, endpoint = "/api/demo/mint-refund"): Promise<{ amount: number }> {
    const locked = this.readLockedBids()[bidId];
    const proofs = locked?.proofs ?? [];
    if (!proofs.length) {
      throw new Error("this browser holds no locked proofs for that bid");
    }
    // The key that owns the returned value is the one the lock named. A wallet
    // whose spend key changed cannot prove ownership of that lock, and must
    // not pretend otherwise.
    const spendPublicKey = locked.spendPublicKey;
    if (spendPublicKey !== this.spendPublicKey()) {
      throw new Error("the wallet spend key changed since this bid was locked, so it cannot claim the refund");
    }
    // One output per locked proof, each locked to the wallet spend key. The
    // coordinator builds the same list from the submitted proofs, so the
    // signature binds exactly the outputs it will create.
    //
    // The claim is the frozen V2 message: it binds the auction id, the
    // committed proof references and the output keys. The retired V1 bound the
    // bid event id, which is a hash of the content that would carry the
    // signature and so cannot be signed here. The coordinator verifies V2 for
    // both this live claim and the bidder's bid-time authorization, so a V1
    // signature is refused.
    const auctionId = locked.auctionId;
    if (!auctionId) {
      throw new Error("this wallet holds no auction id for that bid's lock, so it cannot sign the V2 refund claim");
    }
    const proofRefs = proofs
      .map((proof) => hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true))
      .sort();
    const outputPublicKeys = proofs.map(() => spendPublicKey);
    const signature = bytesToHex(schnorr.sign(await sha256Bytes(refundClaimMessageV2(auctionId, proofRefs, outputPublicKeys)), this.spendSecretKey()));
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bid_id: bidId,
        proofs: proofs.map((proof) => ({
          amount: Number(proof.amount), id: proof.id, secret: proof.secret, C: proof.C,
          dleq: proof.dleq,
        })),
        event,
        spend_public_key: spendPublicKey,
        output_public_keys: outputPublicKeys,
        spend_signature: signature,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { proofs?: Proof[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error || `refund failed (HTTP ${response.status})`);
    }
    const fresh = data.proofs ?? [];
    if (!fresh.length) throw new Error("the coordinator returned no refund proofs");

    // Remove exactly the proofs that were swapped, and only that bid's
    // association. A raise may have locked more proofs since; those stay.
    const spent = new Set(proofs.map((proof) => proof.secret));
    this.storage.set("locked", JSON.stringify(this.locked().filter((proof) => !spent.has(proof.secret))));
    const bids = this.readLockedBids();
    delete bids[bidId];
    this.storage.set("lockedBids", JSON.stringify(bids));
    this.storage.set("spendable", JSON.stringify([...this.spendable(), ...fresh]));
    return { amount: fresh.reduce((total, proof) => total + Number(proof.amount), 0) };
  }

  /**
   * The winner's half of settlement: hands the winning lock's proofs to the
   * coordinator, which swaps them to the SELLER's committed wallet key.
   *
   * The signed KindSettle event is the AUTHORIZATION (it names the auction and
   * proves the caller holds the winner's Nostr key). The wallet spend-key
   * signature is OWNERSHIP: it covers the auction id and the exact input proof
   * set, and the coordinator verifies it against the key the lock was created
   * with. The message is hashed once, exactly like the refund claim.
   *
   * The fresh proofs do NOT come back to this wallet -- they are locked to the
   * seller. This returns the payout digest so the caller can record it in the
   * KindSettle event.
   */
  async settleAuction(auctionId: string, event: unknown, endpoint = "/api/demo/mint-settle"): Promise<{ amount: number; tokenSha256: string }> {
    const found = this.lockedBidForAuction(auctionId);
    if (!found) {
      throw new Error("this browser holds no locked proofs for that auction");
    }
    const { bidId, locked } = found;
    const proofs = locked.proofs ?? [];
    if (!proofs.length) {
      throw new Error("this browser holds no locked proofs for that auction");
    }
    if (locked.spendPublicKey !== this.spendPublicKey()) {
      throw new Error("the wallet spend key changed since this bid was locked, so it cannot settle");
    }
    const refs = proofs
      .map((proof) => hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true))
      .sort();
    const signature = bytesToHex(schnorr.sign(await sha256Bytes(settleClaimMessage(auctionId, refs)), this.spendSecretKey()));
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        auction_id: auctionId,
        proofs: proofs.map((proof) => ({
          amount: Number(proof.amount), id: proof.id, secret: proof.secret, C: proof.C,
          dleq: proof.dleq,
        })),
        event,
        spend_signature: signature,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { proofs?: Proof[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error || `settlement failed (HTTP ${response.status})`);
    }
    const payout = data.proofs ?? [];
    if (!payout.length) throw new Error("the coordinator returned no settlement proofs");

    // The winning proofs are spent; the payout belongs to the seller, so it is
    // deliberately not imported here.
    const spent = new Set(proofs.map((proof) => proof.secret));
    this.storage.set("locked", JSON.stringify(this.locked().filter((proof) => !spent.has(proof.secret))));
    const bids = this.readLockedBids();
    delete bids[bidId];
    this.storage.set("lockedBids", JSON.stringify(bids));
    return {
      amount: payout.reduce((total, proof) => total + Number(proof.amount), 0),
      tokenSha256: await sha256Hex(JSON.stringify(serializeProofs(payout))),
    };
  }

  /**
   * The seller's half: fetches the payout a settlement swap produced and puts
   * it in `spendable`.
   *
   * The endpoint is unauthenticated because the proofs are P2PK-locked to this
   * wallet's spend key -- the lock is the access control, and a wallet that
   * does not hold the key cannot spend what it downloads. Returns 0 when no
   * payout is stored yet, which is the normal state before the winner settles.
   */
  async importSettlement(auctionId: string, endpoint = `/api/demo/settlement/${encodeURIComponent(auctionId)}`): Promise<{ amount: number; imported: boolean }> {
    const response = await fetch(endpoint, { headers: { accept: "application/json" } });
    if (response.status === 404) return { amount: 0, imported: false };
    const data = (await response.json().catch(() => ({}))) as { proofs?: Proof[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error || `settlement import failed (HTTP ${response.status})`);
    }
    const fresh = data.proofs ?? [];
    if (!fresh.length) return { amount: 0, imported: false };
    // Deduplicate by secret: a refresh may fetch the same payout twice, and a
    // duplicated proof would make the next swap fail at the mint.
    const known = new Set(this.spendable().map((proof) => proof.secret));
    const added = fresh.filter((proof) => !known.has(proof.secret));
    if (!added.length) return { amount: 0, imported: false };
    this.storage.set("spendable", JSON.stringify([...this.spendable(), ...added]));
    return { amount: added.reduce((total, proof) => total + Number(proof.amount), 0), imported: true };
  }

  /** When the currently locked proofs become reclaimable by the bidder. */
  lockedUntil(): number {
    const raw = this.storage.get("lockedUntil");
    return raw ? Number(raw) : 0;
  }

  /**
   * Reclaims locked proofs once their locktime has passed.
   *
   * This is a REAL constraint, not a formality: a NUT-11 P2PK lock gives the
   * committee sole spending authority until the locktime, so before then the
   * bidder genuinely cannot move these proofs and no wallet code can change
   * that. An earlier version of this method moved them to "spendable"
   * unconditionally, which was a lie -- the next lock would then have failed at
   * the mint instead, with a much worse message.
   *
   * It exists because a bid can fail AFTER the proofs are locked (the engine
   * refuses it, the auction closes, the tab is closed mid-flight) and nothing
   * else returns them.
   */
  reclaimLocked(): { released: number; reclaimableAt: number } {
    const locked = this.locked();
    if (!locked.length) return { released: 0, reclaimableAt: 0 };
    const reclaimableAt = this.lockedUntil();
    if (reclaimableAt > 0 && Math.floor(Date.now() / 1000) < reclaimableAt) {
      return { released: 0, reclaimableAt };
    }
    const released = locked.reduce((total, proof) => total + Number(proof.amount), 0);
    this.storage.set("spendable", JSON.stringify([...this.spendable(), ...locked]));
    this.storage.set("locked", JSON.stringify([]));
    this.storage.set("lockedBids", JSON.stringify({}));
    this.storage.set("lockedUntil", "0");
    return { released, reclaimableAt: 0 };
  }

  /** Asks the mint directly whether the locked proofs are still unspent. */
  async lockedProofStates(): Promise<Record<string, string>> {
    const locked = this.locked();
    if (!locked.length) return {};
    await this.ensureLoaded();
    const states = await this.wallet.checkProofsStates(locked);
    const bySecret = new Map(locked.map((proof) => [proof.secret, "unknown"]));
    const result: Record<string, string> = {};
    for (const entry of states as Array<{ Y?: string; state?: string; secret?: string }>) {
      const key = entry.Y ?? entry.secret ?? "unknown";
      result[key] = entry.state ?? "unknown";
      void bySecret;
    }
    return result;
  }
}
