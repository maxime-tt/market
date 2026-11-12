import type { CurationPublishIssue } from '@sdk/core/curation'
import type { SignerCapability } from '@sdk/core/signer'
import { submitAppSettingsEvent, type NdkClient } from '@platform/web/ndkPublishContext'
import { createSignerPublishContext } from '@platform/web/sdkSigner'

/**
 * Curation-list publish binding (store drain D2, slice 10).
 *
 * Moved from `src/publish/curationContext.ts`. The binding takes the NDK client and
 * signer capability through the Platform publish bridge, and routes the
 * app-settings submission through the bridge's re-exported `submitAppSettingsEvent`
 * accessor instead of importing `@/lib/appSettings` directly — so a Platform host
 * module consumes it without a counted `platform -> src` edge. A shim remains at the
 * vacated src path for existing call sites; deleted in E1.
 *
 * A3.5: the publish context is built from the signer **capability**
 * (`createSignerPublishContext`, `platform/web/sdkSigner.ts`), not an NDK-typed
 * signer; `ndk` stays for the NDK publish binding the context's publish half wraps.
 */

export type { NdkClient }

/** Curation lists go to the app server, which re-signs them with the app key. */
export function createAppSettingsPublishContext(ndk: NdkClient, signer: SignerCapability) {
	return createSignerPublishContext(signer, (event) => submitAppSettingsEvent(event))
}

/** Lists live under the app pubkey; without one, fall back to the signer's own pubkey. */
export async function resolveListOwner(signer: SignerCapability, appPubkey?: string): Promise<string> {
	const currentUserPubkey = await signer.getPublicKey()
	if (!currentUserPubkey) {
		throw new Error('Unable to get current user pubkey')
	}
	return appPubkey || currentUserPubkey
}

export function curationIssueMessage(issue: CurationPublishIssue, invalidItemLabel = 'pubkey'): string {
	return issue.issue === 'admins-required' ? 'At least one admin is required' : `Invalid ${invalidItemLabel} format: ${issue.item}`
}
