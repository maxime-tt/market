import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { InfiniteProductListView } from './infinite-product-list-view'

type Item = { id: string; title: string }

const items: Item[] = [
	{ id: 'p1', title: 'Handmade Mug' },
	{ id: 'p2', title: 'Wool Beanie' },
]

const commonProps = {
	products: items,
	isLoading: false,
	isError: false,
	error: null,
	hasMore: true,
	totalProducts: 5,
	onLoadMore: () => {},
	renderProduct: (product: Item) => <div key={product.id}>{product.title}</div>,
}

describe('InfiniteProductListView', () => {
	test('renders one grid card per product through the host-provided render prop', () => {
		const markup = renderToStaticMarkup(<InfiniteProductListView {...commonProps} title="All Products" />)
		expect(markup).toContain('Handmade Mug')
		expect(markup).toContain('Wool Beanie')
		expect(markup).toContain('All Products')
		// A string title renders as the page heading.
		expect(markup).toContain('<h1')
	})

	test('offers the load-more control while more chunks remain', () => {
		const markup = renderToStaticMarkup(<InfiniteProductListView {...commonProps} />)
		expect(markup).toContain('Load More Products')
		expect(markup).not.toContain('data-testid="infinite-product-list-end"')
	})

	test('shows the end-of-results line when every chunk is loaded', () => {
		const markup = renderToStaticMarkup(<InfiniteProductListView {...commonProps} hasMore={false} totalProducts={2} />)
		expect(markup).not.toContain('Load More Products')
		expect(markup).toContain('Showing 2 of 2 products')
	})

	test('shows the shared loading state for the first chunk', () => {
		const markup = renderToStaticMarkup(<InfiniteProductListView {...commonProps} isLoading products={[]} />)
		expect(markup).toContain('Loading products...')
		expect(markup).toContain('role="status"')
		expect(markup).not.toContain('No products found')
	})

	test('shows the shared empty state when no products exist', () => {
		const markup = renderToStaticMarkup(<InfiniteProductListView {...commonProps} products={[]} />)
		expect(markup).toContain('No products found')
		expect(markup).toContain('There are no products available at the moment.')
	})

	test('shows the shared error state with the retry control and surfaces the message', () => {
		const markup = renderToStaticMarkup(
			<InfiniteProductListView {...commonProps} isError error={{ message: 'relay unreachable' }} onRetry={() => {}} />,
		)
		expect(markup).toContain('Error loading products')
		expect(markup).toContain('relay unreachable')
		expect(markup).toContain('Try Again')
		expect(markup).toContain('role="alert"')
		expect(markup).not.toContain('Handmade Mug')
	})

	test('a non-string title renders as-is instead of a heading', () => {
		const markup = renderToStaticMarkup(<InfiniteProductListView {...commonProps} title={<h2>Featured</h2>} />)
		expect(markup).toContain('<h2')
		expect(markup).not.toContain('<h1')
	})
})
