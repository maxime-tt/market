/**
 * walletOps.ts — the wallet's action surface: the auction rails, the NIP-61 zap sender, the dev
 * helpers and the pending-token bookkeeping, bound to the coco-backed store in `./cashu`.
 *
 * This module holds no state of its own. Every field it used to own lives on `cashuStore` now
 * (`walletSource`, `balances`, `mints`, `status`, `pendingTokens`, `defaultMint`), and every
 * closure below reads it live, so there is exactly one wallet state and one proof store behind
 * these actions. What is left here is the glue the store should not carry: the parts that need
 * the NDK signer, the relay read for the one-time key migration, and the module-level singletons
 * (the lock, reclaim, receipt and host instances) whose lazy construction keeps the store free of
 * an import cycle.
 *
 * Why a sibling module rather than folding these onto the store object: several tests isolate
 * this surface with `mock.module()` (bun applies module mocks process-wide for a whole run), and
 * `@/lib/stores/cashu` is imported by deposit, mint-authority and adapter tests that must keep
 * seeing the real store. A separate module keeps that mock pointed at the same narrowly-consumed
 * module it pointed at before the cut.
 */
import {
	createAuctionHost,
	createAuctionLock,
	createAuctionReclaim,
	createAuctionReceipt,
	DEV_TEST_MINT_URL,
	deriveAuctionChildPrivkey,
	getSpendableProofsForMint,
	isWalletDevModeEnabled,
	loadAuctionMintKeysets,
	provisionWalletKeyMaterial,
	WALLET_DEV_TEST_MINTS,
	walletKeyPortFromKeyRing,
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
	type WalletKeyMaterial,
} from '@sdk/commerce/payments/wallet'
import { getMintHostname } from '@sdk/commerce/payments/display'
import { auctionP2pkPubkeysMatch } from '@sdk/commerce/auctions/auctionP2pk'
import { AUCTION_SETTLEMENT_GRACE_DEFAULT_SECONDS } from '@sdk/commerce/auctions/constants'
import { getActiveSignerCapability } from '@platform/web/auth/authStore'
import { KeyChain, Mint, Wallet, schnorrSignDigest, type MintKeys, type MintKeyset, type Proof } from '@cashu/cashu-ts'
import type { ArenaWalletSpendSigner } from '@platform/web/auctions/relay/arenaBidFunding'
import { NDKEvent, NDKNutzap, NDKUser, NDKZapper, type NDKFilter } from '@nostr-dev-kit/ndk'
import { fetchEventsWithTimeout, getAppNdk } from '@platform/web/ndkPublishContext'
import { cashuActions, cashuStore } from '@platform/web/wallet/cashuStore'
import { getCurrentPubkey } from '@platform/web/readContext'

// The wallet state this surface reads and writes lives here. Re-exported so a `platform/` or
// `sdk/` consumer reaches the store and the rails through ONE src/ import — the source-boundary
// guard only ratchets down, and a second import line would ratchet it up.
export { cashuStore } from '@platform/web/wallet/cashuStore'
// The pending-token shape, the reclaim-timing helpers and the lock's parameter/result types and
// error live with the rails in `@/lib/wallet`; re-exported for the same single-import reason.
export type { PendingToken } from '@sdk/commerce/payments/wallet'
export type { AuctionP2pkKeyScheme, LockAuctionBidFundsParams, LockAuctionBidFundsResult } from '@sdk/commerce/payments/wallet'
export { AuctionBidLockMutationPossibleError } from '@sdk/commerce/payments/wallet'
export {
	AUCTION_RECLAIM_SKEW_BUFFER_SECONDS,
	formatReclaimWaitSeconds,
	getAuctionReclaimReadyAt,
	getAuctionReclaimReadyAtForGroup,
} from '@sdk/commerce/payments/wallet'

export interface WalletNutzapResult {
	eventId: string
	event: NDKNutzap
}

export interface WalletTestMintResult {
	mintUrl: string
	amount: number
	quoteId: string
	proofsMinted: number
}

export interface WalletDevAuctionBidResult {
	bidEventId: string
	auctionEventId: string
	auctionCoordinates: string
	auctionTitle: string
	mintUrl: string
	bidAmount: number
	minBid: number
	topUpAmount: number
}

const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

