/**
 * Cashu wallet store using coco-cashu-core for robust operation management.
 *
 * This provides:
 * - IndexedDB persistence for proofs via coco
 * - IndexedDB persistence for the mint list via coco — coco is the authority
 *   for which mints this wallet knows, not a relay-backed wallet event
 * - Local persistence for pending tokens (tokens that have been generated but not yet claimed)
 * - Recovery of pending tokens on startup
 */
import { Store } from '@tanstack/store'
import { initializeCoco, Manager, getEncodedToken } from 'coco-cashu-core'
import { IndexedDbRepositories } from 'coco-cashu-indexeddb'
import { decode as decodeBolt11 } from 'light-bolt11-decoder'
import { authStore } from './auth'
import { getMintHostname, loadUserData, saveUserData, type PendingToken } from '@/lib/wallet'
import { createCocoWalletSource, type CashuWalletSource } from '@/lib/wallet/cashuWalletSource'
import {
	type CocoDepositQuote,
	DEPOSIT_CONFIRMATION_TIMEOUT_LABEL,
	createCocoDepositQuote,
	getDepositConfirmationTimeoutMessage,
} from '@/lib/wallet/depositQuote'

const CASHU_SEED_KEY = 'cashu_wallet_seed'
const PENDING_TOKENS_KEY = 'cashu_pending_tokens'
/**
 * The mint a deposit falls back to when the caller names none. A key of this store's own: the
 * session lives here now, and the previous store's key is deliberately not carried over (it was
 * never written by anything but a superseded build), so a stale value cannot silently pick a
 * deposit mint.
 */
const DEFAULT_MINT_KEY = 'cashu_default_mint'

/** The app's deposit confirmation window. Same value the NIP-60 deposit path used. */
export const CASHU_DEPOSIT_CONFIRMATION_TIMEOUT_MS = 15_000

const AUCTION_DEPOSIT_PADDING_RATE = 0.005
const AUCTION_DEPOSIT_MIN_PADDING_SATS = 5
const AUCTION_DEPOSIT_MAX_PADDING_SATS = 100
const AUCTION_MINT_QUOTE_FEE_MIN_CAP_SATS = 25
const AUCTION_MINT_QUOTE_FEE_RELATIVE_CAP_RATE = 0.1
const AUCTION_MINT_QUOTE_FEE_ABSOLUTE_CAP_SATS = 2000

// Re-export for backward compatibility
export type { PendingToken }

/**
 * A deposit's lifecycle. These are DISTINCT states on purpose — a deposit that has been
 * requested, one the user is paying, one the mint has paid but not yet minted, and one whose
 * proofs exist are four different things for the user and four differently-recoverable
 * situations. They are never collapsed into a boolean, and `depositStatus` below is only a
 * compatibility projection of this field for callers that still switch on the older vocabulary.
 */
export type CashuDepositPhase =
	| 'idle' // no session
	| 'requested' // startDeposit began; a mint quote is being created
	| 'waiting_payment' // the invoice is shown and the mint has not seen a payment
	| 'paid_unissued' // the mint reports the quote paid; redemption is still in flight
	| 'unconfirmed' // our confirmation window ran out; the outcome is unknown, not failed
	| 'issued' // the proofs exist — the only success
	| 'expired' // the quote's own window closed unpaid
	| 'failed' // the flow failed
	| 'cancelled' // the session was abandoned

/**
 * The compatibility projection of {@link CashuDepositPhase} that the deposit UI and the auction
 * funding hook still switch on. Derived from the phase at every transition so the two can never
 * disagree; written by the session, never read as an authority.
 */
export type CashuDepositStatus = 'idle' | 'pending' | 'awaiting_confirmation_retry' | 'success' | 'error'

/** The projection used at each phase boundary. `depositStatus` is `depositStatusForPhase(phase)`. */
export const depositStatusForPhase = (phase: CashuDepositPhase): CashuDepositStatus => {
	switch (phase) {
		case 'idle':
		case 'cancelled':
			return 'idle'
		case 'requested':
		case 'waiting_payment':
		case 'paid_unissued':
			return 'pending'
		case 'unconfirmed':
			return 'awaiting_confirmation_retry'
		case 'issued':
			return 'success'
		case 'expired':
		case 'failed':
			return 'error'
	}
}

export interface CashuDepositOptions {
	/** When true, the deposit request carries a bounded safety buffer for mint + Lightning fees. */
	includeFeePadding?: boolean
}

export interface CashuDepositQuoteEstimate {
	requiredBidFundingAmount: number
	totalDepositAmount: number
	mintFeePaddingAmount: number
	lightningFeePaddingAmount: number
	usedFallbackEstimate: boolean
	feeSource: 'quote' | 'fallback'
	mintFeeSource: 'quote' | 'fallback'
	lightningFeeSource: 'quote' | 'fallback'
}

