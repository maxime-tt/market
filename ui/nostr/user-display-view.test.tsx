import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UserDisplayView } from './user-display-view'

const placeholder = createElement('div', null, 'Alice')

describe('UserDisplayView', () => {
	test('customActions replace the built-in action cluster', () => {
		const markup = renderToStaticMarkup(
			createElement(UserDisplayView, {
				userCard: placeholder,
				onMoveUp: () => {},
				onMoveDown: () => {},
				onRemove: () => {},
				customActions: createElement('button', { type: 'button' }, 'Promote'),
			}),
		)

		expect(markup).toContain('Promote')
		expect(markup).not.toContain('data-variant="outline"')
		expect(markup).not.toContain('data-variant="destructive"')
	})

	test('renders one button per supplied callback, in legacy order', () => {
		const withUp = renderToStaticMarkup(createElement(UserDisplayView, { userCard: placeholder, onMoveUp: () => {} }))
		expect(withUp.match(/data-variant="outline"/g)).toHaveLength(1)
		expect(withUp).not.toContain('data-variant="destructive"')

		const withNone = renderToStaticMarkup(createElement(UserDisplayView, { userCard: placeholder }))
		expect(withNone).not.toContain('<button')
	})

	test('disables the reorder buttons while reordering', () => {
		const markup = renderToStaticMarkup(
			createElement(UserDisplayView, {
				userCard: placeholder,
				onMoveUp: () => {},
				onMoveDown: () => {},
				canMoveUp: true,
				canMoveDown: true,
				isReordering: true,
			}),
		)

		expect(markup.match(/disabled=""/g)).toHaveLength(2)
	})

	test('merges a host className and marks the row', () => {
		const markup = renderToStaticMarkup(createElement(UserDisplayView, { userCard: placeholder, className: 'mt-4' }))

		expect(markup).toContain('data-slot="user-display-view"')
		expect(markup).toContain('p-4')
		expect(markup).toContain('mt-4')
		expect(markup).toContain('Alice')
	})
})
