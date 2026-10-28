import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PostView } from './post-view'

const post = {
	id: 'cafebabe11112222333344445555666677778888999900001111222233334444',
	author: 'deadbeef11112222333344445555666677778888999900001111222233334444',
	content: 'Hello from the note',
	createdAt: 1_700_000_000,
}

describe('PostView', () => {
	test('renders the author, the content and a shortened permalink to the post', () => {
		const markup = renderToStaticMarkup(
			createElement(PostView, {
				post,
				author: { name: 'Alice', picture: 'https://images.example/alice.jpg' },
				isLoadingAuthor: false,
				permalinkHref: `/posts/${post.id}`,
			}),
		)

		expect(markup).toContain('Alice')
		expect(markup).toContain('Hello from the note')
		expect(markup).toContain('cafebabe...')
		expect(markup).toContain(`href="/posts/${post.id}"`)
		expect(markup).toContain('https://images.example/alice.jpg')
		expect(markup).toContain('data-slot="post-view"')
	})

	test('falls back to the shortened pubkey when the author has no name', () => {
		const markup = renderToStaticMarkup(
			createElement(PostView, {
				post,
				author: null,
				isLoadingAuthor: false,
				permalinkHref: `/posts/${post.id}`,
			}),
		)

		expect(markup).toContain('deadbeef...')
		expect(markup).toContain('>?</div>') // avatar initial fallback
	})

	test('shows pulsing placeholders for the avatar and the name while the author loads', () => {
		const markup = renderToStaticMarkup(
			createElement(PostView, {
				post,
				author: null,
				isLoadingAuthor: true,
				permalinkHref: `/posts/${post.id}`,
			}),
		)

		expect(markup).toContain('animate-pulse')
		expect(markup).not.toContain('deadbeef...')
	})

	test('renders the raw post JSON only when showJson is set', () => {
		const withJson = renderToStaticMarkup(
			createElement(PostView, {
				post,
				author: { name: 'Alice' },
				isLoadingAuthor: false,
				permalinkHref: `/posts/${post.id}`,
				showJson: true,
			}),
		)
		const withoutJson = renderToStaticMarkup(
			createElement(PostView, {
				post,
				author: { name: 'Alice' },
				isLoadingAuthor: false,
				permalinkHref: `/posts/${post.id}`,
			}),
		)

		expect(withJson).toContain('<pre')
		expect(withJson).toContain('cafebabe111122223333444455556666')
		expect(withoutJson).not.toContain('<pre')
	})
})
