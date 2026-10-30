import { getAppNdk, publishAppNostrEvent } from '@platform/web/ndkPublishContext'
import { getActiveSignerCapability } from '@platform/web/auth/authStore'
import { createSignerPublishContext } from '@platform/web/sdkSigner'
import { publishNwcWalletListWorkflow } from '@sdk/commerce/payments'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { walletKeys } from '@sdk/core/query/queryKeyFactory'
import type { Wallet as UserNwcWallet } from '@sdk/config/wallet' // Using Wallet directly and aliasing

/**
 * Parameters for saving the user's NWC wallet list.
 */
export interface SaveUserNwcWalletsParams {
	wallets: UserNwcWallet[]
	userPubkey: string
}

/**
 * Saves the user's NWC wallet list to Nostr.
 */
export const saveUserNwcWallets = async (params: SaveUserNwcWalletsParams): Promise<string> => {
	const ndk = getAppNdk()
	if (!ndk) {
		toast.error('NDK not initialized. Cannot save wallets to Nostr.')
		throw new Error('NDK not initialized. Cannot save wallets to Nostr.')
	}

	const signer = getActiveSignerCapability()
	if (!signer) {
		throw new Error('Signer not available for saving NWC wallets')
	}
	if (!params.userPubkey) {
		throw new Error('User pubkey is required for saving NWC wallets')
	}

	// A3.5: the capability answers the identity (hex pubkey); the NDK user object it
	// replaced was only read for its pubkey.
	const userPubkey = await signer.getPublicKey()
	if (!userPubkey) {
		toast.error('User object not found via signer. Cannot save wallets to Nostr.')
		throw new Error('User object not found via signer.')
	}

	const nip44Pair = signer.nip44
	if (!nip44Pair) {
		throw new Error('No NIP-44 capability available to encrypt the NWC wallet list')
	}

	// Ensure wallets are correctly structured for storage, marking them as stored on Nostr.
	const context = await createSignerPublishContext(signer, async (event) => {
		const publishedToRelays = await publishAppNostrEvent(ndk, event)
		if (publishedToRelays.size === 0) throw new Error('Failed to publish NWC wallet list event to any relay.')
	})
	const event = await publishNwcWalletListWorkflow(
		{ ...context, encryptToSelf: (plaintext) => nip44Pair.encrypt(userPubkey, plaintext) },
		params.wallets,
	)

	return event.id // Return the ID of the event that was constructed and published
}

/**
 * React Query mutation hook for saving the user's NWC wallet list.
 */
export const useSaveUserNwcWalletsMutation = () => {
	const queryClient = useQueryClient()

	return useMutation<string, Error, SaveUserNwcWalletsParams>({
		mutationFn: saveUserNwcWallets,
		onSuccess: (eventId, variables) => {
			toast.success('Wallets saved to Nostr successfully!')
			// Invalidate the query to refetch the latest list
			queryClient.invalidateQueries({ queryKey: walletKeys.userNwcWallets(variables.userPubkey) })

			// Invalidate all balance queries for the wallets being saved
			variables.wallets.forEach((wallet) => {
				if (wallet.nwcUri) {
					queryClient.invalidateQueries({ queryKey: walletKeys.nwcBalance(wallet.nwcUri) })
				}
			})

			// Also invalidate all balance queries to ensure fresh data
			queryClient.invalidateQueries({ queryKey: walletKeys.all })

			return eventId
		},
		onError: (error) => {
			console.error('Failed to save NWC wallets to Nostr:', error)
			toast.error(`Error saving wallets to Nostr: ${error.message}`)
		},
	})
}
