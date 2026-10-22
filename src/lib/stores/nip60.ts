import {
	createAppWalletKeyStore,
	createAuctionHost,
	createAuctionLock,
	createAuctionReclaim,
	createAuctionReceipt,
	createRelayWalletKeyMigrationSource,
	createWalletEventReader,
	deriveAuctionChildPrivkey,
	getMintHostname,
	getSpendableProofsForMint,
	latestByCreatedAt,
	loadAuctionMintKeysets,
	loadUserData,
	migrateWalletKeyMaterial,
	saveUserData,
	AuctionBidLockMutationPossibleError,
	type AuctionBidPendingTokenContext,
	type AuctionFundsMintAccess,
	type AuctionHost,
	type AuctionLock,
	type AuctionLockHost,
	type AuctionReceipt,
	type AuctionReceiveHost,
	type AuctionReclaim,
	type CashuWalletSource,
	type LockAuctionBidFundsParams,
	type LockAuctionBidFundsResult,
	type PendingToken,
	type PendingTokenContext,
	type WalletEventOpener,
	type WalletEventRelay,
	type WalletKeyMaterial,
	type WalletKeyMigrationSource,
	type WalletKeySigner,
	type WalletKeyStore,
} from '@/lib/wallet'
import { auctionP2pkPubkeysMatch } from '@/lib/auctionP2pk'
import { AUCTION_SETTLEMENT_GRACE_DEFAULT_SECONDS } from '@/lib/auction/constants'
import { toEncryptingSigner } from '@/lib/nostr/ndkEncryptingSigner'
import { CashuMint, CashuWallet, type MintKeys, type MintKeyset, type Proof } from '@cashu/cashu-ts'
import { NDKEvent, NDKNutzap, NDKUser, NDKZapper, type NDKFilter } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { ndkActions, ndkStore } from './ndk'
import { cashuActions, cashuStore } from './cashu'
import type { SaveUserDataOptions } from '@/lib/wallet/storage'

const DEFAULT_MINT_KEY = 'nip60_default_mint'
const PENDING_TOKENS_KEY = 'nip60_pending_tokens'

// Re-export for backward compatibility
export type PendingNip60Token = PendingToken

export interface Nip60LightningPaymentResult {
	preimage?: string
}

export interface Nip60NutzapResult {
	eventId: string
	event: NDKNutzap
}

export interface Nip60TestMintResult {
	mintUrl: string
	amount: number
	quoteId: string
	proofsMinted: number
}

export interface Nip60DevAuctionBidResult {
	bidEventId: string
	auctionEventId: string
	auctionCoordinates: string
	auctionTitle: string
	mintUrl: string
	bidAmount: number
	minBid: number
	topUpAmount: number
}

// The auction P2PK lock's parameter/result shapes and the key scheme now live with the lock
// itself, in `@/lib/wallet/auctionFunds`; re-exported here so callers' import path is unchanged.
export type { AuctionP2pkKeyScheme, LockAuctionBidFundsParams, LockAuctionBidFundsResult } from '@/lib/wallet'
// The irreversible-mint-boundary error moved with the lock; re-exported for the same reason.
export { AuctionBidLockMutationPossibleError } from '@/lib/wallet'

export interface Nip60State {
	/**
	 * The wallet the rails spend through. It is no longer the relay-backed `NDKCashuWallet`: that
	 * class is gone from this store, and `@/lib/wallet/cashuWalletSource` puts coco's proof
	 * repository behind the same synchronous read/write shape the rails were written against.
	 * The field keeps its name and its truthiness meaning so every consumer's readiness check is
	 * unchanged.
	 */
	wallet: CashuWalletSource | null
	status: 'idle' | 'initializing' | 'ready' | 'no_wallet' | 'error'
	balance: number
	mintBalances: Record<string, number>
	mints: string[]
	defaultMint: string | null
	error: string | null
	// Pending tokens tracking (tokens generated but not yet claimed by recipient)
	pendingTokens: PendingNip60Token[]
}

const initialState: Nip60State = {
	wallet: null,
	status: 'idle',
	balance: 0,
	mintBalances: {},
	mints: [],
	defaultMint: typeof localStorage !== 'undefined' ? localStorage.getItem(DEFAULT_MINT_KEY) : null,
	error: null,
	pendingTokens: [],
}

// Default to the public testnet mint. Set APP_DEV_TEST_MINT_URL to override
// (e.g. http://localhost:3338 for local e2e tests with a local nutshell mint).
// APP_DEV_TEST_MINT_URL is set on the server, but it may not reach the browser
// bundle (bun reliably inlines NODE_ENV, not arbitrary custom vars), so the local
// e2e mint (localhost:3338 / 127.0.0.1:3338) is also listed explicitly below so
// mintTestEcash hits the local nutshell mint instead of external testnet mints.
const DEV_TEST_MINT_URL = process.env.APP_DEV_TEST_MINT_URL || 'https://testnut.cashu.space'
export const NIP60_DEV_TEST_MINTS = Array.from(
	new Set(
		[
			DEV_TEST_MINT_URL,
			'http://localhost:3338',
			'http://127.0.0.1:3338',
			'https://testnut.cashu.space',
			'https://nofees.testnut.cashu.space',
		]
			.map((mint) => mint.trim().replace(/\/$/, ''))
			.filter(Boolean),
	),
)
const NIP60_WALLET_KIND = 17375 as unknown as NonNullable<NDKFilter['kinds']>[number]
const NIP60_WALLET_FETCH_TIMEOUT_MS = 5000
const NIP60_WALLET_LOAD_TIMEOUT_MS = 5000
const NIP60_WALLET_START_TIMEOUT_MS = 7000
const AUCTION_KIND = 30408 as unknown as NonNullable<NDKFilter['kinds']>[number]
const AUCTION_BID_KIND = 1023 as unknown as NonNullable<NDKFilter['kinds']>[number]
/**
 * Default `settlement_grace` value (seconds) baked into a freshly-created
 * auction event. The value now lives with the protocol constant it is, in
 * `@sdk/commerce/auctions/constants`; this getter stays exported (deleted
 * with the store) so the dev bid helper and any legacy caller keep their
 * import path until the store goes.
 */
export const getAuctionSettlementGraceSeconds = (): number => AUCTION_SETTLEMENT_GRACE_DEFAULT_SECONDS

/**
 * Re-exported from `@/lib/wallet/auctionFunds`, where the reclaim pair now lives with its
 * timing helpers, backoff constants and error classification. Kept exported here because
 * `platform/…/bids.tsx` reads the two UI helpers off this module; that import moves when the
 * store itself is deleted.
 */