export interface CashuState {
	manager: Manager | null
	/**
	 * The wallet object the auction rails spend through: coco's proof repository behind the
	 * synchronous proof read the rails are written against (`@/lib/wallet/cashuWalletSource`).
	 * Implementation detail — containers must not read it. It is the SAME source the rails get,
	 * so there is no second place a proof can live.
	 */
	walletSource: CashuWalletSource | null
	status: 'idle' | 'initializing' | 'ready' | 'error'
	error: string | null
	balances: Record<string, number>
	totalBalance: number
	/**
	 * The mint list coco holds for this wallet. It is read from coco's own
	 * repository (`manager.mint`), never from a relay-backed wallet event, so
	 * this field is a projection of coco's state and not a second authority.
	 */
	mints: string[]
	// Track pending send operations that have generated tokens
	pendingTokens: PendingToken[]
	/**
	 * The deposit session. The engine is coco's mint quote (`@/lib/wallet/depositQuote`); these
	 * fields are the session and its state around it, moved here off the NIP-60 store.
	 */
	depositPhase: CashuDepositPhase
	/** Compatibility projection of `depositPhase`; see {@link depositStatusForPhase}. */
	depositStatus: CashuDepositStatus
	depositInvoice: string | null
	activeDeposit: CocoDepositQuote | null
	/** The mint a deposit falls back to when the caller names none. */
	defaultMint: string | null
}

const initialState: CashuState = {
	manager: null,
	walletSource: null,
	status: 'idle',
	error: null,
	balances: {},
	totalBalance: 0,
	mints: [],
	pendingTokens: [],
	depositPhase: 'idle',
	depositStatus: 'idle',
	depositInvoice: null,
	activeDeposit: null,
	defaultMint: typeof localStorage !== 'undefined' ? localStorage.getItem(DEFAULT_MINT_KEY) : null,
}

export const cashuStore = new Store<CashuState>(initialState)

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const loadPendingTokens = (): PendingToken[] => loadUserData<PendingToken[]>(PENDING_TOKENS_KEY, [])

const savePendingTokens = (tokens: PendingToken[]): void => saveUserData(PENDING_TOKENS_KEY, tokens)

/**
 * Get or generate a seed for the wallet.
 * The seed is stored in localStorage and used for deterministic key derivation.
 */
async function getOrCreateSeed(): Promise<Uint8Array> {
	const pubkey = authStore.state.user?.pubkey
	if (!pubkey) {
		throw new Error('User not authenticated')
	}

	// Use a user-specific key
	const seedKey = `${CASHU_SEED_KEY}_${pubkey}`
	let seedHex = localStorage.getItem(seedKey)

	if (!seedHex) {
		// Generate a new 64-byte seed
		const seed = new Uint8Array(64)
		crypto.getRandomValues(seed)
		seedHex = Array.from(seed)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
		localStorage.setItem(seedKey, seedHex)
		console.log('[cashu] Generated new wallet seed')
	}

	// Convert hex string back to Uint8Array
	const bytes = new Uint8Array(seedHex.length / 2)
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(seedHex.slice(i * 2, i * 2 + 2), 16)
	}
	return bytes
}

// ============================================================================
// The deposit session — a coco mint quote and the state around it
// ============================================================================

const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs)
			}),
		])
	} finally {
		if (timer) clearTimeout(timer)
	}
}

/**
 * Bounded safety buffer for an auction funding deposit: 0.5% of the requested deposit, rounded
 * up, min 5 sats, max 100 sats. Used only when the mint quote provides no fee component; it is
 * not a fee reported by the mint.
 */
export const getAuctionDepositFeePadding = (depositAmount: number): number =>
	Math.min(
		Math.max(Math.ceil(depositAmount * AUCTION_DEPOSIT_PADDING_RATE), AUCTION_DEPOSIT_MIN_PADDING_SATS),
		AUCTION_DEPOSIT_MAX_PADDING_SATS,
	)

export const getAuctionDepositMaxMintQuoteFeeSats = (requestedAmount: number): number => {
	const relativeCap = Math.ceil(requestedAmount * AUCTION_MINT_QUOTE_FEE_RELATIVE_CAP_RATE)
	return Math.min(AUCTION_MINT_QUOTE_FEE_ABSOLUTE_CAP_SATS, Math.max(AUCTION_MINT_QUOTE_FEE_MIN_CAP_SATS, relativeCap))
}

