/**
 * platform/web/auctions/auctionPublish.ts — the auction publish bindings that leave `src/publish/`.
 *
 * This module is the auction publish composition root: it owns the listing and deletion paths, the
 * winner's claim order, and the form types the auction host modules consume. The money paths live in
 * the sibling modules (`auctionPublishRelease`, `auctionPublishBid`, `auctionPublishSettlement`) and
 * are re-exported from here so `src/publish/auctions.tsx` can stay a one-line shim and every existing
 * `@/publish/auctions` consumer keeps working.
 *
 * No Nostr logic beyond event construction lives here: relay I/O, signing and identity go through the
 * publish bridge (`@platform/web/ndkPublishContext`), the auction listing/claim adapters, and the
 * read binding the same tests mock.
 */
import { AUCTION_SETTLEMENT_POLICY } from '@sdk/commerce/auctions/settlement'
import { AUCTION_MIN_DURATION_SECONDS, validateAuctionPublishInput } from '@sdk/commerce/auctions/auctionPublishValidation'
import { configStore } from '@sdk/config/app-config'
import { walletOps, type AuctionP2pkKeyScheme } from '@platform/web/wallet/walletOps'
import { getUser, signNostrEvent, type EventTemplate } from '@platform/web/ndkPublishContext'
import { runAuctionListingAppAdapter, runAuctionWinnerClaimAppAdapter } from '@platform/web/auctions/auctionWorkflowAdapters'
import { createPrivateAuctionClaimMessageForActiveSigner } from '@platform/web/readContext'
import { recordAuctionDeletion } from '@platform/web/auctions/auctionsQuery'
import { assertAuctionMintsSupportDleq } from '@sdk/commerce/auctions/validation'
import { auctionKeys, orderKeys } from '@sdk/core/query/queryKeyFactory'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import {
	HEX_PUBKEY_RE,
	publishAuctionClaimMarkerToPrivateRelays,
	publishRequired,
	publishRequiredPrivateGiftWrap,
	resolveAuctionClaimBuyerPubkey,
} from './auctionPublishIo'

import { AUCTION_SETTLEMENT_GRACE_PRESETS, type AuctionFormData } from '@sdk/commerce/auctions/auctionForm'

export {
	AUCTION_ANTI_SNIPE_WINDOW_PRESETS_MINUTES,
	AUCTION_MIN_BID_CURVE_PEAK_PRESETS,
	AUCTION_SETTLEMENT_GRACE_PRESETS,
	type AuctionAntiSnipeWindowMinutesPreset,
	type AuctionFormData,
	type AuctionMinBidCurvePeakPreset,
	type AuctionMinBidCurveShape,
	type AuctionSettlementGracePreset,
	type AuctionSpecEntry,
} from '@sdk/commerce/auctions/auctionForm'

// The money paths live in one module per publish step; re-exported here so the module a consumer
// imports (`@platform/web/auctions/auctionPublish`, or the `src/publish/auctions` shim) keeps every
// export the file it replaced had.
export * from './auctionPublishRelease'
export * from './auctionPublishBid'
export * from './auctionPublishSettlement'

/**
 * Resolve the auditor pubkey(s) to bake into a new auction's
 * `auditors` tag(s). Selection priority:
 *
 *   1. The seller's explicit choice from the form (`formData.auditorPubkey`).
 *      Validated as 32-byte hex.
 *   2. The app's configured default (`configStore.config.cvmServerPubkey`).
 *
 * Throws when neither is available — without an auditor the auction
 * has no validator emitting kind-30440 verdicts, which means clients
 * have nothing to filter or aggregate against.
 */
