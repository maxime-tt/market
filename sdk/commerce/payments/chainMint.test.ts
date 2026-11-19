/**
 * Resolving the chain's mint — for the wallet's first mint AND for the escrow lock's target.
 *
 * The chain's committed `mint_url` can be a loopback URL a browser may not reach (the demo chain
 * commits `http://127.0.0.1:3338`), and the instance's configured origin (`INSTANCE_TRUSTED_MINTS`,
 * deployed as `https://mint.playday.it`) is the browser-reachable origin of the same mint. The
 * substitution is accepted only when that origin serves the chain's keyset, because the keyset —
 * not the URL — is what makes a mint “the chain's mint”: a token locked at a different keyset can
 * never be verified by the chain.
 *
 * Every case injects the keyset reader and the page origin, so nothing here touches a relay, a
 * mint or a browser (ADR-0005).
 */
import { describe, expect, test } from 'bun:test'

import { isBrowserReachableMintUrl, resolveChainMintFrom } from './chainMint'

const CHAIN_KEYSET = '0102b930f4dc2d6a8cb29b56e30d3e16436337859f54b77849ad1a1297be2880a1'
const OTHER_KEYSET = '0199aaaabbbbccccddddeeeeffff000011112222333344445555666677778888'
const DEMO_MINT = 'http://127.0.0.1:3338'
const LOCAL_ORIGIN = 'https://mint.playday.it'
/** A public page — the deployed instance's own origin shape. */
const PUBLIC_PAGE = 'https://market-e2e.playday.it'

function keysetsFrom(byMint: Record<string, readonly string[]>, unreadable: readonly string[] = []) {
	return async (mintUrl: string): Promise<readonly string[]> => {
		if (unreadable.includes(mintUrl)) return []
		return byMint[mintUrl] ?? []
	}
}

describe('the wallet’s first mint', () => {
	test('a loopback chain mint is reached through the configured browser origin', async () => {
		const result = await resolveChainMintFrom({
			terms: { mintUrl: DEMO_MINT, keysetId: CHAIN_KEYSET },
			configuredMints: [LOCAL_ORIGIN],
			pageOrigin: PUBLIC_PAGE,
			readKeysetIds: keysetsFrom({ [LOCAL_ORIGIN]: [CHAIN_KEYSET] }),
		})

		// The loopback URL is never a candidate from a public page: the configured origin stands in
		// for it, and only because it serves the chain's keyset.
		expect(result).toEqual({ ok: true, mintUrl: LOCAL_ORIGIN, keysetId: CHAIN_KEYSET })
	})

	test('a chain-reachable mint is used directly', async () => {
		const result = await resolveChainMintFrom({
			terms: { mintUrl: 'https://mint.example.org', keysetId: CHAIN_KEYSET },
			configuredMints: [LOCAL_ORIGIN],
			pageOrigin: PUBLIC_PAGE,
			readKeysetIds: keysetsFrom({ 'https://mint.example.org': [CHAIN_KEYSET] }),
		})

		expect(result).toEqual({ ok: true, mintUrl: 'https://mint.example.org', keysetId: CHAIN_KEYSET })
	})

	test('a local page uses the local chain mint directly', async () => {
		// A dev server on localhost with the local nutshell mint: both are local, so Local Network
		// Access does not block the mint and no configured substitute is needed.
		const result = await resolveChainMintFrom({
			terms: { mintUrl: DEMO_MINT, keysetId: CHAIN_KEYSET },
			configuredMints: [],
			pageOrigin: 'http://localhost:3333',
			readKeysetIds: keysetsFrom({ [DEMO_MINT]: [CHAIN_KEYSET] }),
		})

		expect(result).toEqual({ ok: true, mintUrl: DEMO_MINT, keysetId: CHAIN_KEYSET })
	})
})

