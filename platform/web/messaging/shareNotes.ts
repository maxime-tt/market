import { getAppNdk, publishAppNostrEvent } from '@platform/web/ndkPublishContext'
import { getActiveSignerCapability } from '@platform/web/auth/authStore'
import { createSignerPublishContext } from '@platform/web/sdkSigner'
import {
	publishShareEventNoteWorkflow,
	publishShareNoteWorkflow,
	type ShareEventNoteInput,
	type ShareNoteInput,
} from '@sdk/commerce/messaging'
import type { EventPublishContext } from '@sdk/core/ports/eventPublish'
import type { NostrEvent } from 'nostr-tools'

const SIGN_TIMEOUT_MS = 30_000
const PUBLISH_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))])
}

/** Share notes go out through remote signers that can hang, so signing and publishing are time-boxed. A3.5: the signer is the active capability; the publish half still routes through the NDK publish binding. */
async function createShareNoteContext(): Promise<EventPublishContext<NostrEvent>> {
	const ndk = getAppNdk()
	if (!ndk) throw new Error('NDK not initialized')
	const signer = getActiveSignerCapability()
	if (!signer) throw new Error('No signer available. Please log in with a signing method.')

	const context = await createSignerPublishContext(signer, (note) =>
		withTimeout(publishAppNostrEvent(ndk, note), PUBLISH_TIMEOUT_MS, 'Publish timeout after 10 seconds').then(() => undefined),
	)
	const sign = context.signer.sign
	return {
		...context,
		signer: { sign: (template) => withTimeout(sign(template), SIGN_TIMEOUT_MS, 'Sign timeout - signer not responding') },
	}
}

export async function publishShareProductNote(input: ShareNoteInput): Promise<NostrEvent> {
	return publishShareNoteWorkflow(await createShareNoteContext(), input)
}

export async function publishShareEventNote(input: ShareEventNoteInput): Promise<NostrEvent> {
	return publishShareEventNoteWorkflow(await createShareNoteContext(), input)
}
