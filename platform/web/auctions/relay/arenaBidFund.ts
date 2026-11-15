/**
 * `platform/web/auctions/relay/arenaBidFund.ts` — assembling a funded 1441.
 *
 * ## What this module is
 *
 * The one place the two halves of a consolidated-protocol bid are put
 * together: the **lock** (`arenaBidEscrow` moves the bidder's money into the
 * 2-of-2 escrow) and the **payload** (`arenaBidFunding` builds the pre-signed
 * settle and refund templates). It reads the auction's committed terms, derives
 * the locktime floor (spec §2.1–§2.2), locks exactly the bid amount, and
 * returns the `{ funding, fundingTerms }` pair `publishArenaBid` requires.
 *
 * Everything it touches is a **port**, so the whole assembly is testable
 * without a browser, a mint or a relay:
 *
 * - `readConfig` — `GET /api/auctions/config` (`AuctionsConfig`): the committee
 *   FROST group key and the Cashu mint the escrow must live on;
 * - `readWalletSigner` — the wallet spend key's digest-signing surface
 *   (`walletOps.getAuctionBidWalletSigner`), `null` until the one-time key
 *   migration produced the pair;
 * - `readEscrowManager` — the escrow send port bound to Coco's `Manager`
 *   (`cashuStore.state.manager` through `arenaEscrowSendOverCoco`), the only
 *   object that may move the money, `null` until the wallet is ready.
 *
 * ## The order is the safety property
 *
 * Every check that can be made **without** moving money is made before the
 * lock, in this order: the amount, the committee key, the mint url, the wallet
 * signer, the wallet manager, the lot's end and mode, its window, its seller
 * wallet, and that the committed v4v split is representable at this amount.
 * Only then does the escrow send run, exactly once. A payload that could not be
 * built is therefore refused *before* the bidder's proofs are committed, rather
 * than after — the difference between "your bid was refused" and "your money is
 * locked and your bid was refused".
 *
 * Beyond that boundary the ordering is forced: the templates can only be signed
 * once the proofs exist, so a mint that answers a lock with something unparseable
 * leaves funds the app cannot address. That residual is stated in
 * {@link ArenaBidFundRefusal} and is why no lock is ever retried or re-attempted
 * here — a second lock would double-commit the bidder.
 *
 * ## What it does NOT do
 *
 * It does not sign the event (the Nostr identity's job, in `AuctionBidHost`), it
 * does not publish, it does not refund, and it never invents a key or a mint
 * url: a missing one is a named refusal, never a guess.
 */
import type { ArenaAuctionDetailModel } from '@ui/auction/arena/model'
import {
	arenaBidLocktimeFloor,
	arenaSettleDestinations,
	buildArenaBidFunding,
	type ArenaBidFunding,
	type ArenaBidFundingTerms,
	type ArenaBidSplitRow,
	type ArenaEscrowProof,
	type ArenaWalletSpendSigner,
} from '@platform/web/auctions/relay/arenaBidFunding'
import {
	lockArenaEscrowWithCoco,
	type ArenaEscrowSendManager,
} from '@platform/web/auctions/relay/arenaBidEscrow'

// =========================================================================
// Ports
// =========================================================================

/** The three config fields the escrow needs, as `GET /api/auctions/config` carries them. */
export interface ArenaBidFundConfig {
	/** The committee's single FROST group key (spec §1.1). */
	committee_public_key?: string | null
	/** The mint the escrow lives on; preferred over `mint_url` when both are set. */
	cashu_mint_url?: string | null
	/** The legacy name for the same field. */
	mint_url?: string | null
}

export interface ArenaBidFundPorts {
	readConfig(): Promise<ArenaBidFundConfig>
	/** The wallet spend key's signing surface, or `null` before the key migration. */
	readWalletSigner(): ArenaWalletSpendSigner | null
	/**
	 * The escrow send port over Coco's manager (`arenaEscrowSendOverCoco`), or
	 * `null` while the wallet is not ready. Never a substitute key.
	 */
	readEscrowManager(): ArenaEscrowSendManager | null
}

// =========================================================================
// Refusals — names, not sentences
// =========================================================================

