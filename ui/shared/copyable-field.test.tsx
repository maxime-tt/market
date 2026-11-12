import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CopyableField } from './copyable-field'

describe('CopyableField', () => {
	test('renders the label and value on a bordered row', () => {
		const markup = renderToStaticMarkup(<CopyableField label="App Relay" value="wss://relay.example" />)
		expect(markup).toContain('data-slot="copyable-field"')
		expect(markup).toContain('App Relay')
		expect(markup).toContain('wss://relay.example')
		expect(markup).toContain('bg-surface-sunken/50')
	})

	test('renders a copy control named after the field', () => {
		const markup = renderToStaticMarkup(<CopyableField label="App Relay" value="wss://relay.example" />)
		expect(markup).toContain('data-slot="copy-button"')
		expect(markup).toContain('aria-label="Copy App Relay"')
	})

	test('renders the icon as a node sized by the component', () => {
		const markup = renderToStaticMarkup(<CopyableField label="App Relay" value="wss://relay.example" icon={<svg />} />)
		expect(markup).toContain('[&amp;_svg]:size-5')
	})

	test('omits the icon wrapper when no icon is given', () => {
		const markup = renderToStaticMarkup(<CopyableField label="App Relay" value="wss://relay.example" />)
		expect(markup).not.toContain('[&amp;_svg]:size-5')
	})

	test('merges host className', () => {
		expect(renderToStaticMarkup(<CopyableField label="L" value="V" className="mt-2" />)).toContain('mt-2')
	})
})
