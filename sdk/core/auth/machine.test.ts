import { describe, expect, test } from 'bun:test'
import {
	AUTH_STORAGE_KEYS as K,
	INITIAL_AUTH_STATE,
	createAuthMachine,
	type AuthKeyValueStorage,
	type AuthPorts,
	type AuthSessionFactory,
	type AuthSessionSnapshot,
	type AuthSessionStartInput,
	type AuthState,
} from './index'

/**
 * A harness with every seam stubbed and every call recorded in one ordered `log`, so a test can assert the
 * transition ordering the legacy store relied on (notification clear, then teardown, then cart clear).
 */
function createHarness(
	config: {
		storage?: Record<string, string>
		resolvePubkey?: () => string | undefined
		ndkReady?: boolean
		extensions?: string[]
		acceptedTerms?: boolean
		isRawNsecKey?: (key: string) => boolean
		products?: (pubkey: string) => Promise<boolean>
	} = {},
) {
	const log: string[] = []
	const values = new Map<string, string>(Object.entries(config.storage ?? {}))
	const storage: AuthKeyValueStorage = {
		get: (key) => values.get(key) ?? null,
		set: (key, value) => {
			values.set(key, value)
			log.push(`set:${key}`)
		},
		remove: (key) => {
			values.delete(key)
			log.push(`remove:${key}`)
		},
	}

	const resolvePubkey = config.resolvePubkey ?? (() => 'pk')
	const startCalls: AuthSessionStartInput[] = []
	let factoryCalls = 0
	let endCalls = 0
	let observer: ((snapshot: AuthSessionSnapshot) => void) | undefined

	const handle = {
		startFreshSession: async (input: AuthSessionStartInput) => {
			startCalls.push(input)
			log.push(`start:${input.lane}`)
			return resolvePubkey()
		},
		endSession: async () => {
			endCalls += 1
			log.push('endSession')
		},
	}

	const sessionFactory: AuthSessionFactory = (onSnapshot) => {
		factoryCalls += 1
		observer = onSnapshot
		return handle
	}

	const ports: AuthPorts = {
		isNdkReady: () => config.ndkReady ?? true,
		clearNotifications: () => log.push('clearNotifications'),
		adoptActiveSigner: async (wasLoggedOut: boolean) => {
			log.push(`adoptActiveSigner:${wasLoggedOut}`)
		},
		teardownSignerAndWallet: () => log.push('teardownSignerAndWallet'),
		clearCart: () => log.push('clearCart'),
		hasAcceptedTerms: () => config.acceptedTerms ?? true,
		openTermsDialog: () => log.push('openTermsDialog'),
		userHasProducts: async (pubkey: string) => (config.products ? config.products(pubkey) : true),
		encryptPrivateKey: () => ({ pubkey: 'enc-pubkey', ncryptsec: 'ncryptsec-value' }),
		isRawNsecKey: (key: string) => (config.isRawNsecKey ? config.isRawNsecKey(key) : key.startsWith('nsec1')),
		getAvailableNostrExtensions: () => config.extensions ?? ['nostr'],
	}

	const machine = createAuthMachine({ storage, sessionFactory, ports })

	return {
		machine,
		values,
		log,
		startCalls,
		handle,
		emit: (snapshot: AuthSessionSnapshot) => observer?.(snapshot),
		get factoryCalls() {
			return factoryCalls
		},
		get endCalls() {
			return endCalls
		},
	}
}

const ALL_KEYS = {
	[K.connectUrl]: 'bunker://example',
	[K.localSignerKey]: 'client-key-hex',
	[K.localEncryptedSignerKey]: 'pubkey:ncryptsec-value',
	[K.autoLogin]: 'true',
	[K.userPubkey]: 'stored-pubkey',
}

describe('auth machine — initial state and the lazy session', () => {
	test('starts in INITIAL_AUTH_STATE with no current pubkey', () => {
		const harness = createHarness()

		expect(harness.machine.getState()).toBe(INITIAL_AUTH_STATE)
		expect(harness.machine.getCurrentPubkey()).toBeNull()
	})

	test('does not construct the session factory until a login action runs', async () => {
		const harness = createHarness()

		expect(harness.factoryCalls).toBe(0)

		// An auto-login check with no auto-login flag touches no session.
		await harness.machine.getAuthFromLocalStorageAndLogin()
		expect(harness.factoryCalls).toBe(0)

		await harness.machine.loginWithPrivateKey('nsec1example')
		expect(harness.factoryCalls).toBe(1)
	})
})

