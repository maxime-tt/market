/**
 * The mints a deposit form offers.
 *
 * When a deposit funds a bid, the mint must be one the auction accepts. Holding that mint in the
 * wallet is NOT a precondition: the deposit path registers and trusts it on demand
 * (`cashuActions.startDeposit`), and a fresh identity holds none by design. Intersecting the
 * auction's allowlist with the wallet's mints — the behaviour this helper replaces — filtered
 * every allowed-but-unheld mint out and left `Generate Invoice` disabled.
 */
import { describe, expect, test } from 'bun:test'

import { depositMintCandidates, normalizeDepositMintUrl } from './depositMints'

describe('depositMintCandidates', () => {
	test('offers an allowed mint the wallet does not hold', () => {
		const candidates = depositMintCandidates({
			walletMints: [],
			allowedMints: ['https://mint.playday.it'],
		})

		expect(candidates).toEqual(['https://mint.playday.it'])
	})

	test('offers every allowed mint, held or not, and drops wallet mints the auction excludes', () => {
		const candidates = depositMintCandidates({
			walletMints: ['https://mint.playday.it', 'https://mint.unrelated'],
			allowedMints: ['https://mint.playday.it', 'https://testnut.cashu.space'],
		})

		expect(candidates).toEqual(['https://mint.playday.it', 'https://testnut.cashu.space'])
	})

	test('without an auction allowlist the wallet’s own mints are offered', () => {
		const candidates = depositMintCandidates({
			walletMints: ['https://mint.one', 'https://mint.two'],
			allowedMints: [],
		})

		expect(candidates).toEqual(['https://mint.one', 'https://mint.two'])
	})

	test('normalizes trailing slashes and de-duplicates without reordering', () => {
		const candidates = depositMintCandidates({
			walletMints: [],
			allowedMints: ['https://mint.playday.it/', ' https://mint.playday.it ', 'https://mint.other/'],
		})

		expect(candidates).toEqual(['https://mint.playday.it', 'https://mint.other'])
	})

	test('drops entries that are not URLs', () => {
		const candidates = depositMintCandidates({
			walletMints: [],
			allowedMints: ['not a url', 'https://mint.playday.it'],
		})

		expect(candidates).toEqual(['https://mint.playday.it'])
	})
})

describe('normalizeDepositMintUrl', () => {
	test('normalizes a mint URL and refuses a non-URL', () => {
		expect(normalizeDepositMintUrl(' https://mint.playday.it/ ')).toBe('https://mint.playday.it')
		expect(normalizeDepositMintUrl('not a url')).toBeNull()
	})
})