const getDevTestMintCandidates = (preferredMintUrl?: string): string[] => {
	const normalizedPreferredMint = preferredMintUrl ? normalizeMintUrl(preferredMintUrl) : ''
	const preferred = normalizedPreferredMint && WALLET_DEV_TEST_MINTS.includes(normalizedPreferredMint) ? [normalizedPreferredMint] : []
	return Array.from(new Set([...preferred, ...WALLET_DEV_TEST_MINTS].filter(Boolean)))
}

const isKeysetVerificationError = (err: unknown): err is Error => err instanceof Error && err.message.includes("Couldn't verify keyset ID")

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const getDevTestMintKeyset = async (cashuMint: Mint, targetMint: string): Promise<{ keysets: MintKeyset[]; mintKeys: MintKeys }> => {
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

const createCashuWalletForMint = async (targetMint: string): Promise<{ cashuWallet: Wallet; keysetId?: string }> => {
	const normalizedTargetMint = normalizeMintUrl(targetMint)
	const cashuMint = new Mint(normalizedTargetMint)
	const cashuWallet = new Wallet(cashuMint)

	try {
		await cashuWallet.loadMint()
		return { cashuWallet }
	} catch (err) {
		if (!isWalletDevModeEnabled() || !WALLET_DEV_TEST_MINTS.includes(normalizedTargetMint) || !isKeysetVerificationError(err)) {
			throw err
		}

		// testnut is currently serving a keyset ID that cashu-ts rejects. Seed the dev wallet
		// with the raw keyset metadata so we can keep exercising the faucet flow in dev mode.
		// cashu-ts v5 drops the old constructor `{ keysets, keys }` options: a pre-fetched
		// keyset set is loaded through `loadMintFromCache` with a `KeyChainCache` instead.
		const { keysets, mintKeys } = await getDevTestMintKeyset(cashuMint, normalizedTargetMint)
		const mintInfo = await cashuMint.getInfo()
		cashuWallet.loadMintFromCache(mintInfo, KeyChain.mintToCacheDTO(normalizedTargetMint, keysets, [mintKeys]))
		return {
			cashuWallet,
			keysetId: mintKeys.id,
		}
	}
}

const getFirstTagValue = (event: NDKEvent, tagName: string): string => event.tags.find((tag) => tag[0] === tagName)?.[1] || ''

const parseNonNegativeInt = (value: string, fallback: number = 0): number => {
	const parsed = parseInt(value, 10)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const AUCTION_KIND = 30408 as unknown as NonNullable<NDKFilter['kinds']>[number]
const AUCTION_BID_KIND = 1023 as unknown as NonNullable<NDKFilter['kinds']>[number]

/**
 * The wallet's own P2PK pair, as a synchronous lookup, so the reclaim host's legacy refund-key
 * fallback keeps its old meaning ("the key the wallet itself holds"). It is filled from the
 * wallet's coco key ring — the seed-derived pair the auction HD root and the escrow lock both
 * derive from — and is filled on demand by {@link walletOps.ensureAuctionWalletKey}, so a wallet
 * that was not ready at login is no longer stranded for the session.
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
 * The wallet spend key as a **signing surface**, for the escrow's two outcome
 * templates.
 *
 * The consolidated protocol requires the bidder to pre-sign its settle and
 * refund templates with the wallet key that owns the 2-of-2 lock — not with the
 * Nostr identity (`notes/HANDOVER-consolidated-auction-client.md`: the identity
 * authorises the event, the wallet owns value and holds its own spend key).
 * This is the narrowest way to give `arenaBidFunding` that signature without
 * ever handing it the private key: it can sign a 32-byte digest and nothing
 * else. The pair is the same one the auction HD root derives from, so the lock
 * and the app's existing reclaim path agree about who owns the money.
 *
 * Answers `null` until {@link walletOps.ensureAuctionWalletKey} has resolved the pair from
 * coco's key ring; a caller must then say the bid is unfunded rather than invent a key.
 */
const getAuctionBidWalletSigner = (): ArenaWalletSpendSigner | null => {
	const material: WalletKeyMaterial | null = walletKeyMaterialCache
	if (!material) return null
	return {
		pubkey: material.walletP2pk,
		signDigest: (digestHex: string) => schnorrSignDigest(digestHex, material.walletPrivkey),
	}
}

/**
 * Resolve the wallet key material the auction HD root derives from, for the authenticated owner,
 * by provisioning it from the wallet's own coco key ring.
 *
 * The pair is the key ring's latest `p2pk` keypair — seed-derived, generated on first use by
 * `provisionWalletKeyMaterial` when the ring holds none — and nothing is read from, or written
 * to, a relay. `manager.keyring` is coco's own ring, so the pair has exactly one home and no
 * duplicate copy is kept.
 *
 * The owner pubkey is the one the wallet is signed in as. Without it the pair cannot be attributed
 * to an owner, so it is refused — the same fail-closed stance `walletKeys` takes for material it
 * cannot trust.
 *
 * NOTE (relay path, unwired pending a follow-up): the legacy one-way migration is no longer called
 * from here. The owner wants a separate functionality to import legacy wallets later, so
 * `migrateWalletKeyMaterial`, `createRelayWalletKeyMigrationSource`/`createWalletEventReader` and
 * the sealed `createAppWalletKeyStore` stay in the tree — intact and tested — and are simply no
 * longer wired to the auction paths.
 */
const resolveAuctionKeyMaterial = async (): Promise<WalletKeyMaterial> => {
	const ownerCapability = getActiveSignerCapability()
	const ownerPubkey = ownerCapability ? await ownerCapability.getPublicKey().catch(() => '') : ''
	if (!ownerPubkey) {
		throw new Error('The wallet is not signed in, so it cannot name a spend key yet')
	}

	const manager = cashuStore.state.manager
	if (!manager) {
		throw new Error('The wallet is not ready, so it cannot name a spend key yet')
	}

	return provisionWalletKeyMaterial({ port: walletKeyPortFromKeyRing(manager.keyring, ownerPubkey), ownerPubkey })
}

/**
 * The mint/keyset port the extracted receive needs. It is this module's own
 * `createCashuWalletForMint`, with its dev-test-mint keyset fallback intact, injected so
 * `@/lib/wallet/auctionFunds` never reaches back into the store for a mint.
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
		getWallet: () => cashuStore.state.walletSource,
		isWalletReady: () => cashuStore.state.status === 'ready',
		mint: auctionFundsMintAccess,
		getWalletPrivkey: (pubkey) => getWalletPrivkey(pubkey),
		getWalletPrivkeyCount: () => (walletKeyMaterialCache ? 1 : 0),
		getPendingTokens: () => cashuStore.state.pendingTokens,
		setPendingTokens: (tokens) => cashuActions.setPendingTokens(tokens),
		refresh: () => walletOps.refresh(),
		getCurrentPubkey: () => getCurrentPubkey(),
	})
	return auctionReclaimInstance
}

/**
 * The host the lock reads the store through: wallet, readiness, balances, default mint and the
 * pending-token bookkeeping. All closures, so the lock sees the store's live state.
 */
const auctionLockHost: AuctionLockHost = {
	getWallet: () => cashuStore.state.walletSource,
	isWalletReady: () => cashuStore.state.status === 'ready',
	mint: auctionFundsMintAccess,
	getBalances: () => {
		const wallet = cashuStore.state.walletSource
		return wallet ? getBalancesFromState(wallet) : { totalBalance: 0, mintBalances: {} }
	},
	getDefaultMint: () => cashuStore.state.defaultMint,
	getPendingTokens: () => cashuStore.state.pendingTokens,
	setPendingTokens: (tokens, options) => {
		cashuActions.setPendingTokens(tokens, options)
	},
	setWalletBalances: ({ balance, mintBalances }) => {
		// The mint list is coco's and is left alone; only the money projection is written here.
		cashuStore.setState((s) => ({ ...s, totalBalance: balance, balances: mintBalances }))
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
	getWallet: () => cashuStore.state.walletSource,
	mint: auctionFundsMintAccess,
	refresh: () => walletOps.refresh(),
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
	isWalletReady: () => cashuStore.state.status === 'ready',
	resolveKeyMaterial: () => resolveAuctionKeyMaterial(),
	getPendingTokens: () => cashuStore.state.pendingTokens,
	setPendingTokens: (tokens) => {
		cashuActions.setPendingTokens(tokens)
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
	// cashu-ts v5 `Proof.amount` is an `Amount` value object; ordering uses its comparator and
	// the running total is sat-denominated (always a safe integer).
	const sorted = [...proofs].sort((a, b) => a.amount.compareTo(b.amount))
	const selected: Proof[] = []
	let total = 0

	for (const proof of sorted) {
		if (total >= amount) break
		selected.push(proof)
		total += proof.amount.toNumber()
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
		const balance = spendableProofs.reduce((sum, proof) => sum + proof.amount.toNumber(), 0)
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
	const source = cashuStore.state.walletSource
	if (!source) return undefined
	if (payment.unit && !payment.unit.startsWith('sat')) return undefined

	const amount = Math.floor(payment.amount)
	if (!Number.isFinite(amount) || amount <= 0) return undefined

	const mintCandidates = payment.mints?.length ? payment.mints : getAllMints(source)
	const targetMint = mintCandidates.find((mint) => {
		const balance = getSpendableProofsForMint(source, mint).reduce((sum, proof) => sum + proof.amount.toNumber(), 0)
		return balance >= amount
	})
	if (!targetMint) return undefined

	const proofsWeHave = getSpendableProofsForMint(source, targetMint)
	const { selected, total } = selectProofs(proofsWeHave, amount)
	if (total < amount) return undefined

	const { cashuWallet } = await createCashuWalletForMint(targetMint)
	// cashu-ts v5 splits send options: proof/selection config in the third argument, and the
	// output shape (a NUT-11 P2PK lock for a nutzap) in the fourth.
	const result = await cashuWallet.send(
		amount,
		selected,
		{ proofsWeHave },
		payment.p2pk ? { send: { type: 'p2pk', options: { kind: 'P2PK', data: payment.p2pk } } } : undefined,
	)

	await source.state.update({
		mint: targetMint,
		store: result.keep,
		destroy: selected,
	})

	return { proofs: result.send, mint: targetMint }
}

export const walletOps = {
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
	 * What it does is coco's own initialisation plus the coco-backed wallet source: coco is
	 * already the authority for proofs, mints and balances, so this hydrates the source from it
	 * and projects nothing of its own. The one-time key migration is run here (best effort) so
	 * the wallet's own P2PK pair is available to the reclaim path's legacy refund-key fallback
	 * before any bid needs it.
	 *
	 * Takes no argument. The sign-in pipeline used to pass the authenticated user's pubkey and
	 * the body never read it — coco's init resolves the signer from the stores itself.
	 */
	initialize: async (): Promise<void> => {
		if (cashuStore.state.status === 'ready' && cashuStore.state.walletSource) return

		await cashuActions.initialize()
		const wallet = cashuStore.state.walletSource
		if (!cashuStore.state.manager || !wallet) {
			throw new Error('Cashu wallet is not available')
		}

		await wallet.hydrate()

		// The pair the auction HD root and the reclaim fallback derive from. Best effort at
		// startup: a wallet that is not ready yet must not fail the wallet's own startup, and
		// the auction paths call `ensureAuctionWalletKey()` again on demand — that call retries,
		// so this is no longer a single shot that strands the wallet for the session.
		try {
			await walletOps.ensureAuctionWalletKey()
		} catch (keyErr) {
			console.warn('[wallet] Wallet key material is not available yet:', keyErr)
		}

		// Dev-only bridge for e2e. It exposes read-only status and the wallet's OWN p2pk pair
		// (gated on isWalletDevModeEnabled(), i.e. localhost/dev or an explicit
		// APP_NIP60_DEV_MODE flag — never `stage === 'staging'`, removed in M8). Nothing else
		// is exposed: there is no relay wallet object left to leak.
		if (typeof window !== 'undefined' && isWalletDevModeEnabled()) {
			const material = walletKeyMaterialCache as WalletKeyMaterial | null
			// The bridge names are frozen: e2e specs read `window.__nip60Wallet` by name and
			// cannot be run from here, so they keep the names they were written against.
			;(window as any).__nip60Wallet = {
				getMints: () => getAllMints(wallet),
				getBalance: () => getBalancesFromState(wallet).totalBalance,
				getP2pk: async () => material?.walletP2pk ?? '',
				privkeys: new Map(material ? [[material.walletP2pk, { privateKey: material.walletPrivkey }]] : []),
			}
		}

		cashuActions.loadPendingTokens()
		void walletOps.syncAuctionTransfers()

		// M8: This __nip60 exposure is safe — it only exposes test helpers
		// and non-sensitive status data (balance, mints, balances). No
		// key material is included. Gated on isWalletDevModeEnabled()
		// which no longer checks stage (M8 fix above).
		if (typeof window !== 'undefined' && isWalletDevModeEnabled()) {
			;(window as any).__nip60 = {
				mintTestEcash: walletOps.mintTestEcash,
				getStatus: () => ({
					status: cashuStore.state.status,
					balance: cashuStore.state.totalBalance,
					mints: cashuStore.state.mints,
					balances: cashuStore.state.balances,
				}),
				getDepositStatus: () => ({
					depositStatus: cashuStore.state.depositStatus,
					depositInvoice: cashuStore.state.depositInvoice,
					error: cashuStore.state.error,
				}),
				/**
				 * Dev-only: explicitly register a mint URL in the wallet.
				 * Exposed via the __nip60 bridge so e2e tests can call
				 * walletOps.addMint() after fundWallet to ensure the
				 * mint appears in the store before the deposit modal opens.
				 */
				addMint: walletOps.addMint,
			}
		}
	},

	/**
	 * Tear the wallet down. coco owns the manager and its repositories, so its own `reset`
	 * disposes them; this drops the projection's key-material cache and can no longer leave a
	 * relay subscription open — there is none.
	 */
	reset: async (): Promise<void> => {
		walletKeyMaterialCache = null
		await cashuActions.reset()
	},

	/**
	 * The auction HD account's xpub — the value an auction publishes as `p2pk_xpub`. The body
	 * lives in `@/lib/wallet/auctionHost` (`createAuctionHost`) behind {@link AuctionHost};
	 * this is the binding. It derives from the same key material `getAuctionHdChildPrivkey`
	 * uses, so the xpub an auction publishes and the child key the bidder later spends with can
	 * no longer disagree.
	 */
	getAuctionP2pkXpub: (): Promise<string> => getAuctionHost().getAuctionP2pkXpub(),

	getAuctionHdChildPrivkey: async (params: { derivationPath: string; expectedPubkey?: string }): Promise<string> => {
		const wallet = cashuStore.state.walletSource
		if (!wallet || cashuStore.state.status !== 'ready') {
			throw new Error('Cashu wallet not ready')
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
	 * Attach a context to one pending token. The body lives in `@/lib/wallet/auctionHost`
	 * (`createAuctionHost`) behind {@link AuctionHost}; this is the binding. Returns the
	 * updated token, or null (writing nothing) when the id is unknown.
	 */
	updatePendingTokenContext: (tokenId: string, context: PendingTokenContext): PendingToken | null =>
		getAuctionHost().updatePendingTokenContext(tokenId, context),

	markPendingAuctionBidTokensClaimed: (bidEventIds: string[]): void => {
		if (!bidEventIds.length) return
		const wanted = new Set(bidEventIds)
		const pendingTokens = cashuStore.state.pendingTokens.map((token) => {
			const context = token.context
			if (context?.kind !== 'auction_bid') return token
			if (!context.bidEventId || !wanted.has(context.bidEventId)) return token
			return { ...token, status: 'claimed' as const }
		})
		cashuActions.setPendingTokens(pendingTokens)
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
		const wallet = cashuStore.state.walletSource
		if (!wallet) {
			console.warn('[wallet] Cannot refresh without wallet')
			return
		}

		// coco is the authority for the totals; re-read them and refresh the source's mirror,
		// then project the source's own per-mint money (the same proofs the rails will spend).
		await cashuActions.refreshBalances()
		const { totalBalance, mintBalances } = getBalancesFromState(wallet)

		cashuStore.setState((s) => ({
			...s,
			totalBalance,
			balances: mintBalances,
		}))

		await walletOps.syncAuctionTransfers()
	},

	/**
	 * Register a mint with the wallet. The list is coco's, so this writes through coco (which
	 * re-reads and re-projects its own list) rather than appending to a local copy — a local
	 * append would be a second mint list, which is exactly what the store must not have.
	 */
	addMint: async (mintUrl: string): Promise<void> => {
		await cashuActions.addMint(mintUrl)
	},

	/** Set the default mint for deposits. */
	setDefaultMint: (mintUrl: string | null): void => {
		cashuActions.setDefaultMint(mintUrl)
	},

	/**
	 * Send a NIP-61 nutzap from this wallet.
	 *
	 * The protocol half is NDK's `NDKZapper` (recipient `kind:10019` discovery, the `9321` it
	 * builds and signs, the publish to the recipient's relays) — unchanged. What changed is the
	 * one thing that used to come from the relay wallet: `cashuPay`, the leg that locks the
	 * funds. It is now {@link cashuPay} over the coco-backed source, so the money still leaves
	 * through one proof store.
	 */
	zapWithNutzap: async (params: { target: NDKEvent | NDKUser; amountSats: number; comment?: string }): Promise<WalletNutzapResult> => {
		const wallet = cashuStore.state.walletSource
		const ndk = getAppNdk()
		if (!wallet || cashuStore.state.status !== 'ready') {
			throw new Error('Cashu wallet not ready')
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
			cashuPay: async (payment) => {
				const result = await cashuPay(payment)
				if (!result) return undefined
				// @nostr-dev-kit/ndk still types its cashu callback against cashu-ts v2 proofs
				// (`amount: number`). cashu-ts v5 makes `Proof.amount` an `Amount` value object,
				// so the amount is converted back to a plain sat number at this boundary —
				// NDK's nutzap serialisation and balance math keep seeing the shape they expect.
				return {
					mint: result.mint,
					proofs: result.proofs.map((proof) => ({ ...proof, amount: proof.amount.toNumber() })),
				}
			},
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
	 * The P2PK lock lives in `@/lib/wallet/auctionFunds`, behind {@link AuctionLockHost}. The
	 * action keeps its signature and delegates 1:1.
	 */
	lockAuctionBidFunds: async (params: LockAuctionBidFundsParams): Promise<LockAuctionBidFundsResult> =>
		getAuctionLock().lockAuctionBidFunds(params),

	/**
	 * The wallet spend key's signing surface for the consolidated protocol's
	 * escrow templates. `null` until {@link walletOps.ensureAuctionWalletKey} has
	 * resolved the pair — a caller must then refuse rather than invent one, and
	 * must await the ensure first.
	 */
	getAuctionBidWalletSigner,

	/**
	 * Resolve and cache the wallet's auction spend key on demand, and RETRY after a failure.
	 *
	 * The startup bootstrap in {@link walletOps.initialize} is best effort, so a wallet that was
	 * not ready when the app loaded used to leave the cache empty for the whole session and every
	 * auction create or bid then refused, forever, with no way back. This is the awaited remedy
	 * the two paths call before they read the (synchronous) signer: it is idempotent — a cached
	 * pair short-circuits — and a failure is never cached, so the next call tries again instead
	 * of replaying the first error.
	 *
	 * The pair is provisioned against coco's own key ring (seed-derived, generated once on a
	 * wallet that has none); nothing is read from a relay.
	 */
	ensureAuctionWalletKey: async (): Promise<void> => {
		if (walletKeyMaterialCache) return
		walletKeyMaterialCache = await resolveAuctionKeyMaterial()
	},

	/**
	 * Dev-only helper: mint free test ecash from configured dev mints into the wallet.
	 */
	mintTestEcash: async (
		amount: number,
		mintUrl: string = DEV_TEST_MINT_URL,
		options?: { allowFallback?: boolean },
	): Promise<WalletTestMintResult> => {
		if (!isWalletDevModeEnabled()) {
			throw new Error('Dev wallet actions are disabled in this environment')
		}

		const wallet = cashuStore.state.walletSource
		if (!wallet || cashuStore.state.status !== 'ready') {
			throw new Error('Cashu wallet not ready')
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
				// cashu-ts v5: create the BOLT11 quote on the mint client, then mint from it
				// through the wallet's method-specific helper.
				const quote = await cashuWallet.mint.createMintQuoteBolt11({ amount: mintAmount, unit: 'sat' })
				const proofs = await cashuWallet.mintProofsBolt11(mintAmount, quote, keysetId ? { keysetId } : undefined)

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
				if (!cashuStore.state.defaultMint) {
					walletOps.setDefaultMint(targetMint)
				}

				await walletOps.refresh()

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
	 * the bidder-held-path flow. Delegates the heavy lifting to
	 * `publishAuctionBid` so this helper stays a thin UX wrapper rather than
	 * reimplementing the bid pipeline.
	 */
	placeDevBidOnSeededAuction: async (params?: {
		preferredBidAmount?: number
		preferredMintUrl?: string
	}): Promise<WalletDevAuctionBidResult> => {
		if (!isWalletDevModeEnabled()) {
			throw new Error('Dev wallet actions are disabled in this environment')
		}

		const wallet = cashuStore.state.walletSource
		if (!wallet || cashuStore.state.status !== 'ready') {
			throw new Error('Cashu wallet not ready')
		}

		const capability = getActiveSignerCapability()
		if (!capability) throw new Error('No signer available')
		const bidderPubkey = await capability.getPublicKey()

		// Find a live auction. We pull recent kind-30408 events and
		// filter to ones that (a) we're not the seller of and (b) still
		// have time on the clock.
		const now = Math.floor(Date.now() / 1000)
		const auctions = Array.from(await fetchEventsWithTimeout({ kinds: [AUCTION_KIND], limit: 100 }, { timeoutMs: 5000 }))
		const candidates = auctions.filter((auction) => {
			if (auction.pubkey === bidderPubkey) return false
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
			parseNonNegativeInt(getFirstTagValue(selected, 'settlement_grace'), 0) || AUCTION_SETTLEMENT_GRACE_DEFAULT_SECONDS
		const startingBid = parseNonNegativeInt(getFirstTagValue(selected, 'starting_bid'), 0)
		const bidIncrement = parseNonNegativeInt(getFirstTagValue(selected, 'bid_increment'), 0) || 100
		const trustedMints = selected.tags.filter((tag) => tag[0] === 'mint' && tag[1]).map((tag) => tag[1])

		// Decide the bid amount: caller's preference, or a minimum
		// increment over the current top bid.
		const existingBids = Array.from(
			await fetchEventsWithTimeout({ kinds: [AUCTION_BID_KIND], '#e': [selected.id], limit: 200 }, { timeoutMs: 5000 }),
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
			await walletOps.mintTestEcash(topUpAmount, mintForLock)
		}

		const { publishAuctionBid } = await import('@platform/web/auctions/auctionPublish')
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
	 * Reclaim a pending token (if the recipient hasn't claimed it yet).
	 *
	 * The whole reclaim money path — readiness from the proof secret (not the cached context),
	 * the refund-key preference (bidder record → pre-lock recovery record → the wallet's key
	 * map), the `receiveTokenWithPrivkey` mint call, the pending-token bookkeeping and the
	 * error semantics — lives in `@/lib/wallet/auctionFunds` (`createAuctionReclaim`), behind
	 * `AuctionReclaimHost`. This action is the thin binding; the host is read lazily per call,
	 * so a wallet that appears later is still seen and the sweep's throttle is shared across
	 * calls.
	 */
	reclaimToken: (tokenId: string, options?: { manual?: boolean }): Promise<void> => getAuctionReclaim().reclaimToken(tokenId, options),

	/**
	 * Silently reclaim every pending auction bid whose P2PK timelock has expired. Throttled to
	 * at most one sweep per AUCTION_AUTO_RECLAIM_MIN_INTERVAL_MS — the throttle state lives on
	 * the single `getAuctionReclaim()` instance — and skips tokens that are in cooldown or
	 * marked permanently-failed, so a bad token can't loop the bid flow into 429s.
	 */
	autoReclaimTimelockedBids: (): Promise<void> => getAuctionReclaim().autoReclaimTimelockedBids(),

	/** Remove a pending token from the list. */
	removePendingToken: (tokenId: string): void => {
		cashuActions.removePendingToken(tokenId)
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
		const before = cashuStore.state.pendingTokens.length
		const pendingTokens = cashuStore.state.pendingTokens.filter((t) => !idSet.has(t.id))
		if (pendingTokens.length === before) return 0
		cashuActions.setPendingTokens(pendingTokens)
		return before - pendingTokens.length
	},

	/** Get active pending tokens (not claimed or reclaimed). */
	getActivePendingTokens: (): PendingToken[] => {
		return cashuStore.state.pendingTokens.filter((t) => t.status === 'pending')
	},
}

export type { AuctionBidPendingTokenContext, AuctionFundsMintAccess, AuctionLock, AuctionLockHost, AuctionReclaim, AuctionReceipt }
