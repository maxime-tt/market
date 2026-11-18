/**
 * `arenaReceiptClaims.ts` — the recipient's wallet claims the ecash the
 * validators minted for it.
 *
 * ## The seam this closes
 *
 * The chain publishes a **receipt** for every money move — kind 1443
 * (`arena.refund.v1`, a refund executed) and kind 1444 (`arena.settle.v1`, a
 * settle/payout executed). `arenaReceiptsRead.ts` already parses and verifies
 * them and carries each `out[]` entry through — `{ recipient, amount, id,
 * secret, C, dleq }` — where every proof is **P2PK-locked to the recipient's
 * wallet key**. Nothing yet put those proofs into the recipient's wallet: a
 * seller who was paid, or a bidder who was refunded, held nothing until a human
 * pasted a token. This module is that missing step.
 *
 * ## What it does
 *
 * Given the receipts the read already verified and **this wallet's own P2PK
 * key**, it:
 *
 * 1. finds the `out[]` entries addressed to that key,
 * 2. verifies each entry really is a P2PK lock to that key **before** spending,
 * 3. swaps them into the wallet with the wallet's own spend key —
 *    `receiveTokenWithPrivkey`, the one P2PK money path the escrow and the
 *    reclaim leg already use (`sdk/commerce/payments/wallet/auctionFunds.ts`).
 *    The secrets carry `sigflag: SIG_INPUTS`, so `cashu-ts`'s `receive` signs
 *    the witness with the caller's key over each input's digest; the key comes
 *    from the wallet's key ring, never a new home.
 *
 * ## Refusals are named, and happen before any money moves
 *
 * An entry for **another key** is refused, not attempted: this module never
 * signs for someone else's output. A proof whose `secret`/`C` do not parse as
 * a P2PK lock to this key is refused. A receipt that names a **keyset** other
 * than the one the caller holds is refused. A move whose mint the caller does
 * not name — or a mint that does not serve the receipt's keyset — is refused as
 * a **foreign mint** before the receive is attempted. A move already recorded is
 * refused as **already claimed**.
 *
 * ## At most once, across restarts
 *
 * A claimed move is recorded — its `(bid_id, outcome, event_id)` and the
 * secrets of the proofs spent — in the wallet's own **user-scoped persisted
 * state** (`arena_receipt_claims_v1`, `loadUserData`/`saveUserData`), and a
 * move already in that record is skipped. The mint would refuse a second swap
 * of spent proofs anyway, but the app does not lean on that: the record is the
 * app's own guard, so a restart cannot claim twice.
 *
 * ## Never claim from a receipt the read refused
 *
 * This module consumes only `ParsedArenaReceipt` values — the survivor set
 * `readArenaReceipts` produced after kind, signature, schema, outcome and
 * anchor all verified. It has no raw-event entry point, so an unverified
 * receipt cannot reach it.
 *
 * Pure planning (`selectArenaReceiptClaim`, `planArenaReceiptClaims`) is
 * separated from the one impure step (`createArenaReceiptClaims`), so every
 * refusal can be tested without a mint or a network.
 */
import { Amount, getEncodedToken, type Proof } from '@cashu/cashu-ts'
import { auctionP2pkPubkeysMatch, getAuctionP2pkLockPubkeyFromSecret } from '@sdk/commerce/auctions/auctionP2pk'
import { receiveTokenWithPrivkey, type AuctionFundsMintAccess, type AuctionFundsWallet } from '@sdk/commerce/payments/wallet/auctionFunds'
import { loadUserData, saveUserData } from '@sdk/commerce/payments/wallet/storage'
import { receiptMoveKey, type ArenaReceiptOutput, type ParsedArenaReceipt } from './arenaReceiptsRead'

// =========================================================================
// Named refusals — names, not sentences, so a caller and a test can tell one
// failure mode from another (the discipline `arenaReceiptsRead.ts` set)
// =========================================================================

