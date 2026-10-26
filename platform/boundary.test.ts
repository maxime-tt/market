import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')
const PLATFORM_ROOT = resolve(import.meta.dir)
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const TEST_FILE = /(?:\.test|\.spec)\.(?:ts|tsx|mts|cts)$/
const IMPORT_SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g

// Known coupling to remove: browser routes reading server pricing constants.
const WEB_TO_SERVER_ALLOWLIST = new Set([
	'platform/web/routes/_dashboard-layout/dashboard/account/nostr-address.tsx',
	'platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx',
])

// Legacy src/ host modules allowed to depend on Platform while they are migrated; do not grow this list
// except for publish adapters that now delegate to SDK workflows via the Platform publish context.
//
// The entries below marked "store drain" are the notification chapters' migration-time edges (increments
// C1/C2). They are the same class this list already describes — legacy src/ host modules that depend on
// Platform while they are migrated — and three of them were already violations before those increments ran.
// Each is removed when its owner leaves src/ (E1 deletes the shims; D3 retires the legacy components), so
// treat them as a migration ledger, not a permanent grant. Decision recorded in
// companions/STORE-DRAIN-CHAPTER-PLAN.md ("src -> platform during the drain").
const SRC_TO_PLATFORM_ALLOWLIST = new Set([
	'src/index.tsx',
	'src/lib/boot.ts',
	'src/publish/shipping.tsx',
	'src/publish/products.tsx',
	'src/publish/collections.tsx',
	'src/publish/orders.tsx',
	'src/queries/shipping.tsx',
	'src/queries/products.tsx',
	'src/queries/collections.tsx',
	'src/queries/auctions.tsx',
	'src/queries/payment.tsx',
	'src/publish/comments.tsx',
	'src/publish/liveChat.tsx',
	'src/publish/reactions.tsx',
	'src/publish/shareNotes.ts',
	'src/publish/profiles.tsx',
	'src/publish/relay-list.tsx',
	'src/publish/relay-preferences.tsx',
	'src/publish/cart.tsx',
	'src/publish/wallet.tsx',
	'src/publish/nip89.ts',
	'src/publish/migration.tsx',
	'src/publish/curationContext.ts',
	'src/publish/featured.tsx', // store drain D2 slice 11; shim deleted in E1
	'src/publish/auctionWorkflowAdapters.ts', // store drain D2 slice 6; shim deleted in E1
	'src/queries/relay-list.tsx', // store drain D1 slice 1; shim deleted in E1
	'src/queries/relay-preferences.tsx', // store drain D1 slice 1; shim deleted in E1
	'src/queries/config.tsx', // store drain D1 slice 1; shim deleted in E1
	// --- store drain: the notification chapters' migration-time edges (see the note above). ---
	'src/components/AuctionWonModal.tsx', // pre-existing; owner leaves src/ in D3
	'src/hooks/useAuctionWinMonitor.ts', // pre-existing; owner leaves src/ in D3
	'src/lib/stores/auth.ts', // pre-existing; shim deleted in E1
	'src/hooks/useNotificationMonitor.ts', // C1; rewritten onto the rules, reads C4's ledger; retired in D3
	'src/lib/notificationProducers.ts', // C1; the src-side rule seam + C4 read-state re-export route; retired in D3
	'src/components/layout/Header.tsx', // C2; reads the derived counts, retired in D3
	'src/components/messages/ConversationListItem.tsx', // C2; reads the derived counts, retired in D3
])

async function listSourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true })
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = join(directory, entry.name)
			if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listSourceFiles(fullPath)
			const extension = entry.name.slice(entry.name.lastIndexOf('.'))
			return SOURCE_EXTENSIONS.has(extension) && !TEST_FILE.test(entry.name) ? [fullPath] : []
		}),
	)
	return nested.flat()
}

async function collectImports(root: string) {
	const files = await listSourceFiles(root)
	const results: { file: string; specifier: string }[] = []
	for (const file of files) {
		const source = await readFile(file, 'utf8')
		for (const match of source.matchAll(IMPORT_SPECIFIER)) {
			const specifier = match[1] ?? match[2]
			if (specifier) results.push({ file, specifier })
		}
	}
	return results
}

const repoPath = (file: string) => relative(REPO_ROOT, file).split(sep).join('/')

describe('Platform dependency boundary', () => {
	test('platform modules use aliases instead of relative paths that leave platform/', async () => {
		const violations = (await collectImports(PLATFORM_ROOT))
			.filter(({ file, specifier }) => {
				if (!specifier.startsWith('.')) return false
				const rel = relative(PLATFORM_ROOT, resolve(file, '..', specifier))
				return rel === '..' || rel.startsWith(`..${sep}`)
			})
			.map(({ file, specifier }) => `${repoPath(file)} escapes platform/: ${specifier}`)
		expect(violations).toEqual([])
	})

	test('server code does not import the web host or React', async () => {
		const violations = (await collectImports(join(PLATFORM_ROOT, 'server')))
			.filter(({ specifier }) => /^(?:@platform\/web|react(?:-dom)?(?:\/|$)|@ui\/)/.test(specifier))
			.map(({ file, specifier }) => `${repoPath(file)} imports ${specifier}`)
		expect(violations).toEqual([])
	})

	test('web code does not pull server modules into the browser bundle', async () => {
		const violations = (await collectImports(join(PLATFORM_ROOT, 'web')))
			.filter(({ file, specifier }) => specifier.startsWith('@platform/server') && !WEB_TO_SERVER_ALLOWLIST.has(repoPath(file)))
			.map(({ file, specifier }) => `${repoPath(file)} imports ${specifier}`)
		expect(violations).toEqual([])
	})

	test('legacy src/ code only depends on Platform from the allowlisted host modules', async () => {
		const violations = (await collectImports(join(REPO_ROOT, 'src')))
			.filter(({ file, specifier }) => specifier.startsWith('@platform/') && !SRC_TO_PLATFORM_ALLOWLIST.has(repoPath(file)))
			.map(({ file, specifier }) => `${repoPath(file)} imports ${specifier}`)
		expect(violations).toEqual([])
	})
})
