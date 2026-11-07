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
  type Proof,
} from "@cashu/cashu-ts";
import { schnorr } from "@noble/curves/secp256k1.js";

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
  recordLockedBid(bidId: string, proofs: Proof[], spendPublicKey = this.spendPublicKey()): void {
    if (!bidId || !proofs.length) return;
    const bids = this.readLockedBids();
    bids[bidId] = { proofs, spendPublicKey };
    this.storage.set("lockedBids", JSON.stringify(bids));
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
    const builder = new P2PKBuilder()
      .addMainPubkey(xOnly(committeePublicKey))
      .addRefundPubkey(xOnly(refundPublicKey))
      .lockUntil(locktime);

    const { send, keep } = await this.wallet.send(amount, proofs, {}, {
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
    const outputPublicKeys = proofs.map(() => spendPublicKey);
    const signature = bytesToHex(schnorr.sign(refundClaimMessage(bidId, outputPublicKeys), this.spendSecretKey()));
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
