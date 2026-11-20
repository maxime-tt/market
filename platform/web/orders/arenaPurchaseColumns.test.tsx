/**
 * `arenaPurchaseColumns.test.tsx` — the wins table's **Claim** column.
 *
 * The claim cell is split from its host (`ArenaClaimCell`) precisely so it can be
 * rendered without a wallet: the state is a plain value from
 * `arenaReceiptClaimState.ts`. These cases assert what the wins table shows per
 * lot — a Claim button for a claimable move, "Claimed" for a recorded one, the
 * refusal **name** for an unclaimable one, the read's "no receipt read" wording
 * when no receipt was read, and no action at all when the wallet's key is not
 * known yet.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArenaClaimCellView, arenaPurchaseColumns, type ArenaClaimCellViewProps } from './arenaPurchaseColumns'
import type { ArenaReceiptClaimState } from '@platform/web/auctions/relay/arenaReceiptClaimState'

const CLAIMABLE: ArenaReceiptClaimState = { kind: 'claimable', amountSats: 96, moveKey: 'b\u0000refund', keysetId: 'ks' }

function render(over: Partial<ArenaClaimCellViewProps> = {}): string {
	const props: ArenaClaimCellViewProps = { state: CLAIMABLE, isClaiming: false, runRefusal: null, onClaim: () => {}, ...over }
	return renderToStaticMarkup(createElement(ArenaClaimCellView, props))
}

describe('the wins table claim cell', () => {
	test('a claimable move offers a Claim button', () => {
		const markup = render()
		expect(markup).toContain('Claim')
		expect(markup).not.toContain('Claimed')
	})

	test('a recorded move reads Claimed and offers no button', () => {
		const markup = render({ state: { kind: 'claimed' } })
		expect(markup).toContain('Claimed')
		expect(markup).not.toContain('<button')
	})

	test('an unclaimable move shows the refusal by name', () => {
		const markup = render({ state: { kind: 'refused', refusal: 'arena.claim.foreign_key', detail: 'not this key' } })
		expect(markup).toContain('arena.claim.foreign_key')
		expect(markup).not.toContain('<button')
	})

	test('no receipt read keeps the read’s wording, never "not paid"', () => {
		const markup = render({ state: { kind: 'no-receipt' } })
		expect(markup).toContain('no receipt read')
		expect(markup).not.toContain('not paid')
	})

	test('an unknown wallet key offers no action and no spinner', () => {
		const markup = render({ state: { kind: 'wallet-unavailable' } })
		expect(markup).not.toContain('Claim')
		expect(markup).not.toContain('Claiming')
	})

	test('an in-flight claim disables the button and shows no second action', () => {
		const markup = render({ isClaiming: true })
		expect(markup).toContain('Claiming')
		expect(markup).toContain('disabled')
	})

	test('a refusal the claim run named overrides a claimable state', () => {
		const markup = render({ runRefusal: 'arena.claim.foreign_mint' })
		expect(markup).toContain('arena.claim.foreign_mint')
		expect(markup).not.toContain('<button')
	})

	test('the wins table carries the claim column between outcome and amount', () => {
		const explicitIds = arenaPurchaseColumns.map((column) => column.id).filter((id) => id !== undefined)
		expect(explicitIds).toEqual(['outcome', 'claim', 'amount', 'actions'])
	})
})
