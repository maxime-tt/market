import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LiveChatMessageView } from './live-chat-message-view'

describe('LiveChatMessageView', () => {
	test('renders the author card node, the time label and the message body', () => {
		const markup = renderToStaticMarkup(
			createElement(LiveChatMessageView, {
				authorCard: createElement('span', null, 'alice'),
				timeLabel: '5m ago',
				content: 'gm frens',
			}),
		)

		expect(markup).toContain('alice')
		expect(markup).toContain('5m ago')
		expect(markup).toContain('gm frens')
	})

	test('the body breaks long words instead of widening the row', () => {
		const markup = renderToStaticMarkup(
			createElement(LiveChatMessageView, {
				authorCard: createElement('span', null, 'bob'),
				timeLabel: '1m ago',
				content: 'supercalifragilistic',
			}),
		)

		expect(markup).toContain('break-words')
	})

	test('className merges onto the row root', () => {
		const markup = renderToStaticMarkup(
			createElement(LiveChatMessageView, {
				authorCard: createElement('span', null, 'c'),
				timeLabel: 'now',
				content: 'hi',
				className: 'extra',
			}),
		)

		expect(markup).toContain('extra')
	})
})
