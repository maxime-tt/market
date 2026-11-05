/**
 * Applesauce-relay adapter — wraps `applesauce-relay`'s `RelayPool` as an
 * implementation of the `sdk/core/nostr-io` PoolPort interface.
 *
 * This replaces the previous NDK adapter (same filename, different wire).
 * Every server module talks through the same sdk port; the concrete library
 * is now applesauce-relay — identical to what `sdk/core/nostr-io` ships.
 */
import { RelayPool } from 'applesauce-relay'
import { RelaySeamError } from '@sdk/core/nostr-io/ts/errors'
import type { NostrEvent as ApplesauceEvent } from 'applesauce-core/helpers/event'
import { EMPTY, NEVER, Observable, Subject, filter, firstValueFrom, map, share, takeUntil, takeWhile, tap } from 'rxjs'
import type {
	FilterIn,
	PoolPort,
	PoolSubscription,
	RelayAck,
	RelayStatus,
	RelayUrl,
	CountResult,
	RelayFailure,
	WireResult,
} from '@sdk/core/nostr-io/ts/types'
import { mapClosedReason, normalizeRelayUrl } from '@sdk/core/nostr-io/ts/pool'

function isEventMessage(message: unknown): message is { type: 'EVENT'; event: ApplesauceEvent } {
	return typeof message === 'object' && message !== null && (message as { type?: string }).type === 'EVENT'
}

function isEoseMessage(message: unknown): message is { type: 'EOSE'; from: string } {
	return typeof message === 'object' && message !== null && (message as { type?: string }).type === 'EOSE'
}

function isClosedMessage(message: unknown): message is { type: 'CLOSED'; reason: string; from: string } {
	return typeof message === 'object' && message !== null && (message as { type?: string }).type === 'CLOSED'
}

function isErrorMessage(message: unknown): message is { type: 'ERROR'; error: unknown; from: string } {
	return typeof message === 'object' && message !== null && (message as { type?: string }).type === 'ERROR'
}

/**
 * Applesauce-relay adapter: one RelayPool wrapped as a PoolPort.
 *
 * This is structurally identical to `sdk/core/nostr-io/ts/relay-adapter.ts`
 * but lives in `platform/server/` so the server can carry its own relay
 * pool (different from any pool created by browser-side NostrIo).
 */
export class RelayPoolAdapter implements PoolPort {
	private readonly pool: RelayPool

	constructor(pool?: RelayPool) {
		this.pool = pool ?? new RelayPool()
		this.relays = pool ? Array.from(pool.relays.keys()) : []
	}

	/** Track the relays this adapter was created with. */
	private readonly relays: string[]

	private abortSignalObservable(signal?: AbortSignal): Observable<void> {
		if (!signal) return EMPTY
		return new Observable<void>((s) => {
			const onAbort = () => s.next()
			signal.addEventListener('abort', onAbort, { once: true })
			return () => signal.removeEventListener('abort', onAbort)
		})
	}

	async query(filters: FilterIn | FilterIn[], opts?: { signal?: AbortSignal }): Promise<WireResult> {
		const events: ApplesauceEvent[] = []
		const failures: RelaySeamError[] = []
		const source = this.pool.req([], filters as FilterIn[])
		const sub = source.subscribe({
			next: (message) => {
				if (isEventMessage(message)) events.push(message.event)
				if (isClosedMessage(message)) failures.push(new RelaySeamError(mapClosedReason(message.reason), message.reason))
				if (isErrorMessage(message)) {
					const err = message.error instanceof Error ? message.error : new Error(String(message.error))
					failures.push(new RelaySeamError('rejected', err.message))
				}
			},
			error: (err) => {
				const e = err instanceof Error ? err : new Error(String(err))
				failures.push(new RelaySeamError('rejected', e.message))
			},
			complete: () => {
				// nothing
			},
		})
		// Wait for EOSE by taking until we see one, or signal aborts
		const eoseSubject = new Subject<boolean>()
		source.pipe(
			filter(isEoseMessage),
			tap((msg) => {
				eoseSubject.next(true)
				sub.unsubscribe()
			}),
			takeUntil(this.abortSignalObservable(opts?.signal)),
		).subscribe()
		// Wait for EOSE or abort, with timeout fallback
		try {
			const eose = await firstValueFrom(eoseSubject)
			if (!eose) {
				// EOSE never arrived (signal aborted)
				return { events, eose: false, failures }
			}
		} catch (err: unknown) {
			// If the EOSE never arrived (signal aborted), report partial results with eose: false
			if (opts?.signal?.aborted) {
				sub.unsubscribe()
				return { events, eose: false, failures }
			}
			throw new RelaySeamError('rejected', err instanceof Error ? err.message : 'query failed')
		}
		sub.unsubscribe()
		return { events, eose: true, failures }
	}