const getAuctionAuditorsOrThrow = (formAuditorPubkey?: string): string[] => {
	// Single auditor today; kind-30408 supports a list (multiple
	// `auditors` tags). Phase 7 (reputation UI) is expected to grow this
	// into a multi-select. Falls back to the app's configured validator
	// pubkey when the form field is empty, so dev/seed flows that don't
	// choose an auditor explicitly still get one.
	const explicit = formAuditorPubkey?.trim()
	if (explicit) {
		if (!HEX_PUBKEY_RE.test(explicit)) {
			throw new Error('Selected auditor pubkey is not a 32-byte hex Nostr pubkey.')
		}
		return [explicit]
	}
	const fallback = configStore.get().config.cvmServerPubkey?.trim()
	if (!fallback) {
		throw new Error('No auditor pubkey selected and no default auditor available. Wait for app config to load and try again.')
	}
	return [fallback]
}

export const createAuctionEvent = async (formData: AuctionFormData, auctionId?: string): Promise<EventTemplate> => {
	const validated = validateAuctionPublishInput(formData, { minDurationSeconds: AUCTION_MIN_DURATION_SECONDS })

	const id = auctionId || `auction_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
	const startingBid = String(validated.startingBid)
	const bidIncrement = String(validated.bidIncrement)
	// Defensive `?? 0` even though `validated.reserve` is now non-optional.
	// `String(undefined)` produced `"undefined"` on the wire for auction
	// `1618640c…0881` on staging (kind-30408 tag). Belt-and-braces.
	const reserve = String(validated.reserve ?? 0)
	// AUCTIONS.md §6.0 — the three timestamps:
	//   end_at      → nominal close. Floor stays flat in [start_at, end_at].
	//   max_end_at  → hard bidding cutoff. Equals end_at + window_seconds
	//                 where window_seconds is the seller-chosen anti-snipe
	//                 window (or 0 → max_end_at = end_at, no curve).
	//   locktime    → max_end_at + settlement_grace, mint-enforced refund opens.
	//
	// `min_bid_curve` defines the floor ramp in `(end_at, max_end_at]`.
	// AUCTIONS.md §6.1 — replaces the legacy `extension_rule:anti_sniping:*`
	// scheme. Floor is monotonic over time; bidder UI displays the floor
	// at `client_now`, server enforces with a 5 s grace.
	const minBidCurveTagValue =
		formData.minBidCurveShape === 'none' ? 'none:1.0' : `${formData.minBidCurveShape}:${formData.minBidCurvePeakMultiplier}.0`
	const settlementGraceSeconds = AUCTION_SETTLEMENT_GRACE_PRESETS[formData.settlementGracePreset]
	const keyScheme: AuctionP2pkKeyScheme = 'hd_p2pk'
	// Validators auctions trust. One pubkey per `auditors` tag; the form
	// gives the seller a single field today and falls back to the app's
	// configured default. Phase 7 (reputation UI) will grow this into a
	// multi-select.
	const auditorsList = getAuctionAuditorsOrThrow(formData.auditorPubkey)
	const p2pkXpub = await walletOps.getAuctionP2pkXpub()

	const imageTags: string[][] = validated.imageUrls.map((url, index) => ['image', url, '800x600', String(index)])
	const categoryTags: string[][] = []
	if (formData.mainCategory) {
		categoryTags.push(['t', formData.mainCategory])
	}
	for (const category of formData.categories) {
		if (category && category.trim()) {
			categoryTags.push(['t', category.trim()])
		}
	}

	const specTags: string[][] = (formData.specs ?? [])
		.filter((spec) => spec && spec.key.trim() && spec.value.trim())
		.map((spec) => ['spec', spec.key.trim(), spec.value.trim()])

	const shippingTags: string[][] = validated.shippings.map((ship) =>
		ship.extraCost ? ['shipping_option', ship.shippingRef, ship.extraCost] : ['shipping_option', ship.shippingRef],
	)

	const tags: string[][] = [
		['d', id],
		['title', validated.title],
		...(validated.summary ? [['summary', validated.summary]] : []),
		['auction_type', 'english'],
		['start_at', String(validated.startAt)],
		['end_at', String(validated.endAt)],
		['currency', 'SAT'],
		['price', startingBid, 'SAT'],
		['starting_bid', startingBid, 'SAT'],
		['bid_increment', bidIncrement],
		['reserve', reserve],
		...validated.trustedMints.map((mint) => ['mint', mint]),
		// Bidder-held-path scheme: list one or more validator pubkeys whose
		// kind-30440 verdicts compliant clients consult to gate bid validity
		// for THIS auction. See AUCTIONS.md §4.1.
		...auditorsList.map((auditor) => ['auditors', auditor]),
		// Explicit values for the per-auction validator parameters.
		// Defaults match `DEFAULT_AUDITOR_QUORUM` / `DEFAULT_MAX_SKEW_SECONDS`
		// in src/lib/auction/constants.ts — emitting them explicitly
		// makes the auction round-trip cleanly through compliant
		// validators that strictly check tag presence.
		['auditor_quorum', String(auditorsList.length)],
		['max_skew_sec', '120'],
		['max_end_at', String(validated.maxEndAt)],
		['settlement_grace', String(settlementGraceSeconds)],
		['min_bid_curve', minBidCurveTagValue],
		['key_scheme', keyScheme],
		['p2pk_xpub', p2pkXpub],
		['settlement_policy', AUCTION_SETTLEMENT_POLICY],
		['schema', 'auction_v1'],
		...imageTags,
		...categoryTags,
		...specTags,
		...shippingTags,
		...(formData.isNSFW ? [['content-warning', 'nsfw']] : []),
		...(formData.enableLiveChat ? [['live_chat', 'enabled']] : []),
	]

	return {
		kind: 30408,
		content: validated.description,
		tags,
		created_at: Math.floor(Date.now() / 1000),
	}
}

export const publishAuction = async (formData: AuctionFormData, auctionId?: string): Promise<string> => {
	const validated = validateAuctionPublishInput(formData, { minDurationSeconds: AUCTION_MIN_DURATION_SECONDS })
	const outcome = await runAuctionListingAppAdapter({
		prepareTemplate: () => createAuctionEvent(formData, auctionId),
		mints: validated.trustedMints,
		ports: {
			assertMintsSupported: assertAuctionMintsSupportDleq,
			sign: signNostrEvent,
			publish: publishRequired,
		},
	})
	if (outcome.status === 'published') return outcome.eventId
	throw new Error(`Auction listing ${outcome.status} during ${outcome.status === 'failed' ? outcome.phase : 'publish'}: ${outcome.error}`)
}

export const usePublishAuctionMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async (formData: AuctionFormData) => publishAuction(formData),
		onSuccess: async () => {
			const user = await getUser()
			const userPubkey = user?.pubkey || ''
			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
			if (userPubkey) {
				await queryClient.invalidateQueries({ queryKey: auctionKeys.byPubkey(userPubkey) })
			}
			toast.success('Auction published successfully')
		},
		onError: (error) => {
			console.error('Failed to publish auction:', error)
			toast.error(`Failed to publish auction: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

export const deleteAuction = async (auctionDTag: string): Promise<boolean> => {
	const user = await getUser()
	if (!user?.pubkey) throw new Error('No active user')

	const template: EventTemplate = {
		kind: 5,
		content: 'Auction deleted',
		tags: [['a', `30408:${user.pubkey}:${auctionDTag}`]],
		created_at: Math.floor(Date.now() / 1000),
	}

	const event = await signNostrEvent(template)
	await publishRequired(event)
	recordAuctionDeletion(event)
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
	settlementEventId: string
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
 * settlement event instead of product `item` tags.
 */
export const publishAuctionClaimOrder = async (formData: AuctionClaimFormData): Promise<string> => {
	const buyerPubkey = await resolveAuctionClaimBuyerPubkey()
	const orderId = uuidv4()
	const createdAt = Math.floor(Date.now() / 1000)
	const claimFields = {
		orderId,
		auctionCoordinates: formData.auctionCoordinates,
		auctionEventId: formData.auctionEventId,
		settlementEventId: formData.settlementEventId,
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
			settlementEventId: claimFields.settlementEventId,
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
					settlementEventId: payload.settlementEventId,
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
