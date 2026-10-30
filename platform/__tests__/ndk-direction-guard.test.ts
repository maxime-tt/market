/**
 * Tests for the NDK DIRECTION guard (`scripts/check-ndk-direction.sh`).
 *
 * The guard resolves ROOT from its own location, so each test stages a throwaway
 * "repo" (scripts/ + the three tracked text files + the measured trees) in a temp
 * dir, copies the real script in, and invokes it via bash — then asserts on exit
 * code and stdout. One test runs the real script against the real repo so the
 * committed baseline/allowlist/ledger are covered.
 *
 * Every fail path the A4 plan promises is probed here: sdk rise, platform growth
 * without a ledger row, a declared bridge passing while the TOTAL rises, a dangling
 * ledger row, a bad sdk-target (file and directory), a target that still imports
 * the transport, a bridge that does not import its declared capability, an
 * allowlisted file that actually imports NDK, the `complete=yes` end-state switch,
 * a missing tree, and the `.ts`/`.tsx` scan filter.
 *
 * NOTE: this file must never contain the NDK package literal unbroken — it lives
 * under platform/, which the guard scans, and would count as an undeclared mention.
 */
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

const ROOT = join(import.meta.dir, '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'check-ndk-direction.sh')

const NDK_PACKAGE = '@nostr-dev' + '-kit/ndk'
const NDK_IMPORT = `import { NDK } from '${NDK_PACKAGE}'\n`
const NDK_COMMENT = `// migrated away from ${NDK_PACKAGE}\n`

type StageOptions = {
	baseline: string
	allowlist?: string
	ledger?: string
	files?: Record<string, string>
	omitDirs?: string[]
}

const DEFAULT_TREES = ['src', 'sdk', 'platform/web', 'platform/server', 'contextvm']

function baselineRows(rows: string[], complete: 'yes' | 'no' = 'no'): string {
	return [`complete=${complete}`, ...rows, ''].join('\n')
}

const roots: string[] = []

async function stageRepo(o: StageOptions): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'ndk-direction-guard-'))
	roots.push(root)
	await mkdir(join(root, 'scripts'), { recursive: true })
	await copyFile(SCRIPT, join(root, 'scripts', 'check-ndk-direction.sh'))
	await writeFile(join(root, 'scripts', 'ndk-direction-baseline.txt'), o.baseline)
	await writeFile(join(root, 'scripts', 'ndk-mention-allowlist.txt'), o.allowlist ?? '')
	await writeFile(join(root, 'scripts', 'ndk-bridge-ledger.txt'), o.ledger ?? '')
	for (const dir of DEFAULT_TREES) {
		if ((o.omitDirs ?? []).includes(dir)) continue
		await mkdir(join(root, dir), { recursive: true })
	}
	for (const [rel, content] of Object.entries(o.files ?? {})) {
		const abs = join(root, rel)
		await mkdir(dirname(abs), { recursive: true })
		await writeFile(abs, content)
	}
	return root
}

