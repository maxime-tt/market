/**
 * platform/web/readContext.ts — the read-side composition root.
 *
 * This is the ONLY read module a feature binding may import. The two relay-client adapters beside
 * it (`ndkReadContext.ts`, `applesauceReadContext.ts`) are private implementation: they own the
 * `platform -> src` edge to the host's relay client, and a feature must not know which client is
 * in use (D1 seam `d1-neutral-seam`).
 *
 * Two things are exported here:
 *
 *  - the configured port — `getReadContext()` answers `EventReadContext<NostrEventLike>`, with the
 *    adapter chosen by `configureReadContext()` rather than by the binding's import. Its `fetch`
 *    normalizes every event through `toNostrEventLike`, so a caller of the port never sees an
 *    `NDKEvent` value.
 *  - the flat accessors the bindings still need (store, fetch-one, app-relay pinning, the
 *    private-auction-claim helpers), re-exported by explicit name from the two adapters. Explicit
 *    names are required: both adapters export `NDKEvent`/`NDKFilter`, so `export *` would collide.
 *
 * This file imports only `@platform/*`, `@sdk/*` and packages — it adds no `@/` specifier of its
 * own, so it is not a second `platform -> src` file; the adapter it re-exports from is.
 */
import type { NostrEventLike } from '@sdk/core'
import type { EventReadContext } from '@sdk/core/event-store'
import { toNostrEventLike } from '@sdk/core/nostr/eventLike'
import {
	addAppExplicitRelays,
	createAppRelayReadContext,
	createBugRelayReadContext,
	createNdkReadContext,
	createPrivateAuctionClaimMessageForActiveSigner,
	decryptPrivateAuctionClaimMessageForActiveSigner,
	fetchEventById,
	fetchEventByNaddr,
	fetchEventsByFilter,
	getAppRelaySet,
	getConfiguredRelayUrls,
	getCurrentPubkey,
	getNdkEventStore,
	isAppRelayReady,
	privateAuctionClaimMatchesPublicMarker,
	readAuthorizedLabelers,
	authStore,
	connectAppRelays,
	getAppRelayUrl,
	getAuctionClaimPublicMarkerFields,
} from '@platform/web/ndkReadContext'
import { applesauceIo, createApplesauceReadContext, getRawEventStore } from '@platform/web/applesauceReadContext'

// Explicit names, not `export *`: both adapters export `NDKEvent`/`NDKFilter`.
export {
	addAppExplicitRelays,
	authStore,
	connectAppRelays,
	createAppRelayReadContext,
	createBugRelayReadContext,
	createNdkReadContext,
	createPrivateAuctionClaimMessageForActiveSigner,
	decryptPrivateAuctionClaimMessageForActiveSigner,
	fetchEventById,
	fetchEventByNaddr,
	fetchEventsByFilter,
	getAppRelaySet,
	getAppRelayUrl,
	getAuctionClaimPublicMarkerFields,
	getConfiguredRelayUrls,
	getCurrentPubkey,
	getNdkEventStore,
	isAppRelayReady,
	privateAuctionClaimMatchesPublicMarker,
	readAuthorizedLabelers,
} from '@platform/web/ndkReadContext'
export type { NDKEvent, NDKFilter, PrivateAuctionClaimMessage } from '@platform/web/ndkReadContext'
export {
	applesauceIo,
	createApplesauceReadContext,
	fetchNdkEventSet,
	getRawEventStore,
	mergeNdkEventSetsById,
	rehydrateVerifiedNdkEvent,
	useSubscriptionEvents,
} from '@platform/web/applesauceReadContext'
export type { NDKSigner, NostrFilter } from '@platform/web/applesauceReadContext'

/** Which relay-client adapter answers the port. Defaults to the raw/applesauce seam. */
export type ReadAdapterKind = 'applesauce' | 'ndk'

export interface ReadContextConfig {
	/** The adapter that answers `getReadContext()`. */
	adapter?: ReadAdapterKind
	/** Extra explicit relays the host should add when the NDK adapter is configured. */
	relayUrls?: string[]
	/** Per-fetch timeout handed to the adapter's read context, in milliseconds. */
	timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 8000

interface ResolvedReadContextConfig {
	adapter: ReadAdapterKind
	relayUrls: string[]
	timeoutMs: number
}

const defaultReadContextConfig: ResolvedReadContextConfig = {
	adapter: 'applesauce',
	relayUrls: [],
	timeoutMs: DEFAULT_TIMEOUT_MS,
}

let readContextConfig: ResolvedReadContextConfig = { ...defaultReadContextConfig }

/**
 * Choose the port's adapter (and its relay/timeout policy) as configuration rather than as an
 * import. Merges into the current config: omitted fields keep their previous value.
 */
export function configureReadContext(config: ReadContextConfig): void {
	const adapter = config.adapter ?? readContextConfig.adapter
	readContextConfig = {
		adapter,
		relayUrls: config.relayUrls ? [...config.relayUrls] : readContextConfig.relayUrls,
		timeoutMs: config.timeoutMs ?? readContextConfig.timeoutMs,
	}
	if (adapter === 'ndk' && config.relayUrls && config.relayUrls.length > 0) addAppExplicitRelays(config.relayUrls)
}

/**
 * The app-wide read port. Typed down to `EventReadContext<NostrEventLike>` and normalized at this
 * edge, so a caller only ever sees `NostrEventLike` events whatever adapter answers.
 */
export function getReadContext(): EventReadContext<NostrEventLike> {
	const context: EventReadContext<NostrEventLike> =
		readContextConfig.adapter === 'ndk' ? createNdkReadContext(readContextConfig.timeoutMs) : createApplesauceReadContext()
	return {
		store: context.store,
		fetch: async (filters) => (await context.fetch(filters)).map(toNostrEventLike),
	}
}
