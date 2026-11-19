/**
 * Seeding a fresh identity's first mint.
 *
 * The wallet's mint list has one writer (`syncMints`, reading coco) and nothing used to seed it:
 * coco starts empty and ADR-0010 dropped the kind-17375 mint list, so a new identity genuinely
 * held no mint — the deposit form offered nothing and `Generate Invoice` could never be enabled.
 *
 * `seedMintsIfEmpty` closes that gap, and the mint it registers is decided by the injected
 * resolver, never by this module. These tests pin the store's half of that contract:
 *
 * - a fresh identity gets the configured mint, trusted, and the projection is re-read from coco;
 * - a refusal registers nothing and is recorded by name (a mint that is not the chain's must
 *   never be seeded — deposited funds would be locked to the wrong escrow);
 * - a wallet that already holds a mint is not seeded, and a resolver that fails is flagged
 *   rather than allowed to break initialization.
 *
 * The manager is an in-memory fake, so nothing here touches a relay or a mint (ADR-0005).
 */
import { describe, expect, test } from 'bun:test'
import type { Manager } from '@cashu/coco-core'

import type { ChainMintResolver } from '@sdk/commerce/payments/chainMint'
import { createCashuStore } from '@sdk/commerce/payments/state/cashu'

const CHAIN_KEYSET = '0102b930f4dc2d6a8cb29b56e30d3e16436337859f54b77849ad1a1297be2880a1'
const CONFIGURED_MINT = 'https://mint.playday.it'

interface HeldMint {
	mintUrl: string
	trusted: boolean
}

/**
 * A wallet store whose coco holds exactly `held`, with an optional seed resolver.
 *
 * Only the mint repository is modelled: it is the whole surface `seedMintsIfEmpty` and
 * `syncMints` are allowed to touch.
 */
function installWallet(options: { held?: HeldMint[]; resolveMintSeed?: ChainMintResolver } = {}) {
	const held = (options.held ?? []).map((mint) => ({ ...mint }))
	const added: Array<{ mintUrl: string; trusted: boolean }> = []
	const trusted: string[] = []

	const { cashuState, cashuActions } = createCashuStore(
		() => 'a'.repeat(64),
		options.resolveMintSeed ? { resolveMintSeed: options.resolveMintSeed } : {},
	)

	const manager = {
		mint: {
			getAllMints: async () =>
				held.map((mint) => ({
					mintUrl: mint.mintUrl,
					name: '',
					mintInfo: {},
					trusted: mint.trusted,
					createdAt: 0,
					updatedAt: 0,
				})),
			addMint: async (mintUrl: string, addOptions?: { trusted?: boolean }) => {
				added.push({ mintUrl, trusted: Boolean(addOptions?.trusted) })
				held.push({ mintUrl, trusted: Boolean(addOptions?.trusted) })
				return {}
			},
			trustMint: async (mintUrl: string) => {
				trusted.push(mintUrl)
				const mint = held.find((candidate) => candidate.mintUrl === mintUrl)
				if (mint) mint.trusted = true
			},
		},
	} as unknown as Manager

	cashuState.set((state) => ({ ...state, manager }))
	return { cashuState, cashuActions, added, trusted }
}

describe('seedMintsIfEmpty — a fresh identity gets the chain’s mint', () => {
	test('registers the resolved mint, trusted, and projects it from coco', async () => {
		let resolutions = 0
		const { cashuState, cashuActions, added } = installWallet({
			resolveMintSeed: async () => {
				resolutions += 1
				return { ok: true, mintUrl: CONFIGURED_MINT, keysetId: CHAIN_KEYSET }
			},
		})

		await cashuActions.seedMintsIfEmpty()

		expect(resolutions).toBe(1)
		// The seed is registered through coco, trusted, and the store's list is re-read from
		// coco afterwards — `setMints` still has exactly one caller.
		expect(added).toEqual([{ mintUrl: CONFIGURED_MINT, trusted: true }])
		expect(cashuState.get().mints).toEqual([CONFIGURED_MINT])
		expect(cashuState.get().mintSeedError).toBeNull()
	})

	test('a wallet that already holds a mint is never seeded', async () => {
		let resolutions = 0
		const { cashuActions, added } = installWallet({
			held: [{ mintUrl: 'https://mint.held', trusted: true }],
			resolveMintSeed: async () => {
				resolutions += 1
				return { ok: true, mintUrl: CONFIGURED_MINT, keysetId: CHAIN_KEYSET }
			},
		})

		// The real order from `initialize`: the projection is read from coco, then seeding runs.
		await cashuActions.syncMints()
		await cashuActions.seedMintsIfEmpty()

		expect(resolutions).toBe(0)
		expect(added).toEqual([])
	})

	test('a qualified seed still registers the mint and records the notice', async () => {
		const notice = 'chain.mint.params-unavailable: no anchored chain terms were readable'
		const { cashuState, cashuActions, added } = installWallet({
			resolveMintSeed: async () => ({ ok: true, mintUrl: CONFIGURED_MINT, keysetId: CHAIN_KEYSET, notice }),
		})

		await cashuActions.seedMintsIfEmpty()

		expect(added).toEqual([{ mintUrl: CONFIGURED_MINT, trusted: true }])
		expect(cashuState.get().mints).toEqual([CONFIGURED_MINT])
		expect(cashuState.get().mintSeedError).toBe(notice)
	})
})

describe('seedMintsIfEmpty — a refusal is named and registers nothing', () => {
	test('a chain keyset mismatch is refused by name', async () => {
		const { cashuState, cashuActions, added } = installWallet({
			resolveMintSeed: async () => ({
				ok: false,
				refusal: 'chain.mint.keyset-mismatch',
				message: 'the candidate serves [0199aaaa] but the chain anchored 0102b930',
			}),
		})

		await cashuActions.seedMintsIfEmpty()

		// No mint is registered: depositing into a mint that is not the chain's would lock the
		// funds to an escrow the chain never configured.
		expect(added).toEqual([])
		expect(cashuState.get().mints).toEqual([])
		expect(cashuState.get().mintSeedError?.startsWith('chain.mint.keyset-mismatch:')).toBe(true)
	})

	test('a resolver that throws is flagged, not thrown at initialization', async () => {
		const { cashuState, cashuActions, added } = installWallet({
			resolveMintSeed: async () => {
				throw new Error('relay unavailable')
			},
		})

		await cashuActions.seedMintsIfEmpty()

		expect(added).toEqual([])
		expect(cashuState.get().mintSeedError?.startsWith('chain.mint.resolution-failed:')).toBe(true)
	})

	test('without a manager nothing is resolved or registered', async () => {
		let resolutions = 0
		const { cashuState, cashuActions } = createCashuStore(() => 'a'.repeat(64), {
			resolveMintSeed: async () => {
				resolutions += 1
				return { ok: true, mintUrl: CONFIGURED_MINT, keysetId: CHAIN_KEYSET }
			},
		})

		await cashuActions.seedMintsIfEmpty()

		expect(resolutions).toBe(0)
		expect(cashuState.get().mints).toEqual([])
		expect(cashuState.get().mintSeedError).toBeNull()
	})
})
