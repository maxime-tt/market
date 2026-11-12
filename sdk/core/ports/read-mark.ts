/**
 * read-mark.ts — the read-state persistence seam: one watermark per stream, and nothing else.
 *
 * The notification cutover keeps read state **derived, never stored**. The notification source is
 * authoritative, the records are derived from it, and the only thing that survives a reload is the read
 * MARKS — one watermark per stream: the timestamp of the newest item the user has read. This module is that
 * persistence seam and nothing more; the stream upgrade (F2) layers the "what is unread" question on top.
 *
 * `ReadMarkPort` is the contract. It carries no transport of its own — like every port in `sdk/core/ports/`,
 * it declares a capability and a host supplies the implementation — but the seam is small and its semantics
 * are load-bearing enough that the SDK also ships the two implementations a host actually needs:
 *
 *   - `createStorageReadMarkPort(storage)` — a mark set kept through any `KeyValueStoragePort`, so the web
 *     platform persists marks in `localStorage` (or its user-scoped wrapper) without the SDK knowing browsers
 *     exist. The port owns the key format; the storage port owns encryption and storage policy.
 *   - `createMemoryReadMarkPort()` — a Map-backed set for tests and for a host that wants the seam wired but
 *     stores nothing durably, matching `notifications/ts/persistence.ts#createMemoryStorage`.
 *
 * Decisions the caller can rely on (each chosen against the alternatives):
 *
 *   - **A stream with no mark reads `null`, not `0`.** `null` is the honest absence: no mark means the user
 *     has never read the stream, which is not the same claim as "read everything up to the epoch". A caller
 *     that wants a floor composes `get(stream) ?? -Infinity` itself; the port refuses to invent one, because
 *     only the caller knows a stream's id space. Returning `0` would make "never read" and "read up to a
 *     real timestamp of zero" indistinguishable at the port.
 *
 *   - **Every key is namespaced: `read-mark:<stream>`.** The storage port does no namespacing of its own (its
 *     own doc says so), so the composed layer must scope the keys it writes or it collides with every other
 *     user of the same port — the notifications state key, the app's own keys. The fixed prefix `read-mark:`
 *     is that scope, and it is overridable (`options.namespace`) for a host that composes several mark sets
 *     over one store, e.g. a per-user prefix. The `:` separator keeps the stream opaque while leaving the
 *     namespace a clean, greppable prefix.
 *
 *   - **`set` is monotonic: a lower watermark is ignored, not refused and not stored.** A mark means "read up
 *     to here", so a stream that delivers an older item after a newer one (out-of-order arrival, a stale
 *     page) must not *lower* the mark and re-open read notifications. Clamping to the higher value is the
 *     monotone reading and needs no caller handling; refusing would push an ordering problem the port can
 *     absorb back onto every caller, and allowing the drop would silently un-read. The port therefore only
 *     ever moves a mark forward, which is exactly the property the stream upgrade relies on. Concurrency is
 *     out of scope: a read-modify-write across two writers is not atomic, and the stream's own model is one
 *     writer per stream.
 *
 *   - **A negative or non-finite `at` is refused, fail-closed (`ReadMarkError`, code `invalid-mark`).** These
 *     are not marks: timestamps are finite and non-negative, and `NaN`/`Infinity` would poison every later
 *     comparison. They can only come from a caller bug, so the port names it loudly rather than storing a
 *     value no honest reader can interpret — the same closed-refusal shape as `NotificationsError` and
 *     `StateError`.
 *
 *   - **A rejecting storage port is wrapped and rethrown (`ReadMarkError`, code `storage-failure`); a corrupt
 *     *value* under the key degrades to `null`.** The two are different failures. A rejection is the transport
 *     failing — we do not know the state, so the port must not pretend "never read" and re-show read
 *     notifications; it surfaces a typed error the caller can branch on or retry. A bad value, by contrast,
 *     is a host concern under the key, and the house precedent (notifications and state, which ignore a
 *     corrupt payload rather than lose in-memory state) is to read it as "no valid mark" and carry on.
 */
import type { KeyValueStoragePort } from './storage'

