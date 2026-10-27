import { ndkActions, getWriteRelaySet, getWriteRelays, fetchLatestAppEvent } from '@/lib/stores/ndk'
import { NDKEvent, type NDKSigner, type NDKFilter } from '@/lib/nostr/ndk-events'
import type { EventPublishContext } from '@sdk/core/ports/eventPublish'

export type NdkClient = NonNullable<ConstructorParameters<typeof NDKEvent>[0]>

/**
 * The app-singleton accessors, re-homed here so host feature bindings under
 * `platform/web/<feature>/` can resolve the NDK client, the signer and the
 * publish action without importing `src/lib/stores/ndk` — the gated
 * `platform -> src` boundary. The `ndkActions` edge itself already lives in this
 * file, so routing bindings through these adds no cross-tree import.
 */
export const getAppNdk = () => ndkActions.getNDK()
export const getAppSigner = () => ndkActions.getSigner()
export const setAppSigner = (signer: NDKSigner | undefined) => ndkActions.setSigner(signer)
export const runSignerOnboarding = (signer: NDKSigner) => ndkActions.runSignerOnboarding(signer)
export const removeAppSigner = () => ndkActions.removeSigner()
export const publishAppEvent = (event: NDKEvent) => ndkActions.publishEvent(event)
export { fetchLatestAppEvent, getWriteRelaySet, getWriteRelays }

/** Re-exported so Platform bindings can use the event type without a `platform -> src` edge. */
export { NDKEvent }
export type { NDKFilter, NDKSigner }

/** Re-exported so publish bindings can route app-settings submissions through this bridge without a `platform -> src` edge. */
export { submitAppSettings as submitAppSettingsEvent } from '@/lib/appSettings'

/**
 * Re-exported so the order bindings can adapt the host's NDK signer into the
 * SDK's `EncryptingSigner` port without adding a new `platform -> src` edge:
 * this file already owns a `@/lib` edge.
 */
export { toEncryptingSigner } from '@/lib/nostr/ndkEncryptingSigner'

/**
 * The auction publish bindings sign, publish and identify through the active
 * first-party I/O seam (`src/lib/nostr/io.ts`), never through `applesauceIo`:
 * `io.ts` is the seam that honours `setNostrIo` and the host's signer, and the
 * auction suites drive it by swapping the store's active signer. Re-exported
 * here so those bindings add no new `platform -> src` edge — this file already
 * owns the `@/lib` edges a publish binding needs.
 */
export { getUser, publish as publishNostrEvent, sign as signNostrEvent } from '@/lib/nostr/io'
export type { EventTemplate, NostrEvent, PublishOptions } from '@/lib/nostr/io'

/**
 * Re-exported for the auction publish bindings, which lock and reclaim bid legs
 * through the wallet store and open the user-scoped republish cache over the SDK
 * storage port. Both live in `src/` today; routing them through this file keeps
 * the auction bindings free of `@/` specifiers while the wallet store drains.
 */
export { walletOps, AuctionBidLockMutationPossibleError, type AuctionP2pkKeyScheme } from '@/lib/stores/walletOps'
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
