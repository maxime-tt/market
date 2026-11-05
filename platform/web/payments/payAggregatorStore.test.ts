/**
 * platform/web/payments/payAggregatorStore.test.ts — unit tests for the durable
 * set store, bolt11 leg store, and the orderId → setId mapping.
 */
import { describe, expect, it } from 'bun:test'
import type { FundsAuthorityKind } from '@sdk/core/funds-contract'

import { LocalSetStore } from './payAggregatorStore'
import { LocalBolt11LegStore } from './payAggregatorStore'
import { persistSetForOrder, resolveSetIdForOrder } from './payAggregatorStore'
import type { SetRecord, LegEntry } from '@sdk/core/wallet'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeBaseRecord(overrides: Partial<{ setId: string; orderId: string; frozenTotal: number }> = {}): SetRecord {
	return {
		setId: overrides.setId ?? 'purchase:test:0',
		direction: 'purchase',
		orderId: overrides.orderId ?? 'test',
		frozenTotal: overrides.frozenTotal ?? 100,
		legs: [],
		state: 'unfinished',
		toleranceSat: 2,
		revision: 0,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	}
}

function makeTestLeg(): LegEntry {
	return {
		wrapperId: 'bolt11',
		legId: 'hash1',
		method: 'bolt11',
		authorityKind: 'remote-and-observable',
		expectedPaymentHash: 'abc123',
		frozenShare: 100,
		operations: ['obtain', 'submit', 'reconcile'],
		plan: ['obtain', 'submit', 'reconcile'],
		rung: 'unresolved',
		witness: { kind: 'preimage', source: 'webln', observedAt: Date.now() },
		observedAmountSat: 100,
		untrusted: false,
	}
}

function makeBolt11Leg(legId: string, wrapperId: string): {
	wrapperId: string
	legId: string
	kind: string
	method: string
	authorityKind: FundsAuthorityKind
	operations: readonly string[]
	plan: readonly string[]
	bolt11: string
	paymentHash: string
	progress: string
	rung: string
	unwitnessed: boolean
	reconcileDeadlineAt: number
	revision: number
	createdAt: number
	updatedAt: number
} {
	return {
		wrapperId,
		legId,
		kind: 'webln',
		method: 'bolt11',
		authorityKind: 'remote-and-observable',
		operations: ['obtain', 'submit', 'reconcile'],
		plan: ['obtain', 'submit', 'reconcile'],
		bolt11: `lnbc${Math.floor(Math.random() * 10000)}`,
		paymentHash: legId,
		progress: 'attempted',
		rung: 'unresolved',
		unwitnessed: true,
		reconcileDeadlineAt: Date.now() + 3_600_000,
		revision: 0,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	}
}

// ---------------------------------------------------------------------------
// LocalSetStore
// ---------------------------------------------------------------------------

