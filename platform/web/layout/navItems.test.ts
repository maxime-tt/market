/**
 * platform/web/layout/navItems.test.ts — the one nav list's composition rules.
 *
 * The rules both surfaces depend on, asserted where they are decided rather than
 * through a render: the built-ins, the instance gate on `Nostr`, and the
 * operator's pins — shape-gated (`nav` is untrusted wire data) and ordered
 * (`nav.order`, ties by path).
 */

import { describe, expect, test } from 'bun:test'
import { navItems, type NavBinding, type NavEntry } from './navItems'

/** A well-formed pin, as the routing file stores it: a path *name*, no leading slash. */
const pin = (path: string, label: string, order: number): NavBinding => ({ path, nav: { label, order } })

/** Each entry as the destination it renders — the route, or the pinned path. */
const shown = (entries: NavEntry[]): string[] => entries.map((entry) => (entry.kind === 'route' ? entry.to : entry.href))

describe('navItems', () => {
	test('is the three unconditioned destinations, in order', () => {
		expect(shown(navItems(false))).toEqual(['/products', '/auctions', '/community'])
		expect(navItems(false).every((entry) => entry.kind === 'route')).toBe(true)
	})

	test('adds Nostr last when the instance enables the link', () => {
		expect(shown(navItems(true))).toEqual(['/products', '/auctions', '/community', '/nostr'])
	})

	test('appends the operator’s pins after the built-ins', () => {
		const entries = navItems(false, [pin('featured', 'Featured', 1)])

		expect(shown(entries)).toEqual(['/products', '/auctions', '/community', '/featured'])
		expect(entries.at(-1)).toEqual({ kind: 'pinned', label: 'Featured', href: '/featured' })
	})

	test('roots a pinned path, whichever way the file spells it', () => {
		// A binding's `path` is a *name* — stored without its leading slash
		// (`data/routes.example.json` is `"shop"`) — and an href without one would
		// resolve against the current location instead of the root.
		expect(shown(navItems(false, [pin('featured', 'Featured', 1)]))).toContain('/featured')
		expect(shown(navItems(false, [pin('/featured', 'Featured', 1)]))).toContain('/featured')
	})

	test('orders pins by nav.order, then by path', () => {
		const entries = navItems(false, [pin('zeta', 'Zeta', 9), pin('beta', 'Beta', 2), pin('alpha', 'Alpha', 2)])

		expect(shown(entries)).toEqual(['/products', '/auctions', '/community', '/alpha', '/beta', '/zeta'])
	})

	test('ignores a binding whose nav is malformed', () => {
		// `GET /api/routes` does not validate binding shapes, so every one of these
		// arrives as instance state: the gate is the filter, not the type.
		const malformed: NavBinding[] = [
			{ path: 'no-nav' },
			{ path: 'label-not-a-string', nav: { label: 7 as unknown as string, order: 1 } },
			{ path: 'order-nan', nav: { label: 'Order NaN', order: Number.NaN } },
			{ path: 'order-string', nav: { label: 'Order string', order: '1' as unknown as number } },
			{ path: 'nav-null', nav: null as unknown as NavBinding['nav'] },
			{ path: 'nav-string', nav: 'Featured' as unknown as NavBinding['nav'] },
		]

		expect(shown(navItems(false, malformed))).toEqual(['/products', '/auctions', '/community'])
		expect(shown(navItems(false, [...malformed, pin('pinned', 'Pinned', 1)]))).toEqual(['/products', '/auctions', '/community', '/pinned'])
	})

	test('leaves the caller’s bindings array alone', () => {
		const bindings = [pin('beta', 'Beta', 2), pin('alpha', 'Alpha', 1)]
		const before = [...bindings]

		navItems(false, bindings)

		expect(bindings).toEqual(before)
	})
})
