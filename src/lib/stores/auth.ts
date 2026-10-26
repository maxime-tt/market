import { Store } from '@tanstack/store'
import { ndkActions } from './ndk'
import { walletOps } from './walletOps'
import { cartActions } from './cart'
import { fetchProductsByPubkey } from '@/queries/products'
import { hasAcceptedTerms, TERMS_ACCEPTED_KEY } from '@/lib/terms'
import { uiActions } from './ui'
import { appNotifications } from '@platform/web/notifications'
import { getPublicKey, nip19 } from 'nostr-tools'
import { encrypt } from 'nostr-tools/nip49'
import { hexToBytes } from 'nostr-tools/utils'
import { createWebSignerSession } from '@platform/web/sdkSigner'
import { ndkSignerFromCapability } from '@/lib/nostr/ndk-signer-adapter'
import type { SignerSession } from '@sdk/core/signer'

export const NOSTR_CONNECT_KEY = 'nostr_connect_url'
export const NOSTR_LOCAL_SIGNER_KEY = 'nostr_local_signer_key'
export const NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY = 'nostr_local_encrypted_signer_key'
export const NOSTR_AUTO_LOGIN = 'nostr_auto_login'
export const NOSTR_USER_PUBKEY = 'nostr_user_pubkey'

/**
 * The authenticated user, as this store exposes it. It is intentionally a bare
 * identity record — the pubkey and nothing else — because the current user now
 * belongs to the SDK signer session (`@sdk/core/signer`), not to this store.
 * Consumers only ever read `user?.pubkey`; anything richer is a *read* the
 * signer performs, not state this store holds.
 */
interface AuthUser {
	pubkey: string
}

interface AuthState {
	user: AuthUser | null
	isAuthenticated: boolean
	needsDecryptionPassword: boolean
	isAuthenticating: boolean
	needsMigration: boolean
}

interface Nip46LoginOptions {
	onAuthUrl?: (url: string) => void
}

const initialState: AuthState = {
	user: null,
	isAuthenticated: false,
	needsDecryptionPassword: false,
	isAuthenticating: false,
	needsMigration: false,
}

export const authStore = new Store<AuthState>(initialState)

// ---------------------------------------------------------------------------
// The SDK signer session: who the user is now belongs to the signer.
// ---------------------------------------------------------------------------
//
// #815e0d / store-drain B3 part 2. This store used to build its own NDK signers
// (`NDKNip07Signer`, `NDKNip46Signer`, `NDKPrivateKeySigner`) and hold their
// `NDKUser` as the authenticated identity. That machinery now lives behind the
// SDK signer session (`createWebSignerSession`, `@platform/web/sdkSigner`),
// whose five lanes are one-to-one with this store's login methods:
//
//   extension  <- loginWithExtension          (NIP-07)
//   nsec       <- loginWithPrivateKey         (private key)
//   ncryptsec  <- decryptAndLogin             (NIP-49)
//   bunker     <- loginWithNip46              (NIP-46 bunker://)
//   nostrconnect                              (NIP-46 nostrconnect://, driven
//                                              from `NostrConnectQR.tsx`)
//
// The session is created **lazily** so importing this module does not construct
// a relay pool: a unit test that only reads `authStore` never touches the host
// ports. `observeSession` fires immediately with a snapshot and on every
// transition, and that subscription is how an identity transition (login /
// logout / switch) reaches `authStore` — identity-scoped consumers re-read or
// lose their scope rather than silently sharing the previous user's records.
//
// The session's settings allow-list NIP-04 and NIP-44 so the capability it
// hands out still offers the encryption the rest of the app signs and encrypts
// with (NIP-17 orders and messages).
let signerSession: SignerSession | undefined

const getSignerSession = (): SignerSession => {
	if (!signerSession) {
		const session = createWebSignerSession({
			capabilities: ['nip04', 'nip44'],
			encryption: { nip04: true, nip44: true },
		})
		session.observeSession((snapshot) => {
			authStore.setState((state) => ({
				...state,
				user: snapshot.pubkey ? { pubkey: snapshot.pubkey } : null,
				isAuthenticated: snapshot.state === 'active',
			}))
		})
		signerSession = session
	}
	return signerSession
}