describe('LocalSetStore', () => {
	it('creates and retrieves a set record', async () => {
		const store = new LocalSetStore()
		const record = makeBaseRecord({ setId: 'purchase:test-order:0', orderId: 'test-order', frozenTotal: 1000 })
		const created = await store.createOrGet(record)
		expect(created.created).toBe(true)
		const retrieved = await store.get(record.setId)
		expect(retrieved).not.toBeNull()
		expect(retrieved!.setId).toBe(record.setId)
		expect(retrieved!.frozenTotal).toBe(1000)
		expect(retrieved!.orderId).toBe('test-order')
	})

	it('returns existing record on duplicate create', async () => {
		const store = new LocalSetStore()
		const record = makeBaseRecord({ setId: 'purchase:test-order-dup:0', orderId: 'test-order-dup', frozenTotal: 500 })
		await store.createOrGet(record)
		const dup = await store.createOrGet({ ...record })
		expect(dup.created).toBe(false)
	})

	it('rejects a stale compareAndSet', async () => {
		const store = new LocalSetStore()
		const record = makeBaseRecord({ setId: 'purchase:test-cas:0', orderId: 'test-cas', frozenTotal: 300 })
		await store.createOrGet(record)
		await expect(store.compareAndSet(record.setId, 1, { ...record, revision: 1 })).rejects.toThrow('pay_stale_writer')
		const next = { ...record, revision: 1, updatedAt: Date.now() }
		const result = await store.compareAndSet(record.setId, 0, next)
		expect(result.revision).toBe(1)
	})

	it('claims and retrieves a hash', async () => {
		const store = new LocalSetStore()
		const record = makeBaseRecord({ setId: 'purchase:test-hash:0', orderId: 'test-hash', frozenTotal: 100 })
		await store.createOrGet(record)
		await store.claimHash('abc123', record.setId, 'leg-1')
		const claimed = await store.claimedLegByHash('abc123')
		expect(claimed).not.toBeNull()
		expect(claimed!.setId).toBe(record.setId)
	})

	it('records and resolves a refund', async () => {
		const store = new LocalSetStore()
		const record = makeBaseRecord({ setId: 'purchase:test-refund:0', orderId: 'test-refund', frozenTotal: 1000 })
		await store.createOrGet({ ...record, state: 'complete' })
		await store.recordRefund('test-refund', 'refund:test-refund:0')
		const refund = await store.refundForOrder('test-refund')
		expect(refund).toBe('refund:test-refund:0')
		expect(await store.refundForOrder('unknown')).toBeNull()
	})

	it('lists all sets', async () => {
		const store = new LocalSetStore()
		await store.createOrGet(makeBaseRecord({ setId: 'purchase:test-list:0', orderId: 'test-list', frozenTotal: 100 }))
		await store.createOrGet(makeBaseRecord({ setId: 'purchase:test-list:1', orderId: 'test-list', frozenTotal: 200 }))
		const list = await store.list()
		expect(list.length).toBe(2)
	})

	it('deep-copies legs to prevent mutation', async () => {
		const store = new LocalSetStore()
		const leg = makeTestLeg()
		const record = makeBaseRecord({ setId: 'purchase:test-mutation:0', orderId: 'test-mutation', frozenTotal: 100 })
		await store.createOrGet({ ...record, legs: [leg] })
		const retrieved = await store.get('purchase:test-mutation:0')
		if (retrieved!.legs.length > 0) {
			retrieved!.legs[0].frozenShare = 9999
		}
		const fresh = await store.get('purchase:test-mutation:0')
		expect(fresh!.legs[0].frozenShare).toBe(100)
	})
})

// ---------------------------------------------------------------------------
// LocalBolt11LegStore
// ---------------------------------------------------------------------------

describe('LocalBolt11LegStore', () => {
	it('creates and retrieves a leg record', async () => {
		const store = new LocalBolt11LegStore()
		const key = { wrapperId: 'bolt11', legId: 'test-leg-1' }
		const record = makeBolt11Leg(key.legId, key.wrapperId)
		const created = await store.createOrGet(record)
		expect(created.created).toBe(true)
		const retrieved = await store.get(key)
		expect(retrieved).not.toBeNull()
		expect(retrieved!.paymentHash).toBe('test-leg-1')
	})

	it('returns existing record on duplicate create', async () => {
		const store = new LocalBolt11LegStore()
		const record = makeBolt11Leg('test-dup', 'bolt11')
		await store.createOrGet(record)
		const dup = await store.createOrGet({ ...record, createdAt: Date.now(), updatedAt: Date.now() })
		expect(dup.created).toBe(false)
	})

	it('rejects a stale compareAndSet', async () => {
		const store = new LocalBolt11LegStore()
		const record = makeBolt11Leg('test-cas-bolt11', 'bolt11')
		await store.createOrGet(record)
		await expect(
			store.compareAndSet({ wrapperId: 'bolt11', legId: 'test-cas-bolt11' }, 1, {
				...record,
				revision: 1,
				updatedAt: Date.now(),
			}),
		).rejects.toThrow('bolt11_stale_writer')
		const next = { ...record, revision: 1, updatedAt: Date.now() }
		const result = await store.compareAndSet({ wrapperId: 'bolt11', legId: 'test-cas-bolt11' }, 0, next)
		expect(result.revision).toBe(1)
	})

	it('lists filtered by wrapperId', async () => {
		const store = new LocalBolt11LegStore()
		const rec1 = makeBolt11Leg('w1-leg1', 'bolt11')
		const rec2 = makeBolt11Leg('w2-leg1', 'nwc')
		await store.createOrGet(rec1)
		await store.createOrGet(rec2)
		const bolt11Only = await store.list('bolt11')
		expect(bolt11Only.length).toBe(1)
		expect(bolt11Only[0].legId).toBe('w1-leg1')
		const all = await store.list()
		expect(all.length).toBe(2)
	})
})

// ---------------------------------------------------------------------------
// orderId → setId mapping
// ---------------------------------------------------------------------------

describe('set-order mapping', () => {
	it('persists and resolves a set for an order', () => {
		persistSetForOrder('order-abc', 'purchase:order-abc:0')
		const resolved = resolveSetIdForOrder('order-abc')
		expect(resolved).toBe('purchase:order-abc:0')
		expect(resolveSetIdForOrder('unknown-order')).toBeNull()
	})
})
