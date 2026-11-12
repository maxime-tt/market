import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CollectionSkeletons, MerchantSkeletons } from './community-skeletons'

describe('CollectionSkeletons', () => {
	test('renders the requested number of placeholder cards', () => {
		const markup = renderToStaticMarkup(<CollectionSkeletons count={3} />)
		expect(markup.match(/data-testid="community-collections-skeleton"/g)).toHaveLength(3)
		// Two full-width bars plus the narrower tail bar per card.
		expect(markup.match(/h-40 w-full rounded-lg/g)).toHaveLength(3)
		expect(markup.match(/h-3 w-1\/2/g)).toHaveLength(3)
	})

	test('defaults to twelve cards', () => {
		expect(renderToStaticMarkup(<CollectionSkeletons />).match(/community-collections-skeleton/g)).toHaveLength(12)
	})
})

describe('MerchantSkeletons', () => {
	test('renders the requested number of placeholder cards with its own testid', () => {
		const markup = renderToStaticMarkup(<MerchantSkeletons count={2} />)
		expect(markup.match(/data-testid="community-merchants-skeleton"/g)).toHaveLength(2)
		expect(markup).not.toContain('community-collections-skeleton')
		// The merchants grid uses a wider tail bar than the collections grid.
		expect(markup.match(/h-3 w-3\/4/g)).toHaveLength(2)
	})

	test('defaults to six cards', () => {
		expect(renderToStaticMarkup(<MerchantSkeletons />).match(/community-merchants-skeleton/g)).toHaveLength(6)
	})
})
