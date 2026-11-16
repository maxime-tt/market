/**
 * platform/web/auctions/auctionPublish.ts — the auction publish bindings that leave `src/publish/`.
 *
 * This module is the auction publish composition root. The **listing** is a kind-1440 arena
 * create on the settled protocol (`relay/arenaAuctionCreate.ts`): the CMS form's fields go
 * through one validator, the create is signed by the seller and offered to the relays the
 * arena read reads, and the event it returns is visible to the storefront's auction block,
 * which lists 1440s through `relay/arenaAuctionRead.ts`. The retired kind-30408 tag listing
 * that used to live here is gone — not deprecated, not dual-published — because the two
 * shapes shared no field the other could read.
 *
 * The money paths live in the sibling modules (`auctionPublishRelease`, `auctionPublishBid`,
 * `auctionPublishSettlement`) and are re-exported from here so `src/publish/auctions.tsx`
 * can stay a one-line shim and every existing `@/publish/auctions` consumer keeps working.
 *
 * The winner's claim order (kind 16) and the deletion marker (kind 5) are unchanged; the
 * deletion's `a` tag now names the 1440 coordinate, which is what a create actually publishes.
 */
import { ARENA_AUCTION_CREATE_KIND } from '@sdk/commerce/auctions/constants'
import { ArenaCreateRefusalError } from '@sdk/commerce/auctions/auctionPublishValidation'
import { getActiveSignerCapability } from '@platform/web/auth/authStore'
import { walletOps } from '@platform/web/wallet/walletOps'
import { getUser, signNostrEvent, type EventTemplate } from '@platform/web/ndkPublishContext'
import { createWebNostrIo, webRelayPolicy } from '@platform/web/sdkNostrIo'
import { runAuctionWinnerClaimAppAdapter } from '@platform/web/auctions/auctionWorkflowAdapters'
import { createPrivateAuctionClaimMessageForActiveSigner } from '@platform/web/readContext'
import { recordAuctionDeletion } from '@platform/web/auctions/auctionsQuery'
import type { Event } from '@sdk/core/nostr-io'
import { auctionKeys, orderKeys } from '@sdk/core/query/queryKeyFactory'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import { auctionFormToCreateInput } from '@sdk/commerce/auctions/auctionPublishValidation'
import type { AuctionFormData } from '@sdk/commerce/auctions/auctionForm'
import type { ArenaCreatePublishResult } from '@platform/web/auctions/relay/arenaAuctionCreate'
import {
	publishArenaCreate,
} from '@platform/web/auctions/relay/arenaAuctionCreate'
import {
	publishAuctionClaimMarkerToPrivateRelays,
	publishRequired,
	publishRequiredPrivateGiftWrap,
	resolveAuctionClaimBuyerPubkey,
} from './auctionPublishIo'

export {
	type ArenaAuctionMode,
	type AuctionFormData,
	type AuctionV4vSplitRowInput,
	type ArenaV4vSplitRole,
} from '@sdk/commerce/auctions/auctionForm'
export {
	AUCTION_MAX_ANTISNIPE_WINDOW_SEC,
	AUCTION_MAX_DURATION_SEC,
	AUCTION_MIN_ANTISNIPE_WINDOW_SEC,
	AUCTION_MIN_DURATION_SEC,
	AUCTION_V4V_TOTAL_BPS,
	ArenaCreateRefusalError,
	type ArenaCreateRefusal,
} from '@sdk/commerce/auctions/auctionPublishValidation'

// The money paths live in one module per publish step; re-exported here so the module a consumer
// imports (`@platform/web/auctions/auctionPublish`, or the `src/publish/auctions` shim) keeps every
// export the file it replaced had.
export * from './auctionPublishRelease'
export * from './auctionPublishBid'
export * from './auctionPublishSettlement'

/**
 * Publish one kind-1440 arena create for the signed-in seller.
 *
 * The two keys are not one key, and this function is where that is enforced:
 *
 * - the **event** is signed by the seller's Nostr signer (the auth session's capability);
 * - `sellerWallet` is the **wallet spend key's** pubkey, from the wallet seam
 *   (`walletOps.getAuctionBidWalletSigner()`), which is the key the escrow later pays.
 *
 * When the wallet seam answers `null` the create is refused by name
 * (`create.no-seller-wallet`) and nothing is published: a substitute key would name a
 * wallet that does not own the proceeds, and an empty one would name nothing at all.
 */
