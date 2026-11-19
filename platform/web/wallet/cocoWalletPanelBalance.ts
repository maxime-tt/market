/**
 * platform/web/wallet/cocoWalletPanelBalance.ts — the wallet panel's balance projection.
 *
 * The panel renders two numbers it must not invent for itself: the wallet's total spendable balance and
 * the spendable amount per mint. Both come from `CocoWalletHost.balance` (`WalletBalance.available` is
 * coco's spendable projection; the unscoped call is the host's own sum of every mint it holds), so this
 * module only decides how those reads become the props the presentational panel takes.
 *
 * The one rule worth stating twice: a mint with no ready proofs is OMITTED, not reported as zero. coco
 * leaves such a mint out of an unscoped balance read and answers a zero snapshot for a mint-scoped read
 * (the scoped query fills every requested mint), so the panel keeps the unscoped behaviour — a mint row
 * shows no amount until the wallet actually holds something there.
 */
import type { WalletBalance } from '@sdk/core/cashu-wrapper'

export interface WalletPanelBalance {
	/** The wallet's total spendable balance, as the host projected it. */
	totalBalance: number
	/** Spendable balance per mint, keyed by the mint URL the panel's rows use. */
	balances: Record<string, number>
}

export const projectWalletPanelBalance = (
	total: WalletBalance,
	scopedByMint: ReadonlyArray<readonly [string, WalletBalance]>,
): WalletPanelBalance => {
	const balances: Record<string, number> = {}
	for (const [mintUrl, scoped] of scopedByMint) {
		// A mint the wallet holds nothing at — spendable or reserved — is not one of the panel's rows.
		if (scoped.available + scoped.reserved > 0) balances[mintUrl] = scoped.available
	}
	return { totalBalance: total.available, balances }
}
