import type { CurationPublishIssue } from '@sdk/commerce/curation'
import { createNdkPublishContext, submitAppSettingsEvent, type NdkClient, type NDKSigner } from '@platform/web/ndkPublishContext'

/**
 * Curation-list publish binding (store drain D2, slice 10).
 *
 * Moved from `src/publish/curationContext.ts`. The binding takes the NDK client and signer
 * types and the publish context through the Platform publish bridge, and routes the
 * app-settings submission through the bridge's re-exported `submitAppSettingsEvent` accessor
 * instead of importing `@/lib/appSettings` directly — so a Platform host module consumes it
 * without a counted `platform -> src` edge. A shim remains at the vacated src path for
 * existing call sites; deleted in E1.
 */

export type { NdkClient }

/** Curation lists go to the app server, which re-signs them with the app key. */
export function createAppSettingsPublishContext(ndk: NdkClient, signer: NDKSigner) {
	return createNdkPublishContext(ndk, signer, (event) => submitAppSettingsEvent(event.rawEvent()))
}

/** Lists live under the app pubkey; without one, fall back to the signer's own pubkey. */
export async function resolveListOwner(signer: NDKSigner, appPubkey?: string): Promise<string> {
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}
	return appPubkey || currentUser.pubkey
}

export function curationIssueMessage(issue: CurationPublishIssue, invalidItemLabel = 'pubkey'): string {
	return issue.issue === 'admins-required' ? 'At least one admin is required' : `Invalid ${invalidItemLabel} format: ${issue.item}`
}
