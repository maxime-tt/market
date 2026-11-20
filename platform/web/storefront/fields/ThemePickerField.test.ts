import { describe, expect, test } from 'bun:test'
import { STOREFRONT_THEME_LIST } from '@sdk/config/storefront/storefrontThemes'
import { storefrontColourGroups } from './ThemePickerField'

describe('storefrontColourGroups', () => {
	const groups = storefrontColourGroups()
	const options = groups.flatMap((group) => group.options)

	test('lists every look and colourway exactly once', () => {
		const expected = STOREFRONT_THEME_LIST.flatMap((theme) => theme.palettes.map((palette) => `${theme.id}/${palette.key}`))
		const listed = options.map((option) => `${option.themeId}/${option.paletteKey}`)
		expect(listed.sort()).toEqual(expected.sort())
		expect(new Set(listed).size).toBe(listed.length)
	})

	test('single-colourway looks share the Classic group, named by the look', () => {
		const classic = groups[0]
		expect(classic.label).toBe('Classic')
		for (const option of classic.options) {
			const theme = STOREFRONT_THEME_LIST.find((t) => t.id === option.themeId)!
			expect(theme.palettes).toHaveLength(1)
			expect(option.label).toBe(theme.label)
		}
	})

	test('every option carries swatches to show', () => {
		for (const option of options) expect(option.swatch.length).toBeGreaterThan(0)
	})
})
