import { expect, test } from '@playwright/test'

/**
 * Messaging views. The bubbles and layouts are literal-prop renders, so the
 * specs assert copy, alignment and state without any relay plumbing.
 */

test('renders the messages library', async ({ page }) => {
	await page.goto('/?library=messages')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('messages')
	await expect(page.getByTestId('library-messages')).toBeVisible()

	for (const widget of [
		'ChatMessageBubbleView',
		'ChatMessageBubbleViewOrder',
		'ChatOrderItemView',
		'ConversationListItemView',
		'ConversationViewLayout',
		'MessageInputView',
		'MessageInputViewLoggedOut',
	]) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('aligns the plain chat bubbles by sender', async ({ page }) => {
	await page.goto('/?library=messages')

	const widget = page.getByTestId('widget-ChatMessageBubbleView')
	const bubbles = widget.locator('.justify-start, .justify-end')
	await expect(bubbles).toHaveCount(2)
	await expect(widget).toContainText('Hey! Is the mug still available?')
	await expect(widget).toContainText('Yes — one left. Shipping is 500 sats.')
	// Both bubbles carry a timestamp.
	await expect(widget.locator('.text-right')).toHaveCount(1)
	await expect(widget.locator('.text-left')).toHaveCount(1)
})

test('renders the structured order-creation bubble with its items', async ({ page }) => {
	await page.goto('/?library=messages')

	const widget = page.getByTestId('widget-ChatMessageBubbleViewOrder')
	await expect(widget).toContainText('Order Placed')
	await expect(widget).toContainText('Order ID:')
	await expect(widget).toContainText('order-123')
	await expect(widget).toContainText('17000 sats')
	await expect(widget).toContainText('Shipping: Standard Post')
	await expect(widget).toContainText('Address: 21 Generation Street, London')
	// The host's renderOrderItem resolves each item tag into a literal row.
	await expect(widget.locator('li')).toHaveCount(2)
	await expect(widget).toContainText('Handmade mug')
	await expect(widget).toContainText('Frosted vase')
	await expect(widget).toContainText('Qty: 2')
})

test('renders the order item rows with and without image and price', async ({ page }) => {
	await page.goto('/?library=messages')

	const widget = page.getByTestId('widget-ChatOrderItemView')
	await expect(widget.locator('li')).toHaveCount(2)
	await expect(widget).toContainText('Handmade mug')
	await expect(widget).toContainText('Qty: 2')
	await expect(widget).toContainText('12,000 sats')
	await expect(widget).toContainText('Frosted vase')
	// Only the first row carries an image; the second carries no price.
	await expect(widget.locator('img')).toHaveCount(1)
	await expect(widget.locator('li').nth(1)).not.toContainText('12,000 sats')
})

test('summarises conversations with unseen counts and the active highlight', async ({ page }) => {
	await page.goto('/?library=messages')

	const widget = page.getByTestId('widget-ConversationListItemView')
	await expect(widget.locator('a')).toHaveCount(3)
	await expect(widget).toContainText('Is the mug still available?')
	await expect(widget).toContainText('Thanks, shipped today!')
	// Unread snippet is emphasised; the badge shows the unseen count.
	const badge = widget.locator('.bg-fill-accent')
	await expect(badge).toHaveCount(1)
	await expect(badge).toContainText('3')
	await expect(widget.locator('a.bg-muted\\/20')).toHaveCount(1)
})

test('shows the four resolved states of the conversation pane', async ({ page }) => {
	await page.goto('/?library=messages')

	const widget = page.getByTestId('widget-ConversationViewLayout')
	const ready = widget.locator('[data-slot="conversation-layout-ready"]')
	await expect(ready).toContainText('Hey! Is the mug still available?')
	await expect(ready.getByPlaceholder('Type your message...')).toBeVisible()

	const loading = widget.locator('[data-slot="conversation-layout-loading"]')
	await expect(loading).toContainText('Loading messages...')

	const empty = widget.locator('[data-slot="conversation-layout-empty"]')
	await expect(empty).toContainText('No messages yet. Start the conversation!')

	const error = widget.locator('[data-slot="conversation-layout-error"]')
	await expect(error).toContainText('Error loading messages: The relay did not respond in time.')
	await expect(error.getByRole('button', { name: 'Try Again' })).toBeVisible()
})

test('sends a message from the controlled input', async ({ page }) => {
	await page.goto('/?library=messages')

	const widget = page.getByTestId('widget-MessageInputView')
	const textarea = widget.getByPlaceholder('Type your message...')
	await expect(textarea).toBeEnabled()

	await textarea.fill('Hello from the catalogue')
	await widget.getByRole('button', { name: 'Send message' }).click()
	await expect(textarea).toHaveValue('')

	// Shift+Enter inserts a newline instead of sending.
	await textarea.fill('Line one')
	await textarea.press('Shift+Enter')
	await textarea.type('Line two')
	await expect(textarea).toHaveValue('Line one\nLine two')
})

test('disables the input for signed-out visitors with a reason', async ({ page }) => {
	await page.goto('/?library=messages')

	const widget = page.getByTestId('widget-MessageInputViewLoggedOut')
	await expect(widget.getByPlaceholder('Log in to send messages')).toBeDisabled()
	await expect(widget.getByRole('button', { name: 'Send message' })).toBeDisabled()
})
