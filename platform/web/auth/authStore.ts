/**
 * platform/web/auth/authStore.ts — the platform home of the auth composition root, moved verbatim
 * out of `src/lib/stores/auth.ts` in Wave F slice W-E5b. The only changes are the seven platform
 * substitutions; `src/lib/stores/auth.ts` is the re-export shim the remaining `src/` importers and
 * the mocking suites still resolve. The `@tanstack/store` bridge stays **bidirectional** because
 * ten test files call `authStore.setState(...)` directly; `registerAuthMachine` + `authBinding`
 * are unchanged.
 *
 * The signer session is still created LAZILY (first login action), so importing this module does
 * not construct a relay pool, and a unit test that only reads `authStore` never touches the host
 * ports.
 */
import { Store } from '@tanstack/store'
import { getPublicKey, nip19 } from 'nostr-tools'
import { encrypt } from 'nostr-tools/nip49'
import { hexToBytes } from 'nostr-tools/utils'
import { AUTH_STORAGE_KEYS, createAuthMachine } from '@sdk/core/auth'
import type {
	AuthKeyValueStorage,
	AuthPorts,
	AuthSessionFactory,
	AuthSessionHandle,
	AuthSessionSnapshot,
	AuthSessionStartInput,
	AuthState,
} from '@sdk/core/auth'
import type { SessionStartInput, SignerSession, SignerCapability } from '@sdk/core/signer'
import { NoActiveSessionError } from '@sdk/core/signer'
import { asEncryptingSigner, type EncryptingSigner } from '@sdk/core'
import { createWebSignerSession } from '@platform/web/sdkSigner'
import { registerAuthMachine } from '@platform/web/auth/authBinding'
import { appNotifications } from '@platform/web/notifications'
import { fetchProductsByPubkey } from '@platform/web/products/productQuery'
import { hasAcceptedTerms } from '@platform/web/app/terms'
import { ndkSignerFromCapability } from '@platform/web/auth/ndkSignerAdapter'
import { ndkActions } from '@platform/web/ndk/ndkStore'
import { walletOps } from '@platform/web/wallet/walletOps'
import { cartActions } from '@platform/web/cart/cartStore'
import { uiActions } from '@platform/web/app/uiStore'

/** The five localStorage keys the legacy store owned; the values are the public contract. */
export const NOSTR_CONNECT_KEY = AUTH_STORAGE_KEYS.connectUrl
export const NOSTR_LOCAL_SIGNER_KEY = AUTH_STORAGE_KEYS.localSignerKey
export const NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY = AUTH_STORAGE_KEYS.localEncryptedSignerKey
export const NOSTR_AUTO_LOGIN = AUTH_STORAGE_KEYS.autoLogin
export const NOSTR_USER_PUBKEY = AUTH_STORAGE_KEYS.userPubkey

// ---------------------------------------------------------------------------
// The storage port: localStorage in the browser, nothing during SSR.
// ---------------------------------------------------------------------------
const browserStorage: AuthKeyValueStorage = {
	get: (key) => (typeof window === 'undefined' ? null : localStorage.getItem(key)),
	set: (key, value) => {
		if (typeof window !== 'undefined') localStorage.setItem(key, value)
	},
	remove: (key) => {
		if (typeof window !== 'undefined') localStorage.removeItem(key)
	},
}

// ---------------------------------------------------------------------------
// The signer-session seam: who the user is now belongs to the SDK signer.
// ---------------------------------------------------------------------------
//
// #815e0d / store-drain B3 part 2 — the session's five lanes are one-to-one with the auth actions:
// extension, nsec, ncryptsec, bunker, and (driven from `NostrConnectQR.tsx`) nostrconnect. The session
// is created lazily so importing this module constructs no relay pool, and its settings allow-list
// NIP-04 and NIP-44 so the capability it hands out still offers the encryption the rest of the app
// signs and encrypts with (NIP-17 orders and messages).
let signerSession: SignerSession | undefined
let sessionObserver: ((snapshot: AuthSessionSnapshot) => void) | undefined

