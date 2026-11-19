import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MemoryRepositories, initializeCoco, type Manager } from '@cashu/coco-core'

import { createCocoDepositQuote, toCocoDepositManager } from '@sdk/commerce/payments/wallet/depositQuote'
import { createCashuMintQuoteClient } from '@sdk/commerce/payments/wallet/depositMintQuoteClient'

/**
 * I4 — the deposit lifecycle against a real local mint.
 *
 * The unit suite pins what each mint-quote state *means* for a deposit, driven by a fake coco.
 * This suite is the other half: a real nutshell mint (FakeWallet backend, which settles
 * instantly) + a real coco over in-memory repositories, so the paid → issued transition is the
 * mint's own answer rather than an assumption. What it proves end to end is the property the
 * deposit UI depends on: the payment is noticed without anything nudging the wallet by hand,
 * the proofs are minted, and they are spendable afterwards.
 *
 * This is also the regression this suite exists for: a FakeWallet mint settles the invoice in
 * the same second the quote was created, so the quote's `updated_at` never advances and the
 * wallet's own observation of the payment is rejected as a conflicting accounting. A deposit
 * that only waited for the wallet would sit paid-but-unredeemed forever
 * (`awaiting_confirmation_retry` with a zero balance) — this suite failed exactly that way
 * before the deposit started reading the mint itself.
 *
 * The mint is spawned and torn down here, on its own port, so the suite neither needs nor
 * disturbs anything already listening on the e2e default (3338).
 *
 * Run via: `bun run test:integration`.
 */

const MINT_PORT = 3358
const MINT_URL = `http://127.0.0.1:${MINT_PORT}`
const DEPOSIT_AMOUNT = 21

const PROJECT_ROOT = path.resolve(import.meta.dir, '../../../..')
const MINT_DIR = mkdtempSync(path.join(tmpdir(), 'cashu-mint-deposit-'))
const MINT_LOG = path.join(MINT_DIR, 'mint.log')

let mintProc: ChildProcess | undefined
let manager: Manager | undefined

/** Wait for `/v1/info`, failing fast if the spawned mint exits (e.g. the port is taken). */
const waitForMint = async (timeoutMs = 90_000): Promise<void> => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (mintProc?.exitCode !== null && mintProc?.exitCode !== undefined) {
			throw new Error(`local mint exited early with code ${mintProc.exitCode} — see ${MINT_LOG}`)
		}
		try {
			const res = await fetch(`${MINT_URL}/v1/info`)
			if (res.ok) return
		} catch {
			// not up yet
		}
		await Bun.sleep(250)
	}
	const logTail = readFileSync(MINT_LOG, 'utf8').split('\n').slice(-20).join('\n')
	throw new Error(`local mint at ${MINT_URL} did not become ready within ${timeoutMs}ms\n${logTail}`)
}

beforeAll(async () => {
	const mintLogFd = openSync(MINT_LOG, 'w')
	mintProc = spawn('bash', ['e2e/start-local-mint.sh'], {
		cwd: PROJECT_ROOT,
		env: { ...process.env, CASHU_MINT_DIR: MINT_DIR, CASHU_MINT_PORT: String(MINT_PORT) },
		detached: true,
		stdio: ['ignore', mintLogFd, mintLogFd],
	})
	closeSync(mintLogFd)

	await waitForMint()

	// In-memory repositories: the deposit path must not need IndexedDB to be correct.
	// A silent logger keeps coco's debug dumps of output data out of the test output — the
	// assertions below are what this suite is for.
	const silentLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }
	manager = await initializeCoco({
		repo: new MemoryRepositories(),
		seedGetter: async () => new Uint8Array(64).fill(1),
		logger: silentLogger,
		watchers: {
			mintOperationWatcher: { watchExistingPendingOnStart: false },
			proofStateWatcher: {},
		},
		processors: { mintOperationProcessor: { processIntervalMs: 200 } },
	})
	await manager.mint.addMint(MINT_URL, { trusted: true })
}, 120_000)

afterAll(async () => {
	if (mintProc?.pid) {
		try {
			process.kill(-mintProc.pid, 'SIGTERM')
		} catch {
			/* already gone */
		}
		await Bun.sleep(300)
		try {
			process.kill(-mintProc.pid, 'SIGKILL')
		} catch {
			/* already gone */
		}
	}
	rmSync(MINT_DIR, { recursive: true, force: true })
})

describe('a real deposit over a real mint', () => {
	test('settles on its own once the mint reports the quote paid', async () => {
		if (!manager) throw new Error('coco manager not initialised')

		// The deposit engine settles on a mint-quote state channel; the wallet side comes from
		// coco, the mint side from the deposit's own client (`./depositMintQuoteClient`).
		const deposit = createCocoDepositQuote({
			manager: toCocoDepositManager(manager, createCashuMintQuoteClient()),
			mintUrl: MINT_URL,
			amount: DEPOSIT_AMOUNT,
		})

		// The app's confirmation window is exactly this: the deposit's own outcome listeners, with
		// no manual check. Nothing below nudges the wallet.
		const settlement = Promise.withResolvers<void>()
		deposit.on('success', () => settlement.resolve())
		deposit.on('error', (error) =>
			settlement.reject(error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'deposit failed')),
		)
		const states: string[] = []
		deposit.on('state', (state) => states.push(state))

		try {
			const invoice = await deposit.start()

			// A real BOLT11 from the mint, not a fixture.
			expect(typeof invoice).toBe('string')
			expect(invoice?.startsWith('lnbc')).toBe(true)
			expect(deposit.quoteId).toBeTruthy()

			// Before settlement the wallet holds nothing at this mint.
			const before = await manager.wallet.balances.byMint()
			expect(before[MINT_URL]?.spendable.toNumber() ?? 0).toBe(0)

			await settlement.promise

			// The deposit's definition of success: the proofs exist and are spendable. The wallet
			// minted them itself, from the paid observation the deposit handed it.
			const after = await manager.wallet.balances.byMint()
			expect(after[MINT_URL]?.spendable.toNumber()).toBe(DEPOSIT_AMOUNT)

			// The payment was observed as paid before it was reported issued — a deposit that
			// jumps straight to issued would not have read the mint at all.
			expect(states).toContain('UNPAID')
			expect(states[states.length - 1]).toBe('ISSUED')
		} finally {
			deposit.dispose()
		}
	}, 90_000)
})