export const publishAuction = async (formData: AuctionFormData): Promise<string> => {
	const result = await publishAuctionCreate(formData)
	return result.eventId
}

/**
 * The same publish, reporting the whole outcome (event id, `d`, coordinate, and what each
 * relay said) so a caller can route the seller to the new auction instead of guessing its
 * coordinate.
 */
export const publishAuctionCreate = async (formData: AuctionFormData): Promise<ArenaCreatePublishResult> => {
	const capability = getActiveSignerCapability()
	if (capability === null) {
		throw new Error('Sign in to publish an auction: no signer is available.')
	}
	const sellerPubkey = await capability.getPublicKey()
	const walletSigner = walletOps.getAuctionBidWalletSigner()
	if (walletSigner === null) {
		// Named, not substituted: see the doc comment above.
		throw new ArenaCreateRefusalError(
			'create.no-seller-wallet',
			'The wallet spend key is not available yet, so this auction cannot name a seller wallet. Open the wallet and try again.',
		)
	}

	// `NostrIo` is never closed: it shares the app's pool (`sdkNostrIo.ts`).
	const io = createWebNostrIo()
	return publishArenaCreate(auctionFormToCreateInput(formData), {
		sellerPubkey,
		sellerWallet: walletSigner.pubkey,
		signer: {
			pubkey: sellerPubkey,
			sign: async (template) => (await capability.signEvent({ ...template, pubkey: sellerPubkey })) as unknown as Event,
		},
		publisher: { publish: (event) => io.publish(event) },
		// The same relay set the arena read reads, so a published create is a listed auction.
		relays: [...webRelayPolicy('query')],
		now: Math.floor(Date.now() / 1000),
	})
}

