import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { UpdateAvailableDialog } from './update-available-dialog'

describe('UpdateAvailableDialog', () => {
	test('renders nothing when closed', () => {
		const markup = renderToStaticMarkup(<UpdateAvailableDialog open={false} onDismiss={() => {}} onReload={() => {}} />)
		expect(markup).toBe('')
		expect(markup).not.toContain('data-slot="update-available-dialog"')
	})

	test('renders the notice copy and both actions when open', () => {
		const markup = renderToStaticMarkup(<UpdateAvailableDialog open onDismiss={() => {}} onReload={() => {}} />)
		expect(markup).toContain('Update Available')
		expect(markup).toContain('Later</button>')
		expect(markup).toContain('Reload</button>')
		expect(markup).toContain('data-slot="update-available-dialog"')
	})

	test('merges a host className onto the wrapper', () => {
		const markup = renderToStaticMarkup(<UpdateAvailableDialog open onDismiss={() => {}} onReload={() => {}} className="mt-4" />)
		expect(markup).toContain('mt-4')
		expect(markup).toContain('data-slot="update-available-dialog"')
	})
})
