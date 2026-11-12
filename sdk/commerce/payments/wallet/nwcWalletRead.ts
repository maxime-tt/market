/**
 * sdk/commerce/payments/wallet/nwcWalletRead.ts — the NWC wallet-list and balance reads
 * (store drain D1, slice 4).
 *
 * These two lived in `src/queries/wallet.tsx`, which read the connection out of the ndk store and
 * called `src/lib/wallet/nwcWalletRead.ts`; that helper in turn is called by `src/lib/stores/ndk.ts`
 * during sign-in, which made the pair a cycle. The read logic is framework-free, so it lives here and
 * takes its host dependencies (relay fetch, signer, NWC client) as an explicit port; the ndk store's
 * helper (`src/lib/wallet/nwcWalletRead.ts`) stays as an adapter over `(ndk, pubkey)` and the React
 * binding (`platform/web/wallet/walletQuery.ts`) resolves the port from the platform context.
 *
 * Both workflows deliberately mirror the pre-drain reader's behaviour, including its log lines and its
 * fail-soft returns: a missing signer or a failure to load/parse is an empty/absent answer, never a
 * throw. Nothing here logs an NWC URI or a decrypted wallet payload.
 */
import { toast } from 'sonner'
import type { Wallet as UserNwcWallet } from '../../../config/wallet'
import { USER_NWC_WALLET_LIST_KIND, USER_NWC_WALLET_LIST_LABEL } from '../nwcWalletList'

export interface NwcBalance {
	balance: number // in satoshis
	timestamp: number
}

/** The minimal event shape the wallet-list read needs; a host may pass its richer NDKEvent. */
export interface NwcWalletEventLike {
	pubkey: string
	content: string
	created_at?: number
}

/** A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures. */
export type NwcWalletListFilter = {
	kinds: number[]
	authors: string[]
	'#l': string[]
}

/**
 * Host-supplied wallet-list read dependencies. `decrypt` is NIP-44 to the signer's own key; the
 * workflow only calls it when the event author IS the signer, matching the pre-drain reader.
 */
export interface NwcWalletListPort<E extends NwcWalletEventLike = NwcWalletEventLike> {
	fetchEvents(filter: NwcWalletListFilter): Promise<Iterable<E>>
	/** The signer's own pubkey, or null when no signer is available. */
	getSignerPubkey(): Promise<string | null>
	/** NIP-44 decrypt addressed to the signer. */
	decrypt(content: string): Promise<string>
}

/** The minimal NWC client shape the balance read needs. */
export interface NwcClientLike {
	wallet: { getBalance(): Promise<{ balance: number }> }
}

/**
 * Host-supplied balance read dependency. `walletActions.getOrCreateNwcClient(nwcUri, signer)` lives in
 * the host port because it requires an `NDKSigner`; keeping it here would import the NDK into the SDK
 * read model, which the boundary intentionally forbids. Returns null when there is no signer/client.
 */
export interface NwcBalancePort {
	getNwcClient(nwcUri: string): Promise<NwcClientLike | null>
}

/** Newest by `created_at`; missing/falsy timestamps never win (mirrors the pre-drain reader). */
function pickMostRecentEvent<E extends { created_at?: number }>(events: Iterable<E>): E | undefined {
	let mostRecent: E | undefined
	let mostRecentTimestamp = 0
	for (const event of events) {
		if (event.created_at && event.created_at > mostRecentTimestamp) {
			mostRecent = event
			mostRecentTimestamp = event.created_at
		}
	}
	return mostRecent
}

/**
 * Fetches the user's NWC wallet list from Nostr (kind 30078, `#l=market_user_nwc_wallets`). The list
 * event is NIP-44 encrypted by the user for themselves; the port's signer does the decryption, and a
 * failed decrypt falls back to reading the content as plaintext, exactly as before.
 */