/** An `out[]` entry is addressed to a wallet key that is not this wallet's. */
export const ARENA_CLAIM_REFUSAL_FOREIGN_KEY = 'arena.claim.foreign_key' as const
/** The entry does not carry a readable, canonical P2PK lock to this wallet key. */
export const ARENA_CLAIM_REFUSAL_MALFORMED_P2PK = 'arena.claim.malformed_p2pk' as const
/** The mint the move must be claimed from is not the one the caller names. */
export const ARENA_CLAIM_REFUSAL_FOREIGN_MINT = 'arena.claim.foreign_mint' as const
/** The entry's keyset id is not the keyset the caller holds/is told to expect. */
export const ARENA_CLAIM_REFUSAL_KEYSET_MISMATCH = 'arena.claim.keyset_mismatch' as const
/** The move `(bid_id, outcome)` is already recorded as claimed. */
export const ARENA_CLAIM_REFUSAL_ALREADY_CLAIMED = 'arena.claim.already_claimed' as const

export type ArenaReceiptClaimRefusalName =
	| typeof ARENA_CLAIM_REFUSAL_FOREIGN_KEY
	| typeof ARENA_CLAIM_REFUSAL_MALFORMED_P2PK
	| typeof ARENA_CLAIM_REFUSAL_FOREIGN_MINT
	| typeof ARENA_CLAIM_REFUSAL_KEYSET_MISMATCH
	| typeof ARENA_CLAIM_REFUSAL_ALREADY_CLAIMED

/** The one error type every refusal can be raised as, carrying its stable name. */
export class ArenaReceiptClaimError extends Error {
	readonly refusal: ArenaReceiptClaimRefusalName

	constructor(refusal: ArenaReceiptClaimRefusalName, message: string) {
		super(message)
		this.name = 'ArenaReceiptClaimError'
		this.refusal = refusal
	}
}

/** One refusal, tagged with the receipt it came from. */
export interface ArenaReceiptClaimRefusal {
	eventId: string
	bidId: string
	outcome: string
	refusal: ArenaReceiptClaimRefusalName
	detail: string
}

// =========================================================================
// Selection — one receipt in, its claimable entries and its refusals out
// =========================================================================

/** One `out[]` entry proven claimable: a P2PK lock to this wallet key. */
export interface ArenaClaimableEntry {
	output: ArenaReceiptOutput
	amount: number
	keysetId: string
}

export interface ArenaClaimSelection {
	claimable: ArenaClaimableEntry[]
	refusals: ArenaReceiptClaimRefusal[]
}

const isPositiveInt = (value: number | null): value is number => Number.isSafeInteger(value) && (value as number) > 0

/**
 * Whether an `out[]` entry's lock really is a P2PK secret addressed to
 * `walletP2pk`. Returns the parsed lock pubkey, or `null` when the secret does
 * not parse as a canonical P2PK lock at all.
 *
 * `auctionP2pkPubkeysMatch` throws on a non-hex or malformed key, so the
 * comparison is guarded: a junk recipient is a refusal, never a thrown error
 * that would abort the whole read.
 */
function parseLockPubkey(secret: string): string | null {
	try {
		return getAuctionP2pkLockPubkeyFromSecret(secret)
	} catch {
		return null
	}
}

function recipientMatches(recipient: string, walletP2pk: string): boolean {
	try {
		return auctionP2pkPubkeysMatch(recipient, walletP2pk)
	} catch {
		return false
	}
}

/**
 * Select the `out[]` entries of one verified receipt that this wallet key may
 * claim, and name every entry it may not.
 *
 * An entry is claimable only when its `recipient` **is** this wallet's P2PK key
 * and its proof parses as a P2PK lock to that same key, and its keyset is one
 * the caller holds (`expectedKeysetId`, when given). Every other entry is a
 * named refusal; none is silently dropped.
 */