export type ArenaBidFundRefusal =
	/** `GET /api/auctions/config` did not answer a usable document. */
	| 'fund.config-unreadable'
	/** The config states no committee key, or one that is not a compressed secp256k1 key. */
	| 'fund.committee-key-missing'
	/** The config states no mint, or one that is not an http(s) url. */
	| 'fund.mint-url-missing'
	/** The wallet spend key does not exist yet (the one-time key migration has not run). */
	| 'fund.wallet-signer-missing'
	/** The Cashu wallet is not ready, so there is no manager to send with. */
	| 'fund.wallet-manager-missing'
	/** The lot states no end time, so there is no locktime floor to derive. */
	| 'fund.no-end-time'
	/** The lot states no mode, or one the protocol does not define (`fixed` | `antisnipe`). */
	| 'fund.unknown-mode'
	/** An `antisnipe` lot states no positive window, so the end a bid establishes is unknown. */
	| 'fund.no-window'
	/** The lot states no seller wallet, so the settle template has no destination. */
	| 'fund.seller-wallet-missing'
	/** The stated seller wallet is not a compressed secp256k1 key. */
	| 'fund.seller-wallet-invalid'
	/** A committed v4v split row names a recipient that is not a compressed secp256k1 key. */
	| 'fund.split-recipient-invalid'
	/** The bid amount is not a positive safe integer. Nothing is rounded. */
	| 'fund.amount-invalid'
	/** The mint answered the lock with no proofs at all. */
	| 'fund.escrow-empty'
	/** The mint's locked proofs do not total the bid amount. */
	| 'fund.escrow-mismatch'
	/** The locked proofs name more than one keyset, so the templates cannot pin one. */
	| 'fund.mixed-keysets'
	/** A proof carries no keyset id to pin the template outputs to. */
	| 'fund.keyset-id-invalid'
	/**
	 * The mint refused the escrow send, or its answer never arrived. Nothing is
	 * published and no second lock is attempted: a mint that timed out *may* have
	 * processed the swap, and re-sending would commit the bidder twice. `detail`
	 * carries the mint's own words.
	 */
	| 'fund.lock-failed'

export const ARENA_BID_FUND_REFUSAL_TEXT: Record<ArenaBidFundRefusal, string> = {
	'fund.config-unreadable': 'the auction committee configuration could not be read',
	'fund.committee-key-missing': 'the auction committee key is not configured, so no escrow can be locked to it',
	'fund.mint-url-missing': 'no Cashu mint is configured for auctions, so the escrow cannot be minted',
	'fund.wallet-signer-missing': 'this wallet has no spend key for auction escrows yet',
	'fund.wallet-manager-missing': 'the Cashu wallet is not ready, so no escrow can be funded',
	'fund.no-end-time': 'the auction states no end time, so no locktime floor can be derived',
	'fund.unknown-mode': 'the auction states no mode this client can derive a locktime floor from',
	'fund.no-window': 'the auction states no anti-snipe window, so the end this bid establishes is unknown',
	'fund.seller-wallet-missing': 'the auction states no seller wallet, so the settle has no destination',
	'fund.seller-wallet-invalid': 'the auction’s seller wallet is not a valid payment key',
	'fund.split-recipient-invalid': 'a committed v4v split row names an invalid recipient key',
	'fund.amount-invalid': 'the bid amount must be a positive whole number of sats',
	'fund.escrow-empty': 'the mint locked nothing for this bid',
	'fund.escrow-mismatch': 'the locked escrow does not total the bid amount',
	'fund.mixed-keysets': 'the locked escrow mixes keysets, so one keyset cannot be pinned for the templates',
	'fund.keyset-id-invalid': 'a locked proof carries no keyset id',
	'fund.lock-failed': 'the escrow lock did not complete, so nothing was published',
}

export class ArenaBidFundError extends Error {
	readonly refusal: ArenaBidFundRefusal
	/** The extra detail a refusal carries, e.g. the mint's message. Never key material. */
	readonly detail?: string