export async function readNwcWalletsWorkflow<E extends NwcWalletEventLike>(
	port: NwcWalletListPort<E>,
	userPubkey: string,
): Promise<UserNwcWallet[]> {
	if (!userPubkey) {
		console.error('User pubkey is required to fetch NWC wallets')
		throw new Error('User pubkey is required to fetch NWC wallets')
	}

	try {
		const events = await port.fetchEvents({
			kinds: [USER_NWC_WALLET_LIST_KIND],
			authors: [userPubkey],
			'#l': [USER_NWC_WALLET_LIST_LABEL],
		})

		const mostRecentEvent = pickMostRecentEvent(events)
		if (!mostRecentEvent) return []

		let decryptedContentJson = mostRecentEvent.content
		const signerPubkey = await port.getSignerPubkey()

		if (signerPubkey) {
			if (mostRecentEvent.pubkey === signerPubkey) {
				try {
					decryptedContentJson = await port.decrypt(mostRecentEvent.content)
				} catch (e) {
					console.error('Failed to decrypt NWC wallet list, attempting to parse as plaintext:', e)
				}
			} else if (mostRecentEvent.pubkey !== userPubkey) {
				console.warn("Event pubkey does not match user's pubkey, decryption might be needed differently or skipped.")
			}
		} else {
			console.warn('No signer available, cannot attempt decryption of NWC wallet list.')
		}

		const wallets = JSON.parse(decryptedContentJson) as UserNwcWallet[]
		return wallets.map((wallet: any) => ({
			id: wallet.id || '', // Ensure id is always a string
			name: wallet.name || `Wallet ${Math.floor(Math.random() * 1000)}`,
			nwcUri: wallet.nwcUri,
			pubkey: wallet.pubkey || '',
			relays: wallet.relays || [],
			storedOnNostr: true, // Fetched from Nostr, so this is true
			createdAt: wallet.createdAt || Date.now(),
			updatedAt: wallet.updatedAt || Date.now(),
		}))
	} catch (error) {
		console.error('Failed to fetch or parse NWC wallets from Nostr:', error)
		toast.error('Could not load your wallets from Nostr.')
		return [] // Return empty array on error to prevent breaking UI
	}
}

/**
 * Fetches the balance from an NWC wallet URI via the host's cached client. NIP-47 answers
 * `get_balance` in MILLISATS and `NwcBalance` is documented in sats: the pre-drain path stored the raw
 * figure as sats, so it displayed 1000x the wallet's balance; the conversion stays here.
 */
export async function readNwcBalanceWorkflow(port: NwcBalancePort, nwcUri: string): Promise<NwcBalance | null> {
	if (!nwcUri) {
		console.warn('NWC URI is undefined, cannot fetch balance.')
		return null
	}

	const nwcClient = await port.getNwcClient(nwcUri)
	if (!nwcClient) return null

	try {
		const { balance: balanceMsats } = await nwcClient.wallet.getBalance()

		if (typeof balanceMsats !== 'number' || !Number.isFinite(balanceMsats)) {
			console.error('Failed to get balance or balance is not in expected format. Received:', balanceMsats)
			return null
		}
		return {
			balance: Math.floor(balanceMsats / 1000),
			timestamp: Date.now(),
		}
	} catch (error: any) {
		console.error('❌ Error fetching NWC wallet balance:', error)
		const rawMessage = error?.message || (typeof error === 'string' ? error : '')

		// "Cannot find square root" means the wallet pubkey is all zeros (invalid/missing Lightning key)
		if (rawMessage.toLowerCase().includes('cannot find square root')) {
			toast.error('Wallet has no valid Lightning key configured', { id: 'balance-fetch-invalid-key' })
		} else if (rawMessage) {
			toast.error(`Balance fetch failed: ${rawMessage}`, { id: 'balance-fetch-error' })
		} else {
			toast.error('Failed to fetch balance', { id: 'balance-fetch-error' })
		}
		return null
	}
}
