/**
 * sdk/core/auth/types.ts — the auth state machine's vocabulary: the state it owns,
 * the localStorage contract it preserves, the signer-session seam and the port
 * surface every cross-store effect is injected through.
 *
 * No React, no framework, no '@/'. The machine is pure logic; the host supplies
 * the storage, the signer session and the effects.
 */

/** The authenticated identity this machine exposes (pubkey only — the signer owns the rest). */
export interface AuthUser {
	pubkey: string
}

/** The auth flags the app renders on. Shape is byte-compatible with `src/lib/stores/auth.ts`. */
export interface AuthState {
	user: AuthUser | null
	isAuthenticated: boolean
	needsDecryptionPassword: boolean
	isAuthenticating: boolean
	needsMigration: boolean
}

export const INITIAL_AUTH_STATE: AuthState = {
	user: null,
	isAuthenticated: false,
	needsDecryptionPassword: false,
	isAuthenticating: false,
	needsMigration: false,
}

/** The five localStorage keys the legacy store owned. The names are a public contract; do not change them. */
export const AUTH_STORAGE_KEYS = {
	connectUrl: 'nostr_connect_url',
	localSignerKey: 'nostr_local_signer_key',
	localEncryptedSignerKey: 'nostr_local_encrypted_signer_key',
	autoLogin: 'nostr_auto_login',
	userPubkey: 'nostr_user_pubkey',
} as const

/** The key/value storage seam (localStorage in the browser, a Map in tests). */
export interface AuthKeyValueStorage {
	get(key: string): string | null
	set(key: string, value: string): void
	remove(key: string): void
}

/** One lane start on the signer session. */
export type AuthSessionStartInput =
	| { lane: 'ncryptsec'; ncryptsec: string; password: string }
	| { lane: 'nsec'; key: string }
	| { lane: 'extension' }
	| { lane: 'bunker'; bunkerUrl: string; clientKeyHex?: string; onAuthUrl?: (url: string) => void }

/** The session snapshot the identity observer receives. */
export interface AuthSessionSnapshot {
	pubkey?: string
	state: string
}

/** The handle the machine uses on a live signer session. */
export interface AuthSessionHandle {
	/** End any previous session, start the given lane, resolve the pubkey. */
	startFreshSession(input: AuthSessionStartInput): Promise<string | undefined>
	/** End the current session. */
	endSession(): Promise<void>
}

/**
 * The machine asks the host for a session handle LAZILY (on the first login action)
 * and registers the identity observer exactly once — this reproduces the legacy
 * store's lazy `getSignerSession()`, which deliberately does not construct a relay
 * pool merely because the module was imported.
 */
export type AuthSessionFactory = (onSnapshot: (snapshot: AuthSessionSnapshot) => void) => AuthSessionHandle

/**
 * Every cross-store effect the legacy store performed inline. The machine never
 * imports a store, a query or a component; each effect arrives here.
 */
export interface AuthPorts {
	/** `ndkActions.getNDK() != null` — the legacy guard in the login methods and in logout. */
	isNdkReady(): boolean
	/** `appNotifications.queue.clear()`; runs BEFORE the NDK guard in logout, exactly as the legacy did. */
	clearNotifications(): void
	/** The post-login adoption pipeline (bridge the capability to NDK, run signer onboarding, bootstrap the wallet, reconcile the cart). */
	adoptActiveSigner(wasLoggedOut: boolean): Promise<void>
	/** The logout teardown before the storage clears: remove the NDK signer, clear signer onboarding, reset the wallet. */
	teardownSignerAndWallet(): void
	/** The logout teardown after the storage clears: `cartActions.clear({ publishRemote: false, reason: 'logout' })`. */
	clearCart(): void
	/** `hasAcceptedTerms()`. */
	hasAcceptedTerms(): boolean
	/** `uiActions.openDialog('terms')`. */
	openTermsDialog(): void
	/** `fetchProductsByPubkey(pubkey)` — resolves to a non-empty list. */
	userHasProducts(pubkey: string): Promise<boolean>
	/** Derive the pubkey and encrypt the raw private key (NIP-49). Returns the `ncryptsec` string. */
	encryptPrivateKey(privateKey: string, password: string, logN: number): { pubkey: string; ncryptsec: string }
	/** True when the stored value is a raw `nsec1…` that decodes as an nsec (the migration trigger). */
	isRawNsecKey(key: string): boolean
	/** The browser-extension probe (`window.nostr | nos2x | alby`). */
	getAvailableNostrExtensions(): string[]
}

export interface Nip46LoginOptions {
	onAuthUrl?: (url: string) => void
}
