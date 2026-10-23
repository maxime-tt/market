import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_TUNE } from './tune'
import { TunePanel } from './tune-panel'

const noop = () => {}

describe('TunePanel', () => {
	test('renders one slider per control with the current value', () => {
		const markup = renderToStaticMarkup(<TunePanel value={DEFAULT_TUNE} onChange={noop} onReset={noop} onSurprise={noop} />)

		expect(markup).toContain('data-slot="tune-panel"')
		expect(markup).toContain('Make it yours')
		expect(markup).toContain('data-testid="tune-radius"')
		expect(markup).toContain('data-testid="tune-shadow"')
		expect(markup).toContain('data-testid="tune-glass"')
		expect(markup).toContain('data-testid="tune-spacing"')
		expect(markup).toContain('data-testid="tune-texture"')
		expect(markup).toContain('data-testid="tune-handmade"')
		expect(markup).toContain('value="4"')
		expect(markup).toContain('value="1"')
	})

	test('shows reset and surprise, and export only when provided', () => {
		const withoutExport = renderToStaticMarkup(<TunePanel value={DEFAULT_TUNE} onChange={noop} onReset={noop} onSurprise={noop} />)
		expect(withoutExport).toContain('data-testid="tune-reset"')
		expect(withoutExport).toContain('data-testid="tune-surprise"')
		expect(withoutExport).not.toContain('data-testid="tune-export"')

		const withExport = renderToStaticMarkup(
			<TunePanel value={DEFAULT_TUNE} onChange={noop} onReset={noop} onSurprise={noop} onExport={noop} />,
		)
		expect(withExport).toContain('data-testid="tune-export"')
	})

	test('merges the host className', () => {
		const markup = renderToStaticMarkup(
			<TunePanel value={DEFAULT_TUNE} onChange={noop} onReset={noop} onSurprise={noop} className="col-span-2" />,
		)
		expect(markup).toContain('col-span-2')
	})
})
