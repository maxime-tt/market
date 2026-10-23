import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { VerifiedBadge, elideNip05Address } from './verified-badge'

/**
 * The unit suite has no DOM renderer, so markup is asserted through
 * `renderToStaticMarkup`; the pure elision helper is tested directly.
 */

const render = (props: Parameters<typeof VerifiedBadge>[0]) => renderToStaticMarkup(createElement(VerifiedBadge, props))

describe('elideNip05Address', () => {
	test('drops the `_@` prefix per the NIP-05 spec', () => {
		expect(elideNip05Address('_@domain.com')).toBe('domain.com')
	})

	test('leaves a real user@host address verbatim', () => {
		expect(elideNip05Address('alice@domain.com')).toBe('alice@domain.com')
	})

	test('does not rewrite a bare domain', () => {
		expect(elideNip05Address('domain.com')).toBe('domain.com')
	})
})

describe('VerifiedBadge', () => {
	test('verified state announces the badge and paints the secondary fill', () => {
		const html = render({ state: 'verified', nip05: '_@domain.com' })
		expect(html).toContain('data-state="verified"')
		expect(html).toContain('aria-label="NIP-05 verified"')
		expect(html).toContain('fill-secondary')
		expect(html).not.toContain('fill-destructive')
	})

	test('renders the elided address next to the badge', () => {
		const html = render({ state: 'verified', nip05: '_@domain.com' })
		expect(html).toContain('domain.com')
		expect(html).not.toContain('_@domain.com')
	})

	test('loading state delegates its accessible name to Spinner', () => {
		const html = render({ state: 'loading' })
		expect(html).toContain('data-state="loading"')
		// Spinner owns role=status and the "Loading" name; the badge must not add a second one.
		expect(html).toContain('role="status"')
		expect(html).toContain('aria-label="Loading"')
		expect(html).not.toContain('NIP-05 verified')
	})

	test('invalid state announces failure and paints the destructive fill', () => {
		const html = render({ state: 'invalid', nip05: 'alice@domain.com' })
		expect(html).toContain('data-state="invalid"')
		expect(html).toContain('aria-label="NIP-05 not verified"')
		expect(html).toContain('fill-destructive')
		expect(html).not.toContain('fill-secondary')
	})

	test('showAddress=false hides the address even when nip05 is present', () => {
		const html = render({ state: 'verified', nip05: '_@domain.com', showAddress: false })
		expect(html).not.toContain('domain.com')
	})

	test('omits the address when nip05 is null', () => {
		const html = render({ state: 'verified', nip05: null })
		expect(html).toContain('data-state="verified"')
		expect(html).not.toContain('text-text-mid')
	})

	test('keeps its own classes when the consumer passes className', () => {
		const html = render({ state: 'verified', className: 'mt-2' })
		expect(html).toContain('flex')
		expect(html).toContain('items-end')
		expect(html).toContain('mt-2')
	})
})
