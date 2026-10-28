/**
 * auth/machine.ts — the auth state machine: a mechanical port of `src/lib/stores/auth.ts`.
 *
 * The flow is ported, not redesigned: the same localStorage keys, the same transitions, the same flags and
 * the same error strings. The only substitution is the seam — every cross-store effect the legacy store
 * performed inline arrives as an injected port, and the signer session arrives as a lazily-created factory.
 *
 * No React, no '@/', no '@tanstack/store': the machine owns the state object and notifies its listeners
 * directly. The host supplies storage, the session factory and the ports.
 */
import {
	AUTH_STORAGE_KEYS as K,
	INITIAL_AUTH_STATE,
	type AuthKeyValueStorage,
	type AuthPorts,
	type AuthSessionFactory,
	type AuthSessionHandle,
	type AuthSessionSnapshot,
	type AuthSessionStartInput,
	type AuthState,
	type AuthUser,
	type Nip46LoginOptions,
} from './types'

export interface AuthMachine {
	getState(): AuthState
	subscribe(listener: (state: AuthState) => void): () => void
	getCurrentPubkey(): string | null
	getNeedsMigration(): boolean
	getAvailableNostrExtensions(): string[]
	getAuthFromLocalStorageAndLogin(): Promise<void>
	decryptAndLogin(password: string): Promise<void>
	encryptAndSavePrivateKey(privateKey: string, password: string, logN?: number): Promise<boolean>
	checkAndShowTermsDialog(): void
	loginWithPrivateKey(privateKey: string): Promise<AuthUser>
	loginWithExtension(): Promise<AuthUser>
	loginWithNip46(bunkerUrl: string, localSigner: { privateKey?: string }, options?: Nip46LoginOptions): Promise<AuthUser>
	logout(): void
	userHasProducts(): Promise<boolean>
	migrateToEncryptedKey(password: string): Promise<void>
	/**
	 * The host hydration seam. The machine is normally the only writer, but the app's
	 * `@tanstack/store` bridge must stay bidirectional: twelve test files call
	 * `authStore.setState(...)` directly to force an identity, and `src/lib/stores/auth.ts`
	 * routes those writes here (the same pattern as `src/lib/stores/ui.ts`). Not for
	 * production flow control — the actions above are the transitions.
	 */
	setState(updater: (current: AuthState) => AuthState): void
}

/**
 * The machine's only construction seam: storage, the lazy session factory and the port surface. The machine
 * owns no global — a host that has no localStorage, no NDK and no wallet simply supplies different ports.
 */
