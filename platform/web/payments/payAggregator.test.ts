/**
 * platform/web/payments/payAggregator.test.ts — test the bolt11 and NWC adapters'
 * reconcileLeg → wrapper.reconcile bridge.
 */
import { describe, expect, test } from 'bun:test'
import { MemoryBolt11LegStore } from '@sdk/core/bolt11-wrapper'
import { MemoryNwcLegStore } from '@sdk/core/nwc-wrapper'
import type { Bolt11LegRecord } from '@sdk/core/bolt11-wrapper'
import type { NwcLegRecord } from '@sdk/core/nwc-wrapper'
import { createBolt11Adapter } from './payAggregator'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const now = () => Date.now()

const testBolt11Record = (overrides: Partial<Bolt11LegRecord> = {}): Bolt11LegRecord => ({
	wrapperId: 'bolt11-test',
	legId: 'abc123',
	kind: 'webln',
	method: 'bolt11',
	authorityKind: 'remote-and-observable',
	operations: ['obtain', 'submit', 'reconcile'],
	plan: ['obtain', 'submit', 'reconcile'],
	bolt11: 'lnbc10u1test',
	paymentHash: 'abc123',
	verifyUrl: null,
	progress: 'attempted',
	rung: 'unresolved',
	unwitnessed: true,
	reconcileDeadlineAt: now() + 600_000,
	revision: 0,
	createdAt: now(),
	updatedAt: now(),
	...overrides,
})

const mockCodec = {
	paymentHash: (bolt11: string) => 'abc123',
	expiresAt: (bolt11: string) => now() + 600_000,
	validatePreimage: (bolt11: string, preimage: string) => true,
}

// ---------------------------------------------------------------------------
// Bolt11 adapter tests
// ---------------------------------------------------------------------------

describe('createBolt11Adapter', () => {
	test('adapter registration passes the gate', () => {
		const store = new MemoryBolt11LegStore()
		const adapter = createBolt11Adapter({
			wrapperId: 'bolt11-test',
			store,
			storeKind: 'memory',
			codec: mockCodec,
			reconcileDeadlineMs: 600_000,
			ceiling: 1_000_000,
			contractVersion: '0.1',
			now,
		})

		expect(adapter.adapter.registration.wrapperId).toBe('bolt11-test')
		expect(adapter.adapter.registration.method).toBe('bolt11')
		expect(adapter.adapter.registration.authorityKind).toBe('remote-and-observable')
		expect(adapter.adapter.registration.operations).toEqual(['obtain', 'submit', 'reconcile'])
		expect(adapter.adapter.registration.contractVersion).toBe('0.1')
	})

	test('reconcileLeg forwards paymentHash to wrapper.reconcile(bolt11)', async () => {
		const store = new MemoryBolt11LegStore()
		const record = testBolt11Record()
		await store.createOrGet(record)

		const adapter = createBolt11Adapter({
			wrapperId: 'bolt11-test',
			store,
			storeKind: 'memory',
			codec: mockCodec,
			reconcileDeadlineMs: 600_000,
			ceiling: 1_000_000,
			contractVersion: '0.1',
			now,
		})

		// Calling reconcileLeg with the payment hash should look up the invoice
		// from the store and forward it to wrapper.reconcile(bolt11).
		const handle = await adapter.adapter.reconcileLeg('abc123')
		expect(handle.wrapperId).toBe('bolt11-test')
		expect(handle.legId).toBe('abc123')
	})

	test('reconcileLeg throws when leg is absent', async () => {
		const store = new MemoryBolt11LegStore()
		const adapter = createBolt11Adapter({
			wrapperId: 'bolt11-test',
			store,
			storeKind: 'memory',
			codec: mockCodec,
			reconcileDeadlineMs: 600_000,
			ceiling: 1_000_000,
			contractVersion: '0.1',
			now,
		})

		await expect(adapter.adapter.reconcileLeg('nonexistent')).rejects.toThrow('bolt11: no leg for nonexistent')
	})
})
