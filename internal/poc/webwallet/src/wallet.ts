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
// The refund key is the bidder's own Nostr key. BIP-340 x-only public keys are
// by construction the even-Y point, so the compressed form is exactly `02||x`:
// the same identity, in the encoding the receipt wants.

import {
  Wallet,
  MintQuoteState,
  P2PKBuilder,
  hashToCurve,
  serializeProofs,
  type Proof,
} from "@cashu/cashu-ts";

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
}

/**
 * The bidder's Nostr identity doubles as the Cashu refund key, so a losing bid
 * can only be reclaimed by the bidder and never by the coordinator.
 */
export function refundPublicKeyFromNostr(nostrPubkeyHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(nostrPubkeyHex)) {
    throw new Error("Nostr public key must be 64 lowercase hex characters");
  }
  // BIP-340 mandates an even-Y key, so the compressed encoding is 02||x.
  return `02${nostrPubkeyHex}`;
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
   */
  async lockForBid(
    amount: number,
    committeePublicKey: string,
    refundPublicKey: string,
    locktime: number,
    onProgress?: (state: string) => void,
  ): Promise<BidFunding> {
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
    };
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