export function selectArenaReceiptClaim(
	receipt: ParsedArenaReceipt,
	input: { walletP2pk: string; expectedKeysetId?: string | null },
): ArenaClaimSelection {
	const claimable: ArenaClaimableEntry[] = []
	const refusals: ArenaReceiptClaimRefusal[] = []
	const refuse = (refusal: ArenaReceiptClaimRefusalName, detail: string) => {
		refusals.push({ eventId: receipt.eventId, bidId: receipt.bidId, outcome: receipt.outcome, refusal, detail })
	}

	for (const output of receipt.outputs) {
		if (output.recipient === null) {
			refuse(ARENA_CLAIM_REFUSAL_MALFORMED_P2PK, 'out entry carries no recipient key')
			continue
		}
		if (!recipientMatches(output.recipient, input.walletP2pk)) {
			// Another key's output. Say so by name and move on — never attempt it.
			refuse(ARENA_CLAIM_REFUSAL_FOREIGN_KEY, `out entry is locked to ${output.recipient}, not this wallet key`)
			continue
		}
		if (output.secret === null || output.C === null) {
			refuse(ARENA_CLAIM_REFUSAL_MALFORMED_P2PK, 'out entry for this key carries no secret or C point')
			continue
		}
		const lockPubkey = parseLockPubkey(output.secret)
		if (lockPubkey === null) {
			refuse(ARENA_CLAIM_REFUSAL_MALFORMED_P2PK, 'out entry secret is not a canonical P2PK lock')
			continue
		}
		if (!recipientMatches(lockPubkey, input.walletP2pk)) {
			// The recipient field named us but the lock itself is to another key:
			// the proof would not be spendable by this wallet's signature.
			refuse(ARENA_CLAIM_REFUSAL_MALFORMED_P2PK, `out entry secret is locked to ${lockPubkey}, not this wallet key`)
			continue
		}
		if (output.id === null) {
			refuse(ARENA_CLAIM_REFUSAL_KEYSET_MISMATCH, 'out entry carries no keyset id')
			continue
		}
		if (input.expectedKeysetId != null && input.expectedKeysetId !== '' && output.id !== input.expectedKeysetId) {
			refuse(ARENA_CLAIM_REFUSAL_KEYSET_MISMATCH, `out entry keyset ${output.id} is not the expected ${input.expectedKeysetId}`)
			continue
		}
		if (!isPositiveInt(output.amount)) {
			refuse(ARENA_CLAIM_REFUSAL_MALFORMED_P2PK, 'out entry for this key carries no readable amount')
			continue
		}
		claimable.push({ output, amount: output.amount, keysetId: output.id })
	}

	return { claimable, refusals }
}

// =========================================================================
// Planning — verified receipts in, claimable moves out
// =========================================================================

/** One move this wallet can make: a whole receipt's worth of its own outputs. */
export interface ArenaReceiptClaimMove {
	/** `(bid_id, outcome)` — the identity the record and the dedupe both key on. */
	moveKey: string
	bidId: string
	outcome: string
	eventId: string
	auctionId: string
	entries: ArenaClaimableEntry[]
	/** `Σ entries[].amount`. */
	amount: number
	/** The one keyset every entry of this move shares. */
	keysetId: string
}

export interface ArenaReceiptClaimPlan {
	moves: ArenaReceiptClaimMove[]
	refusals: ArenaReceiptClaimRefusal[]
}

/**
 * Reduce verified receipts to the moves this wallet may still claim.
 *
 * A receipt with **no** `out[]` entry for this key is a **no-op, not an error**:
 * it produces neither a move nor a move-level refusal, and the entries it did
 * carry for other keys are still named. A move already recorded by `isClaimed`
 * is refused `arena.claim.already_claimed` and never re-attempted.
 */
export function planArenaReceiptClaims(
	receipts: readonly ParsedArenaReceipt[],
	input: { walletP2pk: string; expectedKeysetId?: string | null; isClaimed: (moveKey: string) => boolean },
): ArenaReceiptClaimPlan {
	const moves: ArenaReceiptClaimMove[] = []
	const refusals: ArenaReceiptClaimRefusal[] = []

	for (const receipt of receipts) {
		const moveKey = receiptMoveKey(receipt)
		if (input.isClaimed(moveKey)) {
			refusals.push({
				eventId: receipt.eventId,
				bidId: receipt.bidId,
				outcome: receipt.outcome,
				refusal: ARENA_CLAIM_REFUSAL_ALREADY_CLAIMED,
				detail: `the move (${receipt.bidId}, ${receipt.outcome}) is already recorded as claimed`,
			})
			continue
		}
		const selection = selectArenaReceiptClaim(receipt, input)
		refusals.push(...selection.refusals)
		if (selection.claimable.length === 0) continue

		moves.push({
			moveKey,
			bidId: receipt.bidId,
			outcome: receipt.outcome,
			eventId: receipt.eventId,
			auctionId: receipt.auctionId,
			entries: selection.claimable,
			amount: selection.claimable.reduce((sum, entry) => sum + entry.amount, 0),
			keysetId: selection.claimable[0].keysetId,
		})
	}

	return { moves, refusals }
}

// =========================================================================
// The at-most-once record — the wallet's own persisted state
// =========================================================================

/** The storage key of the claim record, user-scoped by `storage.ts`. */
export const ARENA_RECEIPT_CLAIM_RECORD_KEY = 'arena_receipt_claims_v1'

