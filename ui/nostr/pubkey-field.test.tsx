import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PubkeyField } from './pubkey-field'

const NPUB = 'npub1s65ze2cck2fl20964t5vmjlw8alvgflal8uujv7mw7qqhd008zsqd2nnah'
const HEX = '86a82cab18b293f53cbaaae8cdcbee3f7ec427fdf9f9c933db77800bb5ef38a0'

describe('PubkeyField', () => {
	test('renders both forms, truncated, on a bordered field', () => {
		const markup = renderToStaticMarkup(<PubkeyField label="App Public Key" npub={NPUB} hex={HEX} />)
		expect(markup).toContain('data-slot="pubkey-field"')
		expect(markup).toContain('App Public Key')
		// 20 head + '...' + 16 tail.
		expect(markup).toContain(`${NPUB.slice(0, 20)}...${NPUB.slice(-16)}`)
		expect(markup).toContain(`${HEX.slice(0, 20)}...${HEX.slice(-16)}`)
	})

	test('links the npub to njump', () => {
		const markup = renderToStaticMarkup(<PubkeyField label="App Public Key" npub={NPUB} hex={HEX} />)
		expect(markup).toContain(`href="https://njump.me/${NPUB}"`)
		expect(markup).toContain('text-primary')
	})

	test('gives each form its own copy control', () => {
		const markup = renderToStaticMarkup(<PubkeyField label="App Public Key" npub={NPUB} hex={HEX} />)
		expect(markup).toContain('aria-label="Copy npub"')
		expect(markup).toContain('aria-label="Copy hex"')
		expect(markup.match(/data-slot="copy-button"/g)).toHaveLength(2)
	})

	test('renders the icon as a node sized by the component', () => {
		const markup = renderToStaticMarkup(<PubkeyField label="App Public Key" npub={NPUB} hex={HEX} icon={<svg />} />)
		expect(markup).toContain('[&amp;_svg]:size-5')
	})

	test('merges host className', () => {
		expect(renderToStaticMarkup(<PubkeyField label="L" npub={NPUB} hex={HEX} className="mt-2" />)).toContain('mt-2')
	})
})
