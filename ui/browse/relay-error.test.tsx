/**
 * ui/browse/relay-error.test.tsx — Unit tests for RelayIndicator and DeadSearchError.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing test pattern in ui/products/product-search-results.test.tsx.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RelayIndicator, DeadSearchError, type RelayDetail } from './relay-error'

// ---------------------------------------------------------------------------
// RelayIndicator
// ---------------------------------------------------------------------------

describe('RelayIndicator', () => {
	test('renders minimal indicator with responded count', () => {
		const markup = renderToStaticMarkup(
			createElement(RelayIndicator, {
				responded: 3,
				totalProducts: 42,
			}),
		)
		expect(markup).toContain('widget-relay-indicator')
		expect(markup).toContain('3 relays responded')
		expect(markup).toContain('42')
	})

	test('renders expand chip when not all relays responded', () => {
		const relays: RelayDetail[] = [
			{ relay: 'wss://r1.example', status: 'responded' },
			{ relay: 'wss://r2.example', status: 'pending' },
		]
		const markup = renderToStaticMarkup(
			createElement(RelayIndicator, {
				responded: 1,
				totalProducts: 42,
				relays,
			}),
		)
		expect(markup).toContain('widget-relay-indicator-chip')
	})

	test('renders summary counts from relays array', () => {
		const relays: RelayDetail[] = [
			{ relay: 'wss://r1.example', status: 'responded' },
			{ relay: 'wss://r2.example', status: 'pending' },
			{ relay: 'wss://r3.example', status: 'pending' },
		]
		const markup = renderToStaticMarkup(
			createElement(RelayIndicator, {
				responded: 1,
				totalProducts: 10,
				relays,
			}),
		)
		expect(markup).toContain('widget-relay-indicator')
		expect(markup).toContain('1 relay responded')
	})

	test('renders with custom className', () => {
		const markup = renderToStaticMarkup(
			createElement(RelayIndicator, {
				responded: 2,
				totalProducts: 20,
				className: 'custom-indicator-class',
			}),
		)
		expect(markup).toContain('custom-indicator-class')
	})
})

// ---------------------------------------------------------------------------
// DeadSearchError
// ---------------------------------------------------------------------------

describe('DeadSearchError', () => {
	test('renders error panel with default message', () => {
		const markup = renderToStaticMarkup(
			createElement(DeadSearchError, {
				totalRelays: 3,
				pendingCount: 1,
			}),
		)
		expect(markup).toContain('widget-dead-search-error')
		expect(markup).toContain('All relays failed')
	})

	test('renders error panel with custom message', () => {
		const markup = renderToStaticMarkup(
			createElement(DeadSearchError, {
				totalRelays: 2,
				pendingCount: 2,
				message: 'Custom error message',
			}),
		)
		expect(markup).toContain('widget-dead-search-error')
		expect(markup).toContain('Custom error message')
	})

	test('renders retry button when onRetry provided', () => {
		const markup = renderToStaticMarkup(
			createElement(DeadSearchError, {
				totalRelays: 3,
				pendingCount: 3,
				onRetry: () => {},
			}),
		)
		expect(markup).toContain('widget-dead-search-error-retry')
	})

	test('renders with custom className', () => {
		const markup = renderToStaticMarkup(
			createElement(DeadSearchError, {
				totalRelays: 1,
				pendingCount: 1,
				className: 'custom-error-class',
			}),
		)
		expect(markup).toContain('custom-error-class')
	})
})