export {
	AUCTION_RECLAIM_SKEW_BUFFER_SECONDS,
	formatReclaimWaitSeconds,
	getAuctionReclaimReadyAt,
	getAuctionReclaimReadyAtForGroup,
} from '@/lib/wallet'

export const nip60Store = new Store<Nip60State>(initialState)

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

const getDevTestMintCandidates = (preferredMintUrl?: string): string[] => {
	const normalizedPreferredMint = preferredMintUrl ? normalizeMintUrl(preferredMintUrl) : ''
	const preferred = normalizedPreferredMint && NIP60_DEV_TEST_MINTS.includes(normalizedPreferredMint) ? [normalizedPreferredMint] : []
	return Array.from(new Set([...preferred, ...NIP60_DEV_TEST_MINTS].filter(Boolean)))
}

const isKeysetVerificationError = (err: unknown): err is Error => err instanceof Error && err.message.includes("Couldn't verify keyset ID")

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const getDevTestMintKeyset = async (cashuMint: CashuMint, targetMint: string): Promise<{ keysets: MintKeyset[]; mintKeys: MintKeys }> => {
	const keysetResponse = await cashuMint.getKeySets()
	const satKeysets = keysetResponse.keysets.filter((keyset) => keyset.unit === 'sat')
	const activeSatKeyset = satKeysets.find((keyset) => keyset.active) ?? satKeysets[0]
	if (!activeSatKeyset) {
		throw new Error(`Mint ${getMintHostname(targetMint)} has no sat keysets`)
	}

	const keysResponse = await cashuMint.getKeys(activeSatKeyset.id)
	const mintKeys = keysResponse.keysets.find((keyset) => keyset.id === activeSatKeyset.id) ?? keysResponse.keysets[0]
	if (!mintKeys) {
		throw new Error(`Mint ${getMintHostname(targetMint)} returned no keys for keyset ${activeSatKeyset.id}`)
	}

	return {
		keysets: satKeysets,
		mintKeys,
	}
}

const createCashuWalletForMint = async (targetMint: string): Promise<{ cashuWallet: CashuWallet; keysetId?: string }> => {
	const normalizedTargetMint = normalizeMintUrl(targetMint)
	const cashuMint = new CashuMint(normalizedTargetMint)
	const cashuWallet = new CashuWallet(cashuMint)

	try {
		await cashuWallet.loadMint()
		return { cashuWallet }
	} catch (err) {
		if (!isNip60WalletDevModeEnabled() || !NIP60_DEV_TEST_MINTS.includes(normalizedTargetMint) || !isKeysetVerificationError(err)) {
			throw err
		}

		// testnut is currently serving a keyset ID that cashu-ts rejects. Seed the dev wallet
		// with the raw keyset metadata so we can keep exercising the faucet flow in dev mode.
		const { keysets, mintKeys } = await getDevTestMintKeyset(cashuMint, normalizedTargetMint)
		return {
			cashuWallet: new CashuWallet(cashuMint, {
				keysets,
				keys: mintKeys,
			}),
			keysetId: mintKeys.id,
		}
	}
}

const getFirstTagValue = (event: NDKEvent, tagName: string): string => event.tags.find((tag) => tag[0] === tagName)?.[1] || ''

const getTagValues = (event: NDKEvent, tagName: string): string[] =>
	event.tags.filter((tag) => tag[0] === tagName && !!tag[1]).map((tag) => tag[1])

