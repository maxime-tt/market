import { describe, expect, test } from 'bun:test'
import { conversationHref } from './ConversationListItemHost'

describe('conversationHref', () => {
	test('builds the sales messages detail route for a pubkey', () => {
		expect(conversationHref('abc')).toBe('/dashboard/sales/messages/abc')
	})
})
