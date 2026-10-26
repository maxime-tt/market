import { ndkActions, getWriteRelaySet, getWriteRelays } from '@/lib/stores/ndk'
import { NDKEvent, type NDKSigner } from '@/lib/nostr/ndk-events'
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
export const publishAppEvent = (event: NDKEvent) => ndkActions.publishEvent(event)
export { getWriteRelaySet, getWriteRelays }

/** Re-exported so Platform bindings can type their publish callbacks without a `platform -> src` edge. */
export type { NDKEvent, NDKSigner }

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
