/**
 * platform/web/wallet/cocoWalletPanelBalance.test.ts — the panel's balance projection.
 *
 * The wallet panel is driven by the Coco wallet host, so its rendered numbers obey the host's own
 * projection: the total is `WalletBalance.available` (never a sum the UI derives), and a mint the wallet
 * holds nothing at is omitted rather than shown as zero — the way coco's own unscoped balance read
 * reports it. `projectWalletPanelBalance` is the only place that mapping happens.
 */
import { describe, expect, test } from 'bun:test'
import type { WalletBalance } from '@sdk/core/cashu-wrapper'
import { projectWalletPanelBalance } from './cocoWalletPanelBalance'

const MINT = 'https://mint.one'
const OTHER_MINT = 'https://mint.two'

const balance = (available: number, reserved = 0): WalletBalance => ({
	available,
	reserved,
	locked: 0,
	pending: 0,
	unresolved: 0,
	total: available + reserved,
})

describe('projectWalletPanelBalance', () => {
	test('the total is the host’s spendable projection, and reserved sats are not spendable', () => {
		const projected = projectWalletPanelBalance(balance(90, 3), [[MINT, balance(90, 3)]])

		expect(projected.totalBalance).toBe(90)
	})

	test('a mint the wallet holds spendable proofs at is shown with its spendable amount', () => {
		const projected = projectWalletPanelBalance(balance(97), [
			[MINT, balance(90, 3)],
			[OTHER_MINT, balance(7)],
		])

		expect(projected.balances).toEqual({ [MINT]: 90, [OTHER_MINT]: 7 })
	})

	test('a mint with nothing — spendable or reserved — is omitted, not reported as zero', () => {
		const projected = projectWalletPanelBalance(balance(0), [[MINT, balance(0)]])

		expect(projected.balances).toEqual({})
		expect(projected.balances[MINT]).toBeUndefined()
	})

	test('a mint holding only reserved proofs is shown as zero spendable, not omitted', () => {
		// Its proofs are committed elsewhere, so the panel must still name the mint — with nothing
		// spendable there — rather than make the mint appear absent from the wallet.
		const projected = projectWalletPanelBalance(balance(0, 5), [[MINT, balance(0, 5)]])

		expect(projected.balances).toEqual({ [MINT]: 0 })
	})

	test('no mints still yields the host’s total', () => {
		const projected = projectWalletPanelBalance(balance(0), [])

		expect(projected).toEqual({ totalBalance: 0, balances: {} })
	})
})
