import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PickupLocationDialogView } from './pickup-location-dialog-view'

describe('PickupLocationDialogView', () => {
	test('renders nothing while closed', () => {
		const markup = renderToStaticMarkup(
			createElement(PickupLocationDialogView, {
				open: false,
				onOpenChange: () => {},
				locations: [{ name: 'Shop', address: '1 Main St' }],
				geocodedLocations: [],
				loading: false,
				error: null,
			}),
		)
		expect(markup).toBe('')
	})
})
