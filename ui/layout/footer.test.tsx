import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Footer } from './footer'

describe('Footer', () => {
	test('renders the identity line and the conditional links', () => {
		const markup = renderToStaticMarkup(
			<Footer displayName="Plebeian Market" termsUrl="https://example.com/terms" supportContact="support@example.com" />,
		)
		expect(markup).toContain('Plebeian Market: Powered by Nostr.')
		expect(markup).toContain('href="https://example.com/terms"')
		expect(markup).toContain('href="mailto:support@example.com"')
	})

	test('omits the Terms anchor when no termsUrl is given', () => {
		expect(renderToStaticMarkup(<Footer displayName="Plebeian Market" />)).not.toContain('Terms')
	})

	test('renders a social link when one is given', () => {
		const markup = renderToStaticMarkup(<Footer displayName="Plebeian Market" socialLinks={{ twitter: 'https://example.com/twitter' }} />)
		expect(markup).toContain('href="https://example.com/twitter"')
		expect(markup).toContain('alt="X"')
	})

	test('merges a host className onto the root footer', () => {
		const markup = renderToStaticMarkup(<Footer displayName="Plebeian Market" className="mt-4" />)
		expect(markup).toContain('mt-4')
		expect(markup).toContain('data-slot="footer"')
	})
})