const parseNonNegativeInt = (value: string, fallback: number = 0): number => {
	const parsed = parseInt(value, 10)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const ACTIVE_BID_STATUSES = new Set(['locked', 'accepted', 'active', 'unknown'])

const resolveLatestActiveBidByBidder = (bidEvents: NDKEvent[], bidderPubkey: string): NDKEvent | null => {
	const bidderBids = bidEvents.filter((bidEvent) => {
		if (bidEvent.pubkey !== bidderPubkey) return false
		const status = getFirstTagValue(bidEvent, 'status') || 'unknown'
		return ACTIVE_BID_STATUSES.has(status)
	})
	if (!bidderBids.length) return null

	return bidderBids.sort((a, b) => {
		const amountDelta = parseNonNegativeInt(getFirstTagValue(b, 'amount'), 0) - parseNonNegativeInt(getFirstTagValue(a, 'amount'), 0)
		if (amountDelta !== 0) return amountDelta
		const createdAtDelta = (b.created_at || 0) - (a.created_at || 0)
		if (createdAtDelta !== 0) return createdAtDelta
		return b.id.localeCompare(a.id)
	})[0]
}

const isLocalDevHost = (): boolean => {
	if (typeof window === 'undefined') return false
	// Total predicate: never throw when `location` is absent (some test
	// environments define a `window` global without one) — a dev-mode check
	// must not be able to take down the caller's flow.
	const host = window.location?.hostname
	if (!host) return false
	return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
}

export const isNip60WalletDevModeEnabled = (): boolean => {
	// M8 FIX: Gate ONLY on the explicit APP_NIP60_DEV_MODE flag and local
	// dev host detection. Never enable based on stage (e.g. 'staging').
	// The previous code checked `stage === 'staging'` which exposed wallet
	// key material on staging servers accessible to anyone — a major
	// security vulnerability.
	const explicit = process.env.APP_NIP60_DEV_MODE
	if (explicit === 'true') return true
	if (explicit === 'false') return false

	// No explicit flag: fall back to local dev host detection only.
	// Never enable on staging or any non-local environment.
	return isLocalDevHost()
}

export const NIP60_WALLET_DEV_MODE = isNip60WalletDevModeEnabled()

const loadPendingTokens = (): PendingToken[] => loadUserData<PendingToken[]>(PENDING_TOKENS_KEY, [])

const savePendingTokens = (tokens: PendingToken[], options?: SaveUserDataOptions): void => saveUserData(PENDING_TOKENS_KEY, tokens, options)

const markPendingTokensByBidEventIds = (bidEventIds: string[], status: PendingNip60Token['status']): void => {
	if (!bidEventIds.length) return
	const wanted = new Set(bidEventIds)
	const pendingTokens = nip60Store.state.pendingTokens.map((token) => {
		const context = token.context
		if (context?.kind !== 'auction_bid') return token
		if (!context.bidEventId || !wanted.has(context.bidEventId)) return token
		return { ...token, status }
	})
	savePendingTokens(pendingTokens)
	nip60Store.setState((s) => ({ ...s, pendingTokens }))
}

/**
 * The wallet's own P2PK pair, as a synchronous lookup, so the reclaim host's legacy refund-key
 * fallback keeps its old meaning ("the key the wallet itself holds") now that the pair lives in
 * the sealed key store rather than in the relay wallet's `privkeys` map. It is filled from the
 * same one-way migration the auction HD root uses; until that has run, the wallet holds no key
 * and the lookup answers null, exactly as an empty map did.
 *
 * The pair is only ever the wallet's OWN p2pk — per-bid refund keys are deliberately never in it
 * (see `auctionFunds.ts`'s refund-key preference), so this stays a safety net and not a second
 * authority for refund keys.
 */
let walletKeyMaterialCache: WalletKeyMaterial | null = null

const getWalletPrivkey = (pubkey?: string): string | null => {
	const material: WalletKeyMaterial | null = walletKeyMaterialCache
	if (!pubkey || !material) return null
	return auctionP2pkPubkeysMatch(material.walletP2pk, pubkey) ? material.walletPrivkey : null
}

/**
 * The sealer's signer: the app's NDK signer, adapted to the nip44 surface `walletKeyStore`
 * expects. `NDKSigner` does not declare `nip44` (the wallet event is opened through the
 * event's own `decrypt()` — see §9.6's trap note), so the sealer is built from the signer's
 * NIP-44 `encrypt`/`decrypt` through the same adapter the SDK uses.
 */
const auctionWalletKeySigner = (): WalletKeySigner | null => {
	const signer = ndkStore.state.ndk?.signer
	return signer ? { nip44: toEncryptingSigner(signer) } : null
}

/** The app's key store: the pair's durable, sealed home. The signer is read lazily per call. */
let auctionWalletKeyStoreInstance: WalletKeyStore | null = null
const getAuctionWalletKeyStore = (): WalletKeyStore => {
	// Built lazily, not at module scope: the wallet barrel and this store are in an import
	// cycle (via `./ndk` and the auth store), so an eager call here can touch
	// `createAppWalletKeyStore` before that module has initialised.
	auctionWalletKeyStoreInstance ??= createAppWalletKeyStore({ getSigner: auctionWalletKeySigner })
	return auctionWalletKeyStoreInstance
}

/**
 * The relay read for the migration source: the owner's latest kind-17375 event, weight-ordered
 * rather than trusting relay order (a stale wallet event carries a stale key, and a stale key
 * is a different HD root). It follows the same fetch path the rest of this store uses for the
 * wallet event — `ndkActions.fetchEventsWithTimeout` over the NDK bridge — so no new I/O seam
 * is introduced here.
 */
const walletEventRelay = (): WalletEventRelay => ({
	fetchLatestWalletEvent: async (ownerPubkey) => {
		const events = Array.from(
			await ndkActions.fetchEventsWithTimeout(
				{ kinds: [NIP60_WALLET_KIND], authors: [ownerPubkey], limit: 5 },
				{ timeoutMs: NIP60_WALLET_FETCH_TIMEOUT_MS },
			),
		)
		return latestByCreatedAt(events.map((event) => ({ content: event.content, createdAt: event.created_at || 0 })))
	},
})

/**
 * The migration source the app runs: the pair comes from the owner's relay wallet event,
 * decrypted by the signer, through the two seams in `src/lib/wallet/` — `createWalletEventReader`
 * over the relay read and the signer, `createRelayWalletKeyMigrationSource` over the reader.
 *
 * Two failures RAISE rather than answering "no pairs", because the migration reads an empty
 * candidate list as `nothing-to-migrate` and a caller that takes that route may create a fresh
 * wallet over a real one:
 *
 *   - an event that exists but cannot be opened (the reader raises `WalletEventUnreadableError`);
 *   - no signer at all — nothing can open the event, so it is unreadable by construction.
 *
 * The reader never picks among several keys: `selectWalletKeyPair` resolves only against a
 * named pubkey, and this caller has none to name, so an event carrying more than one key is
 * reported (`no-matching-pair`), never guessed.
 */
const createRelayBackedKeyMigrationSource = (): WalletKeyMigrationSource => {
	const signer = ndkStore.state.ndk?.signer
	const opener: WalletEventOpener = signer
		? toEncryptingSigner(signer)
		: {
				decrypt: async () => {
					throw new Error('wallet event unreadable: no signer to open it')
				},
			}
	return createRelayWalletKeyMigrationSource(createWalletEventReader({ relay: walletEventRelay(), opener }))
}

/**
 * Resolve the wallet key material the auction HD root derives from, for the authenticated
 * owner. The pair's durable home is the sealed key store; the one-way migration reads the
 * relay event once and writes it there, after which every call reads it back without
 * consulting the relay again.
 *
 * There is no fallback, and that is the point of this wiring. The pair comes from the relay
 * event or from the local store and from nowhere else: a migration that yields no material —
 * an event that cannot be opened, a candidate list with no unambiguous key, an owner with no
 * wallet event — RAISES rather than seeding the store from a wallet-side read that could put
 * a different pair (and so a different HD root) in place. The earlier fallback to
 * `normalizeWalletKeyMaterial` over the wallet's pair was the last thing in this store reading
 * the pair for the migration; it is deleted with the stub.
 *
 * The owner pubkey is the one the wallet was initialised for. Without it the pair cannot be
 * attributed to an owner, so it is refused — the same fail-closed stance `walletKeys` takes for
 * material it cannot trust.
 */
const resolveAuctionKeyMaterial = async (): Promise<WalletKeyMaterial> => {
	const ownerPubkey =
		(await ndkStore.state.ndk?.signer
			?.user()
			.then((user) => user.pubkey)
			.catch(() => '')) ?? ''
	if (!ownerPubkey) {
		throw new Error('Current wallet does not expose the auction HD root private key')
	}

	const migration = await migrateWalletKeyMaterial({
		store: getAuctionWalletKeyStore(),
		source: createRelayBackedKeyMigrationSource(),
		ownerPubkey,
	})
	if (!migration.material) {
		throw new Error('Current wallet does not expose the auction HD root private key')
	}
	return migration.material
}

/**
 * The mint/keyset port the extracted receive needs. It is the store's own
 * `createCashuWalletForMint`, with its dev-test-mint keyset fallback intact, injected so
 * `@/lib/wallet/auctionFunds` never reaches back into this store for a mint.
 */
const auctionFundsMintAccess: AuctionFundsMintAccess = {
	cashuWalletForMint: (mintUrl) => createCashuWalletForMint(mintUrl),
}

/**
 * The single reclaim instance the two actions delegate to. Built lazily and held once, so the
 * host closures read the store's live pending tokens and wallet, and the sweep's "at most one
 * per minute" throttle is shared across every caller of `autoReclaimTimelockedBids`.
 */
let auctionReclaimInstance: AuctionReclaim | null = null
const getAuctionReclaim = (): AuctionReclaim => {
	auctionReclaimInstance ??= createAuctionReclaim({
		getWallet: () => nip60Store.state.wallet,
		isWalletReady: () => nip60Store.state.status === 'ready',
		mint: auctionFundsMintAccess,
		getWalletPrivkey: (pubkey) => getWalletPrivkey(pubkey),
		getWalletPrivkeyCount: () => (walletKeyMaterialCache ? 1 : 0),
		getPendingTokens: () => nip60Store.state.pendingTokens,
		setPendingTokens: (tokens) => {
			savePendingTokens(tokens)
			nip60Store.setState((s) => ({ ...s, pendingTokens: tokens }))
		},
		refresh: () => nip60Actions.refresh(),
	})
	return auctionReclaimInstance
}

/**
 * The host the lock reads the store through: wallet, readiness, balances, default mint and the
 * pending-token bookkeeping. All closures, so the lock sees the store's live state and this
 * module holds no relay-wallet reference.
 */
const auctionLockHost: AuctionLockHost = {
	getWallet: () => nip60Store.state.wallet,
	isWalletReady: () => nip60Store.state.status === 'ready',
	mint: auctionFundsMintAccess,
	getBalances: () => {
		const wallet = nip60Store.state.wallet
		return wallet ? getBalancesFromState(wallet) : { totalBalance: 0, mintBalances: {} }
	},
	getDefaultMint: () => nip60Store.state.defaultMint,
	getPendingTokens: () => nip60Store.state.pendingTokens,
	setPendingTokens: (tokens, options) => {
		savePendingTokens(tokens, options)
		nip60Store.setState((s) => ({ ...s, pendingTokens: tokens }))
	},
	setWalletBalances: ({ balance, mintBalances }) => {
		const wallet = nip60Store.state.wallet
		nip60Store.setState((s) => ({ ...s, balance, mintBalances, mints: wallet ? getAllMints(wallet) : s.mints }))
	},
}

/**
 * The single lock instance the action delegates to. Built lazily and held once, mirroring the
 * reclaim instance; the host closures read the store's live state.
 */
let auctionLockInstance: AuctionLock | null = null
const getAuctionLock = (): AuctionLock => {
	auctionLockInstance ??= createAuctionLock(auctionLockHost)
	return auctionLockInstance
}

/**
 * The host the settlement receipt reads the store through: the wallet to swap into, the mint
 * access for the receive, and the refresh that follows.
 */
const auctionReceiptHost: AuctionReceiveHost = {
	getWallet: () => nip60Store.state.wallet,
	mint: auctionFundsMintAccess,
	refresh: () => nip60Actions.refresh(),
}

/**
 * The single receipt instance the action delegates to; built lazily and held once, mirroring
 * the lock and reclaim instances.
 */
let auctionReceiptInstance: AuctionReceipt | null = null
const getAuctionReceipt = (): AuctionReceipt => {
	auctionReceiptInstance ??= createAuctionReceipt(auctionReceiptHost)
	return auctionReceiptInstance
}

/**
 * The host the two non-money auction-rail actions read the store through: wallet readiness, the
 * coin's key material (the auction HD root's authority now that it is local), and the
 * pending-token bookkeeping. All closures, so the host sees the store's live state.
 */
const auctionHost: AuctionHost = {
	isWalletReady: () => nip60Store.state.status === 'ready',
	resolveKeyMaterial: () => resolveAuctionKeyMaterial(),
	getPendingTokens: () => nip60Store.state.pendingTokens,
	setPendingTokens: (tokens) => {
		savePendingTokens(tokens)
		nip60Store.setState((s) => ({ ...s, pendingTokens: tokens }))
	},
}

/**
 * The single auction-host instance the two actions delegate to; built lazily and held once,
 * mirroring the lock, reclaim and receipt instances.
 */
let auctionHostInstance: ReturnType<typeof createAuctionHost> | null = null
const getAuctionHost = (): ReturnType<typeof createAuctionHost> => {
	auctionHostInstance ??= createAuctionHost(auctionHost)
	return auctionHostInstance
}

/**
 * Select proofs from available proofs to meet the target amount.
 * Returns selected proofs and their total value.
 */
function selectProofs(proofs: Proof[], amount: number): { selected: Proof[]; total: number } {
	// Sort proofs by amount (smallest first) for better selection
	const sorted = [...proofs].sort((a, b) => a.amount - b.amount)
	const selected: Proof[] = []
	let total = 0

	for (const proof of sorted) {
		if (total >= amount) break
		selected.push(proof)
		total += proof.amount
	}

	return { selected, total }
}

/**
 * Get all mints. The list is coco's — the source reads it straight off the coco store — so there
 * is no second list a balance can be attached to.
 */
function getAllMints(wallet: CashuWalletSource): string[] {
	return Array.from(new Set(wallet.mints ?? []))
}

/**
 * Get accurate balances directly from the wallet source's proof read. The source mirrors coco's
 * ready proofs, so this is the same money the rails will select inputs from.
 */
function getBalancesFromState(wallet: CashuWalletSource): { totalBalance: number; mintBalances: Record<string, number> } {
	const mintBalances: Record<string, number> = {}
	let totalBalance = 0

	for (const mint of getAllMints(wallet)) {
		const spendableProofs = getSpendableProofsForMint(wallet, mint)
		const balance = spendableProofs.reduce((sum, proof) => sum + proof.amount, 0)
		mintBalances[mint] = balance
		totalBalance += balance
	}

	return {
		totalBalance,
		mintBalances,
	}
}

/**
 * NDKZapper's `cashuPay` leg, over the coco-backed wallet source.
 *
 * `NDKZapper.zapNip61` calls this to get the funds for a nutzap and then builds, signs and
 * publishes the `kind:9321` itself; the return value it wants is `{ proofs, mint }`. The relay
 * wallet's own `cashuPay` was a cashu-ts `send` over its proof set, and the mint/flags it was
 * given are reproduced here exactly:
 *
 *   - the mint is the first of the payment's mints (or, when it names none, of the wallet's own
 *     mint list) with enough spendable balance;
 *   - `pubkey` is passed through **verbatim**, exactly as the relay wallet passed it — this leg
 *     does not prefix or normalise it. A NIP-61 nutzap lock key is already the `02`-prefixed
 *     cashu form by the time it reaches here (the recipient's `kind:10019` `pubkey` tag, via
 *     `toCashuP2pkPubkey` in `./nutzap`), and silently rewriting a key would lock funds to a
 *     different one;
 *   - `proofTags` is passed through as the relay wallet passed it. cashu-ts 2.9's `SendOptions`
 *     has no `tags` field (only `p2pk.additionalTags`), so the relay wallet's tags never reached
 *     the proof secret either — this leg does not invent them;
 *   - the consumed inputs are destroyed and the change is stored, in one write to coco.
 *
 * Returns `undefined` when there is no wallet, no fundable mint, or a non-sat unit — the same
 * "could not create a token" answer the relay wallet gave, which NDKZapper turns into a failed
 * zap rather than a fabricated one.
 */
interface NutzapCashuPayRequest {
	amount: number
	unit?: string
	mints?: string[]
	p2pk?: string
	proofTags?: string[][]
}

const cashuPay = async (payment: NutzapCashuPayRequest): Promise<{ proofs: Proof[]; mint: string } | undefined> => {
	const source = nip60Store.state.wallet
	if (!source) return undefined
	if (payment.unit && !payment.unit.startsWith('sat')) return undefined

	const amount = Math.floor(payment.amount)
	if (!Number.isFinite(amount) || amount <= 0) return undefined

	const mintCandidates = payment.mints?.length ? payment.mints : getAllMints(source)
	const targetMint = mintCandidates.find((mint) => {
		const balance = getSpendableProofsForMint(source, mint).reduce((sum, proof) => sum + proof.amount, 0)
		return balance >= amount
	})
	if (!targetMint) return undefined

	const proofsWeHave = getSpendableProofsForMint(source, targetMint)
	const { selected, total } = selectProofs(proofsWeHave, amount)
	if (total < amount) return undefined

	const { cashuWallet } = await createCashuWalletForMint(targetMint)
	const result = await cashuWallet.send(amount, selected, {
		proofsWeHave,
		...(payment.p2pk ? { pubkey: payment.p2pk } : {}),
	})

	await source.state.update({
		mint: targetMint,
		store: result.keep,
		destroy: selected,
	})

	return { proofs: result.send, mint: targetMint }
}

export const nip60Actions = {
	/**
	 * Bring the wallet up.
	 *
	 * The relay-event lifecycle that used to live here is gone, and that is the whole change:
	 *
	 *   - no kind-17375 fetch + `NDKCashuWallet.from` / `new` (there is no relay wallet to load);
	 *   - no `wallet.start({ pubkey })` (no kind-7375 token subscription to open);
	 *   - no `wallet.on('status_changed')` + `NDKWalletStatus` (coco's status is the store's own);
	 *   - no `wallet.publish()` (no kind-17375 event to republish) and no `wallet.stop()`.
	 *
	 * What replaces it is coco's own initialisation plus the coco-backed wallet source: coco is
	 * already the authority for proofs, mints and balances, so the store hydrates the source from
	 * it and projects the same numbers its consumers already read. The one-time key migration is
	 * run here (best effort) so the wallet's own P2PK pair is available to the reclaim path's
	 * legacy refund-key fallback before any bid needs it.
	 *
	 * The `pubkey` parameter is kept because `./ndk` is its only caller and the call site is not
	 * this module's to change yet; the authenticated user it names is what coco's init reads.
	 */
	initialize: async (_pubkey: string): Promise<void> => {
		const state = nip60Store.state

		// Don't re-initialize if already initializing or ready
		if (state.status === 'initializing') return
		if (state.status === 'ready' && state.wallet) return

		if (!ndkStore.state.ndk) {
			console.warn('[nip60] NDK not initialized')
			return
		}

		nip60Store.setState((s) => ({
			...s,
			status: 'initializing',
			error: null,
		}))

		try {
			// coco owns proofs, mints and balances now; bring it up (idempotent) and take the
			// wallet source it built. Without coco there is no wallet to spend from.
			await cashuActions.initialize()
			const wallet = cashuStore.state.walletSource
			if (!cashuStore.state.manager || !wallet) {
				throw new Error('Cashu wallet is not available')
			}

			await wallet.hydrate()

			nip60Store.setState((s) => ({
				...s,
				wallet,
			}))

			// The pair the auction HD root and the reclaim fallback derive from. Best effort: a
			// fresh profile with no wallet event yet has no pair, and that must not fail the
			// wallet's own startup — the auction paths raise for it when they actually need it.
			try {
				walletKeyMaterialCache = await resolveAuctionKeyMaterial()
			} catch (keyErr) {
				console.warn('[nip60] Wallet key material is not available yet:', keyErr)
			}

			// Dev-only bridge for e2e. It exposes read-only status and the wallet's OWN p2pk pair
			// (gated on isNip60WalletDevModeEnabled(), i.e. localhost/dev or an explicit
			// APP_NIP60_DEV_MODE flag — never `stage === 'staging'`, removed in M8). Nothing else
			// is exposed: there is no relay wallet object left to leak.
			if (typeof window !== 'undefined' && isNip60WalletDevModeEnabled()) {
				const material = walletKeyMaterialCache as WalletKeyMaterial | null
				;(window as any).__nip60Wallet = {
					getMints: () => getAllMints(wallet),
					getBalance: () => getBalancesFromState(wallet).totalBalance,
					getP2pk: async () => material?.walletP2pk ?? '',
					privkeys: new Map(material ? [[material.walletP2pk, { privateKey: material.walletPrivkey }]] : []),
				}
			}

			const { totalBalance, mintBalances } = getBalancesFromState(wallet)
			const allMints = getAllMints(wallet)

			nip60Store.setState((s) => ({
				...s,
				status: allMints.length > 0 || totalBalance > 0 ? 'ready' : 'no_wallet',
				balance: totalBalance,
				mints: allMints,
				mintBalances,
			}))

			// Load pending tokens from localStorage
			nip60Actions.loadPendingTokens()
			void nip60Actions.syncAuctionTransfers()

			// M8: This __nip60 exposure is safe — it only exposes test helpers
			// and non-sensitive status data (balance, mints, mintBalances). No
			// key material is included. Gated on isNip60WalletDevModeEnabled()
			// which no longer checks stage (M8 fix above).
			if (typeof window !== 'undefined' && isNip60WalletDevModeEnabled()) {
				;(window as any).__nip60 = {
					mintTestEcash: nip60Actions.mintTestEcash,
					getStatus: () => ({
						status: nip60Store.state.status,
						balance: nip60Store.state.balance,
						mints: nip60Store.state.mints,
						mintBalances: nip60Store.state.mintBalances,
					}),
					getDepositStatus: () => ({
						depositStatus: cashuStore.state.depositStatus,
						depositInvoice: cashuStore.state.depositInvoice,
						error: cashuStore.state.error,
					}),
					/**
					 * Dev-only: explicitly register a mint URL in the wallet.
					 * Exposed via the __nip60 bridge so e2e tests can call
					 * nip60Actions.addMint() after fundWallet to ensure the
					 * mint appears in the store before the deposit modal opens.
					 */
					addMint: nip60Actions.addMint,
				}
			}
		} catch (err) {
			console.error('[nip60] Failed to initialize wallet:', err)
			nip60Store.setState((s) => ({
				...s,
				status: 'error',
				error: err instanceof Error ? err.message : 'Failed to initialize wallet',
			}))
		}
	},

	/**
	 * Tear the wallet down. coco owns the manager and its repositories, so its own `reset`
	 * disposes them; this store only drops the projection (including the key-material cache) and
	 * can no longer leave a relay subscription open — there is none.
	 */
	reset: async (): Promise<void> => {
		walletKeyMaterialCache = null
		await cashuActions.reset()
		nip60Store.setState(() => initialState)
	},

	/**
	 * The auction HD account's xpub — the value an auction publishes as `p2pk_xpub`. The body
	 * now lives in `@/lib/wallet/auctionHost` (`createAuctionHost`) behind {@link AuctionHost};
	 * this is the store binding. It derives from the same key material
	 * `getAuctionHdChildPrivkey` uses, so the xpub an auction publishes and the child key the
	 * bidder later spends with can no longer disagree.
	 */
	getAuctionP2pkXpub: (): Promise<string> => getAuctionHost().getAuctionP2pkXpub(),

	getAuctionHdChildPrivkey: async (params: { derivationPath: string; expectedPubkey?: string }): Promise<string> => {
		const wallet = nip60Store.state.wallet
		if (!wallet || nip60Store.state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}

		// The pair comes from the app's key store now, not from the wallet's HD account. The
		// expected-pubkey guard lives in `walletKeys.deriveAuctionChildPrivkey`, which refuses
		// with the typed code `unexpected-child` rather than the hand-rolled string this threw.
		const material = await resolveAuctionKeyMaterial()
		return deriveAuctionChildPrivkey(material, {
			derivationPath: params.derivationPath,
			expectedPubkey: params.expectedPubkey,
		})
	},

	/**
	 * Attach a context to one pending token. The body now lives in `@/lib/wallet/auctionHost`
	 * (`createAuctionHost`) behind {@link AuctionHost}; this is the store binding. Returns the
	 * updated token, or null (writing nothing) when the id is unknown.
	 */
	updatePendingTokenContext: (tokenId: string, context: PendingTokenContext): PendingNip60Token | null =>
		getAuctionHost().updatePendingTokenContext(tokenId, context),

	markPendingAuctionBidTokensClaimed: (bidEventIds: string[]): void => {
		markPendingTokensByBidEventIds(bidEventIds, 'claimed')
	},

	/**
	 * Refresh the balance projection from the wallet source.
	 *
	 * `options.consolidate` is accepted and ignored on purpose. It used to drive a NUT-7
	 * spent-proof sweep (`consolidateProofs`), which existed only because the relay wallet's
	 * proof set could go stale: coco's `proofStateWatcher` is what does that job now, and the
	 * write path (`saveProofs` + `deleteProofs`) removes the consumed inputs as it goes. The
	 * parameter stays so the call sites that pass it (`bids.tsx`) are unchanged.
	 */
	refresh: async (_options?: { consolidate?: boolean }): Promise<void> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot refresh without wallet')
			return
		}

		// coco is the authority for the totals; re-read them and refresh the source's mirror,
		// then project the source's own per-mint money (the same proofs the rails will spend).
		await cashuActions.refreshBalances()
		const { totalBalance, mintBalances } = getBalancesFromState(wallet)

		nip60Store.setState((s) => ({
			...s,
			balance: totalBalance,
			mintBalances,
			mints: getAllMints(wallet),
		}))

		await nip60Actions.syncAuctionTransfers()
	},

	/**
	 * Register a mint with the wallet. The list is coco's, so this writes through coco (which
	 * re-reads and re-projects its own list) rather than appending to a local copy — a local
	 * append would be a second mint list, which is exactly what this store must not have.
	 */
	addMint: async (mintUrl: string): Promise<void> => {
		await cashuActions.addMint(mintUrl)
	},

	/**
	 * Set the default mint for deposits
	 */
	setDefaultMint: (mintUrl: string | null): void => {
		if (mintUrl) {
			localStorage.setItem(DEFAULT_MINT_KEY, mintUrl)
		} else {
			localStorage.removeItem(DEFAULT_MINT_KEY)
		}
		nip60Store.setState((s) => ({
			...s,
			defaultMint: mintUrl,
		}))
	},

	/**
	 * Send a NIP-61 nutzap from this NIP-60 wallet.
	 *
	 * The protocol half is NDK's `NDKZapper` (recipient `kind:10019` discovery, the `9321` it
	 * builds and signs, the publish to the recipient's relays) — unchanged. What changed is the
	 * one thing that used to come from the relay wallet: `cashuPay`, the leg that locks the
	 * funds. It is now {@link cashuPay} over the coco-backed source, so the money still leaves
	 * through one proof store.
	 */
	zapWithNutzap: async (params: { target: NDKEvent | NDKUser; amountSats: number; comment?: string }): Promise<Nip60NutzapResult> => {
		const wallet = nip60Store.state.wallet
		const ndk = ndkStore.state.ndk
		if (!wallet || nip60Store.state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}
		if (!ndk || !ndk.signer) {
			throw new Error('NDK signer not available')
		}

		const { target, amountSats, comment } = params
		if (!Number.isFinite(amountSats) || amountSats <= 0) {
			throw new Error('Invalid zap amount')
		}

		const zapper = new NDKZapper(target, amountSats * 1000, 'msat', {
			ndk,
			signer: ndk.signer,
			comment,
			cashuPay: async (payment) => cashuPay(payment),
		})

		const results = await zapper.zap(['nip61'])
		const nutzap = Array.from(results.values()).find((result): result is NDKNutzap => result instanceof NDKNutzap)
		if (!nutzap) {
			const error = Array.from(results.values()).find((result): result is Error => result instanceof Error)
			throw new Error(error?.message || 'Failed to send nutzap')
		}

		// The locked proofs left the wallet, so re-read the balance (coco's watcher also fires
		// on the proof write; this makes the UI right immediately).
		await cashuActions.refreshBalances()
		return { eventId: nutzap.id, event: nutzap }
	},

	/**
	 * The P2PK lock moved to `@/lib/wallet/auctionFunds`, behind {@link AuctionLockHost}. The action
	 * keeps its signature and delegates 1:1.
	 */
	lockAuctionBidFunds: async (params: LockAuctionBidFundsParams): Promise<LockAuctionBidFundsResult> =>
		getAuctionLock().lockAuctionBidFunds(params),

	/**
	 * Dev-only helper: mint free test ecash from configured dev mints into the NIP-60 wallet.
	 */
	mintTestEcash: async (
		amount: number,
		mintUrl: string = DEV_TEST_MINT_URL,
		options?: { allowFallback?: boolean },
	): Promise<Nip60TestMintResult> => {
		if (!isNip60WalletDevModeEnabled()) {
			throw new Error('Dev wallet actions are disabled in this environment')
		}

		const wallet = nip60Store.state.wallet
		if (!wallet || (nip60Store.state.status !== 'ready' && nip60Store.state.status !== 'no_wallet')) {
			throw new Error('NIP-60 wallet not ready')
		}

		const mintAmount = Math.floor(amount)
		if (!Number.isFinite(mintAmount) || mintAmount <= 0) {
			throw new Error('Mint amount must be a positive integer')
		}
		const allowFallback = options?.allowFallback ?? true
		const normalizedPreferredMint = mintUrl.trim().replace(/\/$/, '')
		const candidates = allowFallback
			? getDevTestMintCandidates(mintUrl)
			: normalizedPreferredMint
				? [normalizedPreferredMint]
				: getDevTestMintCandidates(mintUrl)
		const failures: string[] = []

		for (const targetMint of candidates) {
			try {
				const { cashuWallet, keysetId } = await createCashuWalletForMint(targetMint)
				const quote = await cashuWallet.createMintQuote(mintAmount)
				const proofs = await cashuWallet.mintProofs(mintAmount, quote.quote, keysetId ? { keysetId } : undefined)

				if (!proofs.length) {
					throw new Error('Mint returned no proofs')
				}

				await wallet.state.update({
					store: proofs,
					mint: targetMint,
				})

				if (!getAllMints(wallet).includes(targetMint)) {
					await cashuActions.addMint(targetMint)
				}
				if (!nip60Store.state.defaultMint) {
					nip60Actions.setDefaultMint(targetMint)
				}

				await nip60Actions.refresh()

				if (nip60Store.state.status !== 'ready') {
					nip60Store.setState((s) => ({ ...s, status: 'ready' }))
				}

				return {
					mintUrl: targetMint,
					amount: mintAmount,
					quoteId: quote.quote,
					proofsMinted: proofs.length,
				}
			} catch (err) {
				failures.push(`${targetMint}: ${getErrorMessage(err)}`)
			}
		}

		throw new Error(`Failed to mint test ecash from dev mints: ${failures.join('; ')}`)
	},

	/**
	 * Dev-only helper: pick a live seeded auction on the user's relays,
	 * top up the wallet with test ecash if needed, and publish a bid via
	 * the bidder-held-path flow. Restored in Phase 3 — delegates the
	 * heavy lifting to `publishAuctionBid` so this helper stays a thin
	 * UX wrapper rather than reimplementing the bid pipeline.
	 */
	placeDevBidOnSeededAuction: async (params?: {
		preferredBidAmount?: number
		preferredMintUrl?: string
	}): Promise<Nip60DevAuctionBidResult> => {
		if (!isNip60WalletDevModeEnabled()) {
			throw new Error('Dev wallet actions are disabled in this environment')
		}

		const wallet = nip60Store.state.wallet
		if (!wallet || nip60Store.state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}

		const signer = ndkActions.getSigner()
		if (!signer) throw new Error('No signer available')
		const bidder = await signer.user()

		// Find a live auction. We pull recent kind-30408 events and
		// filter to ones that (a) we're not the seller of and (b) still
		// have time on the clock.
		const now = Math.floor(Date.now() / 1000)
		const auctions = Array.from(await ndkActions.fetchEventsWithTimeout({ kinds: [AUCTION_KIND], limit: 100 }, { timeoutMs: 5000 }))
		const candidates = auctions.filter((auction) => {
			if (auction.pubkey === bidder.pubkey) return false
			const endAt = parseNonNegativeInt(getFirstTagValue(auction, 'end_at'), 0)
			const maxEndAt = parseNonNegativeInt(getFirstTagValue(auction, 'max_end_at'), 0) || endAt
			if (!endAt || maxEndAt <= now) return false
			const startAt = parseNonNegativeInt(getFirstTagValue(auction, 'start_at'), 0)
			if (startAt && startAt > now) return false
			return true
		})
		if (!candidates.length) throw new Error('No live seeded auction available to bid on')
		const selected = candidates[Math.floor(Math.random() * candidates.length)]

		// Pull the auction fields the publish flow needs.
		const dTag = getFirstTagValue(selected, 'd')
		const auctionCoordinates = dTag ? `${AUCTION_KIND}:${selected.pubkey}:${dTag}` : ''
		if (!auctionCoordinates) throw new Error('Selected auction has no `d` tag')
		const p2pkXpub = getFirstTagValue(selected, 'p2pk_xpub')
		if (!p2pkXpub) throw new Error('Selected auction is missing p2pk_xpub')
		const startAt = parseNonNegativeInt(getFirstTagValue(selected, 'start_at'), 0)
		const endAt = parseNonNegativeInt(getFirstTagValue(selected, 'end_at'), 0)
		const maxEndAt = parseNonNegativeInt(getFirstTagValue(selected, 'max_end_at'), 0) || endAt
		const settlementGraceSeconds =
			parseNonNegativeInt(getFirstTagValue(selected, 'settlement_grace'), 0) || getAuctionSettlementGraceSeconds()
		const startingBid = parseNonNegativeInt(getFirstTagValue(selected, 'starting_bid'), 0)
		const bidIncrement = parseNonNegativeInt(getFirstTagValue(selected, 'bid_increment'), 0) || 100
		const trustedMints = selected.tags.filter((tag) => tag[0] === 'mint' && tag[1]).map((tag) => tag[1])

		// Decide the bid amount: caller's preference, or a minimum
		// increment over the current top bid.
		const existingBids = Array.from(
			await ndkActions.fetchEventsWithTimeout({ kinds: [AUCTION_BID_KIND], '#e': [selected.id], limit: 200 }, { timeoutMs: 5000 }),
		)
		const currentTop = existingBids.reduce((max, bid) => {
			const amount = parseNonNegativeInt(getFirstTagValue(bid, 'amount'), 0)
			return amount > max ? amount : max
		}, 0)
		const minBid = currentTop > 0 ? currentTop + bidIncrement : startingBid
		const preferred = params?.preferredBidAmount ? Math.floor(params.preferredBidAmount) : minBid
		const bidAmount = Math.max(minBid, Number.isFinite(preferred) && preferred > 0 ? preferred : minBid)

		// Top up the wallet at the chosen mint if it can't cover the
		// bid. mintTestEcash works against the public testnut mints
		// only — that's a dev-only assumption, fine here.
		const mintForLock = params?.preferredMintUrl?.trim() || trustedMints[0]
		if (!mintForLock) throw new Error('Selected auction has no trusted mint')
		const { mintBalances } = getBalancesFromState(wallet)
		const balanceAtMint = mintBalances[mintForLock] ?? 0
		if (balanceAtMint < bidAmount) {
			const topUpAmount = bidAmount - balanceAtMint + 1000 // small safety buffer for fees / future bids
			await nip60Actions.mintTestEcash(topUpAmount, mintForLock)
		}

		const { publishAuctionBid } = await import('@/publish/auctions')
		type AuctionBidFormData = Parameters<typeof publishAuctionBid>[0]
		const formData: AuctionBidFormData = {
			auctionEventId: selected.id,
			auctionCoordinates,
			amount: bidAmount,
			auctionStartAt: startAt,
			auctionEffectiveEndAt: maxEndAt,
			auctionLocktimeAt: maxEndAt,
			settlementGraceSeconds,
			sellerPubkey: selected.pubkey,
			p2pkXpub,
			mintCandidates: trustedMints.length ? trustedMints : [mintForLock],
		}

		const bidEventId = await publishAuctionBid(formData)

		return {
			bidEventId,
			auctionEventId: selected.id,
			auctionCoordinates,
			auctionTitle: getFirstTagValue(selected, 'title') || 'untitled',
			mintUrl: mintForLock,
			bidAmount,
			minBid,
			topUpAmount: Math.max(0, bidAmount - balanceAtMint),
		}
	},

	/**
	 * Receive a P2PK-locked Cashu token and swap it into the wallet's
	 * spendable proofs. The caller MUST pass the unlocking `privkey`
	 * derived from `seller_xpriv + derivation_path`. `mintUrl` is
	 * optional but strongly recommended: cashu-ts ≥2.x emits NUT-2 v2
	 * short keyset IDs by default, and `getDecodedToken(token)`
	 * without a keyset map cannot expand them — it throws "A short
	 * keyset ID v2 was encountered, but got no keysets to map it to."
	 * The seller settlement path knows the mint from the winning bid
	 * event, so it can pass it in and skip the decode-to-find-mint
	 * step entirely.
	 */
	receiveLockedEcash: async (token: string, privkey: string, mintUrl?: string): Promise<boolean> =>
		getAuctionReceipt().receiveLockedEcash(token, privkey, mintUrl),

	/**
	 * Fetch a mint's current keysets — required to pass into
	 * `getDecodedToken` for tokens that carry NUT-2 v2 short keyset
	 * IDs (cashu-ts ≥2.x emits these by default). Used by the
	 * auction settlement preflight before `getDecodedToken`.
	 *
	 * Returns an empty array on failure — callers should treat this
	 * as "decode without keysets and hope the token uses long IDs",
	 * which is fine for older tokens but will surface the original
	 * "short keyset ID" error for new ones, giving the seller a
	 * useful actionable message instead of a silent hang.
	 */
	loadAuctionMintKeysets: async (mintUrl: string): Promise<import('@cashu/cashu-ts').MintKeyset[]> =>
		loadAuctionMintKeysets(auctionFundsMintAccess, mintUrl),

	/**
	 * Auction transfer sweep — under the path-oracle profile this is just
	 * the locktime-refund auto-sweep (AUCTIONS.md §8.1). The legacy
	 * `auction_refund_v1` DM ingestion has been removed: refund delivery
	 * isn't part of the v1 path-oracle protocol because the issuer holds
	 * no Cashu key material and can't proactively spend a loser's locked
	 * proofs (see spec §8.1). Losing bidders self-refund here.
	 */
	syncAuctionTransfers: async (): Promise<void> => {
		await getAuctionReclaim().autoReclaimTimelockedBids()
	},

	/**
	 * Load pending tokens from localStorage
	 */
	loadPendingTokens: (): void => {
		const tokens = loadPendingTokens()
		nip60Store.setState((s) => ({ ...s, pendingTokens: tokens }))
	},

	/**
	 * Reclaim a pending token (if the recipient hasn't claimed it yet).
	 *
	 * The whole reclaim money path — readiness from the proof secret (not the cached context),
	 * the refund-key preference (bidder record → pre-lock recovery record → the wallet's key
	 * map), the `receiveTokenWithPrivkey` mint call, the pending-token bookkeeping and the
	 * error semantics — now lives in `@/lib/wallet/auctionFunds` (`createAuctionReclaim`),
	 * behind `AuctionReclaimHost`. This action is the thin store binding; the host is read
	 * lazily per call, so a wallet that appears later is still seen and the sweep's throttle
	 * is shared across calls.
	 */
	reclaimToken: (tokenId: string, options?: { manual?: boolean }): Promise<void> => getAuctionReclaim().reclaimToken(tokenId, options),

	/**
	 * Silently reclaim every pending auction bid whose P2PK timelock has expired. Throttled to
	 * at most one sweep per AUCTION_AUTO_RECLAIM_MIN_INTERVAL_MS — the throttle state lives on
	 * the single `getAuctionReclaim()` instance — and skips tokens that are in cooldown or
	 * marked permanently-failed, so a bad token can't loop the bid flow into 429s.
	 */
	autoReclaimTimelockedBids: (): Promise<void> => getAuctionReclaim().autoReclaimTimelockedBids(),

	/**
	 * Remove a pending token from the list
	 */
	removePendingToken: (tokenId: string): void => {
		const pendingTokens = nip60Store.state.pendingTokens.filter((t) => t.id !== tokenId)
		savePendingTokens(pendingTokens)
		nip60Store.setState((s) => ({ ...s, pendingTokens }))
	},

	/**
	 * Bulk-remove pending tokens by id. Used by the Bids UI to drop orphaned
	 * lock attempts from localStorage in one click. Does NOT touch the mint
	 * — the locked sats stay there and can only be reclaimed by a wallet that
	 * still holds the original refund privkey.
	 */
	removePendingTokens: (tokenIds: string[]): number => {
		if (!tokenIds.length) return 0
		const idSet = new Set(tokenIds)
		const before = nip60Store.state.pendingTokens.length
		const pendingTokens = nip60Store.state.pendingTokens.filter((t) => !idSet.has(t.id))
		if (pendingTokens.length === before) return 0
		savePendingTokens(pendingTokens)
		nip60Store.setState((s) => ({ ...s, pendingTokens }))
		return before - pendingTokens.length
	},

	/**
	 * Get active pending tokens (not claimed or reclaimed)
	 */
	getActivePendingTokens: (): PendingNip60Token[] => {
		return nip60Store.state.pendingTokens.filter((t) => t.status === 'pending')
	},
}

export const useNip60 = () => {
	return {
		...nip60Store.state,
		...nip60Actions,
	}
}