describe('auth machine — loginWithPrivateKey', () => {
	test('sets isAuthenticating during the login and false after, resolves the user and authenticates', async () => {
		const harness = createHarness({ resolvePubkey: () => 'resolved-pubkey' })
		const seen: AuthState[] = []
		harness.machine.subscribe((state) => seen.push(state))

		const user = await harness.machine.loginWithPrivateKey('nsec1example')

		expect(user).toEqual({ pubkey: 'resolved-pubkey' })
		expect(seen.some((state) => state.isAuthenticating)).toBe(true)
		expect(harness.machine.getState().isAuthenticating).toBe(false)
		expect(harness.machine.getState().isAuthenticated).toBe(true)
		expect(harness.machine.getCurrentPubkey()).toBe('resolved-pubkey')
		// The lane start ends any previous session first.
		expect(harness.log.indexOf('endSession')).toBeLessThan(harness.log.indexOf('start:nsec'))
	})

	test('throws the exact string and leaves isAuthenticated false when the lane resolves no identity', async () => {
		const harness = createHarness({ resolvePubkey: () => undefined })

		await expect(harness.machine.loginWithPrivateKey('nsec1example')).rejects.toThrow('The private key lane did not resolve an identity')
		expect(harness.machine.getState().isAuthenticated).toBe(false)
		expect(harness.machine.getState().isAuthenticating).toBe(false)
	})

	test('the NDK guard throws "NDK not initialized" without ever setting isAuthenticating', async () => {
		const harness = createHarness({ ndkReady: false })
		const seen: AuthState[] = []
		harness.machine.subscribe((state) => seen.push(state))

		await expect(harness.machine.loginWithPrivateKey('nsec1example')).rejects.toThrow('NDK not initialized')
		expect(seen).toEqual([])
		expect(harness.factoryCalls).toBe(0)
	})
})

describe('auth machine — logout', () => {
	test('clears the four keys (not userPubkey), runs the teardown in order and resets the state', async () => {
		const harness = createHarness({ storage: ALL_KEYS })
		await harness.machine.loginWithPrivateKey('nsec1example')
		expect(harness.machine.getState().isAuthenticated).toBe(true)

		harness.log.length = 0
		harness.machine.logout()

		expect(harness.values.has(K.localSignerKey)).toBe(false)
		expect(harness.values.has(K.connectUrl)).toBe(false)
		expect(harness.values.has(K.localEncryptedSignerKey)).toBe(false)
		expect(harness.values.has(K.autoLogin)).toBe(false)
		// The legacy store deliberately kept the stored pubkey across a logout.
		expect(harness.values.get(K.userPubkey)).toBe('stored-pubkey')

		expect(harness.log).toEqual([
			'clearNotifications',
			'endSession',
			'teardownSignerAndWallet',
			`remove:${K.localSignerKey}`,
			`remove:${K.connectUrl}`,
			`remove:${K.localEncryptedSignerKey}`,
			`remove:${K.autoLogin}`,
			'clearCart',
		])
		expect(harness.machine.getState()).toBe(INITIAL_AUTH_STATE)
	})

	test('returns early without removing keys when NDK is not ready', async () => {
		const harness = createHarness({ storage: ALL_KEYS, ndkReady: false })

		harness.machine.logout()

		expect(harness.log).toEqual(['clearNotifications'])
		for (const key of Object.values(K)) expect(harness.values.has(key)).toBe(true)
	})
})

describe('auth machine — getNeedsMigration', () => {
	test('is true only when the stored record second half is a raw nsec key', () => {
		const seenKeys: string[] = []
		const harness = createHarness({
			storage: { [K.localEncryptedSignerKey]: 'pubkey:nsec1rawkey' },
			isRawNsecKey: (key) => {
				seenKeys.push(key)
				return key.startsWith('nsec1')
			},
		})

		expect(harness.machine.getNeedsMigration()).toBe(true)
		expect(seenKeys).toEqual(['nsec1rawkey'])
	})

	test('is false when the record second half is not a raw nsec key', () => {
		const harness = createHarness({
			storage: { [K.localEncryptedSignerKey]: 'nsec1rawkey:ncryptsec-value' },
		})

		expect(harness.machine.getNeedsMigration()).toBe(false)
	})

	test('is false when no record is stored', () => {
		const harness = createHarness()
		expect(harness.machine.getNeedsMigration()).toBe(false)
	})
})