const ensureSignerSession = (): SignerSession => {
	const session = createWebSignerSession({
		capabilities: ['nip04', 'nip44'],
		encryption: { nip04: true, nip44: true },
	})
	session.observeSession((snapshot) => sessionObserver?.({ pubkey: snapshot.pubkey, state: snapshot.state }))
	signerSession = session
	return session
}

export const getSignerSession = (): SignerSession => signerSession ?? ensureSignerSession()

/**
 * The active signer capability, or null while logged out (A3.1). Auth-gated:
 * the only swallowed refusal is the session's own "no active session" — every
 * other error propagates. This is the one signer source the io seam and the
 * publish families read; the NDK bridge stays a separate consumer until A3.7.
 */
export function getActiveSignerCapability(): SignerCapability | null {
	try {
		return getSignerSession().currentSigner()
	} catch (error) {
		if (error instanceof NoActiveSessionError) return null
		throw error
	}
}

/** The active capability expressed as the SDK's library-free `EncryptingSigner` port, or null while logged out. */
export function getActiveEncryptingSigner(): EncryptingSigner | null {
	const capability = getActiveSignerCapability()
	return capability ? asEncryptingSigner(capability) : null
}

/** The machine's input shape and the SDK session's differ only in the bunker `onAuthUrl` return type. */
const toSessionStartInput = (input: AuthSessionStartInput): SessionStartInput => {
	if (input.lane !== 'bunker') return input
	return {
		lane: 'bunker',
		bunkerUrl: input.bunkerUrl,
		clientKeyHex: input.clientKeyHex,
		onAuthUrl: input.onAuthUrl
			? async (url: string) => {
					input.onAuthUrl?.(url)
				}
			: undefined,
	}
}

const sessionFactory: AuthSessionFactory = (onSnapshot) => {
	sessionObserver = onSnapshot
	const session = getSignerSession()
	const handle: AuthSessionHandle = {
		// The machine already ended any previous session before calling this.
		startFreshSession: async (input) => {
			const snapshot = await session.startSession(toSessionStartInput(input))
			return snapshot.pubkey
		},
		endSession: () => session.endSession(),
	}
	return handle
}

// ---------------------------------------------------------------------------
// The ports: one per legacy import, so the machine stays dependency-free.
// ---------------------------------------------------------------------------

/**
 * Bootstrap the NIP-60 Cashu wallet after a successful sign-in: fire and forget, a failure is logged
 * and never blocks login.
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
 * Adopt the signer the session just attached: hand NDK a signer to sign with, kick off the
 * post-signer onboarding pipeline and the wallet bootstrap, and reconcile the cart for the freshly
 * resolved identity. The capability remains the single source of signing; `ndkSignerFromCapability`
 * only delegates (the ndk store is not drained — owner ruling).
 */
const adoptActiveSigner = async (wasLoggedOut: boolean): Promise<void> => {
	const capability = getSignerSession().currentSigner()
	const ndkSigner = ndkSignerFromCapability(capability)
	ndkActions.setSigner(ndkSigner)
	// Kick off the post-signer onboarding pipeline (relay list, NWC select) in the background —
	// login can resolve before these finish so the user isn't gated on a slow relay-list fetch.
	void ndkActions.runSignerOnboarding(ndkSigner)
	bootstrapCashuWalletInBackground()

	const pubkey = await capability.getPublicKey()
	const ndk = ndkActions.getNDK()
	// A3.5(d): the cart reconcile takes the **capability** (it publishes through
	// `createSignerPublishContext` now), never the NDK-typed signer.
	void cartActions.reconcileRemoteCartForUser(pubkey, capability, ndk, wasLoggedOut)
}

