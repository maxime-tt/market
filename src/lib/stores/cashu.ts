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
import { authStore } from './auth'
import { loadUserData, saveUserData, type PendingToken } from '@/lib/wallet'

const CASHU_SEED_KEY = 'cashu_wallet_seed'
const PENDING_TOKENS_KEY = 'cashu_pending_tokens'

// Re-export for backward compatibility
export type { PendingToken }

export interface CashuState {
	manager: Manager | null
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
}

const initialState: CashuState = {
	manager: null,
	status: 'idle',
	error: null,
	balances: {},
	totalBalance: 0,
	mints: [],
	pendingTokens: [],
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

	/**
	 * Remove a mint from the wallet.
	 *
	 * coco has no `removeMint` on this pin, so the mint is re-added untrusted:
	 * that is what takes it out of the set the wallet will spend from. The
	 * store's projection of the mint list belongs to `syncMints`, so this
	 * action does not write it.
	 */
	removeMint: async (mintUrl: string): Promise<void> => {
		const manager = cashuStore.state.manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		try {
			await manager.mint.addMint(mintUrl, { trusted: false })
			console.log('[cashu] Mint removed:', mintUrl)
		} catch (err) {
			console.error('[cashu] Failed to remove mint:', err)
			throw err
		}
	},

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