	constructor(refusal: ArenaBidFundRefusal, detail?: string) {
		super(detail === undefined ? ARENA_BID_FUND_REFUSAL_TEXT[refusal] : `${ARENA_BID_FUND_REFUSAL_TEXT[refusal]} (${detail})`)
		this.name = 'ArenaBidFundError'
		this.refusal = refusal
		this.detail = detail
	}
}

/**
 * Annotated `never`, for the same reason `arenaBidFunding`'s own helper is: only
 * an explicit return type makes TypeScript treat the call as terminating, which
 * every narrowing below depends on.
 */
const refuse: (refusal: ArenaBidFundRefusal, detail?: string) => never = (refusal, detail) => {
	throw new ArenaBidFundError(refusal, detail)
}

// =========================================================================
// Small helpers
// =========================================================================

const COMPRESSED_PUBKEY = /^0[23][0-9a-f]{64}$/
const isCompressed = (value: unknown): value is string => typeof value === 'string' && COMPRESSED_PUBKEY.test(value)

/** The modes the protocol defines (spec §3). Anything else has no derivable floor. */
const AUCTION_MODES = new Set(['fixed', 'antisnipe'])

/** `cashu_mint_url` first, then the legacy `mint_url`; `null` when neither is a usable url. */
function mintUrlOf(config: ArenaBidFundConfig): string | null {
	for (const candidate of [config.cashu_mint_url, config.mint_url]) {
		if (typeof candidate !== 'string') continue
		const trimmed = candidate.trim()
		if (trimmed === '') continue
		try {
			const parsed = new URL(trimmed)
			if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return trimmed
		} catch {
			continue
		}
	}
	return null
}

// =========================================================================
// The assembly
// =========================================================================

/** The lot terms the escrow and its templates are built against. */
export type ArenaBidFundTerms = Pick<
	ArenaAuctionDetailModel,
	'mode' | 'endsAt' | 'windowSec' | 'sellerWallet' | 'v4vSplit'
>

export interface AssembleArenaBidFundingInput {
	/** The auction as read, or `null` when nothing was read (refused, never guessed). */
	model: ArenaBidFundTerms | null
	/** The bid amount in sats. Locked exactly; never rounded, never topped up. */
	amount: number
	/** Unix seconds, injected so the locktime floor is reproducible. */
	now: number
}

export interface ArenaBidFundingAssembly {
	/** The funded payload the 1441 content carries. */
	funding: ArenaBidFunding
	/** The auction's terms, for `publishArenaBid`'s pre-signature re-check. */
	fundingTerms: ArenaBidFundingTerms
}

/**
 * Assemble one funded bid: read the committee's terms, derive the locktime
 * floor, lock exactly `amount`, and build the two pre-signed templates.
 *
 * Throws {@link ArenaBidFundError} for every precondition and for the lock
 * itself, and `ArenaBidFundingError` (from `arenaBidFunding`) if the built
 * payload is rejected by its own lock parser. It never retries the lock and
 * never returns a partially funded payload.
 */
