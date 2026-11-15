import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AuctionFormData } from '@sdk/commerce/auctions/auctionForm'
import { AuctionCategoryTab, AuctionNameTab } from './auction-editor-tabs'

/**
 * The two auction-editor tabs, as one cluster file. Every exported view is exercised
 * through its server-rendered markup (the units' suite has no DOM renderer), which is also
 * how "these tabs carry only create fields" is pinned: the assertions name what must be
 * present and what must not.
 */
const noop = () => {}

const formData: AuctionFormData = {
	auctionId: 'vintage-leica',
	title: 'Vintage Leica',
	description: 'Film camera',
	imageUrl: 'https://img.example/leica.png',
	category: 'Art',
	name: 'Studio Nord',
	startPrice: '1000',
	minIncrement: '100',
	mode: 'fixed',
	windowSec: '',
	durationSec: 86_400,
	v4vSplit: [],
}

describe('AuctionNameTab', () => {
	test('renders the create display fields and nothing retired', () => {
		const markup = renderToStaticMarkup(createElement(AuctionNameTab, { formData, setFormData: noop }))
		expect(markup).toContain('flex flex-col gap-4')
		expect(markup).toContain('value="Vintage Leica"')
		expect(markup).toContain('Film camera')
		expect(markup).toContain('value="Studio Nord"')
		expect(markup).toContain('auction-title')
		expect(markup).toContain('auction-description')
		expect(markup).toContain('auction-name')
		// The retired 30408 controls are gone, not merely disabled.
		expect(markup).not.toContain('auction-summary')
		expect(markup).not.toContain('adult/sensitive content')
		expect(markup).not.toContain('data-slot="checkbox"')
	})

	test('merges a host className without dropping or reordering its own', () => {
		const markup = renderToStaticMarkup(createElement(AuctionNameTab, { formData, setFormData: noop, className: 'mt-2' }))
		expect(markup).toContain('flex flex-col gap-4 mt-2')
	})

	test('accepts the ref prop without altering the rendered markup', () => {
		const withRef = renderToStaticMarkup(createElement(AuctionNameTab, { formData, setFormData: noop, ref: null }))
		expect(withRef).toContain('flex flex-col gap-4')
	})
})

describe('AuctionCategoryTab', () => {
	test('renders the single category select and its free-text twin', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionCategoryTab, {
				formData,
				setFormData: noop,
				mainCategories: ['Art', 'Collectibles'],
			}),
		)
		expect(markup).toContain('Category')
		expect(markup).toContain('auction-category-free')
		expect(markup).toContain('value="Art"')
		// The retired multi-category list has no home in the create.
		expect(markup).not.toContain('Sub Categories')
		expect(markup).not.toContain('auction-sub-categories')
	})

	test('merges a host className on its root', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionCategoryTab, { formData, setFormData: noop, mainCategories: [], className: 'mt-2' }),
		)
		expect(markup).toContain('flex flex-col gap-4 mt-2')
	})
})