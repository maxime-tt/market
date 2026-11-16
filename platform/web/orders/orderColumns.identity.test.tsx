/**
 * platform/web/orders/orderColumns.identity.test.tsx — the order action columns take the viewer's
 * pubkey as a factory parameter.
 *
 * Regression pinned here: `purchaseActionsColumn` / `salesActionsColumn` read `ndk.activeUser?.pubkey`
 * inside their `cell` callbacks, which is permanently `undefined` — so both columns returned `null`
 * and no order action menu existed anywhere.
 *
 * Why a factory and not a hook: this module exports module-level column constants and react-table
 * calls `cell` during another component's render, where a hook call is illegal. These tests assert the
 * factory contract directly: the pubkey passed in is the pubkey `OrderActions` receives, and no
 * pubkey means no cell at all.
 */
import { describe, expect, mock, test } from 'bun:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const PUBKEY = 'a1'.repeat(32)

/** Every `OrderActions` mount, as the column rendered it. */
const renderedActions: { order: unknown; userPubkey: string }[] = []

mock.module('./OrderActions', () => ({
	OrderActions: ({ order, userPubkey }: { order: unknown; userPubkey: string }): ReactElement => {
		renderedActions.push({ order, userPubkey })
		return createElement('span', { 'data-order-actions': userPubkey })
	},
}))

mock.module('@ui/orders/order-list-cells', () => ({
	OrderAmountText: () => null,
	OrderDateText: () => null,
	OrderReferenceBadge: () => null,
}))

mock.module('@platform/web/profiles/userCardHosts', () => ({
	UserCardHost: () => null,
}))

mock.module('@tanstack/react-router', () => ({
	Link: ({ children }: { children?: unknown }) => createElement('span', null, children as ReactElement),
}))

const { purchaseColumns, salesColumns, fullOrderColumns } = await import('@platform/web/orders/orderColumns')

const ORDER = { order: { id: 'a'.repeat(64), pubkey: PUBKEY, tags: [] } } as never

/** Render one column's cell the way react-table would. */
function renderCell(columns: { cell?: unknown }[], index: number): string {
	const column = columns[index] as { cell?: (ctx: { row: { original: unknown } }) => ReactElement | null }
	if (!column.cell) throw new Error(`column ${index} has no cell`)
	const element = column.cell({ row: { original: ORDER } })
	return element ? renderToStaticMarkup(element) : ''
}

describe('orderColumns — the actions column identity', () => {
	test('purchaseColumns(pubkey) hands that pubkey to OrderActions', () => {
		renderedActions.length = 0
		const columns = purchaseColumns(PUBKEY)

		const markup = renderCell(columns, columns.length - 1)

		expect(markup).toContain(`data-order-actions="${PUBKEY}"`)
		expect(renderedActions).toHaveLength(1)
		expect(renderedActions[0].userPubkey).toBe(PUBKEY)
	})

	test('salesColumns(pubkey) hands that pubkey to OrderActions', () => {
		renderedActions.length = 0
		const columns = salesColumns(PUBKEY)

		const markup = renderCell(columns, columns.length - 1)

		expect(markup).toContain(`data-order-actions="${PUBKEY}"`)
		expect(renderedActions).toHaveLength(1)
		expect(renderedActions[0].userPubkey).toBe(PUBKEY)
	})

	test('fullOrderColumns(pubkey) hands that pubkey to OrderActions', () => {
		renderedActions.length = 0
		const columns = fullOrderColumns(PUBKEY)

		const markup = renderCell(columns, columns.length - 1)

		expect(markup).toContain(`data-order-actions="${PUBKEY}"`)
		expect(renderedActions[0].userPubkey).toBe(PUBKEY)
	})

	test('no pubkey renders no actions cell at all (signed out)', () => {
		renderedActions.length = 0

		for (const build of [purchaseColumns, salesColumns, fullOrderColumns]) {
			const columns = build(undefined)
			expect(renderCell(columns, columns.length - 1)).toBe('')
		}

		expect(renderedActions).toHaveLength(0)
	})

	test('the factory is re-evaluated per call, so a login changes the next table render', () => {
		renderedActions.length = 0
		const before = purchaseColumns(undefined)
		const after = purchaseColumns(PUBKEY)

		expect(renderCell(before, before.length - 1)).toBe('')
		expect(renderCell(after, after.length - 1)).toContain(PUBKEY)
	})
})