const ports: AuthPorts = {
	isNdkReady: () => ndkActions.getNDK() != null,
	clearNotifications: () => appNotifications.queue.clear(),
	adoptActiveSigner,
	teardownSignerAndWallet: () => {
		ndkActions.removeSigner()
		ndkActions.clearSignerOnboarding()
		void walletOps.reset()
	},
	clearCart: () => cartActions.clear({ publishRemote: false, reason: 'logout' }),
	hasAcceptedTerms: () => hasAcceptedTerms(),
	openTermsDialog: () => uiActions.openDialog('terms'),
	userHasProducts: async (pubkey) => (await fetchProductsByPubkey(pubkey)).length > 0,
	encryptPrivateKey: (privateKey, password, logN) => {
		// Normalize the private key, then NIP-49 encrypt it. The stored record is "pubkey:ncryptsec…".
		const normalizedKey = privateKey.startsWith('nsec1') ? privateKey : nip19.nsecEncode(hexToBytes(privateKey))
		const { data: secretKeyBytes } = nip19.decode(normalizedKey) as { data: Uint8Array }
		const pubkey = getPublicKey(secretKeyBytes)
		const ncryptsec = encrypt(secretKeyBytes, password, logN, 1)
		return { pubkey, ncryptsec }
	},
	isRawNsecKey: (key) => {
		try {
			return key.startsWith('nsec') && nip19.decode(key).type === 'nsec'
		} catch {
			// Silence decode errors since migration is not possible.
			return false
		}
	},
	getAvailableNostrExtensions: () => {
		const extensions: string[] = []
		if (typeof window !== 'undefined') {
			if ((window as any).nostr) extensions.push('nostr')
			if ((window as any).nos2x) extensions.push('nos2x')
			if ((window as any).alby) extensions.push('alby')
		}
		return extensions
	},
}

// ---------------------------------------------------------------------------
// The machine, its registration and the legacy `@tanstack/store` bridge.
// ---------------------------------------------------------------------------
const machine = createAuthMachine({ storage: browserStorage, sessionFactory, ports })

/** The platform binding reads the one machine through this registration. */
registerAuthMachine(machine)

/** The `@tanstack/store` view of the auth state, for the remaining `useStore(authStore)` consumers. */
export const authStore = new Store<AuthState>(machine.getState())

/** The raw prototype updater, captured before the write-through override below installs on the instance. */
const setLocal = authStore.setState.bind(authStore)

// machine -> tanstack: mirror every machine change into the reactive store.
machine.subscribe((next) => setLocal(() => next))

// tanstack -> machine: a consumer (or a test) calling `authStore.setState` writes through to the single
// source of truth, which then mirrors the new value back.
authStore.setState = ((updater: (prev: AuthState) => AuthState) => {
	const prev = machine.getState()
	const next = updater(prev)
	machine.setState(() => next)
	if (Object.is(next, prev)) setLocal(() => next)
}) as typeof authStore.setState

/** The action surface the app calls. Each name and signature is the legacy one. */
export const authActions = {
	getAuthFromLocalStorageAndLogin: machine.getAuthFromLocalStorageAndLogin,
	decryptAndLogin: machine.decryptAndLogin,
	encryptAndSavePrivateKey: machine.encryptAndSavePrivateKey,
	checkAndShowTermsDialog: machine.checkAndShowTermsDialog,
	loginWithPrivateKey: machine.loginWithPrivateKey,
	getAvailableNostrExtensions: machine.getAvailableNostrExtensions,
	loginWithExtension: machine.loginWithExtension,
	loginWithNip46: machine.loginWithNip46,
	logout: machine.logout,
	userHasProducts: machine.userHasProducts,
	getNeedsMigration: machine.getNeedsMigration,
	migrateToEncryptedKey: machine.migrateToEncryptedKey,
} as const

/**
 * The current user's pubkey, or `null`. This is the **parameter** identity-scoped consumers take: an
 * assembly reads it here (or subscribes below) and passes the resolved value into a pure read.
 */
export function getCurrentPubkey(): string | null {
	return machine.getCurrentPubkey()
}

/**
 * The **identity subscription**: fires immediately with the current pubkey and again on every identity
 * transition — login, logout or a switch to another user.
 */
export function subscribeToAuthIdentity(listener: (identity: { pubkey: string | null }) => void): () => void {
	let last = getCurrentPubkey()
	listener({ pubkey: last })
	return machine.subscribe(() => {
		const next = getCurrentPubkey()
		if (next !== last) {
			last = next
			listener({ pubkey: next })
		}
	})
}

export const useAuth = () => {
	return {
		...authStore.state,
		...authActions,
	}
}