	request(relays: RelayUrl[], filters: FilterIn[], opts?: { signal?: AbortSignal }): Observable<ApplesauceEvent> {
		const target = new Set(relays)
		const seen = new Set<string>()
		const source = this.pool.req(relays, [...filters])

		// Build the abort observable if a signal was provided
		let abortSignal: Observable<void> | undefined
		if (opts?.signal) {
			abortSignal = new Observable<void>((s) => {
				const onAbort = () => s.next()
				opts.signal!.addEventListener('abort', onAbort, { once: true })
				return () => opts.signal!.removeEventListener('abort', onAbort)
			})
		}

		return source.pipe(
			tap((message) => {
				if (isEoseMessage(message)) seen.add(message.from)
			}),
			map((message) => {
				if (message.type === 'CLOSED') throw new RelaySeamError(mapClosedReason(message.reason), message.reason)
				if (message.type === 'ERROR') {
					const error = message.error instanceof Error ? message.error : new Error(String(message.error))
					throw new RelaySeamError('not-found', error.message)
				}
				if (message.type === 'EVENT') return message.event
				return message as unknown as ApplesauceEvent
			}),
			takeWhile(() => seen.size < target.size, true),
			abortSignal ? takeUntil(abortSignal) : share(),
		)
	}

	subscribe(relays: RelayUrl[], filters: FilterIn[]): PoolSubscription {
		const stop = new Subject<void>()
		const messages = this.pool.req(relays, [...filters]).pipe(takeUntil(stop), share())
		const events = messages.pipe(
			filter(isEventMessage),
			map((message) => message.event),
			share(),
		)
		const failures = messages.pipe(
			map((message): RelayFailure | null => {
				if (message.type === 'CLOSED') return { relay: message.from, reason: mapClosedReason(message.reason), message: message.reason }
				if (message.type === 'ERROR') {
					const error = message.error instanceof Error ? message.error : new Error(String(message.error))
					return { relay: message.from, reason: 'rejected', message: error.message }
				}
				return null
			}),
			filter((failure): failure is RelayFailure => failure !== null),
			share(),
		)
		const eose = messages.pipe(
			filter(isEoseMessage),
			map(() => undefined),
			share(),
		)
		return {
			events,
			failures,
			eose,
			unsubscribe: () => {
				stop.next()
				stop.complete()
			},
		}
	}

	async publish(relays: RelayUrl[], event: ApplesauceEvent): Promise<RelayAck[]> {
		const responses = await this.pool.publish(relays, event)
		return responses.map((r) => ({
			url: r.from,
			accepted: r.ok,
			reason: r.ok ? undefined : mapClosedReason(r.message ?? ''),
			message: r.message,
		}))
	}

	async count(relays: RelayUrl[], filters: FilterIn[]): Promise<CountResult> {
		const record = await firstValueFrom(this.pool.count(relays, filters as any))
		let count = 0
		let approximate = false
		for (const response of Object.values(record)) {
			count += response.count
			const approx: unknown = (response as Record<string, unknown>).approximate
			if (approx === true) approximate = true
		}
		return { count, approximate }
	}

	status(relays: RelayUrl[]): RelayStatus[] {
		// If no relays were given, return the adapter's known relay set
		const target = relays.length > 0 ? relays : this.relays
		return target.map((url) => {
			let key: string
			try {
				key = normalizeRelayUrl(url)
			} catch {
				key = url
			}
			const relay = this.pool.relays.get(key)
			if (!relay) return { url, connected: false, ready: false, authenticated: false }
			return { url, connected: relay.connected, ready: relay.ready, authenticated: relay.authenticated }
		})
	}

	close(): void {
		this.pool.close()
	}
}
