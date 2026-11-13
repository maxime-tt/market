/**
 * storefrontCmsLive.test.tsx — the live blocks are reachable from the editor.
 *
 * A block that exists in the schema but is absent from the CMS registry cannot
 * be placed by an author, so it is not delivered. This test pins the three live
 * blocks into the registry: the `Live` category offers them, each carries
 * fields and defaults the sidebar can render, the editor component-key list
 * includes them, and a document using each validates for publish.
 *
 * The registry module is imported with its *dependencies that are not under
 * test* stubbed — the editor engine (`@puckeditor/core`), the data slots, and
 * the two sidebar picker fields. What is exercised is the registry data this
 * slice adds, not the editor runtime or the live reads.
 */

import { describe, expect, mock, test } from 'bun:test'
import { StorefrontBlockSchema } from '@sdk/commerce/storefront/storefrontPage'

mock.module('@puckeditor/core', () => ({
	usePuck: () => ({ appState: { data: { root: { props: {} } } }, dispatch: () => {} }),
}))
mock.module('./StorefrontBlockSlots', () => ({ storefrontBlockSlots: {} }))
mock.module('./fields/ItemPickerField', () => ({ CollectionPickerField: () => null, ProductPickerField: () => null }))
mock.module('./fields/ThemePickerField', () => ({
	ThemePaletteStrip: () => null,
	ThemeSwatchGrid: () => null,
	ThemeTunePanel: () => null,
}))

// Imported after the mocks are registered, so the registry module resolves them
// to the stubs above.
const { STOREFRONT_COMPONENT_KEYS, storefrontCmsConfig } = await import('./storefrontCms')

const LIVE_BLOCKS = ['ProductStrips', 'BrowseStats', 'BrowseFeed'] as const

describe('storefront CMS live block registry', () => {
	test('the Live category exists and offers all three live blocks', () => {
		const categories = storefrontCmsConfig.categories ?? {}
		const live = categories.live
		expect(live).toBeDefined()
		expect(live?.title).toBe('Live')
		expect([...(live?.components ?? [])]).toEqual(expect.arrayContaining([...LIVE_BLOCKS]))
	})

	test('each live block is registered with fields, defaults and a render', () => {
		for (const name of LIVE_BLOCKS) {
			const component = storefrontCmsConfig.components?.[name]
			expect(component, name).toBeDefined()
			expect(Object.keys(component?.fields ?? {}).length, name).toBeGreaterThan(0)
			expect(component?.defaultProps, name).toBeDefined()
			expect(typeof component?.render, name).toBe('function')
		}
	})

	test('the editor component-key list includes the live blocks', () => {
		expect(STOREFRONT_COMPONENT_KEYS).toEqual(expect.arrayContaining([...LIVE_BLOCKS]))
	})

	test('an author can publish a document containing each live block', () => {
		for (const name of LIVE_BLOCKS) {
			const component = storefrontCmsConfig.components?.[name]
			const block = { type: name, props: { id: `blk-${name}`, ...(component?.defaultProps ?? {}) } }
			const parsed = StorefrontBlockSchema.safeParse(block)
			expect(parsed.success, `${name}: ${!parsed.success && JSON.stringify(parsed.error.issues)}`).toBe(true)
		}
	})
})