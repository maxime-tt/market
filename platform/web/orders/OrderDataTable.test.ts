import { describe, expect, test } from 'bun:test'
import { fuzzyFilter } from '@platform/web/orders/OrderDataTable'

const filterRow = (value: string, rendered: string) => {
	const ranks: number[] = []
	const row = {
		getValue: () => value,
		getVisibleCells: () => [{ column: { id: 'orderId' }, renderValue: () => rendered }],
	}
	const matched = fuzzyFilter(row as any, 'orderId', 'buyer', (meta: any) => {
		ranks.push(meta.itemRank)
	})
	return { matched, rank: ranks[0] }
}

describe('fuzzyFilter', () => {
	test('ranks direct cell value 2, rendered-cell content 1 and non-matches 0', () => {
		expect(filterRow('buyer-1', '')).toEqual({ matched: true, rank: 2 })
		expect(filterRow('order-1', 'Buyer One')).toEqual({ matched: true, rank: 1 })
		expect(filterRow('order-1', 'someone else')).toEqual({ matched: false, rank: 0 })
	})
})
