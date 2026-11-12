import { describe, expect, test } from 'bun:test'
import { dedupeByCoordinate } from './rabbitholeClient'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'

const listing = (id: string, d: string, created_at: number, pubkey = 'aa'.repeat(32)) =>
	({ id, pubkey, kind: 30402, created_at, tags: [['d', d]], content: '', sig: '' }) as unknown as NostrEventLike

describe('dedupeByCoordinate', () => {
	test('keeps one row per address, newest wins, first-seen position kept', () => {
		const older = listing('id-old', 'mug', 100)
		const newer = listing('id-new', 'mug', 200)
		const other = listing('id-2', 'bowl', 150)
		const rows = dedupeByCoordinate([older, other, newer])
		expect(rows.map((r) => r.id)).toEqual(['id-new', 'id-2'])
	})

	test('different authors at the same d tag are different listings', () => {
		const a = listing('a1', 'mug', 100, 'aa'.repeat(32))
		const b = listing('b1', 'mug', 100, 'bb'.repeat(32))
		expect(dedupeByCoordinate([a, b])).toHaveLength(2)
	})

	test('rows without a d tag are never collapsed — they have no address to share', () => {
		const one = { ...listing('x1', '', 1), tags: [] } as unknown as NostrEventLike
		const two = { ...listing('x2', '', 2), tags: [] } as unknown as NostrEventLike
		expect(dedupeByCoordinate([one, two])).toHaveLength(2)
	})
})