describe('the escrow lock’s target', () => {
	test('locks at the browser-reachable origin of the chain’s keyset, not the loopback URL', async () => {
		// The escrow resolves the terms the funding path already read. `http://127.0.0.1:3338`
		// cannot be trusted by coco from a public page (`addMint` fails, so coco refuses the send),
		// so the lock must target the configured origin — the same resolution the wallet uses.
		const result = await resolveChainMintFrom({
			terms: { mintUrl: DEMO_MINT, keysetId: CHAIN_KEYSET },
			configuredMints: [LOCAL_ORIGIN],
			pageOrigin: PUBLIC_PAGE,
			readKeysetIds: keysetsFrom({ [LOCAL_ORIGIN]: [CHAIN_KEYSET] }),
		})

		expect(result.ok).toBe(true)
		if (!result.ok) throw new Error('unreachable')
		expect(result.mintUrl).toBe(LOCAL_ORIGIN)
		expect(result.mintUrl).not.toBe(DEMO_MINT)
	})

	test('a candidate serving a different keyset is refused by name, so no lock happens there', async () => {
		const result = await resolveChainMintFrom({
			terms: { mintUrl: DEMO_MINT, keysetId: CHAIN_KEYSET },
			configuredMints: [LOCAL_ORIGIN],
			pageOrigin: PUBLIC_PAGE,
			readKeysetIds: keysetsFrom({ [LOCAL_ORIGIN]: [OTHER_KEYSET] }),
		})

		expect(result.ok).toBe(false)
		if (result.ok) throw new Error('unreachable')
		expect(result.refusal).toBe('chain.mint.keyset-mismatch')
		expect(result.message).toContain(CHAIN_KEYSET)
		expect(result.message).toContain(OTHER_KEYSET)
	})

	test('a loopback chain mint from a public page with nothing configured refuses the origin gap', async () => {
		const result = await resolveChainMintFrom({
			terms: { mintUrl: DEMO_MINT, keysetId: CHAIN_KEYSET },
			configuredMints: [],
			pageOrigin: PUBLIC_PAGE,
			readKeysetIds: keysetsFrom({}),
		})

		expect(result.ok).toBe(false)
		if (result.ok) throw new Error('unreachable')
		expect(result.refusal).toBe('chain.mint.no-reachable-origin')
	})

	test('an unreadable candidate is distinguished from a mismatched one', async () => {
		const result = await resolveChainMintFrom({
			terms: { mintUrl: DEMO_MINT, keysetId: CHAIN_KEYSET },
			configuredMints: [LOCAL_ORIGIN],
			pageOrigin: PUBLIC_PAGE,
			readKeysetIds: keysetsFrom({}, [LOCAL_ORIGIN]),
		})

		expect(result.ok).toBe(false)
		if (result.ok) throw new Error('unreachable')
		expect(result.refusal).toBe('chain.mint.keyset-unverifiable')
	})
})

describe('the degraded and missing cases', () => {
	test('terms without a keyset id cannot establish the mint', async () => {
		const result = await resolveChainMintFrom({
			terms: { mintUrl: LOCAL_ORIGIN, keysetId: null },
			configuredMints: [LOCAL_ORIGIN],
			pageOrigin: PUBLIC_PAGE,
			readKeysetIds: keysetsFrom({ [LOCAL_ORIGIN]: [CHAIN_KEYSET] }),
		})

		expect(result.ok).toBe(false)
		if (result.ok) throw new Error('unreachable')
		expect(result.refusal).toBe('chain.mint.params-incomplete')
	})

	test('no reading and no configured mint refuses instead of guessing', async () => {
		const result = await resolveChainMintFrom({
			terms: null,
			configuredMints: [],
			pageOrigin: PUBLIC_PAGE,
			readKeysetIds: keysetsFrom({}),
		})

		expect(result.ok).toBe(false)
		if (result.ok) throw new Error('unreachable')
		expect(result.refusal).toBe('chain.mint.nothing-configured')
	})

	test('an unreadable relay falls back to the configured mint, and says so', async () => {
		const result = await resolveChainMintFrom({
			terms: null,
			configuredMints: [LOCAL_ORIGIN],
			pageOrigin: PUBLIC_PAGE,
			readKeysetIds: keysetsFrom({ [LOCAL_ORIGIN]: [CHAIN_KEYSET] }),
		})

		expect(result.ok).toBe(true)
		if (!result.ok) throw new Error('unreachable')
		expect(result.mintUrl).toBe(LOCAL_ORIGIN)
		// The mint landed, but the missing chain verification is recorded rather than silent.
		expect(result.notice?.startsWith('chain.mint.params-unavailable:')).toBe(true)
	})
})

describe('isBrowserReachableMintUrl', () => {
	test.each([
		[DEMO_MINT, PUBLIC_PAGE, false],
		[DEMO_MINT, 'http://localhost:3333', true],
		[DEMO_MINT, undefined, false],
		['http://localhost:3338', PUBLIC_PAGE, false],
		['http://192.168.1.20:3338', PUBLIC_PAGE, false],
		['http://192.168.1.20:3338', 'http://192.168.1.5:3333', true],
		['http://10.0.0.5:3338', PUBLIC_PAGE, false],
		['http://172.16.4.4:3338', PUBLIC_PAGE, false],
		['https://mint.playday.it', PUBLIC_PAGE, true],
		['https://mint.example.org/path', PUBLIC_PAGE, true],
		['not a url', PUBLIC_PAGE, false],
		['ftp://mint.example.org', PUBLIC_PAGE, false],
	])('%s from %s → %s', (mintUrl, pageOrigin, reachable) => {
		expect(isBrowserReachableMintUrl(mintUrl, pageOrigin)).toBe(reachable)
	})
})