/** One move the wallet has claimed and must never claim again. */
export interface ArenaReceiptClaimRecordedMove {
	/** `(bid_id, outcome)` — the move's identity. */
	moveKey: string
	bidId: string
	outcome: string
	eventId: string
	auctionId: string
	amount: number
	/** The identity of the proofs spent: the secrets of the swapped-in outputs. */
	spentSecrets: string[]
	/** Unix ms the claim was recorded. */
	claimedAt: number
}

export type ArenaReceiptClaimRecord = ArenaReceiptClaimRecordedMove[]

/** Load the claim record for the signed-in identity (empty when none is stored). */
export function loadArenaReceiptClaimRecord(pubkey: string | null): ArenaReceiptClaimRecord {
	return loadUserData<ArenaReceiptClaimRecord>(ARENA_RECEIPT_CLAIM_RECORD_KEY, [], pubkey)
}

/** Persist the claim record for the signed-in identity. */
export function saveArenaReceiptClaimRecord(record: ArenaReceiptClaimRecord, pubkey: string | null): void {
	saveUserData(ARENA_RECEIPT_CLAIM_RECORD_KEY, record, pubkey)
}

// =========================================================================
// The service — the one impure step: swap the selected proofs into the wallet
// =========================================================================

/**
 * What the claim service needs from the wallet it belongs to. Every member is a
 * read or write the store already performs; the key is read from the same single
 * place the escrow and the reclaim leg read it (`walletOps`), never a new one.
 */
export interface ArenaReceiptClaimsHost {
	/** The wallet source to swap into, or null when there is none. */
	getWallet(): AuctionFundsWallet | null
	/** Whether the wallet is ready — the claim's precondition. */
	isWalletReady(): boolean
	/** Mint/keyset access for the receive leg. */
	mint: AuctionFundsMintAccess
	/** This wallet's own P2PK key (compressed secp256k1 hex), or null. */
	getWalletP2pk(): string | null
	/** The wallet's private key for a pubkey it holds, or null. Never a per-bid key. */
	getWalletPrivkey(pubkey: string): string | null
	/**
	 * The mint the chain's params name — preferred when the app holds one.
	 * `null` when the app holds no params read; the service then resolves the
	 * mint by asking which of {@link getWalletMints} serves the receipt's keyset,
	 * and refuses `arena.claim.foreign_mint` when none does.
	 */
	getExpectedMintUrl(): string | null
	/** The mints this wallet holds. */
	getWalletMints(): string[]
	/** The keyset the chain's params name, or null to skip the keyset check. */
	getExpectedKeysetId(): string | null
	/** The persisted claim record. */
	getClaimRecord(): ArenaReceiptClaimRecord
	/** Persist the claim record. */
	setClaimRecord(record: ArenaReceiptClaimRecord): void
	/** Reconcile wallet state after a successful claim. */
	refresh(): Promise<void>
	/** Injected clock (unix ms), for the record's `claimedAt`. */
	now?(): number
}

/** One move actually claimed in a run. */
export interface ArenaReceiptClaimedMove {
	bidId: string
	outcome: string
	eventId: string
	auctionId: string
	amount: number
	keysetId: string
}

export interface ArenaReceiptClaimRun {
	/** The moves claimed in this run (the money actually moved). */
	claimed: ArenaReceiptClaimedMove[]
	/** Every entry/move the run refused, by name. */
	refusals: ArenaReceiptClaimRefusal[]
	/** Receipts that produced no move (no outputs for this key, or already claimed). */
	skipped: number
}

export interface ArenaReceiptClaims {
	claimReceipts(receipts: readonly ParsedArenaReceipt[]): Promise<ArenaReceiptClaimRun>
}

/**
 * Whether a mint serves a keyset. `true`/`false` are the mint's own answer;
 * `null` is "the read failed" — an unknown, not a refusal, so a transient
 * failure does not strand a genuinely claimable move.
 */
async function mintServesKeyset(mint: AuctionFundsMintAccess, mintUrl: string, keysetId: string): Promise<boolean | null> {
	try {
		const { cashuWallet } = await mint.cashuWalletForMint(mintUrl)
		const response = await cashuWallet.mint.getKeySets()
		return response.keysets.some((keyset) => keyset.id === keysetId)
	} catch {
		return null
	}
}

