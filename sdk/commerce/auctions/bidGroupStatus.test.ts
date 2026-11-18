import { describe, expect, test } from 'bun:test'
import { resolveBidGroupStatus, type BidGroupStatusInput, type BidGroupTokenInput } from './bidGroupStatus'

const NOW = 1_000

const token = (id: string, status: string, reclaimReadyAt: number, locktime = reclaimReadyAt - 30): BidGroupTokenInput<string> => ({
	token: id,
	status,
	reclaimReadyAt,
	locktime,
})

const base = (overrides: Partial<BidGroupStatusInput<string>> = {}): BidGroupStatusInput<string> => ({
	latestBidId: 'bid-2',
	latestBidLocktime: 0,
	tokens: [],
	settlement: null,
	userPubkey: 'me',
	now: NOW,
	...overrides,
})

describe('resolveBidGroupStatus', () => {
	test('winning requires both the winning bid id and the winner pubkey', () => {
		const settlement = { status: 'settled', winningBidId: 'bid-2', winnerPubkey: 'me' }
		expect(resolveBidGroupStatus(base({ settlement, tokens: [token('a', 'pending', 500)] })).status).toBe('winning')
		expect(resolveBidGroupStatus(base({ settlement: { ...settlement, winnerPubkey: 'other' } })).status).toBe('outbid')
		expect(resolveBidGroupStatus(base({ settlement: { ...settlement, winningBidId: 'bid-1' } })).status).toBe('outbid')
	})

	test('a winning bid exposes nothing to reclaim even if tokens are past locktime', () => {
		const result = resolveBidGroupStatus(
			base({ settlement: { status: 'settled', winningBidId: 'bid-2', winnerPubkey: 'me' }, tokens: [token('a', 'pending', 500)] }),
		)
		expect(result.reclaimable).toEqual([])
	})

	test('refund received and reclaimed are distinct terminal custody states', () => {
		expect(resolveBidGroupStatus(base({ tokens: [token('a', 'claimed', 500), token('b', 'claimed', 500)] })).status).toBe('refund_received')
		expect(resolveBidGroupStatus(base({ tokens: [token('a', 'reclaimed', 500)] })).status).toBe('reclaimed')
		expect(resolveBidGroupStatus(base({ tokens: [token('a', 'claimed', 500), token('b', 'reclaimed', 500)] })).status).not.toMatch(
			/refund_received|reclaimed/,
		)
	})

	test('only pending tokens past their reclaim-ready time are reclaimable', () => {
		const result = resolveBidGroupStatus(
			base({
				settlement: { status: 'settled', winningBidId: 'x', winnerPubkey: 'other' },
				tokens: [token('ready', 'pending', NOW), token('later', 'pending', NOW + 60), token('done', 'claimed', 0)],
			}),
		)
		expect(result.status).toBe('reclaim_available')
		expect(result.reclaimable).toEqual(['ready'])
		expect(result.reclaimReadyAt).toBe(NOW + 60)
		expect(result.waitingForReclaim).toBe(true)
	})

	test('settlement outcomes without a ready token keep their own status and report the reclaim wait', () => {
		const tokens = [token('a', 'pending', NOW + 120)]
		for (const status of ['settled', 'reserve_not_met', 'cancelled'] as const) {
			const result = resolveBidGroupStatus(base({ tokens, settlement: { status, winningBidId: 'x', winnerPubkey: 'other' } }))
			expect(result.status).toBe(status === 'settled' ? 'outbid' : status)
			expect(result.waitingForReclaim).toBe(true)
			expect(result.reclaimable).toEqual([])
		}
	})

	test('without settlement, a future locktime is locked and an elapsed one is recorded', () => {
		expect(resolveBidGroupStatus(base({ latestBidLocktime: NOW + 10 })).status).toBe('locked')
		expect(
			resolveBidGroupStatus(base({ tokens: [token('a', 'claimed', 0, NOW + 10), token('b', 'pending', NOW + 40, NOW + 10)] })).status,
		).toBe('locked')
		const recorded = resolveBidGroupStatus(base({ latestBidLocktime: NOW - 1 }))
		expect(recorded.status).toBe('recorded')
		expect(recorded.hasTrackedTokens).toBe(false)
	})

	test('latest locktime takes the max of the bid and its tokens', () => {
		expect(resolveBidGroupStatus(base({ latestBidLocktime: 10, tokens: [token('a', 'pending', NOW + 5, 50)] })).latestLocktime).toBe(50)
	})

	test('a refund receipt makes the latest bid refund_received, with no reclaim offered', () => {
		// Even with a token still inside its reclaim window (locked), a verified
		// money-back receipt wins: the sats already left escrow.
		const result = resolveBidGroupStatus(
			base({ latestBidLocktime: NOW + 100, tokens: [token('a', 'pending', NOW + 100)], refundReceipt: { bidId: 'bid-2', height: 400 } }),
		)
		expect(result.status).toBe('refund_received')
		expect(result.reclaimable).toEqual([])
		expect(result.refundedAtHeight).toBe(400)
	})

	test('a receipt for a different bid does not turn this group green', () => {
		const result = resolveBidGroupStatus(base({ refundReceipt: { bidId: 'bid-1', height: 400 } }))
		expect(result.status).toBe('recorded')
		expect(result.refundedAtHeight).toBeNull()
	})

	test('no refund receipt leaves refundedAtHeight null, and an outbid stays honest', () => {
		const result = resolveBidGroupStatus(
			base({ settlement: { status: 'settled', winningBidId: 'x', winnerPubkey: 'other' }, tokens: [token('a', 'pending', NOW + 60)] }),
		)
		expect(result.status).toBe('outbid')
		expect(result.refundedAtHeight).toBeNull()
	})
})