describe('auth machine — getAuthFromLocalStorageAndLogin', () => {
	test('does nothing when auto-login is not enabled and leaves isAuthenticating false', async () => {
		const harness = createHarness()
		const seen: AuthState[] = []
		harness.machine.subscribe((state) => seen.push(state))

		await harness.machine.getAuthFromLocalStorageAndLogin()

		// The legacy `finally` still clears the flag on the early-return path, so the only notifications are
		// that clear — no login action ran and no session was ever started.
		expect(seen.every((state) => !state.isAuthenticating)).toBe(true)
		expect(seen.every((state) => !state.isAuthenticated)).toBe(true)
		expect(harness.machine.getState().isAuthenticating).toBe(false)
		expect(harness.machine.getState().isAuthenticated).toBe(false)
		expect(harness.startCalls).toEqual([])
	})

	test('sets needsMigration and returns without touching isAuthenticating', async () => {
		const harness = createHarness({ storage: { [K.localEncryptedSignerKey]: 'pubkey:nsec1rawkey' } })

		await harness.machine.getAuthFromLocalStorageAndLogin()

		expect(harness.machine.getState().needsMigration).toBe(true)
		expect(harness.machine.getState().isAuthenticating).toBe(false)
	})

	test('sets needsDecryptionPassword when an encrypted key is stored', async () => {
		const harness = createHarness({
			storage: { [K.autoLogin]: 'true', [K.localEncryptedSignerKey]: 'pubkey:ncryptsec-value' },
		})

		await harness.machine.getAuthFromLocalStorageAndLogin()

		expect(harness.machine.getState().needsDecryptionPassword).toBe(true)
		expect(harness.machine.getState().isAuthenticating).toBe(false)
	})
})

describe('auth machine — the identity observer', () => {
	test('flips user and isAuthenticated from a session snapshot', async () => {
		const harness = createHarness({ resolvePubkey: () => 'lane-pubkey' })
		const seen: AuthState[] = []
		harness.machine.subscribe((state) => seen.push(state))
		await harness.machine.loginWithPrivateKey('nsec1example')

		harness.emit({ pubkey: 'observed-pubkey', state: 'active' })

		expect(harness.machine.getState().user).toEqual({ pubkey: 'observed-pubkey' })
		expect(harness.machine.getState().isAuthenticated).toBe(true)
		expect(harness.machine.getCurrentPubkey()).toBe('observed-pubkey')
		expect(seen.at(-1)?.user).toEqual({ pubkey: 'observed-pubkey' })

		harness.emit({ state: 'idle' })

		expect(harness.machine.getState().user).toBeNull()
		expect(harness.machine.getState().isAuthenticated).toBe(false)
	})
})

describe('auth machine — the error strings the callers match', () => {
	test('loginWithExtension refuses with no extension detected', async () => {
		const harness = createHarness({ extensions: [] })

		await expect(harness.machine.loginWithExtension()).rejects.toThrow(
			'No Nostr extension detected. Please install a Nostr browser extension (e.g., Alby, nos2x) before logging in.',
		)
		expect(harness.machine.getState().isAuthenticating).toBe(false)
	})

	test('loginWithExtension refuses when the extension lane resolves no identity', async () => {
		const harness = createHarness({ resolvePubkey: () => undefined })

		await expect(harness.machine.loginWithExtension()).rejects.toThrow(
			'Failed to authenticate with Nostr extension. Please make sure your extension is unlocked and try again.',
		)
		expect(harness.machine.getState().isAuthenticated).toBe(false)
	})

	test('loginWithNip46 refuses when the bunker lane resolves no identity', async () => {
		const harness = createHarness({ resolvePubkey: () => undefined })

		await expect(harness.machine.loginWithNip46('bunker://example', { privateKey: 'key' })).rejects.toThrow(
			'The bunker lane did not resolve an identity',
		)
		expect(harness.machine.getState().isAuthenticated).toBe(false)
	})

	test('decryptAndLogin throws "No encrypted key found" when no record is stored', async () => {
		const harness = createHarness()

		await expect(harness.machine.decryptAndLogin('password')).rejects.toThrow('No encrypted key found')
		expect(harness.machine.getState().isAuthenticating).toBe(false)
	})

	test('migrateToEncryptedKey throws "No private key found to migrate" when no record is stored', async () => {
		const harness = createHarness()

		await expect(harness.machine.migrateToEncryptedKey('password')).rejects.toThrow('No private key found to migrate')
		expect(harness.machine.getState().isAuthenticating).toBe(false)
	})
})
