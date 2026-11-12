import { type NdkClient, publishAppNostrEvent } from '@platform/web/ndkPublishContext'
import type { SignerCapability } from '@sdk/core/signer'
import { createSignerPublishContext } from '@platform/web/sdkSigner'
import { publishCartSnapshotWorkflow, type PersistedCartContent } from '@sdk/commerce/cart'

/**
 * The cart snapshot publish binding (store drain D2, slice 5).
 *
 * Resolves the app NDK through the Platform publish bridge instead of importing
 * `src/lib/stores/ndk`, so a Platform host module can consume it without a counted
 * `platform -> src` edge. A3.5: the signer is the **capability** (the auth session's
 * `currentSigner()`), never an NDK-typed signer — the context is built with
 * `createSignerPublishContext` and its publish half still routes through the NDK
 * publish binding; no NDK type is imported, so this file adds no NDK footprint.
 */
export async function publishCartSnapshot(snapshot: PersistedCartContent, signer: SignerCapability, ndk: NdkClient): Promise<string> {
	const event = await publishCartSnapshotWorkflow(
		await createSignerPublishContext(signer, async (event) => {
			await publishAppNostrEvent(ndk, event)
		}),
		snapshot,
	)
	return event.id
}