/**
 * ReadMarkPort — the read-state persistence seam: the watermark for one stream, or `null` when the stream has
 * never been read. A stream is the caller's opaque key (a conversation pubkey, a scope); the port interprets
 * nothing about it and validates nothing about it, matching the notifications module's opaque `scope`.
 */
export interface ReadMarkPort {
	/** The watermark for one stream — the newest read timestamp — or `null` when it has no mark. */
	get(stream: string): Promise<number | null>
	/** Record `stream` as read up to `at`. Monotonic: an `at` at or below the current mark is ignored. */
	set(stream: string, at: number): Promise<void>
}

/** ReadMarkPortOptions — how a storage-backed mark set is scoped: the key prefix it writes under. */
export interface ReadMarkPortOptions {
	/** The key prefix every mark is stored under. Defaults to `read-mark:`, so a key looks like `read-mark:<stream>`. */
	readonly namespace?: string
}

/**
 * ReadMarkError — the port's refusal, carrying a stable code a caller can branch on. It follows
 * `NotificationsError`/`StateError`: a named class with a `code`, and a message that interpolates no caller
 * value. `invalid-mark` is a caller bug (a negative or non-finite `at`); `storage-failure` is the injected
 * `KeyValueStoragePort` rejecting.
 */
export class ReadMarkError extends Error {
	readonly code: string
	readonly cause?: unknown

	constructor(code: string, message: string, cause?: unknown) {
		super(message)
		this.name = 'ReadMarkError'
		this.code = code
		this.cause = cause
	}
}

/** The default key prefix; a mark for stream `s` is stored under `read-mark:s`. */
const DEFAULT_NAMESPACE = 'read-mark:'

/** Reject anything that is not a mark: a negative or non-finite timestamp can only be a caller bug. */
function assertValidMark(at: number): void {
	if (!Number.isFinite(at) || at < 0) {
		throw new ReadMarkError('invalid-mark', 'a read mark must be a finite, non-negative number')
	}
}

/** A finite, non-negative number parsed from a stored value, or `null` when it is absent or corrupt. */
function parseStoredMark(raw: string | null): number | null {
	if (raw === null) return null
	const parsed = Number(raw)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/**
 * createStorageReadMarkPort — a mark set kept through a `KeyValueStoragePort`. Keys are the namespace plus the
 * stream (default `read-mark:<stream>`); the port writes the decimal value and reads it back, treating a value
 * that is absent or does not parse as "no mark", and wrapping a rejecting storage port as `storage-failure`.
 */
export function createStorageReadMarkPort(storage: KeyValueStoragePort, options: ReadMarkPortOptions = {}): ReadMarkPort {
	const namespace = options.namespace ?? DEFAULT_NAMESPACE
	const keyFor = (stream: string): string => `${namespace}${stream}`

	const get = async (stream: string): Promise<number | null> => {
		try {
			return parseStoredMark(await storage.get(keyFor(stream)))
		} catch (cause) {
			throw new ReadMarkError('storage-failure', 'the storage port rejected a read mark lookup', cause)
		}
	}

	const set = async (stream: string, at: number): Promise<void> => {
		assertValidMark(at)
		try {
			const current = parseStoredMark(await storage.get(keyFor(stream)))
			if (current !== null && at <= current) return
			await storage.set(keyFor(stream), String(at))
		} catch (cause) {
			if (cause instanceof ReadMarkError) throw cause
			throw new ReadMarkError('storage-failure', 'the storage port rejected a read mark write', cause)
		}
	}

	return { get, set }
}

/**
 * createMemoryReadMarkPort — a `ReadMarkPort` backed by a Map, with no persistence beyond the process. Test
 * support, and an in-memory fallback for a host that wants the seam wired but stores nothing durably, matching
 * `notifications/ts/persistence.ts#createMemoryStorage`. It performs no I/O and never rejects.
 */
export function createMemoryReadMarkPort(): ReadMarkPort {
	const marks = new Map<string, number>()
	return {
		get: async (stream) => marks.get(stream) ?? null,
		set: async (stream, at) => {
			assertValidMark(at)
			const current = marks.get(stream)
			if (current !== undefined && at <= current) return
			marks.set(stream, at)
		},
	}
}
