/**
 * NUT-07 witness-keeping reads — unit tests.
 *
 * A fake `mintClient` stands in for the mint so the shapes the two parsers produce can be compared
 * directly, including the back-compat proof that the state-only reader discards the witness the
 * details reader keeps.
 */

import { describe, expect, test } from 'bun:test'
import type { CashuMint } from '@cashu/cashu-ts'
import { checkProofStateBatch, checkProofStateDetails, checkProofStateDetailsBatch } from '@/lib/cashu/nut7'

const MINT_URL = 'https://mint.test'

const Y_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const Y_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const WITNESS_A = JSON.stringify({ signatures: ['c0ffee'.repeat(21)] })

const SECRET_A = JSON.stringify(['P2PK', { nonce: 'a', data: '11'.repeat(32), tags: [['locktime', '1790000600']] }])
const SECRET_B = JSON.stringify(['P2PK', { nonce: 'b', data: '22'.repeat(32), tags: [['refund', '33'.repeat(32)]] }])

const fakeMint = (check: (body: { Ys: string[] }) => Promise<unknown>): CashuMint => ({ check }) as unknown as CashuMint

/** Mint that answers for Y_A with a witness and deliberately omits Y_B. */
const partialMint = (): CashuMint =>
	fakeMint(async ({ Ys }) => ({
		states: Ys.filter((y) => y === Y_A).map((Y) => ({ Y, state: 'SPENT', witness: WITNESS_A })),
	}))

describe('nut7SpendDetails', () => {
	test('the witness the mint returns is kept in the observation', async () => {
		const details = await checkProofStateDetailsBatch(MINT_URL, [Y_A], { mintClient: partialMint() })
		const observation = details.get(Y_A)
		expect(observation).toBeDefined()
		expect(observation?.state).toBe('spent')
		expect(observation?.witness).toBe(WITNESS_A)
	})

	test('a caller-supplied secretsByY secret is attached to that Y, matched case-insensitively', async () => {
		const secretsByY = new Map<string, string>([
			[Y_A.toUpperCase(), SECRET_A],
			[Y_B, SECRET_B],
		])
		const details = await checkProofStateDetailsBatch(MINT_URL, [Y_A], { mintClient: partialMint(), secretsByY })
		expect(details.get(Y_A)?.secret).toBe(SECRET_A)
		// nothing invented for a Y the caller did not provide a secret for
		expect('secret' in (details.get(Y_B) ?? {})).toBe(false)
	})

	test('a second Y the mint omits comes back state missing with its secret still attached', async () => {
		const secretsByY = new Map<string, string>([
			[Y_A, SECRET_A],
			[Y_B, SECRET_B],
		])
		const details = await checkProofStateDetailsBatch(MINT_URL, [Y_A, Y_B], { mintClient: partialMint(), secretsByY })
		expect(details.size).toBe(2)
		expect(details.get(Y_A)?.state).toBe('spent')
		expect(details.get(Y_B)?.state).toBe('missing')
		expect(details.get(Y_B)?.secret).toBe(SECRET_B)
	})

	test('check({Ys}) throwing leaves the Ys at unknown and never rejects', async () => {
		const failingMint = fakeMint(async () => {
			throw new Error('mint exploded')
		})
		const secretsByY = new Map<string, string>([[Y_A, SECRET_A]])

		const details = await checkProofStateDetailsBatch(MINT_URL, [Y_A, Y_B], { mintClient: failingMint, secretsByY })
		expect(details.get(Y_A)?.state).toBe('unknown')
		expect(details.get(Y_B)?.state).toBe('unknown')
		// the secret survives so a retry can still be attributed
		expect(details.get(Y_A)?.secret).toBe(SECRET_A)

		// the single-proof helper is equally non-throwing
		const single = await checkProofStateDetails(MINT_URL, Y_A, { mintClient: failingMint })
		expect(single.state).toBe('unknown')
	})

	test('the state-only checkProofStateBatch returns exactly the same states and never witness data', async () => {
		const secretsByY = new Map<string, string>([
			[Y_A, SECRET_A],
			[Y_B, SECRET_B],
		])
		const options = { mintClient: partialMint(), secretsByY }

		const states = await checkProofStateBatch(MINT_URL, [Y_A, Y_B], options)
		const details = await checkProofStateDetailsBatch(MINT_URL, [Y_A, Y_B], options)

		expect([...states.keys()].sort()).toEqual([...details.keys()].sort())
		expect(states.size).toBe(details.size)
		for (const [y, observation] of details) {
			expect(states.get(y)).toBe(observation.state)
		}
		// state-only values are bare strings: no witness (or secret) travels with them
		for (const value of states.values()) {
			expect(typeof value).toBe('string')
		}
		expect(details.get(Y_A)?.witness).toBe(WITNESS_A)
	})

	test('the single-proof checkProofStateDetails equals the batch entry for the same Y', async () => {
		const secretsByY = new Map<string, string>([[Y_A, SECRET_A]])
		const options = { mintClient: partialMint(), secretsByY }

		const single = await checkProofStateDetails(MINT_URL, Y_A, options)
		const batch = await checkProofStateDetailsBatch(MINT_URL, [Y_A], options)

		expect(single).toEqual(batch.get(Y_A))
		expect(single.witness).toBe(WITNESS_A)
		expect(single.secret).toBe(SECRET_A)
	})
})