/**
 * The current user's pubkey, or `null`. This is the **parameter** identity-scoped
 * consumers take: an assembly reads it here (or subscribes below) and passes the
 * resolved value into a pure read, rather than a pure read reaching for ambient
 * store state.
 */
export function getCurrentPubkey(): string | null {
	return authStore.state.user?.pubkey ?? null
}

/**
 * The **identity subscription**: fires immediately with the current pubkey and
 * again on every identity transition — login, logout or a switch to another
 * user. An assembly that holds identity-scoped data (storage, caches, wallet
 * keys) subscribes once and re-runs its assembly when the pubkey changes, so it
 * never silently keeps the previous user's scope.
 */
export function subscribeToAuthIdentity(listener: (identity: { pubkey: string | null }) => void): () => void {
	let last = getCurrentPubkey()
	listener({ pubkey: last })
	const subscription = authStore.subscribe(() => {
		const next = getCurrentPubkey()
		if (next !== last) {
			last = next
			listener({ pubkey: next })
		}
	})
	return () => subscription.unsubscribe()
}

/**
 * Bootstrap the NIP-60 Cashu wallet after a successful sign-in.
 *
 * This was the third step of `ndkActions.runSignerOnboarding` until the ndk
 * store stopped importing the wallet: `src/lib/stores/ndk.ts` is the highest
 * fan-in contract in the tree (96 dependents) and its edge to `./walletOps` was
 * the hub of the 36-file import cycle blocking the src/ retirement. The
 * semantics are unchanged — fire and forget, a failure is logged and never
 * blocks login, and it runs alongside the relay-list and NWC steps.
 */
const bootstrapCashuWalletInBackground = (): void => {
	void (async () => {
		try {
			await walletOps.initialize()
		} catch (e) {
			console.error('[auth] walletOps.initialize failed:', e)
		}
	})()
}

/**
 * Adopt the signer the session just attached: hand NDK a signer to sign with,
 * kick off the post-signer onboarding pipeline and the wallet bootstrap, and
 * reconcile the cart for the freshly resolved identity. Returns the resolved
 * pubkey.
 *
 * The SDK capability is bridged onto NDK's `NDKSigner` interface by
 * `ndkSignerFromCapability` — the ndk store is not drained (owner ruling), so
 * this is the one seam that keeps its library-typed consumers compiling. The
 * capability remains the single source of signing; the adapter only delegates.
 */
const adoptActiveSigner = async (wasLoggedOut: boolean): Promise<string> => {
	const capability = getSignerSession().currentSigner()
	const ndkSigner = ndkSignerFromCapability(capability)
	ndkActions.setSigner(ndkSigner)
	// Kick off the post-signer onboarding pipeline (relay list, NWC select)
	// in the background — login can resolve before these finish so the user
	// isn't gated on a slow relay-list fetch.
	void ndkActions.runSignerOnboarding(ndkSigner)
	bootstrapCashuWalletInBackground()

	const pubkey = await capability.getPublicKey()
	const ndk = ndkActions.getNDK()
	void cartActions.reconcileRemoteCartForUser(pubkey, ndkSigner, ndk, wasLoggedOut)
	return pubkey
}

/**
 * Start a lane on a fresh session. A session holds at most one capability, so a
 * second login without a logout ends the previous one first (idempotent from
 * any state) rather than refusing with `SessionAttachedError` the way a raw
 * `startSession` would.
 */
const startFreshSession = async (input: Parameters<SignerSession['startSession']>[0]): Promise<string | undefined> => {
	const session = getSignerSession()
	await session.endSession()
	const snapshot = await session.startSession(input)
	return snapshot.pubkey
}

