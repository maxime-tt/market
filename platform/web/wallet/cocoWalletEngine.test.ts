/**
 * platform/web/wallet/cocoWalletEngine.test.ts — the app's own lives, as the Coco wallet host reads them.
 *
 * `CocoWalletHost` is app-neutral, so the wallet UI's host is only as truthful as the engine source it is
 * composed with. This pins that source's reading direction: the manager is resolved from the app's store
 * PER CALL (a re-init or an account switch is followed, not frozen), the account is the same
 * `currentCashuAccount` read the cashu rail's registration uses, and the preferred mint is the store's own
 * choice. One declaration serves both composition points, so these are the values the panel's host and the
 * payments rail both see.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { Manager } from '@cashu/coco-core'
import { cashuStore } from '@platform/web/wallet/cashuStore'
import {
	CASHU_WALLET_ENVIRONMENT_ID,
	CASHU_WALLET_IDENTITY,
	cashuEngineSource,
	currentCashuAccount,
	preferredCashuMint,
} from './cocoWalletEngine'

const MINT = 'https://mint.one'
const OTHER_MINT = 'https://mint.two'

/** A manager is only ever read through the binding's declared engine surface; nothing else is needed. */
const fakeManager = (tag: string): Manager => ({ tag }) as unknown as Manager

afterEach(() => {
	cashuStore.setState((s) => ({ ...s, manager: null, status: 'idle', mints: [], balances: {}, totalBalance: 0, defaultMint: null }))
})

describe('cocoWalletEngine — the engine source', () => {
	test('the manager is resolved per call, so a re-init is followed rather than frozen', () => {
		const first = fakeManager('first')
		const second = fakeManager('second')

		cashuStore.setState((s) => ({ ...s, manager: first }))
		expect(cashuEngineSource.current()).toBe(first)

		cashuStore.setState((s) => ({ ...s, manager: second }))
		expect(cashuEngineSource.current()).toBe(second)
	})

	test('with no wallet the source answers null instead of throwing', () => {
		expect(cashuEngineSource.current()).toBeNull()
	})

	test('the account is the same read the app uses everywhere, under the wallet’s environment', () => {
		// The source must not carry a copy of the identity read: it hands the binding the app's own.
		expect(cashuEngineSource.identity).toBe(currentCashuAccount)

		// Before the auth machine is registered the read answers null rather than throwing.
		const account = cashuEngineSource.identity()
		expect(account).toEqual(currentCashuAccount())
		if (account) expect(account.environmentId).toBe(CASHU_WALLET_ENVIRONMENT_ID)
	})

	test('the preferred mint is the store’s own mint choice', () => {
		expect(preferredCashuMint()).toBeNull()

		cashuStore.setState((s) => ({ ...s, defaultMint: MINT }))
		expect(preferredCashuMint()).toBe(MINT)

		cashuStore.setState((s) => ({ ...s, defaultMint: OTHER_MINT }))
		expect(preferredCashuMint()).toBe(OTHER_MINT)
	})

	test('the engine closes the app’s own wallet, so the host and the store never own two wallets', async () => {
		const manager = fakeManager('live')
		const dispose = mock(async () => {})
		cashuStore.setState((s) => ({ ...s, manager: { ...manager, dispose } as unknown as Manager, status: 'ready' }))

		await cashuEngineSource.close()

		expect(dispose).toHaveBeenCalledTimes(1)
		expect(cashuStore.state.manager).toBeNull()
	})
})

describe('cocoWalletEngine — the wallet identity', () => {
	test('is the registration identity the payments rail composes under', () => {
		expect(CASHU_WALLET_IDENTITY).toEqual({
			wrapperId: 'coco',
			method: 'cashu-melt',
			applicationId: 'market',
			operationKind: 'melt',
			storeKind: 'localStorage',
			ceiling: 1_000_000_000,
			contractVersion: '1.0.0',
		})
	})
})
