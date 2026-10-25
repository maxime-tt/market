/**
 * platform/web/storage/localStorageKeyValue.ts — the host's localStorage-backed KeyValueStoragePort.
 *
 * Host-side, by design: `sdk/core/ports/storage.ts` declares the port and states that "hosts own
 * encryption and storage policy". The SDK therefore ships no concrete store; this module is the web
 * host's answer — a store that keeps string values verbatim in `globalThis.localStorage`, with no
 * namespacing, envelope or encryption of its own. Callers that need scoping, a schema wrapper or
 * ciphertext wrap this port (see `src/lib/sdkAdapters.ts` for the app's user-scoped variant).
 *
 * Non-DOM behaviour (documented decision): a host with no `localStorage` — SSR, build-time, a worker
 * without storage, or a sandbox with the global removed — is treated as an EMPTY store, never an
 * error. `get` resolves `null`, `set` and `remove` resolve without persisting. Reasons:
 *   1. The port's shape already says it. `get` returns `string | null`; absent storage and an absent
 *      key are indistinguishable to a caller, so an empty store is the honest reading of "no
 *      localStorage" rather than a special case.
 *   2. It matches the house pattern. The app's own storage seam (`src/lib/wallet/storage.ts`) swallows
 *      storage failures so a missing or quota-full store degrades the feature instead of tearing down
 *      the page, and `memoryEventStore` is the reference port that performs no I/O and never throws.
 *      Throwing here would force every query and publish path to guard a store it may not even need.
 *   3. It fails safe, not closed. The SDK's one fail-closed write path (`saveUserData({ strict: true })`)
 *      is for fund-loss-critical records whose only durable copy must not vanish silently. This port
 *      is the generic seam beneath features; making it throw would turn every optional cache write into
 *      a hard failure. A caller that needs fail-closed semantics wraps this port and adds them.
 *
 * The rejected option was throwing a named error (e.g. `StorageUnavailableError`): it is louder, but it
 * pushes the non-DOM case onto every caller and contradicts `get`'s nullable return. Kept here only as
 * a note; a caller wanting that contract can test for the global itself.
 */
import type { KeyValueStoragePort } from '@sdk/core'

/**
 * Read the ambient store, or `undefined` on a host that has none. `localStorage` is also read through a
 * try/catch because some browsers throw on mere property access when storage is disabled by policy.
 */
function store(): Storage | undefined {
	try {
		return globalThis.localStorage as Storage | undefined
	} catch {
		return undefined
	}
}

/**
 * `KeyValueStoragePort` backed by the host's `localStorage`, keys and values verbatim.
 *
 * On a host with no `localStorage` the port is an empty store: `get` yields `null`, `set` and `remove`
 * are no-ops. Reads that fail (storage disabled, security error) resolve `null`; writes that fail are
 * swallowed rather than thrown, per the house degrade-don't-tear-down pattern. See the module header.
 */
export function createLocalStorageKeyValuePort(): KeyValueStoragePort {
	return {
		get: async (key) => {
			const storage = store()
			if (!storage) return null
			try {
				return storage.getItem(key)
			} catch {
				return null
			}
		},
		set: async (key, value) => {
			const storage = store()
			if (!storage) return
			try {
				storage.setItem(key, value)
			} catch {
				// Storage policy (private mode, quota) refused the write; degrade silently.
			}
		},
		remove: async (key) => {
			const storage = store()
			if (!storage) return
			try {
				storage.removeItem(key)
			} catch {
				// Removing from an unavailable store is already a no-op.
			}
		},
	}
}
