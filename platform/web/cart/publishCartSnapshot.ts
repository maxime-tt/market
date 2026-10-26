import { createNdkPublishContext, type NdkClient } from '@platform/web/ndkPublishContext'
import { publishCartSnapshotWorkflow, type PersistedCartContent } from '@sdk/commerce/cart'

/**
 * The cart snapshot publish binding (store drain D2, slice 5).
 *
 * Resolves the app NDK/signer through the Platform publish bridge instead of importing
 * `src/lib/stores/ndk`, so a Platform host module can consume it without a counted
 * `platform -> src` edge. The signer type is derived from the bridge's own signature
 * rather than imported from `@nostr-dev-kit/ndk`, so this file adds no NDK footprint.
 */
type NdkSigner = Parameters<typeof createNdkPublishContext>[1]

export async function publishCartSnapshot(snapshot: PersistedCartContent, signer: NdkSigner, ndk: NdkClient): Promise<string> {
	const event = await publishCartSnapshotWorkflow(await createNdkPublishContext(ndk, signer), snapshot)
	return event.id
}