/** The receipt's outputs as the `cashu-ts` proofs a token is built from. */
function toCashuProofs(entries: readonly ArenaClaimableEntry[]): Proof[] {
	return entries.map((entry) => {
		const dleq = entry.output.dleq
		return {
			id: entry.keysetId,
			amount: Amount.from(entry.amount),
			secret: entry.output.secret as string,
			C: entry.output.C as string,
			...(dleq && dleq.e && dleq.s && dleq.r ? { dleq: { e: dleq.e, s: dleq.s, r: dleq.r } } : {}),
		}
	})
}

/**
 * Build the claim service over the host. The body is deliberately the narrow
 * path the escrow/reclaim legs already walk: select → verify the mint → encode
 * the receipt's own proofs as a token → `receiveTokenWithPrivkey` (the wallet's
 * own key) → record the move → refresh. It performs no retry of its own: a
 * receive that throws propagates, because a swap that timed out may already
 * have been processed by the mint.
 */
export const createArenaReceiptClaims = (host: ArenaReceiptClaimsHost): ArenaReceiptClaims => ({
	claimReceipts: async (receipts: readonly ParsedArenaReceipt[]): Promise<ArenaReceiptClaimRun> => {
		const wallet = host.getWallet()
		if (!wallet || !host.isWalletReady()) {
			return { claimed: [], refusals: [], skipped: receipts.length }
		}
		const walletP2pk = host.getWalletP2pk()
		if (!walletP2pk) {
			return { claimed: [], refusals: [], skipped: receipts.length }
		}
		// The spend key is the wallet's own. Without it nothing can be signed, and
		// a second key is never invented — the run does nothing.
		const privkey = host.getWalletPrivkey(walletP2pk)
		if (!privkey) {
			return { claimed: [], refusals: [], skipped: receipts.length }
		}

		const expectedMintUrl = host.getExpectedMintUrl()
		const expectedKeysetId = host.getExpectedKeysetId()
		const record = host.getClaimRecord()
		const claimedKeys = new Set(record.map((move) => move.moveKey))
		const { moves, refusals } = planArenaReceiptClaims(receipts, {
			walletP2pk,
			expectedKeysetId,
			isClaimed: (moveKey) => claimedKeys.has(moveKey),
		})

		const now = host.now?.() ?? Date.now()
		const claimed: ArenaReceiptClaimedMove[] = []
		let nextRecord = record

		for (const move of moves) {
			// Resolve the mint: the one the chain's params name when held, else the
			// first mint this wallet holds that serves the receipt's keyset. A mint
			// that does not serve the keyset is a foreign mint — refused before any
			// receive, never guessed at.
			const candidates = expectedMintUrl ? [expectedMintUrl] : host.getWalletMints()
			let mintUrl: string | null = null
			for (const candidate of candidates) {
				const serves = await mintServesKeyset(host.mint, candidate, move.keysetId)
				if (serves !== false) {
					mintUrl = candidate
					break
				}
			}
			if (!mintUrl) {
				refusals.push({
					eventId: move.eventId,
					bidId: move.bidId,
					outcome: move.outcome,
					refusal: ARENA_CLAIM_REFUSAL_FOREIGN_MINT,
					detail:
						candidates.length === 0
							? 'the app holds no mint the receipt names, so this move is not claimable'
							: `no mint this wallet holds serves the receipt's keyset ${move.keysetId}`,
				})
				continue
			}

			const token = getEncodedToken({ mint: mintUrl, proofs: toCashuProofs(move.entries) })
			// No try/catch, no retry: a receive that throws is surfaced, and the
			// move is NOT recorded, because the money did not provably move.
			await receiveTokenWithPrivkey({ wallet, mint: host.mint, token, privkey, mintUrl })

			nextRecord = [
				...nextRecord,
				{
					moveKey: move.moveKey,
					bidId: move.bidId,
					outcome: move.outcome,
					eventId: move.eventId,
					auctionId: move.auctionId,
					amount: move.amount,
					spentSecrets: move.entries.map((entry) => entry.output.secret as string),
					claimedAt: now,
				},
			]
			host.setClaimRecord(nextRecord)
			claimed.push({
				bidId: move.bidId,
				outcome: move.outcome,
				eventId: move.eventId,
				auctionId: move.auctionId,
				amount: move.amount,
				keysetId: move.keysetId,
			})
		}

		if (claimed.length > 0) await host.refresh()
		return { claimed, refusals, skipped: receipts.length - moves.length }
	},
})
