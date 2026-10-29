/**
 * platform/web/media/blossomUploadHost.ts — the transitional platform host for
 * the Blossom upload capability (Wave G-a1.2 of PR #1420's media lane).
 *
 * `sdk/` reads no store, so the signer port arrives here: this host composes the
 * sdk signer session's CURRENT capability into the upload client's signer
 * function and re-exports the server list as `BLOSSOM_SERVERS`, so the legacy
 * `src/` consumers keep both their names. The capability is the same key
 * material the rest of the app signs with; a missing session refuses through
 * the session's typed error (NoActiveSessionError), which the upload call
 * propagates instead of the legacy string refusal.
 *
 * This module is transitional only — the final home of the capability is
 * `sdk/core/media/` and the host dissolves with the `src/` leaves (D3).
 */
import { uploadFileToBlossom as uploadFileToBlossomPort } from '@sdk/core/media/blossomUpload'
import type {
	BlossomUploadEventTemplate,
	BlossomUploadSignedEvent,
	BlossomUploadSigner,
	UploadOptions,
	UploadResult,
} from '@sdk/core/media/blossomUpload'
import type { SignerCapability } from '@sdk/core/signer'
import { getSignerSession } from '@platform/web/auth/authStore'

export {
	DEFAULT_BLOSSOM_SERVERS as BLOSSOM_SERVERS,
	checkBlossomServerAvailability,
	getAvailableBlossomServers,
} from '@sdk/core/media/blossomServers'
export type { BlossomServer } from '@sdk/core/media/blossomServers'
export type { ImetaTag, UploadOptions, UploadResult } from '@sdk/core/media/blossomUpload'

/** Adapt the session capability to the upload client's signer-function port. */
const capabilityToSigner = (capability: SignerCapability): BlossomUploadSigner => {
	return async (draft: BlossomUploadEventTemplate): Promise<BlossomUploadSignedEvent> => capability.signEvent(draft)
}

/**
 * Upload a file to Blossom servers using the active session's signer.
 *
 * Signature-compatible with the legacy `@/lib/blossom` export (no signer
 * argument): the signer is the logged-in session's current capability.
 */
export async function uploadFileToBlossom(file: File, options: UploadOptions = {}): Promise<UploadResult> {
	// Throws the session's typed refusal (NoActiveSessionError) when no session is active.
	const capability = getSignerSession().currentSigner()
	return uploadFileToBlossomPort(capabilityToSigner(capability), file, options)
}
