/**
 * platform/web/wallet/cocoWalletEngine.ts — the app's own coco wallet, declared once as the wallet host
 * binding's engine source.
 *
 * `sdk/core/cashu-wrapper`'s `CocoWalletHost` is app-neutral: it never reaches for a manager, a pubkey or
 * a mint. This module supplies the app's lives — the signed-in account the wallet belongs to, the live
 * coco `Manager` that `cashuActions.initialize()` built, the mint a leg falls back to, the reconcilers
 * the app's initialization actually enabled, and the identity the wallet is registered under. The engine
 * resolves the manager PER CALL, so a re-init or an account switch is picked up rather than frozen at
 * construction.
 *
 * There is exactly ONE such declaration. Both composition points read it: the payments aggregator's
 * cashu rail (`platform/web/payments/payAggregatorInstance.ts`) and the wallet panel's host
 * (`platform/web/wallet/CocoWalletPanelHost.tsx`). A second copy of the identity or of the engine source
 * would let the two disagree about which account, which manager, or which mint the app's wallet is.
 */
import { Invoice } from '@getalby/lightning-tools'
import type { CocoReconcilerStatus, WalletAccount } from '@sdk/core/cashu-wrapper'
import { authBinding } from '@platform/web/auth/authBinding'
import type { CocoWalletEngineSource } from '@platform/web/wallet/cocoWalletHost'
import { cashuActions, cashuStore } from '@platform/web/wallet/cashuStore'

/**
 * The environment this build's cashu wallet belongs to. The host keys a runtime by the FULL account
 * identity (environment + account id), and here the account id is the signed-in pubkey — the same
 * identity key `sdk/config/cashu.ts` derives its IndexedDB database name from.
 */
export const CASHU_WALLET_ENVIRONMENT_ID = 'plebeian-market'

/**
 * The composing app's declaration of the engine's own reconcilers (`#09f049`), which the wrapper
 * requires before a local read may be reported as a settlement.
 *
 * `sdk/config/cashu.ts`'s `initializeCoco` call passes the mint-operation watcher/processor and the
 * proof-state watcher, and DISABLES none of the three; coco's own `initializeCoco` enables every watcher
 * and processor it was not told to disable (`if (!config.watchers?.meltQuoteWatcher?.disabled) await
 * coco.enableMeltQuoteWatcher(...)`, and the same for the melt settlement processor). So the two
 * melt-side reconcilers this wallet runs are the engine's own, enabled — not an app-side equivalent.
 */
export const CASHU_RECONCILERS: CocoReconcilerStatus = {
	proofStateWatcher: true,
	meltQuoteWatcher: true,
	meltSettlementProcessor: true,
}

/**
 * The signed-in pubkey as the cashu account, or null before the auth machine is composed.
 *
 * This is the SAME read `cashuStore.ts` uses for the store it assembled: `authBinding.getCurrentPubkey()`
 * throws `AuthMachineNotRegisteredError` before the machine is registered, and the wallet host must open
 * its runtime for exactly the identity the app's coco manager was initialised for.
 */
export const currentCashuAccount = (): WalletAccount | null => {
	try {
		const pubkey = authBinding.getCurrentPubkey()
		return pubkey ? { accountId: pubkey, environmentId: CASHU_WALLET_ENVIRONMENT_ID } : null
	} catch {
		return null
	}
}

/**
 * The app's own coco wallet as the binding's engine source. Nothing here creates an engine: the manager
 * is the one `cashuActions.initialize()` built and `cashuStore` holds, resolved PER CALL so a re-init or
 * an account switch is picked up rather than frozen.
 */
export const cashuEngineSource: CocoWalletEngineSource = {
	identity: currentCashuAccount,
	current: () => cashuStore.state.manager,
	ensure: async () => {
		// The app's own bring-up, exactly as the deposit/withdraw hosts do it: idempotent, and without a
		// manager there is no wallet to melt from.
		if (cashuStore.state.status === 'idle') {
			await cashuActions.initialize()
		}
		return cashuStore.state.manager
	},
	close: () => cashuActions.reset(),
}

/**
 * The identity the app's cashu wallet is registered under. Its wrapper id and method are distinct from
 * the bolt11 and nip47 registrations because the aggregator's acceptance gate keeps exactly one
 * registration per method; `applicationId`/`operationKind` are the wallet host keys an app caller must
 * name when it opens a cashu leg.
 */
export const CASHU_WALLET_IDENTITY = {
	wrapperId: 'coco',
	method: 'cashu-melt',
	applicationId: 'market',
	operationKind: 'melt',
	storeKind: 'localStorage',
	ceiling: 1_000_000_000,
	contractVersion: '1.0.0',
} as const

/** The mint a leg is opened against when the app holds no explicit choice. */
export const preferredCashuMint = (): string | null => cashuStore.state.defaultMint

/** The invoice's own amount in sats, or null when it carries none (a NUT-11 amountless invoice). */
export const invoiceAmountSats = (paymentRequest: string): number | null => {
	const invoice = new Invoice({ pr: paymentRequest.trim().replace(/^lightning:/i, '') })
	return invoice.satoshi > 0 ? invoice.satoshi : null
}
