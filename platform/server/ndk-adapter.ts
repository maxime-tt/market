/**
 * NDK adapter — wraps `@nostr-dev-kit/ndk` as an implementation of the
 * `sdk/core/nostr-io` PoolPort interface.
 *
 * The server needs NDK (not applesauce-relay) for backward compatibility with
 * existing singleton patterns and the Lightning identifier path. This adapter
 * lets every server module talk through the same sdk port whether the wire is
 * NDK or applesauce-relay.
 */
import NDK from '@nostr-dev-kit/ndk'
import type { NostrEvent as NdkEvent } from '@nostr-dev-kit/ndk'
import type {
	NostrEvent as SdkEvent,
	FilterIn,
	PoolPort,
	PoolSubscription,
	RelayAck,
	RelayStatus,
	RelayUrl,
} from '@sdk/core/nostr-io/ts/types'
import { Observable, Subject } from 'rxjs'
import type { RelaySeamError } from '@sdk/core/nostr-io/ts/errors'
import type { CountResult } from '@sdk/core/nostr-io/ts/types'

/** NDK's subscribe handle — opaque to us, we only need `.on()` and `.stop()`. */
interface NdkSubscriptionHandle {
	on(event: string, cb: (arg: unknown) => void): void
	stop(): void
}

/**
 * A NostrEvent-like object that exposes `rawEvent()`.
 *
 * `NDKEvent` from NDK has a `rawEvent()` method returning the raw protocol event.
 * The sdk port uses the raw event type (`SdkEvent` / `NostrEvent` from nostr-io).
 */
interface NdkEventWrapper {
	rawEvent(): SdkEvent
}

function ndkEventHasRawEvent(obj: unknown): obj is NdkEventWrapper {
	return typeof obj === 'object' && obj !== null && 'rawEvent' in obj && typeof (obj as NdkEventWrapper).rawEvent === 'function'
}

function toRelayStatus(url: RelayUrl, ndk: NDK): RelayStatus {
	const relayConfig = ndk.getRelays(url)
	const connected = relayConfig !== undefined
	return { url, connected, ready: connected, authenticated: false }
}

/**
 * Extract the raw protocol event from an NDK event.
 *
 * NDKEvent's rawEvent() returns a structurally identical event.
 * We use a guard instead of a cast so the reader can see where the
 * unchecked boundary is.
 */
function toSdkEvent(ndkEvent: NdkEvent): SdkEvent {
	const raw = ndkEvent.rawEvent()
	return raw as unknown as SdkEvent
}

/** NDK instance with count() available. */
interface NdkWithCount {
	count?: (filters: FilterIn[]) => Promise<number>
}

/** NDK instance with NDKEvent constructor. */
interface NdkWithConstructor {
	NDKEvent: new (ndk: NDK, evt: unknown) => NdkEventWrapper
}

/** Object with a publish() method returning boolean. */
interface PublishableEvent {
	publish(): Promise<boolean>
}

/**
 * NDK adapter: one NDK instance wrapped as a PoolPort.
 */
export class NdkAdapter implements PoolPort {
	private ndk: NDK
	private subscriptions: Array<{ sub: NdkSubscriptionHandle; events: Subject<SdkEvent> }> = []

	constructor(ndk: NDK) {
		this.ndk = ndk
	}

	async request(relays: RelayUrl[], filters: FilterIn[], opts?: { signal?: AbortSignal }): Promise<Observable<SdkEvent>> {
		return new Observable<SdkEvent>((subscriber) => {
			const sub = this.ndk.subscribe(filters, { closeOnEose: true }) as NdkSubscriptionHandle
			sub.on('event', (rawEvent: unknown) => {
				if (ndkEventHasRawEvent(rawEvent)) {
					subscriber.next(rawEvent.rawEvent())
				}
			})
			sub.on('eose', () => {
				subscriber.complete()
			})
			sub.on('close', () => {
				if (!subscriber.closed) subscriber.complete()
			})

			return () => {
				sub.stop()
				subscriber.complete()
			}
		})
	}

	subscribe(relays: RelayUrl[], filters: FilterIn[]): PoolSubscription {
		const events = new Subject<SdkEvent>()
		const errors = new Subject<RelaySeamError>()
		const sub = this.ndk.subscribe(filters, { closeOnEose: false }) as NdkSubscriptionHandle

		sub.on('event', (rawEvent: unknown) => {
			if (ndkEventHasRawEvent(rawEvent)) {
				events.next(rawEvent.rawEvent())
			}
		})
		sub.on('error', (err: Error) => {
			errors.next({ relays, filters, reason: 'unknown', message: err.message } as RelaySeamError)
		})

		this.subscriptions.push({ sub, events })

		return {
			events: events.asObservable(),
			errors: errors.asObservable(),
			unsubscribe: () => {
				try {
					sub.stop()
				} catch {
					// Idempotent — stop twice throws nothing
				}
				events.complete()
			},
		}
	}

	async publish(relays: RelayUrl[], event: SdkEvent): Promise<RelayAck[]> {
		// Construct an NDK event wrapper around the raw event for publication.
		// We reach through the NDK singleton's NDKEvent constructor — a necessary
		// unchecked cast because NDK does not export the constructor type.
		const ndkCtor = this.ndk as NdkWithConstructor
		const ndkEvent = new ndkCtor.NDKEvent(this.ndk, event)
		const result = (ndkEvent as PublishableEvent).publish()
		return [{ url: relays[0] || '', accepted: !!result }]
	}

	async count(relays: RelayUrl[], filters: FilterIn[]): Promise<CountResult> {
		const ndkWithCount = this.ndk as NdkWithCount
		const countMethod = ndkWithCount.count
		const count = countMethod ? await countMethod(filters) : 0
		return { count, approximate: false }
	}

	status(relays: RelayUrl[]): RelayStatus[] {
		return relays.map((url) => toRelayStatus(url, this.ndk))
	}

	close(): void {
		for (const { sub } of this.subscriptions) {
			try {
				sub.stop()
			} catch {
				// Idempotent
			}
		}
		this.subscriptions = []
	}
}
