/**
 * The wallet's mint list has exactly one authority: coco.
 *
 * `src/lib/stores/cashu.ts` used to take its mint list from the relay-backed
 * NIP-60 wallet store's own projection and copy it into coco. That
 * made a relay event the authority for a fact coco already persists in its own
 * repository, and it left the coco store unable to outlive the relay store.
 * These tests pin the inversion:
 *
 *  - the store module names no relay-backed wallet module at all, and
 *  - `syncMints()` reads coco's repository, trusts what it finds there, and
 *    publishes that list as the store's projection — so nothing else can be
 *    mistaken for the wallet's mint list.
 *
 * The source check is deliberately shallow: it proves the *file* carries no
 * relay-wallet dependency, not that no future call site could add a second
 * mint list. The behaviour checks below are what pin the reading direction.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'
import type { Manager } from '@cashu/coco-core'

import { cashuActions, cashuStore } from '@/lib/stores/cashu'

const CASHU_STORE_SOURCE = join(import.meta.dir, '..', 'stores', 'cashu.ts')

type CocoMint = { mintUrl: string; name: string; mintInfo: Record<string, never>; trusted: boolean; createdAt: number; updatedAt: number }

const cocoMint = (mintUrl: string, trusted: boolean): CocoMint => ({
	mintUrl,
	name: '',
	mintInfo: {},
	trusted,
	createdAt: 0,
	updatedAt: 0,
})

/**
 * Install a fake `manager.mint` in the store. Only the mint repository is
 * modelled — that is the whole surface `syncMints` is allowed to read.
 */
function installMintRepository(repository: {
	getAllMints: () => Promise<CocoMint[]>
	trustMint?: (mintUrl: string) => Promise<void>
	addMint?: (mintUrl: string, options?: { trusted?: boolean }) => Promise<unknown>
}) {
	const trusted: string[] = []
	const added: string[] = []
	const manager = {
		mint: {
			trustMint: async (mintUrl: string) => {
				trusted.push(mintUrl)
			},
			addMint: async (mintUrl: string) => {
				added.push(mintUrl)
				return {}
			},
			...repository,
		},
	} as unknown as Manager

	cashuStore.setState((s) => ({ ...s, manager }))
	return { trusted, added }
}

afterEach(() => {
	cashuStore.setState((s) => ({ ...s, manager: null, mints: [], balances: {}, totalBalance: 0, error: null }))
})

describe('cashu store — the mint list is coco’s', () => {
	test('syncMints projects the mints coco holds and trusts every one of them', async () => {
		const { trusted } = installMintRepository({
			getAllMints: async () => [cocoMint('https://mint.one', true), cocoMint('https://mint.two', false)],
		})

		await cashuActions.syncMints()

		expect(cashuStore.state.mints).toEqual(['https://mint.one', 'https://mint.two'])
		// The wallet spends from every mint coco holds, so each is trusted; an
		// already-trusted mint is not re-trusted.
		expect(trusted).toEqual(['https://mint.two'])
	})

	test('syncMints reads coco and not a caller-supplied list', async () => {
		// The projection must come from the repository: a stale list left in
		// state is replaced by what coco actually holds.
		cashuStore.setState((s) => ({ ...s, mints: ['https://stale.example'] }))
		installMintRepository({ getAllMints: async () => [cocoMint('https://mint.live', true)] })

		await cashuActions.syncMints()

		expect(cashuStore.state.mints).toEqual(['https://mint.live'])
	})

	test('syncMints without an initialised wallet leaves the projection untouched', async () => {
		cashuStore.setState((s) => ({ ...s, mints: ['https://mint.kept'] }))

		await cashuActions.syncMints()

		expect(cashuStore.state.mints).toEqual(['https://mint.kept'])
	})

	test('a repository that cannot be read does not half-write the projection', async () => {
		cashuStore.setState((s) => ({ ...s, mints: ['https://mint.kept'] }))
		installMintRepository({
			getAllMints: async () => {
				throw new Error('indexeddb unavailable')
			},
		})

		await cashuActions.syncMints()

		expect(cashuStore.state.mints).toEqual(['https://mint.kept'])
	})

	test('addMint re-reads the list from coco rather than appending locally', async () => {
		const { added } = installMintRepository({
			getAllMints: async () => [cocoMint('https://mint.added', true)],
		})

		await cashuActions.addMint('https://mint.added')

		expect(added).toEqual(['https://mint.added'])
		expect(cashuStore.state.mints).toEqual(['https://mint.added'])
	})

	test('getMints returns the coco projection, not a second read of its own', () => {
		cashuStore.setState((s) => ({ ...s, mints: ['https://mint.projected'] }))

		expect(cashuActions.getMints()).toEqual(['https://mint.projected'])
	})

	test('the store module names no relay-backed wallet module', () => {
		const source = readFileSync(CASHU_STORE_SOURCE, 'utf8')

		expect(source).not.toMatch(/nip60/i)
		expect(source).not.toMatch(/@nostr-dev-kit/)
	})
})