const extractInvoiceAmountSats = (invoice: string): number | null => {
	const normalizedInvoice = invoice.trim().replace(/^lightning:/i, '')
	if (!normalizedInvoice) return null

	try {
		const decoded = decodeBolt11(normalizedInvoice)
		const amountMillisatsRaw = decoded.sections.find((section) => section.name === 'amount')?.value
		if (amountMillisatsRaw == null) return null

		const amountMillisats =
			typeof amountMillisatsRaw === 'number'
				? amountMillisatsRaw
				: Number.parseInt(typeof amountMillisatsRaw === 'string' ? amountMillisatsRaw : String(amountMillisatsRaw), 10)

		if (!Number.isFinite(amountMillisats) || amountMillisats <= 0) return null
		return Math.ceil(amountMillisats / 1000)
	} catch {
		return null
	}
}

export const validateAuctionDepositInvoiceQuote = (params: {
	requestedAmount: number
	depositAmount: number
	invoiceAmountSats: number
	mintUrl: string
}): void => {
	const { requestedAmount, depositAmount, invoiceAmountSats, mintUrl } = params
	if (!Number.isFinite(invoiceAmountSats) || invoiceAmountSats <= 0) {
		throw new Error('Mint returned an invalid Lightning invoice amount. Please retry with a different mint.')
	}

	if (invoiceAmountSats < depositAmount) {
		throw new Error(
			`Mint ${getMintHostname(mintUrl)} returned an invoice below the requested deposit amount. Please retry with a different mint.`,
		)
	}

	const quoteFeeSats = invoiceAmountSats - depositAmount
	const maxAllowedQuoteFeeSats = getAuctionDepositMaxMintQuoteFeeSats(requestedAmount)
	if (quoteFeeSats > maxAllowedQuoteFeeSats) {
		throw new Error(
			`Mint ${getMintHostname(mintUrl)} returned an unusually high Lightning fee quote (${quoteFeeSats} sats on a ${requestedAmount} sat deposit). ` +
				`Maximum allowed is ${maxAllowedQuoteFeeSats} sats. Please choose another mint.`,
		)
	}
}

const computePaddedDepositAmount = (
	requiredBidFundingAmount: number,
	mintFeePaddingAmount: number,
	lightningFeePaddingAmount: number,
): number => requiredBidFundingAmount + mintFeePaddingAmount + lightningFeePaddingAmount

const buildDepositQuoteEstimate = (params: {
	requiredBidFundingAmount: number
	mintFeePaddingAmount: number
	lightningFeePaddingAmount: number
	mintFeeSource: 'quote' | 'fallback'
	lightningFeeSource: 'quote' | 'fallback'
}): CashuDepositQuoteEstimate => {
	const { requiredBidFundingAmount, mintFeePaddingAmount, lightningFeePaddingAmount, mintFeeSource, lightningFeeSource } = params
	const usedFallbackEstimate = mintFeeSource === 'fallback' || lightningFeeSource === 'fallback'
	return {
		requiredBidFundingAmount,
		totalDepositAmount: computePaddedDepositAmount(requiredBidFundingAmount, mintFeePaddingAmount, lightningFeePaddingAmount),
		mintFeePaddingAmount,
		lightningFeePaddingAmount,
		usedFallbackEstimate,
		feeSource: usedFallbackEstimate ? 'fallback' : 'quote',
		mintFeeSource,
		lightningFeeSource,
	}
}

/**
 * Wait for a deposit's outcome. Resolves on success, rejects on an error event and rejects with
 * the shared confirmation-timeout message when the wait runs out — the message
 * `isDepositConfirmationTimeoutError` classifies, so a caller can tell "we ran out of patience"
 * (an unconfirmed outcome, not a failure) from a real failure.
 */
export const waitForDepositConfirmation = async (
	deposit: Pick<CocoDepositQuote, 'on'>,
	timeoutMs = CASHU_DEPOSIT_CONFIRMATION_TIMEOUT_MS,
): Promise<void> =>
	withTimeout(
		new Promise<void>((resolve, reject) => {
			deposit.on('success', () => resolve())
			deposit.on('error', (error) => reject(new Error(typeof error === 'string' ? error : String(error))))
		}),
		timeoutMs,
		DEPOSIT_CONFIRMATION_TIMEOUT_LABEL,
	)

const isDepositConfirmationTimeoutError = (error: unknown, timeoutMs = CASHU_DEPOSIT_CONFIRMATION_TIMEOUT_MS): boolean =>
	error instanceof Error && error.message === getDepositConfirmationTimeoutMessage(timeoutMs)

