import { ndkActions, ndkStore, getWriteRelaySet, getWriteRelays, fetchLatestAppEvent } from '@platform/web/ndk/ndkStore'
import { NDKEvent, NDKRelaySet, type NDKSigner, type NDKFilter } from '@/lib/nostr/ndk-events'
import { applesauceIo, type NostrUser, type PublishOptions, type PublishResult } from '@platform/web/applesauceIo'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'
import type { EventPublishContext } from '@sdk/core/ports/eventPublish'

export type NdkClient = NonNullable<ConstructorParameters<typeof NDKEvent>[0]>

/**
 * The app-singleton accessors, re-homed here so host feature bindings under
 * `platform/web/<feature>/` can resolve the NDK client and the publish action
 * without importing `src/lib/stores/ndk` — the gated `platform -> src`
 * boundary. The `ndkActions` edge itself already lives in this file, so
 * routing bindings through these adds no cross-tree import.
 *
 * A3.7: the signer accessors are RETIRED — `getAppSigner`/`setAppSigner`/
 * `runSignerOnboarding`/`removeAppSigner` answered the ndk store's signer
 * surface, which is deleted with this slice; every publish family builds
 * its context from the auth session's capability
 * (`createSignerPublishContext`) instead.
 */
export const getAppNdk = () => ndkActions.getNDK()
export const publishAppEvent = (event: NDKEvent) => ndkActions.publishEvent(event)

/**
 * A3.5: publish a raw **signed** event through the NDK publish binding. The publish
 * families build their context with `createSignerPublishContext(capability, ...)` now,
 * whose publish half carries a `NostrEvent`; this wraps it into the `NDKEvent`
 * `ndkActions.publishEvent` takes, so the families' publish path is unchanged
 * (still `ndkActions.publishEvent`, transitional until the relay stream flips).
 */
export const publishAppNostrEvent = (ndk: NdkClient, event: NostrEvent) => publishAppEvent(new NDKEvent(ndk, event))

/**
 * The NDK read with a caller-chosen timeout, re-homed here so platform bindings (the wallet action
 * surface) can reach it without a `platform -> src` edge. `ndkPublishContext` already owns the
 * `@/lib/stores/ndk` edge, so this adds no counted cross-tree import. Delegates verbatim to
 * `ndkActions.fetchEventsWithTimeout` (src/lib/stores/ndk.ts:355).
 */
export const fetchEventsWithTimeout: typeof ndkActions.fetchEventsWithTimeout = (...args) => ndkActions.fetchEventsWithTimeout(...args)

export { fetchLatestAppEvent, getWriteRelaySet, getWriteRelays }

/** Re-exported so Platform bindings can use the event type without a `platform -> src` edge. */
export { NDKEvent }
export type { NDKFilter, NDKSigner }

/** Re-exported so publish bindings can route app-settings submissions through this bridge without a `platform -> src` edge. */
export { submitAppSettings as submitAppSettingsEvent } from '@/lib/appSettings'

/**
 * Re-exported so the order bindings can adapt the auth session's signer capability
 * onto the SDK's `EncryptingSigner` port. A3.4 flipped the bindings onto
 * `asEncryptingSigner(getActiveSignerCapability())` (the `@sdk/core` interop
 * port), so this NDK-typed re-export is retired — the underlying adapter
 * `src/lib/nostr/ndkEncryptingSigner.ts` is deleted in the same slice.
 */

/**
 * Publish a raw **signed** event through the NDK publish binding. The publish
 * families build their context with `createSignerPublishContext(capability, ...)` now,
 * whose publish half carries a `NostrEvent`; this wraps it into the `NDKEvent`
 * `ndkActions.publishEvent` takes, so the families' publish path is unchanged
 * (still `ndkActions.publishEvent`, transitional until the relay stream flips).
 */
async function publishViaNdk(event: NostrEvent, opts?: PublishOptions): Promise<PublishResult> {
	const ndk = ndkStore.state.ndk
	if (!ndk) throw new Error('NDK not initialized')
	const relaySet = opts?.relayUrls?.length ? NDKRelaySet.fromRelayUrls(opts.relayUrls, ndk) : undefined
	const ndkEvent = new NDKEvent(ndk, event)
	// ndkActions.publishEvent resolves with the set of relays that ACKed the
	// event (NDKRelay), so the bridge can surface truthful relay URLs.
	const published = await ndkActions.publishEvent(ndkEvent, relaySet)
	return { publishedRelays: new Set(Array.from(published, (relay) => (relay as { url: string }).url)) }
}

/**
 * The first-party publish bridge — the seam object the auction publish
 * families and the test-label actions sign, publish and identify through.
 *
 * Moved out of the retired `src/lib/nostr/{io,io-ndk}.ts` seam (J-0) with its
 * production behavior preserved: `sign`/`getUser` resolve the auth session's
 * capability through the port's injected signer source (identical in both former
 * adapters), and `publish` keeps the NDK publish path the former default adapter
 * (`ndkIo.publish`) answered — `ndkActions.publishEvent` with an optional relay
 * override — until the relay stream flips (Wave K / the SDK-seam drain).
 * The object is mutable so the suites that used to drive the seam via
 * `setNostrIo` can patch its members directly (same idiom as patching
 * `applesauceIo`'s methods).
 */
export const nostrPublishBridge = {
	sign: (template: EventTemplate): Promise<NostrEvent> => applesauceIo.sign(template),
	getUser: (): Promise<NostrUser | null> => applesauceIo.getUser(),
	publish: (event: NostrEvent, opts?: PublishOptions): Promise<PublishResult> => publishViaNdk(event, opts),
}

/** Sign an event template through the active signer capability. */
export const signNostrEvent = (template: EventTemplate): Promise<NostrEvent> => nostrPublishBridge.sign(template)

/** The active user's pubkey, or null while logged out. */
export const getUser = (): Promise<NostrUser | null> => nostrPublishBridge.getUser()

/** Publish a signed raw event (optionally restricted to explicit relays). */
export const publishNostrEvent = (event: NostrEvent, opts?: PublishOptions): Promise<PublishResult> =>
	nostrPublishBridge.publish(event, opts)

export type { EventTemplate, NostrEvent, PublishOptions, PublishResult }

/**
 * Re-exported for the auction publish bindings, which open the user-scoped
 * republish cache over the SDK storage port. It lives in `src/` today, so
 * routing it through this file keeps those bindings free of `@/` specifiers
 * while the republish cache drains.
 */
export { createUserScopedKeyValueStoragePort } from '@/lib/sdkAdapters'

/**
 * Platform adapter: binds the web host's NDK client and signer to the SDK's
 * explicit publish context. SDK workflows never read the NDK singleton.
 */
export async function createNdkPublishContext(
	ndk: NdkClient,
	signer: NDKSigner,
	publish: (event: NDKEvent) => Promise<void> = async (event) => {
		await ndkActions.publishEvent(event)
	},
): Promise<EventPublishContext<NDKEvent>> {
	const author = await signer.user()
	return {
		authorPubkey: author.pubkey,
		now: () => Math.floor(Date.now() / 1000),
		signer: {
			sign: async (template) => {
				const event = new NDKEvent(ndk)
				event.kind = template.kind as typeof event.kind
				event.content = template.content
				event.tags = template.tags as typeof event.tags
				event.created_at = template.created_at
				await event.sign(signer)
				return event
			},
		},
		publish,
	}
}
