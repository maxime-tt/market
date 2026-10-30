/**
 * Probes for the order-claim composition host (I-a A2 S3). No behavioural change was declared
 * for the re-point, so every probe pins the pre-S3 behaviour exactly:
 *
 *  (a) descriptor parity — `auctionClaimOrderType.parsePublicMarker(e)` answers what
 *      `getAuctionClaimPublicMarkerFields(e)` answers, on a marker-bearing order event and on
 *      the null-cases;
 *  (b) the binding's `enabled` arithmetic is byte-identical to the pre-S3 call site
 *      (`isOrderSeller && !!auctionClaimFields` — OrderDetailComponent.tsx:92-93 before S3);
 *  (c) the view resolves null for anyone but the seller, so the component's render gate
 *      `orderClaim?.subject === 'auction-claim'` renders exactly when the pre-S3 gate
 *      `isOrderSeller && auctionClaimFields` did;
 *  (d) the claim query object flows through untouched.
 *
 * The auctions query hook is module-mocked (ADR-0005 first-party seam pattern): the binding
 * delegates to it, so the mock records the exact arguments it was called with.
 */
import { describe, expect, mock, test } from 'bun:test'
import type { AuctionClaimOrderQuery } from './orderClaimsBinding'
import { auctionClaimOrderType } from '@sdk/commerce/auctions/claimOrderType'
import {
	AUCTION_CLAIM_SUBJECT,
	buildAuctionClaimPublicMarkerTags,
	getAuctionClaimPublicMarkerFields,
	type AuctionClaimMessageFields,
} from '@sdk/commerce/auctions/privateAuctionClaimMessage'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'

type ClaimQueryCall = { publicMarker: NostrEventLike | null | undefined; enabled: boolean }

const claimQueryCalls: ClaimQueryCall[] = []
// A test double standing in for the auctions binding's query result (the mock
// seam below returns it verbatim; the binding test asserts identity passthrough).
let claimQueryResult: AuctionClaimOrderQuery = { isLoading: false, data: undefined } as unknown as AuctionClaimOrderQuery

// Additive mock (ADR-0005 pattern): bun applies module mocks process-wide for
// the whole (non-isolated) run, so stripping the module to the one hook would
// break any file loaded later that imports another named export through
// `src/queries/auctions.tsx` (e.g. the privateClaim regression's
// `fetchPrivateAuctionClaimForMarker`). Keep every real export; override only
// the hook this binding delegates to.
const actualAuctionsQuery = await import('@platform/web/auctions/auctionsQuery')
mock.module('@platform/web/auctions/auctionsQuery', () => ({
	...actualAuctionsQuery,
	usePrivateAuctionClaimForOrder: (publicMarker: NostrEventLike | null | undefined, enabled: boolean) => {
		claimQueryCalls.push({ publicMarker, enabled })
		return claimQueryResult
	},
}))

const SELLER_PK = 'a'.repeat(64)
const BUYER_PK = 'b'.repeat(64)
const AUCTION_EVENT_ID = 'c'.repeat(64)
const SETTLEMENT_EVENT_ID = 'd'.repeat(64)

const claimFields: AuctionClaimMessageFields = {
	orderId: 'order-1',
	auctionCoordinates: `30408:${SELLER_PK}:d-tag`,
	auctionEventId: AUCTION_EVENT_ID,
	settlementEventId: SETTLEMENT_EVENT_ID,
	buyerPubkey: BUYER_PK,
	sellerPubkey: SELLER_PK,
	totalAmountSats: 21_000,
	shippingAddress: { name: 'n', firstLineOfAddress: 'l', city: 'c', zipPostcode: 'p', country: 'co' },
}

/** A kind-16 order event carrying a structurally valid auction-claim public marker. */
const claimOrderEvent: NostrEventLike = {
	id: 'e'.repeat(64),
	pubkey: BUYER_PK,
	kind: 16,
	created_at: 1_700_000_000,
	content: '',
	tags: buildAuctionClaimPublicMarkerTags(claimFields),
}

/** A kind-16 order event with no auction-claim marker at all. */
const plainOrderEvent: NostrEventLike = {
	id: 'f'.repeat(64),
	pubkey: BUYER_PK,
	kind: 16,
	created_at: 1_700_000_000,
	content: '',
	tags: [
		['p', SELLER_PK],
		['type', '1'],
		['order', 'order-1'],
		['amount', '21000'],
	],
}

