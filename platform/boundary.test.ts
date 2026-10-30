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
// except for host modules that now delegate to SDK workflows through a Platform host — publish adapters
// (the Platform publish context) and media hosts (the Wave G blossom upload host). Rows are a migration
// ledger: each is removed when its owner leaves src/.
//
// The entries below marked "store drain" are the notification chapters' migration-time edges (increments
// C1/C2). They are the same class this list already describes — legacy src/ host modules that depend on
// Platform while they are migrated — and three of them were already violations before those increments ran.
// Each is removed when its owner leaves src/ (E1 deletes the shims; D3 retires the legacy components), so
// treat them as a migration ledger, not a permanent grant. Decision recorded in
// companions/STORE-DRAIN-CHAPTER-PLAN.md ("src -> platform during the drain").
const SRC_TO_PLATFORM_ALLOWLIST = new Set([
	'src/index.tsx',
	'src/publish/shipping.tsx', // store drain D2 slice 17; shim deleted in E1
	'src/publish/products.tsx',
	'src/publish/collections.tsx',
	'src/publish/orders.tsx', // store drain D2 slice 19; shim deleted in E1
	'src/publish/auctions.tsx', // store drain D2 slice 20; shim deleted in E1
	'src/queries/shipping.tsx',
	'src/queries/products.tsx',
	'src/queries/collections.tsx',
	'src/queries/auctions.tsx',
	'src/queries/payment.tsx',
	'src/queries/orders.tsx', // store drain D1 slice 7; shim deleted in E1
	'src/queries/messages.tsx', // store drain D1 slice 7; shim deleted in E1
	'src/queries/liveChat.tsx', // store drain D1 slice 7; shim deleted in E1
	'src/queries/zaps.tsx', // store drain D1 slice 7; shim deleted in E1
	'src/publish/comments.tsx',
	'src/publish/liveChat.tsx',
	'src/publish/reactions.tsx',
	'src/publish/shareNotes.ts',
	'src/publish/relay-list.tsx',
	'src/publish/wallet.tsx',
	'src/publish/nip89.ts',
	'src/publish/migration.tsx',
	'src/publish/featured.tsx', // store drain D2 slice 11; shim deleted in E1
	'src/publish/payment.tsx', // store drain D2 slice 14; shim deleted in E1
	'src/publish/app-settings.tsx', // store drain D2 slice 18; shim deleted in E1
	'src/publish/blacklist.tsx', // store drain D2 slice 16; shim deleted in E1
	'src/queries/relay-list.tsx', // store drain D1 slice 1; shim deleted in E1
	'src/queries/relay-preferences.tsx', // store drain D1 slice 1; shim deleted in E1
	'src/queries/config.tsx', // store drain D1 slice 1; shim deleted in E1
	'src/queries/posts.tsx', // store drain D1 slice 2; shim deleted in E1
	'src/queries/bugReports.tsx', // store drain D1 slice 2; shim deleted in E1
	'src/queries/nip05.tsx', // store drain D1 slice 2; shim deleted in E1
	'src/queries/vanity.tsx', // store drain D1 slice 2; shim deleted in E1
	'src/queries/reactions.tsx', // store drain D1 slice 2; shim deleted in E1
	'src/queries/comments.tsx', // store drain D1 slice 2; shim deleted in E1
	'src/queries/blacklist.tsx', // store drain D1 slice 3; shim deleted in E1
	'src/queries/testLabels.tsx', // store drain D1 slice 3; shim deleted in E1
	'src/queries/featured.tsx', // store drain D1 slice 4; shim deleted in E1
	'src/queries/profiles.tsx', // store drain D1 slice 4; shim deleted in E1
	'src/queries/wallet.tsx', // store drain D1 slice 4; shim deleted in E1
	'src/queries/external.tsx', // store drain D1 slice 4; shim deleted in E1
	'src/queries/app-settings.tsx', // store drain D1 slice 5; shim deleted in E1
	'src/queries/migration.tsx', // store drain D1 slice 5; shim deleted in E1
	'src/queries/v4v.tsx', // store drain D1 slice 5; shim deleted in E1
	'src/lib/stores/collection.ts', // store drain; shim deleted in E1b
	'src/lib/utils/productFormStorage.ts', // Wave C product drain S0; shim deleted in E1b
	'src/lib/stores/product.ts', // Wave C product drain S1-S3; shim deleted in E1b
	'src/lib/stores/ndk.ts', // Wave C ndk drain S2; reads the moved NDK adapters directly, edge retired in E1b
	'src/lib/stores/cart.ts', // Wave D cart drain S0-S2; imports the moved cart model; shim deleted in E1b
	'src/lib/stores/cashu.ts', // Wave D walletOps drain S0; shim deleted in E1b
	'src/lib/stores/ui.ts', // Wave E adapter drain W-E3.5; shim deleted in E1b
	'src/lib/stores/config.ts', // Wave E adapter drain W-E3.6; shim deleted in E1b
	'src/lib/stores/wallet.ts', // Wave E adapter drain W-E3.7; shim deleted in E1b
	'src/lib/stores/walletOps.ts', // Wave D walletOps drain S2; shim deleted in E1b
	'src/lib/stores/vanity.ts', // Wave E adapter drain W-E3.1; shim deleted in E1b
	'src/lib/stores/blacklist.ts', // Wave E adapter drain W-E3.2; shim deleted in E1b
	'src/lib/stores/testLabels.ts', // Wave E adapter drain W-E3.3; shim deleted in E1b
	'src/lib/terms.ts', // Wave F W-E5a; shim deleted in E1b
	// --- store drain: the notification chapters' migration-time edges (see the note above). ---
	'src/components/AuctionWonModal.tsx', // pre-existing; owner leaves src/ in D3
	// --- I-c-hooks: src/ consumers re-pointed to the moved platform hooks (retire with these leaves in D3). ---
	'src/components/UserCard.tsx', // I-c-hooks; useBreakpoint moved to platform/web/app
	'src/components/EntityActionsMenu.tsx', // I-c-hooks; useEntityPermissions moved to platform/web/permissions
	'src/components/pages/ProfilePage.tsx', // I-c-hooks; useBreakpoint/useEntityPermissions moved to platform
	'src/lib/stores/auth.ts', // pre-existing; shim deleted in E1
	// --- store drain I-c (2026-10-29): the notification monitor and its src-side seam moved to
	// platform/web/notifications/ and both files are deleted, so their rows went with them; the seam's
	// two src/ consumers read the platform barrel directly until D3 retires them. ---
	'src/components/dashboard/AuctionListItemHost.tsx', // I-c; reads the read marks + notification scopes; retired in D3
	'src/components/messages/ConversationView.tsx', // I-c; reads the read marks; retired in D3
	'src/components/layout/Header.tsx', // C2; reads the derived counts, retired in D3
	'src/components/messages/ConversationListItem.tsx', // C2; reads the derived counts, retired in D3
	'src/components/social/SocialInteractions.tsx', // H-b kit 2: zaps via the platform ZapButtonHost; retires with the B2 SocialInteractions kit
	'src/components/FeaturedSections.tsx', // H-b kit 3: renders the platform ProductCardHost; retires with the H-e/AuctionCard park
	'src/components/orders/OrderDetailComponent.tsx', // H-b kit 3: renders the platform ProductCardHost; retires with the H-e4 orders cluster
	'src/components/ui/image-uploader/ImageUploader.tsx', // Wave G media host (G-a1.2); retires with the H-e8 image-uploader leaf cluster
	'src/components/BugReportModal.tsx', // Wave G media host (G-a1.2); retires with the D3 layout/Header.tsx consumer chain
	// --- I-c-monitors (2026-10-29): useAuctionBidFunding moved to
	// platform/web/auctions/useAuctionBidFunding.ts and the src/ original is deleted, so these
	// src/ consumers read the platform hook directly until their own slices retire them. ---
	'src/components/AuctionBidder.tsx', // I-c-monitors; retires in I-PARKED (the AuctionBidder host)
	'src/components/AuctionBidProgressDialog.tsx', // I-c-monitors; retires in I-PARKED
	'src/feature/wallet/components/DepositLightningModal.tsx', // I-c-monitors; retires in J-b (the wallet modals slice)
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

/** The private read adapters, and the composition root that is allowed to name them. */
const READ_ADAPTER_MODULES = new Set(['platform/web/ndkReadContext.ts', 'platform/web/applesauceReadContext.ts'])
const READ_CONTEXT_FACADE = 'platform/web/readContext.ts'
const SOURCE_EXTENSION_LIST = ['.ts', '.tsx', '.mts', '.cts']

/** Repo-relative path of the read adapter a specifier resolves to, or undefined when it names neither. */
const resolvesToReadAdapter = (file: string, specifier: string): string | undefined => {
	const target = specifier.startsWith('@platform/')
		? resolve(REPO_ROOT, 'platform', specifier.slice('@platform/'.length))
		: specifier.startsWith('.')
			? resolve(file, '..', specifier)
			: undefined
	if (!target) return undefined
	const base = repoPath(target)
	const hasSourceExtension = SOURCE_EXTENSION_LIST.some((extension) => base.endsWith(extension))
	const candidates = hasSourceExtension ? [base] : SOURCE_EXTENSION_LIST.map((extension) => `${base}${extension}`)
	return candidates.find((candidate) => READ_ADAPTER_MODULES.has(candidate))
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

	test('web feature bindings reach the read adapters only through readContext.ts', async () => {
		const violations = (await collectImports(join(PLATFORM_ROOT, 'web')))
			.filter(({ file }) => repoPath(file) !== READ_CONTEXT_FACADE)
			.filter(({ file, specifier }) => resolvesToReadAdapter(file, specifier) !== undefined)
			.map(({ file, specifier }) => `${repoPath(file)} imports the private read adapter ${specifier}`)
		expect(violations).toEqual([])
	})
})