/**
 * Watch a started deposit and, when the confirmation window runs out, land the session in the
 * `unconfirmed` phase — the outcome is unknown, never failed, because a payment may still be in
 * flight (AGENTS.md: wallet acknowledgement is not settlement). Identity-guarded against the
 * active deposit so a stale session's timeout cannot overwrite a newer one.
 */
const monitorDepositConfirmation = (deposit: CocoDepositQuote, timeoutMs = CASHU_DEPOSIT_CONFIRMATION_TIMEOUT_MS): void => {
	void waitForDepositConfirmation(deposit, timeoutMs).catch((error) => {
		const state = cashuStore.state
		if (state.activeDeposit !== deposit || state.depositStatus !== 'pending') return
		if (!isDepositConfirmationTimeoutError(error, timeoutMs)) return

		setDepositPhase('unconfirmed', {
			error: 'Payment confirmation timed out. Retry confirmation to check the mint again.',
		})
	})
}

/** Move the deposit session to a phase, keeping `depositStatus` the projection of it. */
const setDepositPhase = (
	phase: CashuDepositPhase,
	extra: Partial<Pick<CashuState, 'error' | 'activeDeposit' | 'depositInvoice'>> = {},
): void => {
	cashuStore.setState((s) => ({
		...s,
		depositPhase: phase,
		depositStatus: depositStatusForPhase(phase),
		...extra,
	}))
}

