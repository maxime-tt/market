import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { parseRouteIntent, routeIntentContent } from '@sdk/commerce/storefront/routeIntent'
import type { Binding } from '@platform/server/routes/routeFile'
import {
	EMPTY_DRAFT,
	describeBindings,
	describeBinding,
	draftFromRow,
	formatUpdatedAt,
	removeIntent,
	resolveAuthor,
	shortPubkey,
	validateDraft,
	type BindingDraft,
} from './routeAuthoring'

const AUTHOR = 'a'.repeat(64)
const ADMIN = 'b'.repeat(64)

const draft = (over: Partial<BindingDraft> = {}): BindingDraft => ({
	path: 'shop',
	author: AUTHOR,
	d: 'storefront-page',
	showInNav: false,
	navLabel: '',
	navOrder: '',
	...over,
})

const binding = (over: Partial<Binding> = {}): Binding => ({
	kind: 'admin',
	path: 'shop',
	target: { type: 'page', author: AUTHOR, d: 'storefront-page' },
	updatedAt: 1_800_000_000,
	updatedBy: ADMIN,
	...over,
})

describe('the authoring view model', () => {
	test('a binding row names its target, who changed it and when', () => {
		expect(describeBinding(binding())).toMatchObject({
			path: 'shop',
			targetLabel: `page ${AUTHOR.slice(0, 8)}…${AUTHOR.slice(-4)} / storefront-page`,
			pageName: 'Storefront',
			pageAuthorLabel: `${AUTHOR.slice(0, 8)}…${AUTHOR.slice(-4)}`,
			updatedAtLabel: '2027-01-15',
			updatedByLabel: `${ADMIN.slice(0, 8)}…${ADMIN.slice(-4)}`,
			warning: null,
			navLabel: null,
			navOrder: null,
			author: AUTHOR,
			d: 'storefront-page',
		})
	})

	test('a pinned binding carries its nav label and order, and a malformed pin reads as not pinned', () => {
		const pinned = describeBinding(binding({ nav: { label: 'Shop', order: 2 } }))
		expect(pinned).toMatchObject({ navLabel: 'Shop', navOrder: 2 })

		// The table is read over the wire; `fetchRouteTable` does not validate it.
		const malformed = describeBinding(binding({ nav: { label: '', order: 1.5 } }))
		expect(malformed).toMatchObject({ navLabel: null, navOrder: null })
	})

	test('rows are sorted by path so the list does not reorder itself', () => {
		const rows = describeBindings([binding({ path: 'shop' }), binding({ path: 'about-us' }), binding({ path: 'featured' })])
		expect(rows.map((row) => row.path)).toEqual(['about-us', 'featured', 'shop'])
	})

	test('a compiled-in warning is attached to the row whose path it names', () => {
		const rows = describeBindings(
			[binding({ path: 'products' }), binding({ path: 'shop' })],
			[{ code: 'compiled-in-path', path: 'products', message: 'compiled-in-path: the binding on products supersedes a compiled-in route' }],
		)
		expect(rows.find((row) => row.path === 'products')?.warning).toContain('supersedes a compiled-in route')
		expect(rows.find((row) => row.path === 'shop')?.warning).toBeNull()
	})

	test('a boot-written binding says so instead of showing a fake author', () => {
		expect(shortPubkey('instance')).toBe('the instance (at boot)')
		expect(formatUpdatedAt(0)).toBe('unknown')
	})

	test('a row can seed the edit form', () => {
		expect(draftFromRow(describeBinding(binding()))).toEqual({
			path: 'shop',
			author: AUTHOR,
			d: 'storefront-page',
			showInNav: false,
			navLabel: '',
			navOrder: '',
		})
	})

	test('a pinned row seeds the edit form with the pin, and an unpinned row leaves it off', () => {
		expect(draftFromRow(describeBinding(binding({ nav: { label: 'Shop', order: 3 } })))).toMatchObject({
			showInNav: true,
			navLabel: 'Shop',
			navOrder: '3',
		})
		expect(draftFromRow(describeBinding(binding({ nav: { label: 'Shop', order: 0 } }))).showInNav).toBe(true)
	})

	test('the author may be an npub or a hex key; both become the stored hex form', () => {
		expect(resolveAuthor(AUTHOR)).toEqual({ hex: AUTHOR, error: null })
		expect(resolveAuthor(AUTHOR.toUpperCase())).toEqual({ hex: AUTHOR, error: null })
		expect(resolveAuthor(nip19.npubEncode(AUTHOR))).toEqual({ hex: AUTHOR, error: null })
		expect(resolveAuthor('  ').error).toContain('Enter the author pubkey')
		expect(resolveAuthor('npub1nope').error).toContain('not an npub')
	})

	test('an empty draft reports each field that is missing', () => {
		const result = validateDraft(EMPTY_DRAFT, [])
		expect(result.intent).toBeNull()
		expect(result.errors).toHaveLength(2)
		expect(result.errors[0]).toContain('Enter a path')
		expect(result.errors[1]).toContain('Choose the page this path should serve')
	})

	test('the path rules match the ones the server will enforce', () => {
		expect(validateDraft(draft({ path: 'SHOP' }), []).errors[0]).toContain('name grammar')
		expect(validateDraft(draft({ path: 'api' }), []).errors[0]).toContain('URL space')
		expect(validateDraft(draft({ path: 'shop/featured' }), []).errors[0]).toContain('top-level name')
		expect(validateDraft(draft({ path: ' shop' }), []).errors[0]).toContain('may not begin or end with a space')
	})

	test('a path that is already bound is refused, and says which row to edit', () => {
		const errors = validateDraft(draft({ path: 'shop' }), ['shop']).errors
		expect(errors[0]).toContain('already bound')
		// Retargeting that same binding is not a collision with itself.
		expect(validateDraft(draft({ path: 'shop', d: 'home' }), ['shop'], 'shop').intent).not.toBeNull()
	})

	test('the d tag is required and bounded', () => {
		expect(validateDraft(draft({ d: '  ' }), []).errors[0]).toContain('Choose the page this path should serve')
		expect(validateDraft(draft({ d: 'x'.repeat(513) }), []).errors[0]).toContain('cannot be used')
	})

	test('a valid draft produces the intent the server parses, with the tag as its address', () => {
		const { intent } = validateDraft(draft({ author: nip19.npubEncode(AUTHOR) }), [])
		expect(intent).toEqual({
			version: 1,
			action: 'set',
			path: 'shop',
			target: { type: 'page', author: AUTHOR, d: 'storefront-page' },
		})
		const parsed = parseRouteIntent(routeIntentContent(intent!), intent!.path)
		expect(parsed.error).toBeNull()
		expect(parsed.intent?.target).toEqual({ type: 'page', author: AUTHOR, d: 'storefront-page' })
	})

	test('an unpinned draft carries no nav, even if a stale label and order are left in the form', () => {
		const { intent } = validateDraft(draft({ navLabel: 'Shop', navOrder: '2' }), [])
		expect(intent).toEqual({
			version: 1,
			action: 'set',
			path: 'shop',
			target: { type: 'page', author: AUTHOR, d: 'storefront-page' },
		})
		expect(intent).not.toHaveProperty('nav')
	})

	test('a pinned draft carries the nav pair, and the signed document round-trips it', () => {
		const { intent } = validateDraft(draft({ showInNav: true, navLabel: '  Shop  ', navOrder: ' 2 ' }), [])
		expect(intent).toEqual({
			version: 1,
			action: 'set',
			path: 'shop',
			target: { type: 'page', author: AUTHOR, d: 'storefront-page' },
			nav: { label: 'Shop', order: 2 },
		})
		const parsed = parseRouteIntent(routeIntentContent(intent!), intent!.path)
		expect(parsed.error).toBeNull()
		expect(parsed.intent?.nav).toEqual({ label: 'Shop', order: 2 })
	})

	test('a pinned draft without a label names the label field', () => {
		const { errors, intent } = validateDraft(draft({ showInNav: true, navLabel: '   ', navOrder: '1' }), [])
		expect(intent).toBeNull()
		expect(errors).toContain('Enter a nav label.')
		expect(errors.join(' ')).not.toContain('Nav order')
	})

	test('a pinned draft whose order is not a whole number names the order field', () => {
		for (const navOrder of ['', '1.5', 'one', '2e3', '  ']) {
			const { errors, intent } = validateDraft(draft({ showInNav: true, navLabel: 'Shop', navOrder }), [])
			expect(intent).toBeNull()
			expect(errors).toEqual(['Nav order must be a whole number.'])
		}
		// A negative or zero order is still an integer the AppBar can sort by.
		expect(validateDraft(draft({ showInNav: true, navLabel: 'Shop', navOrder: '-1' }), []).intent?.nav).toEqual({
			label: 'Shop',
			order: -1,
		})
	})

	test('a nav label longer than the AppBar allows names the label field', () => {
		const errors = validateDraft(draft({ showInNav: true, navLabel: 'x'.repeat(25), navOrder: '1' }), []).errors
		expect(errors).toEqual(['A nav label is at most 24 characters.'])
	})

	test('a removal intent names only the path', () => {
		expect(removeIntent('shop')).toEqual({ version: 1, action: 'remove', path: 'shop', target: null })
	})
})
