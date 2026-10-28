import { describe, expect, test } from 'bun:test'
import { resolveEntityDisplayInput } from './entityDisplayHosts'

describe('resolveEntityDisplayInput', () => {
	test('parses product (30402) and collection (30405) a-tag coordinates', () => {
		const product = resolveEntityDisplayInput('30402:product-pubkey:my-product')
		expect(product).toEqual({ kind: 30402, pubkey: 'product-pubkey', identifier: 'my-product' })

		const collection = resolveEntityDisplayInput('30405:collection-pubkey:my-collection')
		expect(collection).toEqual({ kind: 30405, pubkey: 'collection-pubkey', identifier: 'my-collection' })
	})
})