export async function assembleArenaBidFunding(
	input: AssembleArenaBidFundingInput,
	ports: ArenaBidFundPorts,
): Promise<ArenaBidFundingAssembly> {
	// --- 1. Everything checkable before money moves -------------------------
	if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
		refuse('fund.amount-invalid', `got ${String(input.amount)}`)
	}
	const amount = input.amount

	let config: ArenaBidFundConfig
	try {
		config = await ports.readConfig()
	} catch (error) {
		return refuse('fund.config-unreadable', error instanceof Error ? error.message : String(error))
	}
	const committeeKey = typeof config.committee_public_key === 'string' ? config.committee_public_key.trim() : ''
	if (!isCompressed(committeeKey)) {
		return refuse('fund.committee-key-missing', committeeKey === '' ? 'no committee_public_key' : 'not a compressed secp256k1 key')
	}
	const mintUrl = mintUrlOf(config)
	if (mintUrl === null) {
		return refuse('fund.mint-url-missing', 'neither cashu_mint_url nor mint_url is an http(s) url')
	}

	const signer = ports.readWalletSigner()
	if (signer === null) return refuse('fund.wallet-signer-missing', 'the wallet spend key is not available')
	if (!isCompressed(signer.pubkey)) return refuse('fund.wallet-signer-missing', 'the wallet spend key is not a compressed secp256k1 key')
	const bidderWallet = signer.pubkey.toLowerCase()

	const manager = ports.readEscrowManager()
	if (manager === null) return refuse('fund.wallet-manager-missing', 'the Cashu manager is not available')

	const model = input.model
	if (model === null) return refuse('fund.no-end-time', 'no auction was read')
	const endAt = model.endsAt
	if (typeof endAt !== 'number' || !Number.isFinite(endAt) || endAt <= 0) {
		refuse('fund.no-end-time', 'the create stated no positive duration')
	}
	const mode = model.mode
	// A floor derived from the wrong mode can only be too low, and a floor that is
	// too low is refused by the chain *after* the money is locked (spec §2.2). So
	// an unrecognized mode is a refusal, not a default.
	if (typeof mode !== 'string' || !AUCTION_MODES.has(mode)) {
		refuse('fund.unknown-mode', `mode is ${JSON.stringify(mode ?? null)}`)
	}
	const windowSec = model.windowSec
	if (mode === 'antisnipe' && (typeof windowSec !== 'number' || !Number.isFinite(windowSec) || windowSec <= 0)) {
		refuse('fund.no-window', 'the create stated no positive window_seconds')
	}
	const sellerWallet = model.sellerWallet
	if (typeof sellerWallet !== 'string' || sellerWallet.trim() === '') refuse('fund.seller-wallet-missing', 'sellerWallet is null')
	if (!isCompressed(sellerWallet)) refuse('fund.seller-wallet-invalid', 'sellerWallet is not a compressed secp256k1 key')
	const v4vSplit: readonly ArenaBidSplitRow[] | undefined = model.v4vSplit ?? undefined
	for (const row of v4vSplit ?? []) {
		if (!isCompressed(row.recipientPubkey)) refuse('fund.split-recipient-invalid', `role ${row.role}`)
	}
	// The split's rounding (spec §6) is checked here, before the lock, so an
	// amount the committed split cannot represent never commits the bidder's money.
	arenaSettleDestinations({ amount, sellerWallet, v4vSplit })

	const minLocktime = arenaBidLocktimeFloor({ mode, endAt, windowSec, now: input.now })

	// --- 2. The one money movement ----------------------------------------
	let proofs: ArenaEscrowProof[]
	try {
		proofs = await lockArenaEscrowWithCoco(manager, {
			mintUrl,
			amount,
			bidderWallet,
			committeeKey,
			locktime: minLocktime,
		})
	} catch (error) {
		return refuse('fund.lock-failed', error instanceof Error ? error.message : String(error))
	}
	if (proofs.length === 0) return refuse('fund.escrow-empty')
	const lockedTotal = proofs.reduce((sum, proof) => sum + proof.amount, 0)
	if (lockedTotal !== amount) return refuse('fund.escrow-mismatch', `${lockedTotal} locked for a ${amount} bid`)

	// --- 3. One keyset, one pinned id -------------------------------------
	const keysets = new Set<string>()
	for (const proof of proofs) {
		if (typeof proof.id !== 'string' || proof.id.trim() === '') refuse('fund.keyset-id-invalid')
		keysets.add(proof.id)
	}
	if (keysets.size !== 1) refuse('fund.mixed-keysets', `${keysets.size} keysets: ${[...keysets].join(', ')}`)
	const keysetId = [...keysets][0]

	// --- 4. The payload ----------------------------------------------------
	const funding = await buildArenaBidFunding({
		proofs,
		sellerWallet,
		bidderWallet,
		committeeKey,
		keysetId,
		minLocktime,
		signer,
		// `null` means "the create committed no split"; that is `undefined` here,
		// never an empty array, so the two cannot be confused downstream.
		v4vSplit,
	})
	const fundingTerms: ArenaBidFundingTerms = {
		bidderWallet,
		sellerWallet,
		committeeKey,
		keysetId,
		minLocktime,
		v4vSplit,
	}
	return { funding, fundingTerms }
}