export const authActions = {
	getAuthFromLocalStorageAndLogin: async () => {
		try {
			// Check for migration (unencrypted private key) first
			if (authActions.getNeedsMigration()) {
				authStore.setState((state) => ({
					...state,
					needsMigration: true,
				}))

				return
			}

			// Only trigger auth check if auto-login is enabled

			const autoLogin = localStorage.getItem(NOSTR_AUTO_LOGIN)
			if (autoLogin !== 'true') return

			authStore.setState((state) => ({ ...state, isAuthenticating: true }))

			// Signer / Bunker URL

			const privateKeySigner = localStorage.getItem(NOSTR_LOCAL_SIGNER_KEY)
			const bunkerUrl = localStorage.getItem(NOSTR_CONNECT_KEY)

			if (privateKeySigner && bunkerUrl) {
				await authActions.loginWithNip46(bunkerUrl, { privateKey: privateKeySigner })
				authActions.checkAndShowTermsDialog()
				return
			}

			// Private key decryption

			const privateKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)

			if (privateKey) {
				authStore.setState((state) => ({ ...state, needsDecryptionPassword: true }))
				return
			}

			// Else, login with extension

			await authActions.loginWithExtension()
			authActions.checkAndShowTermsDialog()
		} catch (error) {
			console.error('Authentication failed:', error)
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},
	decryptAndLogin: async (password: string) => {
		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const encryptedPrivateKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
			if (!encryptedPrivateKey) {
				throw new Error('No encrypted key found')
			}

			// The record is "pubkey:ncryptsec..."; the SDK's ncryptsec lane takes
			// the ncryptsec and the passphrase and unlocks the identity itself —
			// this store no longer derives the key locally.
			const [, encryptedKey] = encryptedPrivateKey.split(':')

			const wasLoggedOut = localStorage.getItem(NOSTR_AUTO_LOGIN) !== 'true'
			await startFreshSession({ lane: 'ncryptsec', ncryptsec: encryptedKey, password })
			await adoptActiveSigner(wasLoggedOut)
			authStore.setState((state) => ({ ...state, needsDecryptionPassword: false }))
			authActions.checkAndShowTermsDialog()
		} catch (error) {
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	encryptAndSavePrivateKey: async (privateKey: string, password: string, logN: number = 18) => {
		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))

			// Normalize the private key
			const normalizedKey = privateKey.startsWith('nsec1') ? privateKey : nip19.nsecEncode(hexToBytes(privateKey))

			const { data: secretKeyBytes } = nip19.decode(normalizedKey) as { data: Uint8Array }
			const pubkey = getPublicKey(secretKeyBytes)

			// Use nostr-tools encrypt function
			const encryptedKey = encrypt(secretKeyBytes, password, logN, 1)

			// Replace encrypted key with format: "pubkey:ncryptsec..."
			localStorage.setItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY, `${pubkey}:${encryptedKey}`)

			return true
		} catch (error) {
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	checkAndShowTermsDialog: () => {
		if (!hasAcceptedTerms()) {
			uiActions.openDialog('terms')
		}
	},

	loginWithPrivateKey: async (privateKey: string) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const wasLoggedOut = localStorage.getItem(NOSTR_AUTO_LOGIN) !== 'true'

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const pubkey = await startFreshSession({ lane: 'nsec', key: privateKey })
			if (!pubkey) throw new Error('The private key lane did not resolve an identity')
			await adoptActiveSigner(wasLoggedOut)

			const user: AuthUser = { pubkey }
			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			return user
		} catch (error) {
			authStore.setState((state) => ({
				...state,
				isAuthenticated: false,
			}))
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	getAvailableNostrExtensions: (): string[] => {
		const extensions: string[] = []
		if (typeof window !== 'undefined') {
			if ((window as any).nostr) extensions.push('nostr')
			if ((window as any).nos2x) extensions.push('nos2x')
			if ((window as any).alby) extensions.push('alby')
		}
		return extensions
	},

	loginWithExtension: async () => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		// Check if extensions are available before attempting login
		const availableExtensions = authActions.getAvailableNostrExtensions()
		if (availableExtensions.length === 0) {
			throw new Error('No Nostr extension detected. Please install a Nostr browser extension (e.g., Alby, nos2x) before logging in.')
		}

		const wasLoggedOut = localStorage.getItem(NOSTR_AUTO_LOGIN) !== 'true'

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const pubkey = await startFreshSession({ lane: 'extension' })

			if (!pubkey) {
				throw new Error('Failed to authenticate with Nostr extension. Please make sure your extension is unlocked and try again.')
			}

			// Store user pubkey and enable auto-login for persistence
			localStorage.setItem(NOSTR_USER_PUBKEY, pubkey)
			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

			await adoptActiveSigner(wasLoggedOut)

			const user: AuthUser = { pubkey }
			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			return user
		} catch (error) {
			authStore.setState((state) => ({
				...state,
				isAuthenticated: false,
			}))
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	loginWithNip46: async (bunkerUrl: string, localSigner: { privateKey?: string }, options?: Nip46LoginOptions) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const wasLoggedOut = localStorage.getItem(NOSTR_AUTO_LOGIN) !== 'true'

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
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

			// Wait until user is logged in successfully before saving the bunkerURL/private key.
			localStorage.setItem(NOSTR_LOCAL_SIGNER_KEY, localSigner.privateKey || '')
			localStorage.setItem(NOSTR_CONNECT_KEY, bunkerUrl)

			await adoptActiveSigner(wasLoggedOut)

			const user: AuthUser = { pubkey }
			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			return user
		} catch (error) {
			authStore.setState((state) => ({
				...state,
				isAuthenticated: false,
			}))
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	logout: () => {
		appNotifications.queue.clear()
		const ndk = ndkActions.getNDK()
		if (!ndk) return
		// End the signer session so the identity it holds is released and every
		// identity-scoped subscriber sees the transition to no user.
		if (signerSession) void signerSession.endSession()
		ndkActions.removeSigner()
		// Tear down per-user state: NWC selection through the ndk store,
		// the NIP-60 wallet here. Mirrors the sign-in side, where both are
		// started from this store rather than from `./ndk`.
		ndkActions.clearSignerOnboarding()
		void walletOps.reset()
		localStorage.removeItem(NOSTR_LOCAL_SIGNER_KEY)
		localStorage.removeItem(NOSTR_CONNECT_KEY)
		localStorage.removeItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
		localStorage.removeItem(NOSTR_AUTO_LOGIN)
		// Clear cart when user logs out
		cartActions.clear({ publishRemote: false, reason: 'logout' })
		authStore.setState(() => initialState)
	},

	userHasProducts: async (): Promise<boolean> => {
		const state = authStore.state
		if (!state.user) return false

		try {
			const products = await fetchProductsByPubkey(state.user.pubkey)
			return products.length > 0
		} catch (error) {
			console.error('Failed to check user products:', error)
			return false
		}
	},

	getNeedsMigration: (): boolean => {
		const authData = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)

		if (authData) {
			const privateKey = authData.split(':').at(1)

			// Validate if private key has been stored in raw format ("nsec...")
			try {
				if (privateKey?.startsWith('nsec') && nip19.decode(privateKey).type === 'nsec') {
					return true
				}
			} catch {
				// Silence decode errors since migration is not possible.
			}
		}

		return false
	},

	migrateToEncryptedKey: async (password: string) => {
		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))

			// Get the unencrypted private key
			const authData = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
			const privateKey = authData?.split(':').at(1)

			if (!privateKey) {
				throw new Error('No private key found to migrate')
			}

			authActions.encryptAndSavePrivateKey(privateKey, password)

			// Update auth state
			authStore.setState((state) => ({
				...state,
				needsMigration: false,
				needsDecryptionPassword: false,
			}))

			// Continue with login using the unencrypted key (it will be wiped after)
			await authActions.loginWithPrivateKey(privateKey)
		} catch (error) {
			console.error('Migration failed:', error)
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},
}

export const useAuth = () => {
	return {
		...authStore.state,
		...authActions,
	}
}
