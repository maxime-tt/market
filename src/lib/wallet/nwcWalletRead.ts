import { NDKEvent } from '@nostr-dev-kit/ndk'
import type NDK from '@nostr-dev-kit/ndk'
import { USER_NWC_WALLET_LIST_KIND, USER_NWC_WALLET_LIST_LABEL } from '@sdk/commerce/payments'
import { toast } from 'sonner'
import { walletActions, type Wallet as UserNwcWallet } from '@/lib/stores/wallet'

/**
 * NWC wallet reads, with the ndk instance as a **parameter**.
 *
 * These two lived in `@/queries/wallet` and read the connection out of the ndk
 * store; the store in turn called them during sign-in, which made the pair a
 * cycle. They import no store of their own for the connection now — the caller
 * supplies it — so the ndk store can call them without reaching into the query
 * layer. The "no NDK yet" guards stay with whoever owns the connection.
 */

/**
 * Fetches the user's NWC wallet list from Nostr.
 * This event is encrypted by the user for themselves.
 */
export const fetchUserNwcWallets = async (ndk: NDK, userPubkey: string): Promise<UserNwcWallet[]> => {
	if (!userPubkey) {
		console.error('User pubkey is required to fetch NWC wallets')
		throw new Error('User pubkey is required to fetch NWC wallets')
	}

	try {
		const events = await ndk.fetchEvents({
			kinds: [USER_NWC_WALLET_LIST_KIND],
			authors: [userPubkey],
			'#l': [USER_NWC_WALLET_LIST_LABEL],
		})

		if (events.size === 0) {
			return []
		}

		let mostRecentEvent: NDKEvent | undefined
		let mostRecentTimestamp = 0
		events.forEach((event) => {
			if (event.created_at && event.created_at > mostRecentTimestamp) {
				mostRecentEvent = event
				mostRecentTimestamp = event.created_at
			}
		})

		if (!mostRecentEvent) {
			return []
		}

		let decryptedContentJson = mostRecentEvent.content
		const signer = ndk.signer

		if (signer) {
			const ndkUserForDecryption = await signer.user()
			if (ndkUserForDecryption && mostRecentEvent.pubkey === ndkUserForDecryption.pubkey) {
				try {
					decryptedContentJson = await signer.decrypt(ndkUserForDecryption, mostRecentEvent.content)
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
			id: wallet.id || '', // Ensure id is always a string, use uuidv4 if it were imported and needed for new ones
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

export interface NwcBalance {
	balance: number // in satoshis
	timestamp: number
}

/**
 * Fetches the balance from an NWC wallet URI.
 * This function uses the cached NWC client (@getalby/sdk).
 */
export const fetchNwcWalletBalance = async (ndk: NDK, nwcUri: string): Promise<NwcBalance | null> => {
	if (!nwcUri) {
		console.warn('NWC URI is undefined, cannot fetch balance.')
		return null
	}

	if (!ndk.signer) {
		console.error('Main NDK instance or signer not available for NWC balance fetch')
		return null
	}

	const nwcClient = await walletActions.getOrCreateNwcClient(nwcUri, ndk.signer)
	if (!nwcClient) return null

	try {
		const { balance: balanceMsats } = await nwcClient.wallet.getBalance()

		// NIP-47 answers get_balance in MILLISATS and NwcBalance is documented in sats. The
		// NDK-based path stored the raw figure as sats, so what it displayed was 1000x the
		// wallet's balance; convert here rather than carry that forward.
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
	} finally {
		// the client stays cached for reuse; teardown happens when the signer changes
	}
}
