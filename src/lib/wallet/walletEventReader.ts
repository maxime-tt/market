/**
 * walletEventReader.ts — the adapter that gives `WalletEventReader` its two halves.
 *
 * One half is the relay read, the other is the signer's NIP-44. Both are injected, so this file
 * imports neither the relay client nor the signer: the app supplies them, and the tests supply
 * stand-ins. That also keeps the plaintext key where it belongs — the signer opens the event,
 * and nothing here holds anything that could.
 *
 * The relay half asks for the LATEST wallet event and reads its content verbatim. The event is
 * weight-ordered rather than trusting relay order, because a stale wallet event carries a stale
 * key, and a stale key is a different HD root.
 */
import type { WalletEventReader } from './nip60WalletEventSource'

/** The relay read: the owner's latest kind-17375 event, or null when there is none. */
export interface WalletEventRelay {
	fetchLatestWalletEvent(ownerPubkey: string): Promise<{ content: string; createdAt: number } | null>
}

/** The signer's NIP-44 surface. Declared structurally so no signer library is imported here. */
export interface WalletEventOpener {
	decrypt(senderPubkey: string, ciphertext: string): Promise<string>
}

export const createWalletEventReader = (deps: { relay: WalletEventRelay; opener: WalletEventOpener }): WalletEventReader => ({
	readWalletEventContent: async (ownerPubkey: string) => {
		const event = await deps.relay.fetchLatestWalletEvent(ownerPubkey)
		return event?.content ?? null
	},
	decrypt: async (ownerPubkey: string, ciphertext: string) => deps.opener.decrypt(ownerPubkey, ciphertext),
})

/**
 * Pick the newest of several candidate events. Exported because "latest by `created_at`" is a
 * decision worth being able to test on its own: relays do not order a result set, and taking the
 * first is how a stale key wins.
 */
export const latestByCreatedAt = <T extends { createdAt: number }>(events: readonly T[]): T | null =>
	events.length === 0 ? null : events.reduce((newest, event) => (event.createdAt >= newest.createdAt ? event : newest))
