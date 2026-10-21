import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FEATURED_USER_CARD_SLOTS, FeaturedUserCardView, type FeaturedUserCardRenderLink } from './featured-user-card'

/**
 * The unit suite has no DOM renderer, so markup is asserted through
 * `renderToStaticMarkup` and link rendering is injected as a stub that records
 * what the view asks the host for.
 */

const linkStub = () => {
	const calls: { href: string; className?: string }[] = []
	const renderLink: FeaturedUserCardRenderLink = ({ href, className, children }) => {
		calls.push({ href, className })
		return createElement('a', { href, className }, children)
	}
	return { calls, renderLink }
}

const base = {
	profileHref: '/profile/abc',
	displayName: 'Alice',
	productCount: 0,
}

const render = (props: Partial<Parameters<typeof FeaturedUserCardView>[0]> & { renderLink: FeaturedUserCardRenderLink }) =>
	renderToStaticMarkup(createElement(FeaturedUserCardView, { ...base, ...props }))

describe('FeaturedUserCardView', () => {
	test('renders the name, blurb and product count', () => {
		const { renderLink } = linkStub()
		const html = render({ renderLink, about: 'Sells handmade mugs', productCount: 7 })
		expect(html).toContain('Alice')
		expect(html).toContain('Sells handmade mugs')
		expect(html).toContain('7 products')
	})

	test('links both the avatar and the title block to the profile', () => {
		const { calls, renderLink } = linkStub()
		render({ renderLink })
		expect(calls.filter((call) => call.href === '/profile/abc')).toHaveLength(2)
	})

	test('uses the avatar url and falls back to the display name for alt text', () => {
		const { renderLink } = linkStub()
		const html = render({ renderLink, picture: 'https://example.com/a.png' })
		expect(html).toContain('src="https://example.com/a.png"')
		expect(html).toContain('alt="Alice"')
	})

	test('renders one tile per supplied product and a placeholder for each remaining slot', () => {
		const { renderLink } = linkStub()
		const html = render({
			renderLink,
			products: [
				{ id: 'p1', href: '/product/p1', imageUrl: 'https://example.com/p1.png' },
				{ id: 'p2', href: '/product/p2' },
			],
		})
		expect(html).toContain('https://example.com/p1.png')
		// A product without an image gets the placeholder asset.
		expect(html).toContain('/images/placeholder.png')
		// The empty slots are the dot placeholders, so tiles == slots exactly.
		expect(html.match(/>•</g)).toHaveLength(FEATURED_USER_CARD_SLOTS - 2)
	})

	test('asks the host to render each product href', () => {
		const { calls, renderLink } = linkStub()
		render({
			renderLink,
			products: [
				{ id: 'p1', href: '/product/p1' },
				{ id: 'p2', href: '/product/p2' },
			],
		})
		expect(calls.filter((call) => call.href.startsWith('/product/')).map((call) => call.href)).toEqual(['/product/p1', '/product/p2'])
	})

	test('shows pulse placeholders instead of tiles while loading', () => {
		const { calls, renderLink } = linkStub()
		const html = render({ renderLink, isLoadingProducts: true, products: [{ id: 'p1', href: '/product/p1' }] })
		expect(html.match(/animate-pulse/g)).toHaveLength(FEATURED_USER_CARD_SLOTS)
		// No tile links are rendered while loading.
		expect(calls.filter((call) => call.href.startsWith('/product/'))).toHaveLength(0)
	})

	test('prints the total product count, not the number of rendered tiles', () => {
		const { renderLink } = linkStub()
		const products = Array.from({ length: FEATURED_USER_CARD_SLOTS }, (_, i) => ({ id: `p${i}`, href: `/product/p${i}` }))
		const html = render({ renderLink, products, productCount: 128 })
		expect(html).toContain('128 products')
		expect(html).not.toContain('4 products')
	})

	test('keeps its own classes when the consumer passes className', () => {
		const { renderLink } = linkStub()
		const html = render({ renderLink, className: 'bg-background text-foreground' })
		expect(html).toContain('hover:shadow-lg')
		expect(html).toContain('text-foreground')
	})
})
