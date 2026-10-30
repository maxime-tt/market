/**
 * Temporary NDK-backed implementation of the {@link NostrIo} port.
 *
 * This bridges the existing NDK singleton (`@/lib/stores/ndk`) onto the
 * library-agnostic seam. It is the default adapter during the migration and
 * is deleted in Wave D once every caller has flipped to `io-applesauce.ts`.
 */
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'

import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { getRegisteredSignerSource } from './io-applesauce'
// The contract is imported from `./io-types`, not `./io`: `./io` imports this
// adapter to register the default, so importing back from it would be a cycle.
import type { FetchOptions, NostrFilter, NostrIo, NostrUser, PublishOptions, PublishResult, SubscribeOptions } from './io-types'

/** Convert an NDKEvent into a raw nostr-tools event. */
function toRaw(event: NDKEvent): NostrEvent {
	return event.rawEvent() as unknown as NostrEvent
}

export const ndkIo: NostrIo = {
	async fetchEvents(filter, opts?: FetchOptions) {
		const ndk = ndkStore.state.ndk
		const relaySet = opts?.relayUrls?.length && ndk ? NDKRelaySet.fromRelayUrls(opts.relayUrls, ndk) : undefined
		const events = await ndkActions.fetchEventsWithTimeout(filter as NostrFilter[], {
			timeoutMs: opts?.timeoutMs,
			relaySet,
		})
		return Array.from(events).map(toRaw)
	},

	subscribe(filter, onEvent, opts?: SubscribeOptions) {
		const ndk = ndkStore.state.ndk
		if (!ndk) return () => {}
		const relaySet = opts?.relayUrls?.length ? NDKRelaySet.fromRelayUrls(opts.relayUrls, ndk) : undefined
		const subscriptionOpts = {
			closeOnEose: opts?.closeOnEose ?? false,
			onEvent: (event: NDKEvent) => onEvent(toRaw(event)),
			onEose: () => opts?.onEose?.(),
		}
		const subscription = relaySet
			? ndk.subscribe(filter as NostrFilter[], subscriptionOpts, relaySet)
			: ndk.subscribe(filter as NostrFilter[], subscriptionOpts)
		return () => {
			subscription.stop()
		}
	},

	async publish(event, opts?: PublishOptions): Promise<PublishResult> {
		const ndk = ndkStore.state.ndk
		if (!ndk) throw new Error('NDK not initialized')
		const relaySet = opts?.relayUrls?.length ? NDKRelaySet.fromRelayUrls(opts.relayUrls, ndk) : undefined
		const ndkEvent = new NDKEvent(ndk, event)
		// ndkActions.publishEvent resolves with the set of relays that ACKed the
		// event (NDKRelay), so the seam can surface truthful relay URLs.
		const published = await ndkActions.publishEvent(ndkEvent, relaySet)
		return { publishedRelays: new Set(Array.from(published, (relay) => (relay as { url: string }).url)) }
	},

	async sign(template: EventTemplate): Promise<NostrEvent> {
		// A3.7 (C2): the NDK bridge signs through the SAME injected signer source
		// io-applesauce reads — the auth session's capability, never the ndk
		// store's signer copy. Unregistered fails closed; logged-out is the same
		// 'No signer available' refusal the NDK signer-less path threw.
		const source = getRegisteredSignerSource()
		if (!source) {
			throw new Error('io-ndk: no signer source registered — platform/web/boot.ts must call setSignerSource at composition')
		}
		const capability = source()
		if (!capability) throw new Error('No signer available')
		return (await capability.signEvent(template)) as NostrEvent
	},

	async getUser(): Promise<NostrUser | null> {
		const source = getRegisteredSignerSource()
		if (!source) throw new Error('io-ndk: no signer source registered — platform/web/boot.ts must call setSignerSource at composition')
		const capability = source()
		// Logged out is a null user, matching the ndk store's null user.
		if (!capability) return null
		return { pubkey: await capability.getPublicKey() }
	},
}
