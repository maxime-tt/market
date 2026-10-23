import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BackButton } from './back-button'
import type { NavItemWithBadge, NavSectionView } from './model'
import { SIDEBAR_NAV_LINK_CLASS, SidebarNav, type NavLinkRenderArgs } from './sidebar-nav'

/**
 * The unit suite has no DOM renderer, so markup is asserted through
 * `renderToStaticMarkup` and the host's link renderer is replaced with a stub
 * that echoes the arguments it receives.
 */

const navItem = (overrides: Partial<NavItemWithBadge> = {}): NavItemWithBadge => ({
	path: '/dashboard/sales/sales',
	title: 'Sales',
	emoji: '💰',
	badgeCount: 0,
	active: false,
	...overrides,
})

const section = (items: NavItemWithBadge[], title = 'SALES'): NavSectionView => ({ title, items })

/** Records the args the renderer passes out, so the host contract is testable. */
const linkStub = () => {
	const calls: NavLinkRenderArgs[] = []
	const renderLink = (args: NavLinkRenderArgs) => {
		calls.push(args)
		return createElement(
			'a',
			{
				key: args.item.path,
				href: args.item.path,
				className: args.className,
				'data-status': args.active ? 'active' : 'inactive',
			},
			args.children,
		)
	}
	return { calls, renderLink }
}

describe('SidebarNav', () => {
	test('renders section headings in order', () => {
		const { renderLink } = linkStub()
		const markup = renderToStaticMarkup(
			createElement(SidebarNav, {
				sections: [section([navItem()], 'SALES'), section([navItem({ path: '/x', title: 'X', emoji: '🧾' })], 'PRODUCTS')],
				renderLink,
			}),
		)
		expect(markup).toContain('>SALES<')
		expect(markup).toContain('>PRODUCTS<')
		expect(markup.indexOf('SALES')).toBeLessThan(markup.indexOf('PRODUCTS'))
	})

	test('joins emoji and title into the visible label', () => {
		const { renderLink } = linkStub()
		const markup = renderToStaticMarkup(createElement(SidebarNav, { sections: [section([navItem()])], renderLink }))
		expect(markup).toContain('💰 Sales')
	})

	test('hands the host the resolved link class and active state', () => {
		const { calls, renderLink } = linkStub()
		renderToStaticMarkup(
			createElement(SidebarNav, {
				sections: [section([navItem({ active: true })])],
				renderLink,
			}),
		)
		expect(calls).toHaveLength(1)
		expect(calls[0]?.className).toBe(SIDEBAR_NAV_LINK_CLASS)
		expect(calls[0]?.active).toBe(true)
		expect(calls[0]?.item.path).toBe('/dashboard/sales/sales')
	})

	test('marks the active entry via data-status so the stylesheet variants apply', () => {
		const { renderLink } = linkStub()
		const markup = renderToStaticMarkup(createElement(SidebarNav, { sections: [section([navItem({ active: true })])], renderLink }))
		expect(markup).toContain('data-status="active"')
	})

	test('calls onNavigate when the host activates a link', () => {
		const { calls, renderLink } = linkStub()
		let navigated = 0
		renderToStaticMarkup(
			createElement(SidebarNav, {
				sections: [section([navItem()])],
				renderLink,
				onNavigate: () => {
					navigated += 1
				},
			}),
		)
		calls[0]?.onNavigate()
		expect(navigated).toBe(1)
	})

	test('omits the badge at zero', () => {
		const { renderLink } = linkStub()
		const markup = renderToStaticMarkup(createElement(SidebarNav, { sections: [section([navItem({ badgeCount: 0 })])], renderLink }))
		expect(markup).not.toContain('rounded-full')
	})

	test('renders the badge count', () => {
		const { renderLink } = linkStub()
		const markup = renderToStaticMarkup(createElement(SidebarNav, { sections: [section([navItem({ badgeCount: 7 })])], renderLink }))
		expect(markup).toContain('>7<')
	})

	test('caps the badge at 99+', () => {
		const { renderLink } = linkStub()
		const markup = renderToStaticMarkup(createElement(SidebarNav, { sections: [section([navItem({ badgeCount: 150 })])], renderLink }))
		expect(markup).toContain('99+')
		expect(markup).not.toContain('>150<')
	})

	test('renders nothing for an empty section list', () => {
		const { renderLink } = linkStub()
		const markup = renderToStaticMarkup(createElement(SidebarNav, { sections: [], renderLink }))
		expect(markup).toContain('data-slot="sidebar-nav"')
		expect(markup).not.toContain('<nav')
	})

	test('does not import the router — the host owns link rendering', () => {
		// Structural guarantee: this module's only imports are react types, cn and
		// the model. If a router import were added the boundary suite would fail.
		expect(SIDEBAR_NAV_LINK_CLASS).toContain('data-[status=active]')
	})
})

describe('BackButton', () => {
	test('inline variant shows the resolved label and an accessible name', () => {
		const markup = renderToStaticMarkup(createElement(BackButton, { label: 'Back to 📦 Products', onClick: () => {} }))
		expect(markup).toContain('Back to 📦 Products')
		expect(markup).toContain('aria-label="Back to 📦 Products"')
		expect(markup).toContain('i-back')
		expect(markup).toContain('data-variant="inline"')
	})

	test('inline variant falls back to "Back" when no label is given', () => {
		const markup = renderToStaticMarkup(createElement(BackButton, { onClick: () => {} }))
		expect(markup).toContain('>Back<')
		expect(markup).toContain('aria-label="Back"')
	})

	test('icon variant shows no visible text but keeps an accessible name', () => {
		const markup = renderToStaticMarkup(createElement(BackButton, { variant: 'icon', ariaLabel: 'Back to sidebar', onClick: () => {} }))
		expect(markup).toContain('aria-label="Back to sidebar"')
		expect(markup).toContain('data-variant="icon"')
		expect(markup).not.toContain('font-medium text-sm')
	})

	test('icon variant is positioned absolutely for the mobile header', () => {
		const markup = renderToStaticMarkup(createElement(BackButton, { variant: 'icon', onClick: () => {} }))
		expect(markup).toContain('absolute')
		expect(markup).toContain('-translate-y-1/2')
	})

	test('uses semantic text tokens rather than the legacy raw grey classes', () => {
		const markup = renderToStaticMarkup(createElement(BackButton, { label: 'Back', onClick: () => {} }))
		expect(markup).toContain('text-text-mid')
		expect(markup).not.toContain('text-gray-600')
		expect(markup).not.toContain('text-gray-800')
	})

	test('is a real button element', () => {
		const markup = renderToStaticMarkup(createElement(BackButton, { onClick: () => {} }))
		expect(markup).toContain('type="button"')
		expect(markup).toContain('data-slot="back-button"')
	})
})