function runGuard(root: string): { exitCode: number; stdout: string; stderr: string } {
	const r = spawnSync('bash', [join(root, 'scripts', 'check-ndk-direction.sh')], {
		cwd: root,
		encoding: 'utf8',
	})
	return { exitCode: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('NDK direction guard (scripts/check-ndk-direction.sh)', () => {
	afterEach(async () => {
		while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
	})

	test('exits 0 against the real repo and reports M8/M9/M10', () => {
		const r = runGuard(ROOT)
		expect(r.stderr).toBe('')
		expect(r.exitCode).toBe(0)
		// M8: no effective (un-allowlisted) sdk production mention.
		expect(r.stdout).toContain('M8 sdk-production-effective=0 (raw 2)')
		// M9: the undeclared platform-bridge count is a RATCHET from the 48-file seed, like the src row
		// below: declaring a bridge is sanctioned declare-as-you-touch (the ledger's own rule — I-c's
		// `platform/web/notifications/monitor.ts` is the first declared row), and the TOTAL may rise with a
		// declared bridge (red-team F1). A3.5 flipped three platform files off the raw NDK imports
		// (walletQuery/publishCartSnapshot/profilePublish lost their type imports), taking platform/web
		// production 33 -> 30. Assert the invariant (undeclared <= seed, undeclared <= total), never the
		// absolute — `complete=yes` is the end-state hard rail.
		const m9 = r.stdout.match(/M9 platform-undeclared=(\d+) \(of (\d+) platform NDK files\)/)
		expect(m9).not.toBeNull()
		expect(Number(m9![1])).toBeLessThanOrEqual(48)
		expect(Number(m9![1])).toBeLessThanOrEqual(Number(m9![2]))
		expect(r.stdout).toContain('M10 ledger-target-failures=0')
		// src/ is a RATCHET, so assert the invariant (current <= baseline), never an
		// absolute count: any lane that deletes a src/ NDK file (e.g. A1's
		// `src/lib/blossom.ts`, which took src production 44 -> 43) must leave this
		// test green without editing it. Same for the `+N` test count.
		const srcRow = r.stdout.match(/src\s+production\s+(\d+)\s+(\d+)\s+ratchet/)
		expect(srcRow).not.toBeNull()
		expect(Number(srcRow![1])).toBeLessThanOrEqual(Number(srcRow![2]))
		const srcMetrics = r.stdout.match(/src=(\d+)\+(\d+)/)
		expect(srcMetrics).not.toBeNull()
		expect(Number(srcMetrics![1])).toBeLessThanOrEqual(Number(srcRow![2]))
		// The `+N` test count follows the same rule as the production row: A3.2
		// deleted four NDK-mentioning src test files (nip17*.test.ts × 3 +
		// privateOrderMessage.test.ts), taking src test 25 -> 21 (production
		// 44-curve 38 the same way) — so assert the ratchet invariant against the
		// row's own BASE, never an absolute count.
		const srcTestRow = r.stdout.match(/src\s+test\s+(\d+)\s+(\d+)\s+ratchet/)
		expect(srcTestRow).not.toBeNull()
		expect(Number(srcTestRow![1])).toBeLessThanOrEqual(Number(srcTestRow![2]))
		expect(Number(srcMetrics![2])).toBe(Number(srcTestRow![1]))
		expect(r.stdout).toContain('complete=no')
		expect(r.stdout).toContain('OK')
	})

	test('fails (exit 1) when sdk/ production gains an un-allowlisted NDK import', async () => {
		const root = await stageRepo({
			baseline: baselineRows(['sdk production 0 zero']),
			files: { 'sdk/core/media/blossomUpload.ts': NDK_IMPORT },
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('::error::')
		expect(r.stdout).toContain('this rail must be 0')
		expect(r.stdout).toContain('M8 sdk-production-effective=1')
	})

	test('allowlists a comment-only sdk mention but rejects an allowlisted IMPORT', async () => {
		const commentOnly = await stageRepo({
			baseline: baselineRows(['sdk production 0 zero']),
			allowlist: `sdk/config/wallet.ts|A3|prose mention only|wave-H\n`,
			files: { 'sdk/config/wallet.ts': NDK_COMMENT },
		})
		const ok = runGuard(commentOnly)
		expect(ok.exitCode).toBe(0)
		expect(ok.stdout).toContain('M8 sdk-production-effective=0 (raw 1)')

		// The same row is invalid the moment the file actually imports the transport.
		const importing = await stageRepo({
			baseline: baselineRows(['sdk production 0 zero']),
			allowlist: `sdk/config/wallet.ts|A3|claims prose only|wave-H\n`,
			files: { 'sdk/config/wallet.ts': NDK_IMPORT },
		})
		const bad = runGuard(importing)
		expect(bad.exitCode).toBe(1)
		expect(bad.stdout).toContain('IMPORTS')
		expect(bad.stdout).toContain('comment-only mentions, not transports')
	})

	test('fails (exit 1) on platform growth with no ledger row (declare-as-you-touch)', async () => {
		const root = await stageRepo({
			baseline: baselineRows(['platform/web production 0 bridge']),
			files: { 'platform/web/ndk/newBridge.ts': `${NDK_IMPORT}` },
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('undeclared NDK files rose from 0 to 1')
		expect(r.stdout).toContain('M9 platform-undeclared=1')
	})

	test('passes a DECLARED new bridge even though the platform total rose (rail counts undeclared)', async () => {
		// Red-team F1 acceptance (a): the bridge rail must ratchet the UNDECLARED
		// count, never the total, or a sanctioned bridge could never land.
		const root = await stageRepo({
			baseline: baselineRows(['platform/web production 0 bridge']),
			files: {
				'platform/web/media/blossomUploadHost.ts': `import { upload } from '@sdk/core/media/blossomUpload'\n${NDK_IMPORT}`,
				'sdk/core/media/blossomUpload.ts': 'export const upload = () => null\n',
			},
			ledger: 'platform/web/media/blossomUploadHost.ts|A1|sdk/core/media/blossomUpload.ts|host injects the NDK-free capability|wave-I\n',
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(0)
		expect(r.stdout).toContain('M9 platform-undeclared=0 (of 1 platform NDK files)')
		expect(r.stdout).toContain('ledger: 1 row(s)')
		expect(r.stdout).toContain('OK')
	})

	test('accepts an sdk-target DIRECTORY as well as a concrete file', async () => {
		const root = await stageRepo({
			baseline: baselineRows(['platform/web production 0 bridge']),
			files: {
				'platform/web/auth/ndkSignerAdapter.ts': `import { createSigner } from '@sdk/core/signer'\n${NDK_IMPORT}`,
				'sdk/core/signer/index.ts': 'export const createSigner = () => null\n',
			},
			ledger: 'platform/web/auth/ndkSignerAdapter.ts|A3|sdk/core/signer|NDK-typed consumers need an adapter|wave-H\n',
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(0)
		expect(r.stdout).toContain('M10 ledger-target-failures=0')
	})

	test('fails (exit 1) on a dangling ledger row (path gone) — the row cannot outlive its bridge', async () => {
		const root = await stageRepo({
			baseline: baselineRows(['platform/web production 0 bridge']),
			ledger: 'platform/web/ndk/deletedBridge.ts|A1|sdk/core/media/blossomUpload.ts|gone|wave-I\n',
			files: { 'sdk/core/media/blossomUpload.ts': 'export const upload = () => null\n' },
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('stale row')
		expect(r.stdout).toContain('does not exist')
	})

	test('fails (exit 1) on a bad sdk-target and counts it in M10', async () => {
		const root = await stageRepo({
			baseline: baselineRows(['platform/web production 0 bridge']),
			files: {
				'platform/web/ndk/ndkStore.ts': `import { missing } from '@sdk/core/nope'\n${NDK_IMPORT}`,
			},
			ledger: 'platform/web/ndk/ndkStore.ts|A3|sdk/core/nope|names a capability that does not exist|wave-H\n',
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain("sdk-target 'sdk/core/nope' does not exist")
		expect(r.stdout).toContain('M10 ledger-target-failures=1')
	})

	test('rejects an sdk-target that still imports NDK (a bridge target must be the capability)', async () => {
		const root = await stageRepo({
			baseline: baselineRows(['platform/web production 0 bridge']),
			files: {
				'platform/web/ndk/ndkStore.ts': `import { thing } from '@sdk/core/signer'\n${NDK_IMPORT}`,
				'sdk/core/signer/index.ts': NDK_IMPORT,
			},
			ledger: 'platform/web/ndk/ndkStore.ts|A3|sdk/core/signer|not yet migrated|wave-H\n',
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('must be the NDK-free capability')
	})

	test('rejects a bridge that does not import its declared sdk-target (the direction proof)', async () => {
		const root = await stageRepo({
			baseline: baselineRows(['platform/web production 0 bridge']),
			files: {
				'platform/web/ndk/ndkStore.ts': NDK_IMPORT,
				'sdk/core/signer/index.ts': 'export const createSigner = () => null\n',
			},
			ledger: 'platform/web/ndk/ndkStore.ts|A3|sdk/core/signer|claims an injection it does not do|wave-H\n',
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('does not import its declared sdk-target')
	})

	test('rejects a ledger row that lives outside platform/', async () => {
		const root = await stageRepo({
			baseline: baselineRows(['src production 0 ratchet']),
			files: {
				'src/lib/ndkThing.ts': `import { x } from '@sdk/core/signer'\n${NDK_IMPORT}`,
				'sdk/core/signer/index.ts': 'export const x = 1\n',
			},
			ledger: 'src/lib/ndkThing.ts|A3|sdk/core/signer|wrong tree|wave-H\n',
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('is not under platform/')
	})

	test('complete=yes turns the undeclared count into a hard rail, and passes at zero', async () => {
		const undeclared = await stageRepo({
			baseline: baselineRows(['platform/web production 1 bridge'], 'yes'),
			files: { 'platform/web/ndk/ndkStore.ts': NDK_IMPORT },
		})
		const red = runGuard(undeclared)
		expect(red.exitCode).toBe(1)
		expect(red.stdout).toContain('complete=yes but 1 platform/ NDK file(s) have no valid ledger row')

		const declared = await stageRepo({
			baseline: baselineRows(['platform/web production 0 bridge'], 'yes'),
			files: {
				'platform/web/ndk/ndkStore.ts': `import { createSigner } from '@sdk/core/signer'\n${NDK_IMPORT}`,
				'sdk/core/signer/index.ts': 'export const createSigner = () => null\n',
			},
			ledger: 'platform/web/ndk/ndkStore.ts|A3|sdk/core/signer|last bridge|wave-H\n',
		})
		const green = runGuard(declared)
		expect(green.exitCode).toBe(0)
		expect(green.stdout).toContain('complete=yes')
	})

	test('refuses to measure a partial tree (exit 2) instead of passing on a shrunken scope', async () => {
		const root = await stageRepo({
			baseline: baselineRows(['src production 0 ratchet']),
			omitDirs: ['src'],
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(2)
		expect(r.stdout).toContain('tree src/ does not exist')
	})

	test('refuses a missing complete= switch and an unknown rule (exit 2)', async () => {
		const noSwitch = await stageRepo({
			baseline: 'sdk production 0 zero\n',
		})
		const r1 = runGuard(noSwitch)
		expect(r1.exitCode).toBe(2)
		expect(r1.stdout).toContain('missing the')

		const badRule = await stageRepo({
			baseline: baselineRows(['src production 0 bogusrule']),
		})
		const r2 = runGuard(badRule)
		expect(r2.exitCode).toBe(2)
		expect(r2.stdout).toContain('unknown rule')
	})

	test('scans only *.ts/*.tsx — evidence .sh/.md mentions do not trip a rail', async () => {
		const root = await stageRepo({
			baseline: baselineRows(['sdk production 0 zero']),
			files: {
				'sdk/core/signer/evidence/run.sh': `grep ${NDK_PACKAGE} build.log\n`,
				'sdk/core/auth/auth.md': `the ${NDK_COMMENT}`,
			},
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(0)
		expect(r.stdout).toContain('M8 sdk-production-effective=0 (raw 0)')
	})
})
