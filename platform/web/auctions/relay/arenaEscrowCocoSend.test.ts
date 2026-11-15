/**
 * `platform/web/auctions/relay/arenaEscrowCocoSend.test.ts` — the Coco send
 * adapter, exercised through the real `lockArenaEscrowWithCoco`.
 *
 * The point of these tests is that the mapping is the **only** thing between
 * the escrow module and the installed SDK: `lockArenaEscrowWithCoco` is driven
 * for real, against a fake `Manager` that records what Coco would have been
 * asked to do. If Coco's `ops.send.prepare({ mintUrl, amount, target })` shape
 * ever drifts, or the P2PK options stop travelling intact, this fails before a
 * bid is ever funded.
 */
import { describe, expect, test } from 'bun:test'
import type { Manager, PrepareSendInput } from '@cashu/coco-core'
import { OutputData, type Proof, type Token } from '@cashu/cashu-ts'
import { arenaWalletPubkey, buildArenaEscrowLockOptions } from './arenaBidFunding'
import { lockArenaEscrowWithCoco } from './arenaBidEscrow'
import { arenaEscrowSendOverCoco } from './arenaEscrowCocoSend'

const BIDDER = arenaWalletPubkey('11'.repeat(32))
const COMMITTEE = arenaWalletPubkey('22'.repeat(32))
const KEYSET = '009a1f293253e41e'
const MINT = 'https://mint.test/Bitcoin'
const LOCKTIME = 1_800_000_000

const denominations = (amount: number): number[] => {
	const out: number[] = []
	for (let bit = 1 << 30; bit >= 1; bit >>= 1) if (amount & bit) out.push(bit)
	return out
}

/** A Coco manager double: it records the prepare input and answers a token. */
function cocoDouble() {
	const adds: { mintUrl: string; options?: { trusted?: boolean } }[] = []
	const prepares: PrepareSendInput[] = []
	const executed: string[] = []
	const manager = {
		mint: {
			addMint: async (mintUrl: string, options?: { trusted?: boolean }) => {
				adds.push({ mintUrl, options })
				return { mint: {}, keysets: [] }
			},
		},
		ops: {
			send: {
				prepare: async (input: PrepareSendInput) => {
					prepares.push(input)
					return { id: 'send-op-1', state: 'prepared' }
				},
				execute: async (operationOrId: { id: string } | string) => {
					executed.push(typeof operationOrId === 'string' ? operationOrId : operationOrId.id)
					const input = prepares[prepares.length - 1]
					const options = input.target && 'options' in input.target ? input.target.options : null
					if (options === null || options === undefined || !('kind' in options) || options.kind !== 'P2PK') {
						throw new Error('the prepare carried no p2pk options')
					}
					const proofs = denominations(Number(input.amount)).map(
						(amount) =>
							({
								id: KEYSET,
								amount,
								secret: new TextDecoder().decode(OutputData.createSingleP2PKData(options, amount, KEYSET).secret),
								C: `02${'ab'.repeat(32)}`,
							}) as unknown as Proof,
					)
					return { operation: { id: 'send-op-1' }, token: { mint: MINT, proofs, unit: 'sat' } as Token }
				},
			},
		},
	}
	return { manager: manager as unknown as Manager, adds, prepares, executed }
}

describe('the escrow lock travels through Coco’s own send API', () => {
	test('addMint is trusted, prepare carries the p2pk target, execute takes the prepared id', async () => {
		const coco = cocoDouble()
		const proofs = await lockArenaEscrowWithCoco(arenaEscrowSendOverCoco(coco.manager), {
			mintUrl: MINT,
			amount: 1000,
			bidderWallet: BIDDER,
			committeeKey: COMMITTEE,
			locktime: LOCKTIME,
		})

		expect(coco.adds).toEqual([{ mintUrl: MINT, options: { trusted: true } }])
		expect(coco.prepares).toHaveLength(1)
		const prepare = coco.prepares[0]
		expect(prepare.mintUrl).toBe(MINT)
		expect(Number(prepare.amount)).toBe(1000)
		// The exact condition `arenaBidFunding` parses back out of the proofs.
		const expectedOptions = buildArenaEscrowLockOptions({ bidderWallet: BIDDER, committeeKey: COMMITTEE, locktime: LOCKTIME })
		expect(prepare.target).toEqual({ type: 'p2pk', options: { ...expectedOptions, kind: 'P2PK' } })
		expect(coco.executed).toEqual(['send-op-1'])

		expect(proofs.reduce((sum, proof) => sum + proof.amount, 0)).toBe(1000)
		expect(proofs.every((proof) => proof.id === KEYSET)).toBe(true)
		for (const proof of proofs) {
			const parsed = JSON.parse(proof.secret) as [string, { data: string; tags: string[][] }]
			expect(parsed[0]).toBe('P2PK')
			expect(parsed[1].data).toBe(BIDDER)
			expect(parsed[1].tags).toEqual([
				['locktime', String(LOCKTIME)],
				['pubkeys', COMMITTEE],
				['n_sigs', '2'],
				['refund', BIDDER],
				['sigflag', 'SIG_ALL'],
			])
		}
	})

	test('an amount the wallet cannot describe is refused before Coco is touched', async () => {
		const coco = cocoDouble()
		await expect(
			lockArenaEscrowWithCoco(arenaEscrowSendOverCoco(coco.manager), {
				mintUrl: MINT,
				amount: 0,
				bidderWallet: BIDDER,
				committeeKey: COMMITTEE,
				locktime: LOCKTIME,
			}),
		).rejects.toThrow('escrow amount must be a positive integer number of sats')
		expect(coco.prepares).toHaveLength(0)
		expect(coco.executed).toHaveLength(0)
	})
})