export const cashuActions = {
	/**
	 * Initialize the coco manager with IndexedDB persistence
	 */
	initialize: async (): Promise<void> => {
		const state = cashuStore.state
		if (state.status === 'initializing' || state.status === 'ready') {
			return
		}

		const pubkey = authStore.state.user?.pubkey
		if (!pubkey) {
			console.warn('[cashu] Cannot initialize without authenticated user')
			return
		}

		cashuStore.setState((s) => ({
			...s,
			status: 'initializing',
			error: null,
		}))

		try {
			console.log('[cashu] Initializing coco manager...')

			// Create IndexedDB repositories with user-specific database name
			const repos = new IndexedDbRepositories({
				name: `cashu_wallet_${pubkey.slice(0, 8)}`,
			})

			const seed = await getOrCreateSeed()

			// Initialize coco with watchers enabled
			const manager = await initializeCoco({
				repo: repos,
				seedGetter: async () => seed,
				watchers: {
					mintQuoteWatcher: { watchExistingPendingOnStart: true },
					proofStateWatcher: {},
				},
				processors: {
					mintQuoteProcessor: { processIntervalMs: 3000 },
				},
			})

			console.log('[cashu] Coco manager initialized')

			// The wallet object the rails spend through: coco's proof repository behind the
			// synchronous proof read they are written against. Built here, from the same
			// repositories the manager was initialised with, so there is exactly one proof
			// store and one mint list behind it.
			const walletSource = createCocoWalletSource({
				getMints: () => cashuStore.state.mints,
				proofs: {
					saveProofs: (mintUrl, proofs) =>
						repos.proofRepository.saveProofs(mintUrl, proofs as Parameters<typeof repos.proofRepository.saveProofs>[1]),
					getReadyProofs: (mintUrl) => repos.proofRepository.getReadyProofs(mintUrl),
					deleteProofs: (mintUrl, secrets) => repos.proofRepository.deleteProofs(mintUrl, secrets),
				},
			})

			// Subscribe to balance updates
			manager.on('proofs:saved', async () => {
				await cashuActions.refreshBalances()
			})
			manager.on('proofs:state-changed', async () => {
				await cashuActions.refreshBalances()
			})
			manager.on('proofs:deleted', async () => {
				await cashuActions.refreshBalances()
			})

			// Load pending tokens from localStorage
			const pendingTokens = loadPendingTokens()

			cashuStore.setState((s) => ({
				...s,
				manager,
				walletSource,
				status: 'ready',
				pendingTokens,
			}))

			// Initial balance fetch
			await cashuActions.refreshBalances()

			// Load the mint list coco itself holds
			await cashuActions.syncMints()
		} catch (err) {
			console.error('[cashu] Failed to initialize:', err)
			cashuStore.setState((s) => ({
				...s,
				status: 'error',
				error: err instanceof Error ? err.message : 'Failed to initialize wallet',
			}))
		}
	},

	/**
	 * Read the wallet's mint list from coco and keep the store's projection of
	 * it current.
	 *
	 * coco is the authority: the mints it has persisted are the wallet's mints,
	 * and every one of them is trusted, exactly as the wallet treated the mints
	 * it previously copied across from the relay-backed wallet event. This is
	 * the only place the mint list is read, so there is no second source that
	 * could disagree with what the wallet will actually spend from.
	 */
	syncMints: async (): Promise<void> => {
		const manager = cashuStore.state.manager
		if (!manager) return

		try {
			const knownMints = await manager.mint.getAllMints()

			for (const mint of knownMints) {
				if (mint.trusted) continue
				try {
					await manager.mint.trustMint(mint.mintUrl)
				} catch (err) {
					console.error('[cashu] Failed to trust mint:', mint.mintUrl, err)
				}
			}

			cashuActions.setMints(knownMints.map((mint) => mint.mintUrl))

			// The mirror reads coco per mint, so it can only be filled once the mint list is
			// known. Nothing else refreshes it from the repository.
			await cashuStore.state.walletSource?.hydrate()
		} catch (err) {
			console.error('[cashu] Failed to read mints from coco:', err)
		}
	},

	/**
	 * Publish a mint list onto the store. Only `syncMints` should call this —
	 * the list it publishes comes from coco, so a caller that writes a list
	 * from anywhere else would reintroduce a second authority.
	 */
	setMints: (mints: string[]): void => {
		cashuStore.setState((s) => ({
			...s,
			mints,
		}))
	},

	/**
	 * Add a mint to coco
	 */
	addMint: async (mintUrl: string): Promise<void> => {
		const manager = cashuStore.state.manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		try {
			await manager.mint.addMint(mintUrl, { trusted: true })
			console.log('[cashu] Mint added:', mintUrl)
		} catch (err) {
			console.error('[cashu] Failed to add mint:', err)
			throw err
		}

		await cashuActions.syncMints()
	},

	// There is deliberately no `removeMint` here. coco's public mint API on this pin
	// (`MintApi`) exposes `trustMint` / `untrustMint` but no delete: `deleteMint` lives on the
	// internal `MintRepository` / `MintService` and is not reachable through `manager.mint`.
	// And `syncMints` re-trusts every mint coco holds (see walletMintAuthority.test.ts), so
	// untrusting one is undone at the next sync. A control wired to either would appear to
	// work and quietly resurrect the mint, so the wallet UI has no remove-mint affordance
	// until the coco 2.0 upgrade, where the mint API is the right place to revisit it.

	/**
	 * Refresh balances from coco
	 */
	refreshBalances: async (): Promise<void> => {
		const manager = cashuStore.state.manager
		if (!manager) return

		try {
			const balances = await manager.wallet.getBalances()
			const total = Object.values(balances).reduce((sum, b) => sum + b, 0)

			cashuStore.setState((s) => ({
				...s,
				balances,
				totalBalance: total,
			}))

			// Every proof event lands here, so this is where the rails' synchronous proof mirror
			// is re-read from coco. coco stays the authority; the mirror only answers a question
			// the rails ask synchronously.
			await cashuStore.state.walletSource?.hydrate()

			console.log('[cashu] Balances updated:', { balances, total })
		} catch (err) {
			console.error('[cashu] Failed to refresh balances:', err)
		}
	},

	/**
	 * Send eCash - generates a token
	 * The token is persisted to localStorage so it can be recovered if the app crashes
	 */
	send: async (mintUrl: string, amount: number): Promise<string> => {
		const manager = cashuStore.state.manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		// Ensure mint is added and trusted
		try {
			await manager.mint.addMint(mintUrl, { trusted: true })
		} catch {
			// Mint might already exist
		}

		console.log('[cashu] Sending:', { mintUrl, amount })

		// Generate the token
		const token = await manager.wallet.send(mintUrl, amount)
		const tokenString = getEncodedToken(token)

		// Store as pending token BEFORE returning
		// This ensures the token is saved even if the user closes the modal
		const pendingToken: PendingToken = {
			id: generateId(),
			token: tokenString,
			amount: token.proofs.reduce((sum, p) => sum + p.amount, 0),
			mintUrl: token.mint,
			createdAt: Date.now(),
			status: 'pending',
		}

		const pendingTokens = [...cashuStore.state.pendingTokens, pendingToken]
		savePendingTokens(pendingTokens)

		cashuStore.setState((s) => ({
			...s,
			pendingTokens,
		}))

		console.log('[cashu] Token generated and saved:', tokenString.slice(0, 50))

		// Refresh balances
		await cashuActions.refreshBalances()

		return tokenString
	},

	/**
	 * Reclaim a pending token (if recipient hasn't claimed it yet)
	 * This receives the token back into our wallet
	 */
	reclaimToken: async (tokenId: string): Promise<boolean> => {
		const manager = cashuStore.state.manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		const pendingToken = cashuStore.state.pendingTokens.find((t) => t.id === tokenId)
		if (!pendingToken) {
			throw new Error('Pending token not found')
		}

		console.log('[cashu] Attempting to reclaim token:', tokenId)

		try {
			// Try to receive the token back
			await manager.wallet.receive(pendingToken.token)

			// Update status to reclaimed
			const pendingTokens = cashuStore.state.pendingTokens.map((t) => (t.id === tokenId ? { ...t, status: 'reclaimed' as const } : t))
			savePendingTokens(pendingTokens)

			cashuStore.setState((s) => ({
				...s,
				pendingTokens,
			}))

			// Refresh balances
			await cashuActions.refreshBalances()

			console.log('[cashu] Token reclaimed successfully')
			return true
		} catch (err) {
			// Token was already claimed by recipient
			console.log('[cashu] Token already claimed:', err)

			// Mark as claimed
			const pendingTokens = cashuStore.state.pendingTokens.map((t) => (t.id === tokenId ? { ...t, status: 'claimed' as const } : t))
			savePendingTokens(pendingTokens)

			cashuStore.setState((s) => ({
				...s,
				pendingTokens,
			}))

			return false
		}
	},

	/**
	 * Remove a pending token from the list (after user confirms)
	 */
	removePendingToken: (tokenId: string): void => {
		const pendingTokens = cashuStore.state.pendingTokens.filter((t) => t.id !== tokenId)
		savePendingTokens(pendingTokens)

		cashuStore.setState((s) => ({
			...s,
			pendingTokens,
		}))
	},

	/**
	 * Receive an eCash token
	 */
	receive: async (token: string): Promise<void> => {
		const manager = cashuStore.state.manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		console.log('[cashu] Receiving token...')
		await manager.wallet.receive(token)
		await cashuActions.refreshBalances()
		console.log('[cashu] Token received')
	},

	/**
	 * Create a mint quote (for deposits)
	 */
	createMintQuote: async (mintUrl: string, amount: number) => {
		const manager = cashuStore.state.manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		// Ensure mint is added
		try {
			await manager.mint.addMint(mintUrl, { trusted: true })
		} catch {
			// Mint might already exist
		}

		console.log('[cashu] Creating mint quote:', { mintUrl, amount })
		return manager.quotes.createMintQuote(mintUrl, amount)
	},

	/**
	 * Redeem a mint quote (after payment)
	 */
	redeemMintQuote: async (mintUrl: string, quoteId: string) => {
		const manager = cashuStore.state.manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		console.log('[cashu] Redeeming mint quote:', { mintUrl, quoteId })
		await manager.quotes.redeemMintQuote(mintUrl, quoteId)
		await cashuActions.refreshBalances()
	},

	/**
	 * Melt (withdraw to Lightning)
	 */
	melt: async (mintUrl: string, invoice: string) => {
		const manager = cashuStore.state.manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		// Ensure mint is added
		try {
			await manager.mint.addMint(mintUrl, { trusted: true })
		} catch {
			// Mint might already exist
		}

		console.log('[cashu] Creating melt quote:', { mintUrl, invoice: invoice.slice(0, 50) })

		// Create melt quote
		const quote = await manager.quotes.createMeltQuote(mintUrl, invoice)
		console.log('[cashu] Melt quote created:', quote)

		// Pay the melt quote
		await manager.quotes.payMeltQuote(mintUrl, quote.quote)
		console.log('[cashu] Melt paid successfully')

		await cashuActions.refreshBalances()
		return quote
	},

	/**
	 * Start a Lightning deposit (mint ecash) on coco's mint quote.
	 *
	 * The engine is coco's (`createCocoDepositQuote`); this action owns the session around it —
	 * the invoice, the quote identity, the listeners and the lifecycle phase. The phase moves
	 * requested → waiting_payment → issued/expired/failed, and a phase is never collapsed with
	 * another: `depositStatus` is only the projection the UI still switches on.
	 *
	 * @param amount Amount in sats to deposit
	 * @param mint Optional mint URL (uses `defaultMint`, then nothing, when omitted)
	 */
	startDeposit: async (amount: number, mint?: string, options?: CashuDepositOptions): Promise<string | null> => {
		const state = cashuStore.state

		// The deposit engine is coco's mint quote, so coco must be up before a quote exists.
		// Initializing is idempotent, so it is done here rather than assumed to have happened on
		// some earlier screen; without a manager there is nothing to deposit into.
		if (!state.manager) {
			await cashuActions.initialize()
		}
		const cashuManager = cashuStore.state.manager
		if (!cashuManager) {
			console.warn('[cashu] Cannot deposit without a coco manager')
			return null
		}

		const requestedAmount = Math.ceil(amount)
		if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
			setDepositPhase('failed', { error: 'Deposit amount must be a positive integer.' })
			return null
		}

		const targetMint = mint ? normalizeMintUrl(mint) : state.defaultMint ? normalizeMintUrl(state.defaultMint) : null
		if (!targetMint) {
			setDepositPhase('failed', { error: 'No mint specified. Please select a default mint first.' })
			return null
		}

		// Ensure coco knows the target mint. Best effort: a mint coco already holds is not an
		// error, and a fake manager without a mint API must not turn the deposit into a failure.
		try {
			await cashuManager.mint.addMint(targetMint, { trusted: true })
		} catch {
			// Mint already known (or unavailable on this manager) — the quote call will surface
			// a real problem.
		}

		try {
			setDepositPhase('requested', { error: null })

			let depositAmount = requestedAmount
			if (options?.includeFeePadding) {
				// #4: Fallback-only fee design — we do NOT call the mint quote API here to
				// estimate fees. Instead, a conservative static padding (0.5%, min 5, max 100)
				// via getAuctionDepositFeePadding(). This avoids creating an abandoned mint quote
				// just for estimation. The actual Lightning fee is whatever the mint embeds in
				// the invoice returned by deposit.start(); validateAuctionDepositInvoiceQuote()
				// then checks it is within acceptable caps before we show it.
				// estimateDepositQuote() exposes the same fallback logic without side effects.
				depositAmount = requestedAmount + getAuctionDepositFeePadding(requestedAmount)
			}

			const deposit = createCocoDepositQuote({ manager: cashuManager, mintUrl: targetMint, amount: depositAmount })
			// #3: Wrap deposit.start() in a 15s timeout so a hung mint quote request doesn't
			// leave the user staring at a spinner indefinitely.
			const invoice = await withTimeout(deposit.start(), CASHU_DEPOSIT_CONFIRMATION_TIMEOUT_MS, 'deposit invoice creation')

			if (invoice) {
				const invoiceAmountSats = extractInvoiceAmountSats(invoice)
				if (invoiceAmountSats == null) {
					throw new Error('Mint returned an invoice without a parseable amount. Please retry with a different mint.')
				}
				validateAuctionDepositInvoiceQuote({
					requestedAmount,
					depositAmount,
					invoiceAmountSats,
					mintUrl: targetMint,
				})
			}

			setDepositPhase('waiting_payment', { activeDeposit: deposit, depositInvoice: invoice ?? null })

			// Listen for deposit completion. Both listeners are identity-guarded
			// (`activeDeposit === deposit`): a stale listener from an earlier deposit session must
			// never overwrite a newer session's status (review #1235, blocker 3).
			deposit.on('success', () => {
				if (cashuStore.state.activeDeposit !== deposit) return
				setDepositPhase('issued', { activeDeposit: null, depositInvoice: null })
				void cashuActions.refreshBalances()
			})

			deposit.on('error', (err?: Error) => {
				if (cashuStore.state.activeDeposit !== deposit) return
				console.error('[cashu] Deposit error:', err)
				const message = err instanceof Error ? err.message : 'The deposit failed.'
				// A quote the mint let expire unpaid is its own outcome, distinct from a failure.
				const phase: CashuDepositPhase = message.includes('expired before payment reached the mint') ? 'expired' : 'failed'
				setDepositPhase(phase, { error: message, activeDeposit: null, depositInvoice: null })
			})

			// The engine's state channel. `PAID` (the payment landed, redemption still in flight)
			// is its own phase — distinct from waiting for a payment and from issued, and the
			// reason the phase union is not collapsed into a boolean.
			deposit.on('state', (state) => {
				if (cashuStore.state.activeDeposit !== deposit) return
				if (state === 'PAID') setDepositPhase('paid_unissued')
			})

			monitorDepositConfirmation(deposit)

			return invoice ?? null
		} catch (err) {
			console.error('[cashu] Failed to start deposit:', err)
			setDepositPhase('failed', {
				error: err instanceof Error ? err.message : 'Failed to start deposit',
				activeDeposit: null,
				depositInvoice: null,
			})
			return null
		}
	},

	/**
	 * Re-enter the wait after a confirmation timeout — the `unconfirmed` phase is recoverable,
	 * so the SAME quote is checked again rather than a fresh funding session being created.
	 */
	retryDepositConfirmation: (): void => {
		const { activeDeposit, depositStatus } = cashuStore.state
		if (!activeDeposit || depositStatus !== 'awaiting_confirmation_retry') return

		setDepositPhase('waiting_payment', { error: null })

		monitorDepositConfirmation(activeDeposit)
		void activeDeposit.check(CASHU_DEPOSIT_CONFIRMATION_TIMEOUT_MS).catch((error) => {
			console.error('[cashu] Deposit confirmation retry failed:', error)
		})
	},

	/**
	 * Manual "check now" for a "Confirm" button — unlike `retryDepositConfirmation`, this isn't
	 * gated behind the confirmation timeout, so it works while a deposit is still awaiting
	 * payment. Reuses the success/error listeners `startDeposit` already attached to
	 * `activeDeposit`, so a payment found here still transitions the session normally.
	 */
	checkDepositNow: async (): Promise<void> => {
		const { activeDeposit, depositStatus } = cashuStore.state
		if (!activeDeposit || (depositStatus !== 'pending' && depositStatus !== 'awaiting_confirmation_retry')) return

		if (depositStatus === 'awaiting_confirmation_retry') {
			cashuActions.retryDepositConfirmation()
			return
		}

		try {
			await activeDeposit.check(CASHU_DEPOSIT_CONFIRMATION_TIMEOUT_MS)
		} catch (error) {
			console.error('[cashu] Manual deposit check failed:', error)
		}
	},

	/**
	 * Pre-flight deposit estimate on the bounded fallback buffer. Never calls mint quote APIs
	 * (which would consume rate-limit budget for an estimate), so both fee components use the
	 * same static buffer; over-estimating is the safe direction.
	 */
	estimateDepositQuote: async (amount: number, mintUrl: string): Promise<CashuDepositQuoteEstimate> => {
		const requiredBidFundingAmount = Math.ceil(amount)
		const targetMint = normalizeMintUrl(mintUrl)
		if (!Number.isFinite(requiredBidFundingAmount) || requiredBidFundingAmount <= 0) {
			throw new Error('Deposit quote amount must be a positive integer')
		}
		if (!targetMint) {
			throw new Error('Mint URL is required for deposit quote estimation')
		}

		const fallbackPaddingAmount = getAuctionDepositFeePadding(requiredBidFundingAmount)

		return buildDepositQuoteEstimate({
			requiredBidFundingAmount,
			mintFeePaddingAmount: fallbackPaddingAmount,
			lightningFeePaddingAmount: fallbackPaddingAmount,
			mintFeeSource: 'fallback',
			lightningFeeSource: 'fallback',
		})
	},

	/**
	 * Cancel an active deposit.
	 *
	 * Default: full clear of the deposit session — the phase goes `cancelled` (projected to
	 * `idle`), quote identity, invoice and error are all reset.
	 *
	 * `{ preserveRecovery: true }`: the deposit UI is being closed while the payment outcome is
	 * paid-or-uncertain (a waiting or unconfirmed phase). Release the UI but KEEP the deposit /
	 * quote identity so `retryDepositConfirmation()` and `checkDepositNow()` can still reconcile
	 * the SAME Lightning payment without a fresh funding session (review #1235, blocker 3); only
	 * the transient error display is reset. Terminal (issued / failed / expired) and idle
	 * sessions have no recoverable quote to preserve, so they fall through to the full clear.
	 */
	cancelDeposit: (options?: { preserveRecovery?: boolean }): void => {
		const preserveRecovery = options?.preserveRecovery ?? false
		cashuStore.setState((s) => {
			const recoverable = s.depositStatus === 'pending' || s.depositStatus === 'awaiting_confirmation_retry'
			if (preserveRecovery && s.activeDeposit && recoverable) {
				// Keep activeDeposit / depositInvoice / depositStatus — the reconciliation handle
				// for the SAME Lightning payment.
				return { ...s, error: null }
			}
			return {
				...s,
				depositPhase: 'cancelled',
				depositStatus: depositStatusForPhase('cancelled'),
				activeDeposit: null,
				depositInvoice: null,
				error: null,
			}
		})
	},

	/**
	 * Clear a completed deposit result from the UI. Intentionally separate from cancelDeposit():
	 * cancelDeposit() abandons an active pending deposit, while this only clears a terminal
	 * issued/failed UI state after the mint has already resolved the deposit.
	 */
	clearDepositResult: (): void => {
		const { depositStatus } = cashuStore.state
		if (depositStatus !== 'success' && depositStatus !== 'error') return

		cashuStore.setState((s) => ({
			...s,
			depositPhase: 'idle',
			depositStatus: depositStatusForPhase('idle'),
			activeDeposit: null,
			depositInvoice: null,
			error: null,
		}))
	},

	/**
	 * Get the wallet's mint list. It is coco's own list, projected into state by
	 * `syncMints`, so a caller reads what the wallet will actually spend from.
	 */
	getMints: (): string[] => {
		return cashuStore.state.mints
	},

	/**
	 * Reset the store
	 */
	reset: async (): Promise<void> => {
		const manager = cashuStore.state.manager
		if (manager) {
			await manager.dispose()
		}
		cashuStore.setState(() => initialState)
	},
}