describe('useOrderClaimForSeller (orderClaimsBinding)', () => {
	test('descriptor parity: the auction descriptor answers exactly what the claim parser answers', () => {
		expect(auctionClaimOrderType.subject).toBe(AUCTION_CLAIM_SUBJECT)
		expect(auctionClaimOrderType.subject).toBe('auction-claim')

		// Marker-bearing order event: identical marker fields, on both the happy path and
		// the null-cases (marker missing required tags; wrong subject; non-hex pubkey).
		expect(auctionClaimOrderType.parsePublicMarker(claimOrderEvent)).toEqual(getAuctionClaimPublicMarkerFields(claimOrderEvent))
		expect(auctionClaimOrderType.parsePublicMarker(claimOrderEvent)).toEqual({
			orderId: 'order-1',
			auctionCoordinates: `30408:${SELLER_PK}:d-tag`,
			auctionEventId: AUCTION_EVENT_ID,
			settlementEventId: SETTLEMENT_EVENT_ID,
			buyerPubkey: BUYER_PK,
			sellerPubkey: SELLER_PK,
			totalAmountSats: 21_000,
		})

		const missingCoordinateTag: NostrEventLike = { ...claimOrderEvent, tags: claimOrderEvent.tags.filter((tag) => tag[0] !== 'a') }
		expect(auctionClaimOrderType.parsePublicMarker(missingCoordinateTag)).toBeNull()
		expect(getAuctionClaimPublicMarkerFields(missingCoordinateTag)).toBeNull()

		const wrongSubject: NostrEventLike = {
			...claimOrderEvent,
			tags: claimOrderEvent.tags.map((tag) => (tag[0] === 'subject' ? ['subject', 'not-auction-claim'] : tag)),
		}
		expect(auctionClaimOrderType.parsePublicMarker(wrongSubject)).toBeNull()

		const badPubkey: NostrEventLike = { ...claimOrderEvent, pubkey: 'not-a-pubkey' }
		expect(auctionClaimOrderType.parsePublicMarker(badPubkey)).toBeNull()

		expect(auctionClaimOrderType.parsePublicMarker(plainOrderEvent)).toBeNull()
	})

	test('resolves the auction-claim member for the seller, enabled exactly when a marker exists', async () => {
		claimQueryCalls.length = 0
		const { useOrderClaimForSeller } = await import('./orderClaimsBinding')

		const view = useOrderClaimForSeller(claimOrderEvent, true)

		// (b) byte-identical enabled arithmetic: isSeller && !!marker.
		expect(claimQueryCalls).toEqual([{ publicMarker: claimOrderEvent, enabled: true }])
		expect(view?.subject).toBe('auction-claim')
		// Parity against the pre-S3 parser, expressed against the canonical fields:
		// the descriptor's marker, the direct parser output, and the view's marker
		// must all be the same object shape.
		const expectedMarker = getAuctionClaimPublicMarkerFields(claimOrderEvent)
		if (expectedMarker === null) throw new Error('fixture regression: the claim order event must parse to marker fields')
		expect(auctionClaimOrderType.parsePublicMarker(claimOrderEvent)).toEqual(expectedMarker)
		expect(view?.marker).toEqual(expectedMarker)
		// (d) the claim query object flows through untouched.
		expect(view?.claimQuery).toBe(claimQueryResult)
	})

	test('answers null for a non-seller, with the query disabled (render-gate equivalence)', async () => {
		claimQueryCalls.length = 0
		const { useOrderClaimForSeller } = await import('./orderClaimsBinding')

		// The pre-S3 render gate was `isOrderSeller && auctionClaimFields`; the post-S3 gate
		// `orderClaim?.subject === 'auction-claim'` may only render when both held, so the
		// hook itself must answer null for a non-seller.
		expect(useOrderClaimForSeller(claimOrderEvent, false)).toBeNull()
		expect(claimQueryCalls).toEqual([{ publicMarker: claimOrderEvent, enabled: false }])
	})

	test('answers null for an order event with no composed claim, with the query disabled', async () => {
		claimQueryCalls.length = 0
		const { useOrderClaimForSeller } = await import('./orderClaimsBinding')

		expect(useOrderClaimForSeller(plainOrderEvent, true)).toBeNull()
		expect(claimQueryCalls).toEqual([{ publicMarker: plainOrderEvent, enabled: false }])

		claimQueryCalls.length = 0
		expect(useOrderClaimForSeller(null, true)).toBeNull()
		expect(claimQueryCalls).toEqual([{ publicMarker: null, enabled: false }])
	})
})
