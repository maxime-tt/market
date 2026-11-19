/**
 * The dev test-mint button, at the wire.
 *
 * `walletOps.mintTestEcash` mints outside coco: it creates the BOLT11 quote on a cashu-ts `Mint`,
 * redeems it through the wallet's `mintProofsBolt11`, then hands the proofs to the store, whose
 * write path is coco's own proof repository. Two things were wrong on that path and both only
 * showed up one step after the wire:
 *
 *  - the quote request must carry the unit the mint requires (the mint refuses a unit-less quote);
 *  - cashu-ts v5 proofs carry neither `unit` nor `state`, and coco's proof store rejects a
 *    unit-less proof outright ("Unit is required") and never counts a proof that is not `ready`.
 *
 * These tests pin the first on the captured request body and the second on the proofs handed to
 * the store. `loadMint` and `mintProofsBolt11` are stubbed so the run stays offline (ADR-0005);
 * the quote request itself is built by the real cashu-ts client against a stubbed `fetch`, so the
 * body and the mint's own refusal are exercised verbatim.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Amount, Wallet, type Proof } from '@cashu/cashu-ts'

import { cashuActions, cashuStore } from '@platform/web/wallet/cashuStore'
import { walletOps } from '@platform/web/wallet/walletOps'

const MINT = 'http://127.0.0.1:3338'
const KEYSET_ID = '0102b930f4dc2d6a8cb29b56e30d3e16436337859f54b77849ad1a1297be2880a1'

const proof = (secret: string, amount: number): Proof => ({
	id: KEYSET_ID,
	amount: Amount.from(amount),
	secret,
	C: `02${'a'.repeat(64)}`,
})

/**
 * A test seam onto the library's `Wallet.prototype`: the stub signatures are narrower than the
 * real ones (skipping the keyset fetch, returning a canned proof), so the prototype is viewed
 * through this named, documented type rather than inline-cast at each assignment.
 */
const walletProtoSeam = Wallet.prototype as unknown as {
	loadMint: () => Promise<void>
	mintProofsBolt11: () => Promise<Proof[]>
}

interface CapturedRequest {
	url: string
	body: unknown
}

let quoteRequests: CapturedRequest[]
let mintShouldRefuse: boolean
let updateCalls: Array<{ store: Proof[]; mint: string }>
let originalLoadMint: typeof Wallet.prototype.loadMint | undefined
let originalMintProofsBolt11: typeof Wallet.prototype.mintProofsBolt11 | undefined
let originalFetch: typeof globalThis.fetch | undefined
let originalAddMint: typeof cashuActions.addMint | undefined
let originalRefresh: typeof walletOps.refresh | undefined

beforeEach(() => {
	quoteRequests = []
	mintShouldRefuse = false
	updateCalls = []
	process.env.APP_NIP60_DEV_MODE = 'true'

	originalLoadMint = Wallet.prototype.loadMint
	originalMintProofsBolt11 = Wallet.prototype.mintProofsBolt11
	originalFetch = globalThis.fetch
	originalAddMint = cashuActions.addMint
	originalRefresh = walletOps.refresh

	// The keyset metadata is not what these tests are about; skip the fetch it would need.
	walletProtoSeam.loadMint = async (): Promise<void> => {}
	// The redeem leg is exercised live elsewhere; hand back a canned proof so the focus stays on
	// the request the app builds and the proofs it stores.
	walletProtoSeam.mintProofsBolt11 = async (): Promise<Proof[]> => [proof('minted', 100)]

	// The only network the client is allowed here is the quote request, answered from a stub.
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input)
		const body = init?.body ? JSON.parse(String(init.body)) : undefined
		if (url.endsWith('/v1/mint/quote/bolt11')) {
			quoteRequests.push({ url, body })
			if (mintShouldRefuse) {
				return new Response(JSON.stringify({ detail: "unit 'usd' not supported in any keyset.", code: 12000 }), {
					status: 400,
					headers: { 'content-type': 'application/json' },
				})
			}
			return new Response(
				JSON.stringify({
					quote: 'quote-1',
					request: 'lnbc1stub',
					amount: 100,
					unit: 'sat',
					method: 'bolt11',
					amount_paid: 0,
					amount_issued: 0,
					updated_at: 0,
					state: 'PAID',
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			)
		}
		throw new Error(`unexpected fetch in test: ${url}`)
	}) as typeof globalThis.fetch

	// The mint list and the balance projection are not under test; `mints: []` makes the helper
	// register the mint, and the coco write is replaced so no manager is needed.
	cashuStore.setState((s) => ({
		...s,
		status: 'ready',
		defaultMint: MINT,
		mints: [MINT],
		walletSource: {
			mints: [MINT],
			state: {
				update: async (update: { store: Proof[]; mint: string }) => {
					updateCalls.push(update)
				},
			},
		} as never,
	}))
	cashuActions.addMint = async (): Promise<void> => {}
	walletOps.refresh = async (): Promise<void> => {}
})

afterEach(() => {
	if (originalLoadMint) Wallet.prototype.loadMint = originalLoadMint
	if (originalMintProofsBolt11) Wallet.prototype.mintProofsBolt11 = originalMintProofsBolt11
	if (originalFetch) globalThis.fetch = originalFetch
	if (originalAddMint) cashuActions.addMint = originalAddMint
	if (originalRefresh) walletOps.refresh = originalRefresh
	delete process.env.APP_NIP60_DEV_MODE
})

describe('walletOps.mintTestEcash', () => {
	test('the mint-quote request carries the mint\'s unit, and the minted proofs reach the store with that unit and a ready state', async () => {
		const result = await walletOps.mintTestEcash(100, MINT, { allowFallback: false })

		expect(result.mintUrl).toBe(MINT)
		expect(result.amount).toBe(100)
		expect(result.proofsMinted).toBe(1)

		// The request the app builds: the mint refuses a quote without `unit`.
		expect(quoteRequests).toHaveLength(1)
		expect(quoteRequests[0]?.body).toEqual({ amount: 100, unit: 'sat' })

		// cashu-ts proofs carry no unit/state; the store's write path (coco) needs both.
		expect(updateCalls).toHaveLength(1)
		expect(updateCalls[0]?.mint).toBe(MINT)
		expect(updateCalls[0]?.store).toHaveLength(1)
		expect(updateCalls[0]?.store[0]).toMatchObject({ secret: 'minted', unit: 'sat', state: 'ready' })
	})

	test('a refused quote reports the mint\'s own error verbatim', async () => {
		mintShouldRefuse = true

		await expect(walletOps.mintTestEcash(100, MINT, { allowFallback: false })).rejects.toThrow(
			`${MINT}: unit 'usd' not supported in any keyset.`,
		)
		expect(updateCalls).toHaveLength(0)
	})
})
