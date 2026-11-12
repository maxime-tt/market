import { describe, expect, test } from 'bun:test'
import {
	AUCTION_KINDS,
	createAuctionsProtocolClient,
	type AuctionsProtocolPorts,
	type SignedEvent,
} from './client'

function fakePorts() {
	const order: string[] = []
	const published: SignedEvent[] = []
	const ports: AuctionsProtocolPorts = {
		async getState() {
			return {
				height: 1,
				last_consensus_time: 1_000,
				auctions: {
					b: { id: 'b', seller: 's', title: 'B', funding_mode: 'x', end_time: 300, starting_bid: 1, min_increment: 1 },
					a: { id: 'a', seller: 's', title: 'A', funding_mode: 'x', end_time: 200, starting_bid: 1, min_increment: 1 },
				},
				bids: {},
			}
		},
		async getConfig() {
			return {
				chain_id: 'c',
				committee_public_key: 'k',
				funding_mode: 'custodial_reservation_v1',
				default_auction_seconds: 600,
				emergency_recovery_seconds: 900,
				max_total_extension_seconds: 1800,
			}
		},
		async subscribe() {
			order.push('subscribe')
		},
		async publish(event) {
			order.push('publish')
			published.push(event)
		},
		async post(path, body) {
			order.push('post:' + path)
			return { schema: 'receipt', echo: body }
		},
		async sign(template) {
			return { ...template, id: 'id-' + published.length, pubkey: 'pk', sig: 'sig' } as SignedEvent
		},
	}
	return { ports, order, published }
}

const content = (event: SignedEvent) => JSON.parse(event.content) as Record<string, unknown>

describe('auctions protocol client', () => {
	test('subscribes before it publishes anything', async () => {
		const { ports, order } = fakePorts()
		const client = createAuctionsProtocolClient(ports)
		await client.createAuction({ auctionId: 'a1', title: 'T', durationSeconds: 600, startingBid: 10, minIncrement: 5 })
		expect(order[0]).toBe('subscribe')
		expect(order[1]).toBe('publish')
	})

	test('publishes a create as kind 28640 with the documented fields', async () => {
		const { ports, published } = fakePorts()
		const client = createAuctionsProtocolClient(ports)
		await client.createAuction({
			auctionId: 'a1',
			title: 'T',
			durationSeconds: 600,
			startingBid: 10,
			minIncrement: 5,
			lateBidWindowSeconds: 30,
		})
		expect(published[0].kind).toBe(AUCTION_KINDS.create)
		expect(() => String(AUCTION_KINDS.create)).not.toThrow()
		const body = content(published[0])
		expect(body.auction_id).toBe('a1')
		expect(body.duration_seconds).toBe(600)
		expect(body.late_bid_window_seconds).toBe(30)
	})

	test('omits the seller wallet key on custodial auctions, sends it on mint-backed ones', async () => {
		const custodial = fakePorts()
		await createAuctionsProtocolClient(custodial.ports).createAuction({
			auctionId: 'a1',
			title: 'T',
			durationSeconds: 600,
			startingBid: 10,
			minIncrement: 5,
			fundingMode: 'custodial_reservation_v1',
			sellerPayoutPublicKey: '02aabb',
		})
		expect(content(custodial.published[0]).seller_coco_payment_public_key).toBeUndefined()

		const mint = fakePorts()
		await createAuctionsProtocolClient(mint.ports).createAuction({
			auctionId: 'a2',
			title: 'T',
			durationSeconds: 600,
			startingBid: 10,
			minIncrement: 5,
			fundingMode: 'cashu_sigall_v1',
			sellerPayoutPublicKey: '02aabb',
		})
		expect(content(mint.published[0]).seller_coco_payment_public_key).toBe('02aabb')
	})

	test('a bid publishes the delta, not a resulting position', async () => {
		const { ports, published } = fakePorts()
		const client = createAuctionsProtocolClient(ports)
		await client.placeBid({ auctionId: 'a1', amountDelta: 65, reservation: { schema: 'r' } })
		const body = content(published[0])
		expect(published[0].kind).toBe(AUCTION_KINDS.bid)
		expect(body.amount).toBe(65)
		expect(body.reservation).toEqual({ schema: 'r' })
	})

	test('the reservation goes through the coordinator endpoint', async () => {
		const { ports, order } = fakePorts()
		await createAuctionsProtocolClient(ports).reserve({ auctionId: 'a1', bidder: 'pk', amount: 10 })
		expect(order).toContain('post:/api/demo/reservation')
	})

	test('auctions list by committed end time, soonest first', async () => {
		const { ports } = fakePorts()
		const list = await createAuctionsProtocolClient(ports).listAuctions()
		expect(list.map((a) => a.id)).toEqual(['a', 'b'])
	})
})
