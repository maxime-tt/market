/**
 * NDK type-name boundary for `platform/web` — the structural-elimination ratchet
 * (`d7s2/ndk-structural`; census `runs/union-1420/ndk-structural/batch0-census.md`).
 *
 * The import-level wave (`d7-s2/ndk-web`) removed every direct NDK package import from
 * `platform/web`, so `scripts/check-ndk-direction.sh` — which greps the *package* string —
 * can no longer see an NDK dependency: the type names survive behind the
 * `@platform/web/readContext` facade. This guard is the only coverage for that gap.
 *
 * Scan: every `.ts`/`.tsx` under `platform/web` that carries no NDK package import
 * specifier. (Files that do import it are the declared transport/bridge set, already
 * owned by the direction guard + ledger.) In those files the NDK type names — Event,
 * Filter, UserProfile, Kind, RelaySet — may appear only in `BOUNDARY_ALLOWLIST` (the 5
 * transport-boundary files) or in `BOUNDARY_LEAK_ALLOWLIST` (the recorded structural
 * leaks: each needs a real NDK constructor/method or an sdk port that does not exist).
 * The number of OTHER files still naming them is the `BASELINE` ratchet; it may only
 * fall, and the tail batch lowers it to 0, leaving only the two allowlists.
 *
 * The type names are assembled from fragments so this file can never match its own scan.
 */
import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const WEB_ROOT = resolve(import.meta.dir)
const REPO_ROOT = resolve(import.meta.dir, '..', '..')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])

const NDK_TYPE_NAMES = ['NDK' + 'Event', 'NDK' + 'Filter', 'NDK' + 'UserProfile', 'NDK' + 'Kind', 'NDK' + 'RelaySet']
const NDK_TYPE_NAME_RE = new RegExp(`\\b(?:${NDK_TYPE_NAMES.join('|')})\\b`)
const PACKAGE_PREFIX = '@nostr-dev' + '-kit/'
const IMPORT_SPECIFIER_RE = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g

/** This guard speaks the names only as fragments; exclude it defensively regardless. */
const GUARD_FILE = 'platform/web/ndk-type-names.boundary.test.ts'

/**
 * The transport boundary — the only platform/web files allowed to speak NDK types.
 * `readContext.ts` is the composition root that re-exports them; the two adapters and
 * the publish context own the NDK client; the events test exercises the NDK store.
 */
const BOUNDARY_ALLOWLIST = new Set([
	'platform/web/readContext.ts',
	'platform/web/ndkReadContext.ts',
	'platform/web/ndkPublishContext.ts',
	'platform/web/applesauceReadContext.ts',
	'platform/web/ndk/ndkEvents.test.ts',
])

/**
 * The recorded structural leaks (census §(3)). Every entry needs a real NDK
 * constructor/method (`new` Event, `.ndk`, `.author`, `.tagValue()`, `.rawEvent()`,
 * `getMatchingTags`, `deduplicationKey`, `instanceof` user/zapper) or an sdk read/publish
 * port that does not exist yet — an sdk change this lane is not authorised to make.
 * A cast that keeps the NDK name is a non-migration, so these files stay as-is and are
 * listed here. The batch that owns a directory adds its own cells; the tail batch leaves
 * this the only remaining set.
 *
 * The 16th census leak, `platform/web/orders/orders-seam.test.ts`, is not listed because
 * its sole occurrence is the plural `NDKEvents` in a test title, which the word-boundary
 * regex does not match (a live allowlist beats a dead row).
 */
const BOUNDARY_LEAK_ALLOWLIST = new Set([
	'platform/web/messaging/ReactionButtonHost.tsx',
	'platform/web/messaging/CommentButtonHost.tsx',
	'platform/web/orders/ordersQuery.ts',
	'platform/web/routes/_dashboard-layout/dashboard/products/migration-tool.tsx',
	'platform/web/products/productQuery.ts',
	'platform/web/products/useStreamingProducts.ts',
	'platform/web/products/ProductCardHost.tsx',
	'platform/web/collections/collectionPublish.ts',
	'platform/web/account/piiDeletion.ts',
	'platform/web/v4v/v4vQuery.ts',
	'platform/web/shipping/shippingPublish.ts',
	'platform/web/nip89.ts',
	'platform/web/migration.tsx',
	'platform/web/featured/featuredPublish.tsx',
	'platform/web/payments/LightningPaymentProcessor.tsx',
])

/**
 * The ratchet: files outside both allowlists that still name an NDK type. Lower it in the
 * batch that converts them (config 42→37, routes →24, collections →23, products →20,
 * orders →14, messaging →4, tail →0).
 */
const BASELINE = 37

async function listSourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true })
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = join(directory, entry.name)
			if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listSourceFiles(fullPath)
			const extension = entry.name.slice(entry.name.lastIndexOf('.'))
			return SOURCE_EXTENSIONS.has(extension) ? [fullPath] : []
		}),
	)
	return nested.flat()
}

function hasNdkPackageImport(source: string): boolean {
	for (const match of source.matchAll(IMPORT_SPECIFIER_RE)) {
		const specifier = match[1] ?? match[2]
		if (specifier?.startsWith(PACKAGE_PREFIX)) return true
	}
	return false
}

describe('NDK type-name boundary (platform/web)', () => {
	test('only the boundary + recorded-leak allowlists name NDK types', async () => {
		const files = await listSourceFiles(WEB_ROOT)
		const offenders: string[] = []
		for (const file of files) {
			const rel = relative(REPO_ROOT, file)
			if (rel === GUARD_FILE) continue
			const source = await readFile(file, 'utf8')
			if (hasNdkPackageImport(source)) continue
			if (BOUNDARY_ALLOWLIST.has(rel) || BOUNDARY_LEAK_ALLOWLIST.has(rel)) continue
			if (NDK_TYPE_NAME_RE.test(source)) offenders.push(rel)
		}
		const verdict =
			offenders.length <= BASELINE
				? 'within ratchet'
				: `${offenders.length} file(s) name an NDK type outside the allowlists (ratchet ${BASELINE}):\n${offenders.sort().join('\n')}`
		expect(verdict).toBe('within ratchet')
	})

	test('both allowlists are live (every entry exists and still names an NDK type)', async () => {
		const stale: string[] = []
		for (const rel of [...BOUNDARY_ALLOWLIST, ...BOUNDARY_LEAK_ALLOWLIST]) {
			const source = await readFile(join(REPO_ROOT, rel), 'utf8').catch(() => undefined)
			if (source === undefined || !NDK_TYPE_NAME_RE.test(source)) stale.push(rel)
		}
		expect(stale).toEqual([])
	})
})
