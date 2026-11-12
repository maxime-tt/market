import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AuctionFormData } from '@sdk/commerce/auctions/auctionForm'
import { AuctionCategoryTab, AuctionImagesTab, AuctionNameTab, AuctionSpecTab } from './auction-editor-tabs'

/**
 * The four simple auction-editor tabs moved out of the `auction-editor`
 * monolith as one cluster file in T6.3 S5a. This one `*.test.tsx` covers all
 * four views (the `/AGENTS.md` § Cluster files rule allows a single cluster
 * spec, but every exported view must be exercised).
 *
 * The units' suite has no DOM renderer, so each view is asserted through its
 * server-rendered markup — which is what "behaviour unchanged" means here: the
 * same branches, the same copy, the same delegation to the host's render prop.
 * Raw palette strings are guard-counted debt even in a `*.test.*` file, so the
 * suite pins structure and copy, never the palette; the palette is proven
 * verbatim against the monolith instead.
 */
const noop = () => {}

const formData: AuctionFormData = {
	title: 'Vintage Leica',
	summary: 'A classic rangefinder',
	description: 'Film camera',
	startingBid: '1000',
	bidIncrement: '100',
	startAt: '',
	endAt: '',
	antiSnipeWindowMinutes: 0,
	minBidCurveShape: 'none',
	minBidCurvePeakMultiplier: 2,
	settlementGracePreset: '1h',
	mainCategory: 'Art',
	categories: [],
	imageUrls: [],
	specs: [
		{ key: 'Brand', value: 'Leica' },
		{ key: 'Condition', value: 'Mint' },
	],
	shippings: [],
	trustedMints: [],
	isNSFW: false,
	enableLiveChat: true,
	auditorPubkey: '',
}

describe('AuctionNameTab', () => {
	test('renders the form values and the NSFW panel', () => {
		const markup = renderToStaticMarkup(createElement(AuctionNameTab, { formData, setFormData: noop }))
		expect(markup).toContain('flex flex-col gap-4')
		expect(markup).toContain('value="Vintage Leica"')
		expect(markup).toContain('A classic rangefinder')
		expect(markup).toContain('Film camera')
		expect(markup).toContain('This auction contains adult/sensitive content')
		// The three labelled fields, and the NSFW checkbox, are all present.
		expect(markup).toContain('auction-title')
		expect(markup).toContain('auction-summary')
		expect(markup).toContain('auction-description')
		expect(markup).toContain('data-slot="checkbox"')
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
	test('renders the main-category select and the sub-category textarea', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionCategoryTab, {
				formData,
				setFormData: noop,
				subCategoryInput: 'Cameras, Optics',
				setSubCategoryInput: noop,
				mainCategories: ['Art', 'Collectibles'],
			}),
		)
		expect(markup).toContain('Main Category')
		expect(markup).toContain('Sub Categories (comma or newline separated)')
		expect(markup).toContain('Cameras, Optics')
		expect(markup).toContain('auction-sub-categories')
	})

	test('merges a host className on its root', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionCategoryTab, {
				formData,
				setFormData: noop,
				subCategoryInput: '',
				setSubCategoryInput: noop,
				mainCategories: [],
				className: 'mt-2',
			}),
		)
		expect(markup).toContain('flex flex-col gap-4 mt-2')
	})
})

describe('AuctionSpecTab', () => {
	test('renders each key/value pair, the helper copy and the add affordance', () => {
		const markup = renderToStaticMarkup(createElement(AuctionSpecTab, { formData, setFormData: noop }))
		expect(markup).toContain('Item Specifications')
		expect(markup).toContain('Key/value pairs describing the item')
		// Two spec rows: both names and both values render as input values.
		expect(markup).toContain('value="Brand"')
		expect(markup).toContain('value="Leica"')
		expect(markup).toContain('value="Condition"')
		expect(markup).toContain('value="Mint"')
		expect(markup).toContain('Add Specification')
	})

	test('merges a host className on its root', () => {
		const markup = renderToStaticMarkup(createElement(AuctionSpecTab, { formData, setFormData: noop, className: 'mt-2' }))
		expect(markup).toContain('flex flex-col gap-4 mt-2')
	})
})

describe('AuctionImagesTab', () => {
	test('delegates every slot to the host-supplied uploader and shows the error', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionImagesTab, {
				images: [{ imageUrl: 'https://img/1.png', imageOrder: 0 }],
				setImages: noop,
				error: 'At least one image',
				renderUploader: ({ src, index }) => createElement('span', null, `uploader:${index}:${src ?? 'new'}`),
			}),
		)
		expect(markup).toContain('space-y-4')
		expect(markup).toContain('We recommend using square images of 1600x1600 and under 2mb.')
		expect(markup).toContain('uploader:0:https://img/1.png')
		expect(markup).toContain('uploader:-1:new')
		expect(markup).toContain('At least one image')
	})

	test('hides the error span when no error is supplied', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionImagesTab, {
				images: [],
				setImages: noop,
				renderUploader: ({ src, index }) => createElement('span', null, `uploader:${index}:${src ?? 'new'}`),
			}),
		)
		expect(markup).not.toContain('At least one image')
	})

	test('merges a host className on its root', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionImagesTab, {
				images: [],
				setImages: noop,
				renderUploader: () => createElement('span', null, 'uploader'),
				className: 'mt-2',
			}),
		)
		expect(markup).toContain('space-y-4 mt-2')
	})
})