export const usePublishAuctionMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async (formData: AuctionFormData) => publishAuctionCreate(formData),
		onSuccess: async (result) => {
			const user = await getUser()
			const userPubkey = user?.pubkey || ''
			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
			if (userPubkey) {
				await queryClient.invalidateQueries({ queryKey: auctionKeys.byPubkey(userPubkey) })
			}
			toast.success(`Auction published at ${result.coordinate}`)
		},
		onError: (error) => {
			console.error('Failed to publish auction:', error)
			toast.error(`Failed to publish auction: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Publish a NIP-09 deletion for one of the seller's auctions.
 *
 * The `a` tag names the **1440** coordinate, which is what a create publishes. Two honest
 * limits, both outside the create path: a regular kind cannot be deleted by coordinate alone
 * (`sdk/core/event-store/mergeRules.ts` only applies `a` deletions to addressable kinds), and
 * no CMS surface calls this action today — it is kept as the only delete entry point rather
 * than deleted mid-slice.
 */
export const deleteAuction = async (auctionDTag: string): Promise<boolean> => {
	const user = await getUser()
	if (!user?.pubkey) throw new Error('No active user')

	const template: EventTemplate = {
		kind: 5,
		content: 'Auction deleted',
		tags: [['a', `${ARENA_AUCTION_CREATE_KIND}:${user.pubkey}:${auctionDTag}`]],
		created_at: Math.floor(Date.now() / 1000),
	}

	const event = await signNostrEvent(template)
	await publishRequired(event)
	await recordAuctionDeletion(event)
	return true
}

export const useDeleteAuctionMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async (auctionDTag: string) => deleteAuction(auctionDTag),
		onSuccess: async (_success, auctionDTag) => {
			const user = await getUser()
			const userPubkey = user?.pubkey || ''

			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
			if (userPubkey) {
				await queryClient.invalidateQueries({ queryKey: auctionKeys.byPubkey(userPubkey) })
			}
			toast.success('Auction deleted successfully')
		},
		onError: (error) => {
			console.error('Failed to delete auction:', error)
			toast.error(`Failed to delete auction: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

// ---------------------------------------------------------------------------
// Auction Claim Order — winner submits shipping address after settlement
// ---------------------------------------------------------------------------

export interface AuctionClaimFormData {
	auctionEventId: string
	auctionCoordinates: string
	verdictEventId: string
	sellerPubkey: string
	finalAmount: number
	shippingAddress: {
		name: string
		firstLineOfAddress: string
		city: string
		zipPostcode: string
		country: string
		additionalInformation?: string
	}
	email?: string
	phone?: string
	notes?: string
}

/**
 * Creates a Kind 16 order event that references the won auction.
 * This is identical to a normal order creation but uses an `a` tag
 * pointing at the auction coordinate and an `e` tag pointing at the
 * winning verdict event instead of product `item` tags.
 */
export const publishAuctionClaimOrder = async (formData: AuctionClaimFormData): Promise<string> => {
	const buyerPubkey = await resolveAuctionClaimBuyerPubkey()
	const orderId = uuidv4()
	const createdAt = Math.floor(Date.now() / 1000)
	const claimFields = {
		orderId,
		auctionCoordinates: formData.auctionCoordinates,
		auctionEventId: formData.auctionEventId,
		verdictEventId: formData.verdictEventId,
		buyerPubkey,
		sellerPubkey: formData.sellerPubkey,
		totalAmountSats: formData.finalAmount,
		shippingAddress: formData.shippingAddress,
		email: formData.email,
		phone: formData.phone,
		notes: formData.notes,
	}

	const outcome = await runAuctionWinnerClaimAppAdapter({
		claim: {
			orderId,
			auctionCoordinate: claimFields.auctionCoordinates,
			auctionEventId: claimFields.auctionEventId,
			verdictEventId: claimFields.verdictEventId,
			buyerPubkey: claimFields.buyerPubkey,
			sellerPubkey: claimFields.sellerPubkey,
			finalAmount: claimFields.totalAmountSats,
			shippingAddress: claimFields.shippingAddress,
			email: claimFields.email,
			phone: claimFields.phone,
			notes: claimFields.notes,
			createdAt,
		},
		ports: {
			createPrivateDelivery: async (payload) =>
				createPrivateAuctionClaimMessageForActiveSigner({
					orderId: payload.orderId,
					auctionCoordinates: payload.auctionCoordinate,
					auctionEventId: payload.auctionEventId,
					verdictEventId: payload.verdictEventId,
					buyerPubkey: payload.buyerPubkey,
					sellerPubkey: payload.sellerPubkey,
					totalAmountSats: payload.finalAmount,
					shippingAddress: payload.shippingAddress,
					email: payload.email,
					phone: payload.phone,
					notes: payload.notes,
					createdAt,
				}),
			publishPrivateDelivery: async (privateClaim) => ({
				eventId: privateClaim.giftWrap.id,
				acceptedRelays: await publishRequiredPrivateGiftWrap(privateClaim.giftWrap),
			}),
			signMarker: signNostrEvent,
			publishMarker: publishAuctionClaimMarkerToPrivateRelays,
		},
	})
	if (outcome.status === 'published') return outcome.markerEventId
	if (outcome.status === 'failed') {
		throw new Error(`Auction claim failed during ${outcome.phase}: ${outcome.error}`)
	}
	throw new Error(
		`Auction claim is partial during ${outcome.phase}; encrypted delivery ${outcome.privateDeliveryEventId} was published to ` +
			`${outcome.acceptedRelays.length} relay(s), but its public marker was not confirmed: ${outcome.error}`,
	)
}

export const usePublishAuctionClaimOrderMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishAuctionClaimOrder,
		onSuccess: async (_orderId, variables) => {
			await queryClient.invalidateQueries({ queryKey: auctionKeys.settlements(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.details(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: orderKeys.all })
			const user = await getUser()
			if (user?.pubkey) {
				await queryClient.invalidateQueries({ queryKey: orderKeys.byBuyer(user.pubkey) })
				await queryClient.invalidateQueries({ queryKey: orderKeys.byPubkey(user.pubkey) })
			}
			toast.success('Shipping details submitted — the seller has been notified')
		},
		onError: (error) => {
			console.error('Failed to submit auction claim:', error)
			toast.error(`Failed to submit claim: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}
