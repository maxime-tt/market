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
 * Re-exported so the payment binding can consume the Lightning payment publish
 * helpers without adding a new `platform -> src` edge: this file already owns a
 * `@/lib` edge.
 */
export {
	payInvoiceWithNwc,
	payInvoiceWithWebln,
	publishPaymentDetail,
	type PublishPaymentDetailParams,
	type PayWithNwcParams,
} from '@/publish/payment'

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
