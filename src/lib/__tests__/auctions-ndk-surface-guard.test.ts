/**
 * Tests for the auctions NDK-surface CI guard
 * (`scripts/check-auctions-ndk-surface.sh`).
 *
 * The guard resolves ROOT from its own location, so we can stage a throwaway
 * "repo" (scripts/ + src/) in a temp dir, copy the real script in, write the
 * production auctions files, and invoke it via bash — then assert on exit code
 * and stdout for the clean / dirty branches. One test runs the real script
 * against the real repo so the committed file set is covered.
 */
import { spawnSync } from 'node:child_process'
import { copyFile, exists, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

const ROOT = join(import.meta.dir, '..', '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'check-auctions-ndk-surface.sh')
// I-a A2 S2 (2026-10-29): the private-claim module left `src/lib/auctions/` for
// the sdk home (the two ambient-signer helpers went to platform/web/
// ndkReadContext.ts), so the guard covers it through the
// `sdk/commerce/auctions/*.ts` glob family and the `src/lib/auctions/*.ts`
// family is deleted. These tests pin that post-S2 shape.
const CLAIM_MODULE = 'sdk/commerce/auctions/privateAuctionClaimMessage.ts'
const RETIRED_SRC_CLAIM = 'src/lib/auctions/privateAuctionClaimMessage.ts'

const NDK_PACKAGE = '@nostr-dev' + '-kit/ndk'
const NDK_IMPORT = `import { NDKEvent } from '${NDK_PACKAGE}'\n`
const NDK_ACTIONS = "import { ndkActions } from '@/lib/stores/ndk'\n"
const NDK_STORE = "import { ndkStore } from '@/lib/stores/ndk'\n"

/**
 * Run the guard. `strict` enables the coverage gate (pinned paths must exist,
 * glob families must match); staged throwaway repos disable it because they
 * carry only the handful of files a given test needs.
 */
function runGuard(root: string, strict = false): { exitCode: number; stdout: string; stderr: string } {
	const r = spawnSync('bash', [join(root, 'scripts', 'check-auctions-ndk-surface.sh')], {
		cwd: root,
		encoding: 'utf8',
		env: { ...process.env, AUCTIONS_GUARD_REQUIRE_COVERAGE: strict ? '1' : '0' },
	})
	return { exitCode: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const roots: string[] = []
async function stageRepo(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'auctions-ndk-guard-'))
	roots.push(root)
	await mkdir(join(root, 'scripts'), { recursive: true })
	await copyFile(SCRIPT, join(root, 'scripts', 'check-auctions-ndk-surface.sh'))
	for (const [rel, content] of Object.entries(files)) {
		const abs = join(root, rel)
		await mkdir(dirname(abs), { recursive: true })
		await writeFile(abs, content)
	}
	return root
}

describe('auctions NDK-surface guard (scripts/check-auctions-ndk-surface.sh)', () => {
	afterEach(async () => {
		while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
	})

	test('exits 0 against the real repo — the production file set is clean', () => {
		const r = runGuard(ROOT, true)
		expect(r.stderr).toBe('')
		expect(r.exitCode).toBe(0)
		expect(r.stdout).toContain('Auctions NDK-surface guard:')
		expect(r.stdout).toContain('coverage strict=1')
		// The #1252 allowlist is empty since A3.3 (and stays empty after the S2
		// move): the guard scans every auctions file, allowlisted 0.
		expect(r.stdout).toContain('allowlisted 0 (#1252-gated)')
		expect(r.stdout).toContain('OK')
	})

	test('fails closed when the file set is gutted (coverage gate, not a blind OK)', async () => {
		// A staged repo with only test files: every pinned path and glob family
		// is absent. Without the coverage gate this would print `scanned 0 … OK`
		// — the "silently blind guard" the review flagged.
		const root = await stageRepo({ 'src/lib/auction/whatever.test.ts': NDK_IMPORT })
		const r = runGuard(root, true)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('coverage check failed')
		// The pinned entries name the sdk/platform seams that own the surface now.
		expect(r.stdout).toContain('sdk/commerce/auctions/workflows.ts')
	})

	test('reads a newly created file under src/lib/auction/ (set completeness)', async () => {
		// The guard's own suite passed with `scanned 0` before this: prove that a
		// brand-new production file in the real auction directory is scanned and
		// flagged, so the directory cannot be a blind spot.
		const root = await stageRepo({ 'src/lib/auction/newlyAdded.ts': NDK_IMPORT })
		const r = runGuard(root)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('src/lib/auction/newlyAdded.ts')
	})

	test('the guard source derives the auction directory and documents the scope gaps', async () => {
		const source = await readFile(SCRIPT, 'utf8')
		// The real directory must be scanned via a glob, not `src/lib/auction*.ts`.
		expect(source).toContain('src/lib/auction/*.ts')
		expect(source).toContain('AUCTIONS_GUARD_REQUIRE_COVERAGE')
		// Wave 7 retarget: the surface is pinned in the sdk/platform seams and the
		// `src/` shims that are still in the tree keep their own glob families.
		expect(source).toContain('sdk/commerce/auctions/workflows.ts')
		expect(source).toContain('sdk/commerce/auctions/auctionRead.ts')
		expect(source).toContain('platform/web/auctions/auctionPublish.ts')
		expect(source).toContain('platform/web/auctions/auctionsQuery.ts')
		expect(source).toContain('src/publish/auctions.tsx')
		expect(source).toContain('src/queries/auctions.tsx')
		// The out-of-scope files are named, not silently ignored: the wallet store
		// directory, and the sanctioned first-party NDK wrapper.
		expect(source).toContain('src/lib/stores/')
		expect(source).toContain('src/lib/nostr/ndk-events.ts')
	})

	test('the guard source retires the #1252 allowlist and the src/lib/auctions family (A3.3 + I-a S2)', async () => {
		const source = await readFile(SCRIPT, 'utf8')
		expect(source).toContain('1252')
		// The per-file ALLOWLIST is empty since A3.3: the claim file flipped onto
		// the signer capability accessor and no longer needs the raw NDK signer,
		// so the guard scans it like every other auctions file.
		expect(source).toContain('ALLOWLIST=()')
		expect(source).not.toMatch(/^\t"src\//m)
		// S2: the claim module now lives in the sdk home, so the `src/lib/auctions`
		// glob family left the guard's assembled set. The historical count table
		// may still mention the old path in prose, but the family must never be
		// re-assembled while the directory is empty.
		expect(source).not.toContain('"$ROOT"/src/lib/auctions/*.ts')
	})

	test('the moved private-claim module is NDK-surface-free and scanned at its sdk home', async () => {
		// S2 moved the module to sdk/commerce/auctions/ — the guard scans it via
		// the sdk/commerce/auctions/*.ts family, so an NDK mention it re-acquired
		// would fail `exits 0 against the real repo`. Pin the post-S2 shape: the
		// sdk module is host-free (no capability accessor — that half lives in the
		// platform read adapter) and never touches the raw NDK signer.
		const source = await readFile(join(ROOT, CLAIM_MODULE), 'utf8')
		expect(source).not.toContain('getActiveSignerCapability')
		expect(source).not.toContain('asEncryptingSigner')
		expect(source).not.toContain('ndkActions')
		expect(source).not.toContain('ndkStore')
		expect(source).not.toContain('@nostr-dev-kit')
		// The src original is gone with its directory — a resurrected copy would
		// be unscanned (no family matches it) and must not slip back silently.
		expect(await exists(join(ROOT, RETIRED_SRC_CLAIM))).toBe(false)
		// The sdk family the moved module is covered by is still assembled.
		const guardSource = await readFile(SCRIPT, 'utf8')
		expect(guardSource).toContain('"$ROOT"/sdk/commerce/auctions/*.ts')
	})

	test('exits 0 when the production file set has no NDK surface', async () => {
		const root = await stageRepo({
			'src/publish/auctions.tsx': "import { sign } from '@/lib/nostr/io'\n",
			'src/queries/auctions.tsx': "import { applesauceIo } from '@/lib/nostr/io'\n",
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(0)
		expect(r.stdout).toContain('OK')
	})

	test('fails (exit 1) when a non-allowlisted auctions file imports @nostr-dev-kit', async () => {
		const root = await stageRepo({ 'src/publish/auctions.tsx': NDK_IMPORT })
		const r = runGuard(root)
		expect(r.exitCode).toBe(1)
		expect(r.stdout).toContain('::error::')
		expect(r.stdout).toContain('src/publish/auctions.tsx')
	})

	test('fails (exit 1) when a non-allowlisted auctions file uses ndkActions or ndkStore', async () => {
		const actions = await stageRepo({ 'src/components/AuctionCard.tsx': NDK_ACTIONS })
		expect(runGuard(actions).exitCode).toBe(1)

		const store = await stageRepo({ 'src/lib/auctionHd.ts': NDK_STORE })
		expect(runGuard(store).exitCode).toBe(1)
	})

	test('fails (exit 1) when the moved private-claim module (sdk home) imports @nostr-dev-kit', async () => {
		// S2: the claim module is scanned at its sdk home via the
		// sdk/commerce/auctions/*.ts family — a re-acquired NDK import must fail
		// the guard, while a clean claim module passes with an empty allowlist.
		const dirty = await stageRepo({
			[CLAIM_MODULE]: NDK_IMPORT,
			'src/publish/auctions.tsx': "import { sign } from '@/lib/nostr/io'\n",
		})
		const dirtyResult = runGuard(dirty)
		expect(dirtyResult.exitCode).toBe(1)
		expect(dirtyResult.stdout).toContain('::error::')
		expect(dirtyResult.stdout).toContain(CLAIM_MODULE)

		const clean = await stageRepo({
			[CLAIM_MODULE]: "import { createNip59GiftWrapWithSigner } from '@sdk/core/nostr/nip59'\n",
			'src/publish/auctions.tsx': "import { sign } from '@/lib/nostr/io'\n",
		})
		const cleanResult = runGuard(clean)
		expect(cleanResult.exitCode).toBe(0)
		expect(cleanResult.stdout).toContain('allowlisted 0 (#1252-gated)')
	})

	test('ignores test files in the file set', async () => {
		const root = await stageRepo({
			'src/lib/auctionHd.test.ts': NDK_IMPORT,
			'src/lib/__tests__/whatever.test.ts': NDK_ACTIONS,
		})
		const r = runGuard(root)
		expect(r.exitCode).toBe(0)
	})
})