export function createAuthMachine(deps: {
	storage: AuthKeyValueStorage
	sessionFactory: AuthSessionFactory
	ports: AuthPorts
}): AuthMachine {
	let state: AuthState = INITIAL_AUTH_STATE
	const listeners = new Set<(state: AuthState) => void>()

	/** Replace the state with a new object and notify every listener (the machine is the single source of truth). */
	const setState = (updater: (current: AuthState) => AuthState): void => {
		state = updater(state)
		for (const listener of listeners) listener(state)
	}

	/** The lazy session handle. Constructed on the first login action, never at import time. */
	let handle: AuthSessionHandle | undefined

	/** The identity observer the host's session factory reports snapshots through — the legacy `observeSession` body. */
	const onSnapshot = (snapshot: AuthSessionSnapshot): void => {
		setState((state) => ({
			...state,
			user: snapshot.pubkey ? { pubkey: snapshot.pubkey } : null,
			isAuthenticated: snapshot.state === 'active',
		}))
	}

	const ensureSession = (): AuthSessionHandle => {
		if (!handle) handle = deps.sessionFactory(onSnapshot)
		return handle
	}

	/** End any previous session, start the given lane and resolve the pubkey. */
	const startFreshSession = async (input: AuthSessionStartInput): Promise<string | undefined> => {
		const session = ensureSession()
		await session.endSession()
		return session.startFreshSession(input)
	}

	const auth: AuthMachine = {
		getState: () => state,

		subscribe: (listener) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},

		getCurrentPubkey: () => state.user?.pubkey ?? null,

		getNeedsMigration: () => {
			const authData = deps.storage.get(K.localEncryptedSignerKey)
			if (!authData) return false

			const privateKey = authData.split(':').at(1)
			try {
				if (privateKey && deps.ports.isRawNsecKey(privateKey)) return true
			} catch {
				// Silence decode errors since migration is not possible.
			}

			return false
		},

		getAvailableNostrExtensions: () => deps.ports.getAvailableNostrExtensions(),

		getAuthFromLocalStorageAndLogin: async () => {
			try {
				// Check for migration (unencrypted private key) first
				if (auth.getNeedsMigration()) {
					setState((state) => ({ ...state, needsMigration: true }))
					return
				}

				// Only trigger auth check if auto-login is enabled
				const autoLogin = deps.storage.get(K.autoLogin)
				if (autoLogin !== 'true') return

				setState((state) => ({ ...state, isAuthenticating: true }))

				// Signer / Bunker URL
				const privateKeySigner = deps.storage.get(K.localSignerKey)
				const bunkerUrl = deps.storage.get(K.connectUrl)

				if (privateKeySigner && bunkerUrl) {
					await auth.loginWithNip46(bunkerUrl, { privateKey: privateKeySigner })
					auth.checkAndShowTermsDialog()
					return
				}

				// Private key decryption
				const privateKey = deps.storage.get(K.localEncryptedSignerKey)

				if (privateKey) {
					setState((state) => ({ ...state, needsDecryptionPassword: true }))
					return
				}

				// Else, login with extension
				await auth.loginWithExtension()
				auth.checkAndShowTermsDialog()
			} catch (error) {
				console.error('Authentication failed:', error)
			} finally {
				setState((state) => ({ ...state, isAuthenticating: false }))
			}
		},

		decryptAndLogin: async (password: string) => {
			try {
				setState((state) => ({ ...state, isAuthenticating: true }))
				const encryptedPrivateKey = deps.storage.get(K.localEncryptedSignerKey)
				if (!encryptedPrivateKey) {
					throw new Error('No encrypted key found')
				}

				// The record is "pubkey:ncryptsec..." — we only need the encrypted key part
				const [, encryptedKey] = encryptedPrivateKey.split(':')

				const wasLoggedOut = deps.storage.get(K.autoLogin) !== 'true'
				await startFreshSession({ lane: 'ncryptsec', ncryptsec: encryptedKey, password })
				await deps.ports.adoptActiveSigner(wasLoggedOut)
				setState((state) => ({ ...state, needsDecryptionPassword: false }))
				auth.checkAndShowTermsDialog()
			} catch (error) {
				throw error
			} finally {
				setState((state) => ({ ...state, isAuthenticating: false }))
			}
		},

		encryptAndSavePrivateKey: async (privateKey: string, password: string, logN: number = 18) => {
			try {
				setState((state) => ({ ...state, isAuthenticating: true }))

				const { pubkey, ncryptsec } = deps.ports.encryptPrivateKey(privateKey, password, logN)
				deps.storage.set(K.localEncryptedSignerKey, `${pubkey}:${ncryptsec}`)

				return true
			} catch (error) {
				throw error
			} finally {
				setState((state) => ({ ...state, isAuthenticating: false }))
			}
		},

		checkAndShowTermsDialog: () => {
			if (!deps.ports.hasAcceptedTerms()) deps.ports.openTermsDialog()
		},

		loginWithPrivateKey: async (privateKey: string) => {
			if (!deps.ports.isNdkReady()) throw new Error('NDK not initialized')

			const wasLoggedOut = deps.storage.get(K.autoLogin) !== 'true'

			try {
				setState((state) => ({ ...state, isAuthenticating: true }))
				const pubkey = await startFreshSession({ lane: 'nsec', key: privateKey })
				if (!pubkey) throw new Error('The private key lane did not resolve an identity')
				await deps.ports.adoptActiveSigner(wasLoggedOut)

				const user: AuthUser = { pubkey }
				setState((state) => ({ ...state, user, isAuthenticated: true }))

				return user
			} catch (error) {
				setState((state) => ({ ...state, isAuthenticated: false }))
				throw error
			} finally {
				setState((state) => ({ ...state, isAuthenticating: false }))
			}
		},

		loginWithExtension: async () => {
			if (!deps.ports.isNdkReady()) throw new Error('NDK not initialized')

			// Check if extensions are available before attempting login
			const availableExtensions = deps.ports.getAvailableNostrExtensions()
			if (availableExtensions.length === 0) {
				throw new Error('No Nostr extension detected. Please install a Nostr browser extension (e.g., Alby, nos2x) before logging in.')
			}

			const wasLoggedOut = deps.storage.get(K.autoLogin) !== 'true'

			try {
				setState((state) => ({ ...state, isAuthenticating: true }))
				const pubkey = await startFreshSession({ lane: 'extension' })

				if (!pubkey) {
					throw new Error('Failed to authenticate with Nostr extension. Please make sure your extension is unlocked and try again.')
				}

				deps.storage.set(K.userPubkey, pubkey)
				deps.storage.set(K.autoLogin, 'true')

				await deps.ports.adoptActiveSigner(wasLoggedOut)

				const user: AuthUser = { pubkey }
				setState((state) => ({ ...state, user, isAuthenticated: true }))

				return user
			} catch (error) {
				setState((state) => ({ ...state, isAuthenticated: false }))
				throw error
			} finally {
				setState((state) => ({ ...state, isAuthenticating: false }))
			}
		},

		loginWithNip46: async (bunkerUrl: string, localSigner: { privateKey?: string }, options?: Nip46LoginOptions) => {
			if (!deps.ports.isNdkReady()) throw new Error('NDK not initialized')

			const wasLoggedOut = deps.storage.get(K.autoLogin) !== 'true'

			try {
				setState((state) => ({ ...state, isAuthenticating: true }))
				const pubkey = await startFreshSession({
					lane: 'bunker',
					bunkerUrl,
					clientKeyHex: localSigner.privateKey,
					onAuthUrl: options?.onAuthUrl
						? async (url: string) => {
								options.onAuthUrl?.(url)
							}
						: undefined,
				})
				if (!pubkey) throw new Error('The bunker lane did not resolve an identity')

				deps.storage.set(K.localSignerKey, localSigner.privateKey || '')
				deps.storage.set(K.connectUrl, bunkerUrl)

				await deps.ports.adoptActiveSigner(wasLoggedOut)

				const user: AuthUser = { pubkey }
				setState((state) => ({ ...state, user, isAuthenticated: true }))

				return user
			} catch (error) {
				setState((state) => ({ ...state, isAuthenticated: false }))
				throw error
			} finally {
				setState((state) => ({ ...state, isAuthenticating: false }))
			}
		},

		logout: () => {
			deps.ports.clearNotifications()

			if (!deps.ports.isNdkReady()) return

			if (handle) void handle.endSession()

			deps.ports.teardownSignerAndWallet()

			deps.storage.remove(K.localSignerKey)
			deps.storage.remove(K.connectUrl)
			deps.storage.remove(K.localEncryptedSignerKey)
			deps.storage.remove(K.autoLogin)

			deps.ports.clearCart()

			setState(() => INITIAL_AUTH_STATE)
		},

		userHasProducts: async () => {
			if (!state.user) return false

			try {
				return await deps.ports.userHasProducts(state.user.pubkey)
			} catch (error) {
				console.error('Failed to check user products:', error)
				return false
			}
		},

		migrateToEncryptedKey: async (password: string) => {
			try {
				setState((state) => ({ ...state, isAuthenticating: true }))

				// Get the unencrypted private key
				const authData = deps.storage.get(K.localEncryptedSignerKey)
				const privateKey = authData?.split(':').at(1)

				if (!privateKey) {
					throw new Error('No private key found to migrate')
				}

				auth.encryptAndSavePrivateKey(privateKey, password)

				// Update auth state
				setState((state) => ({
					...state,
					needsMigration: false,
					needsDecryptionPassword: false,
				}))

				// Continue with login using the unencrypted key (it will be wiped after)
				await auth.loginWithPrivateKey(privateKey)
			} catch (error) {
				console.error('Migration failed:', error)
				throw error
			} finally {
				setState((state) => ({ ...state, isAuthenticating: false }))
			}
		},

		setState: (updater) => setState(updater),
	}

	return auth
}
