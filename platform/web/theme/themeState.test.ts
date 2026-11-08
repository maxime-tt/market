import { describe, expect, test } from 'bun:test'

import type { ThemePreset } from '@ui/theme/presets'
import { DEFAULT_TUNE } from '@ui/theme/tune'

import {
	defaultThemeState,
	normalizeThemeState,
	readThemeState,
	resolveThemeTokens,
	serializeThemeState,
	THEME_STORAGE_KEY,
} from './themeState'

const presets: ThemePreset[] = [
	{ name: 'One', blurb: 'first', tokens: { '--primary': 'oklch(0.4 0.1 10)', '--card': 'oklch(1 0 0)' }, tune: { ...DEFAULT_TUNE, radius: 4 } },
	{ name: 'Two', blurb: 'second', tokens: { '--primary': 'oklch(0.7 0.2 20)' }, tune: { ...DEFAULT_TUNE, radius: 16 } },
]

describe('defaultThemeState', () => {
	test('uses the first preset and its tune', () => {
		expect(defaultThemeState(presets)).toEqual({ presetIndex: 0, tune: presets[0].tune })
	})

	test('falls back to the neutral tune when the preset table is empty', () => {
		expect(defaultThemeState([])).toEqual({ presetIndex: 0, tune: DEFAULT_TUNE })
	})
})

describe('normalizeThemeState', () => {
	test('keeps a valid preset index and tune', () => {
		const raw = { presetIndex: 1, tune: { ...DEFAULT_TUNE, radius: 20 } }
		expect(normalizeThemeState(presets, raw)).toEqual({ presetIndex: 1, tune: { ...DEFAULT_TUNE, radius: 20 } })
	})

	test('falls back to the first preset for an out-of-range or non-integer index', () => {
		expect(normalizeThemeState(presets, { presetIndex: 9, tune: DEFAULT_TUNE }).presetIndex).toBe(0)
		expect(normalizeThemeState(presets, { presetIndex: 1.5, tune: DEFAULT_TUNE }).presetIndex).toBe(0)
		expect(normalizeThemeState(presets, { presetIndex: -1, tune: DEFAULT_TUNE }).presetIndex).toBe(0)
	})

	test('clamps a tune value outside its control range instead of rejecting the payload', () => {
		const raw = { presetIndex: 1, tune: { ...DEFAULT_TUNE, radius: 999 } }
		const normalized = normalizeThemeState(presets, raw)
		expect(normalized.presetIndex).toBe(1)
		expect(normalized.tune.radius).toBe(32)
	})

	test('keeps the preset default for missing or non-numeric controls', () => {
		const raw = { presetIndex: 0, tune: { radius: 'huge', shadow: Number.NaN } }
		const normalized = normalizeThemeState(presets, raw)
		expect(normalized.tune).toEqual(presets[0].tune)
	})

	test('degrades to the default for non-object input', () => {
		expect(normalizeThemeState(presets, null)).toEqual(defaultThemeState(presets))
		expect(normalizeThemeState(presets, 'nope')).toEqual(defaultThemeState(presets))
	})
})

describe('readThemeState', () => {
	test('reads a serialized value', () => {
		const stored = serializeThemeState({ presetIndex: 1, tune: { ...DEFAULT_TUNE, radius: 12 } })
		expect(readThemeState(presets, stored).presetIndex).toBe(1)
	})

	test('degrades to the default for malformed JSON and for null', () => {
		expect(readThemeState(presets, '{not json')).toEqual(defaultThemeState(presets))
		expect(readThemeState(presets, null)).toEqual(defaultThemeState(presets))
	})
})

describe('resolveThemeTokens', () => {
	test('merges the preset tokens with the tune tokens', () => {
		const tokens = resolveThemeTokens(presets, { presetIndex: 1, tune: { ...DEFAULT_TUNE, radius: 22 } })
		expect(tokens['--primary']).toBe('oklch(0.7 0.2 20)')
		expect(tokens['--radius']).toBe('22px')
	})

	test('falls back to the first preset for an unknown index', () => {
		const tokens = resolveThemeTokens(presets, { presetIndex: 9, tune: DEFAULT_TUNE })
		expect(tokens['--primary']).toBe('oklch(0.4 0.1 10)')
	})
})

test('the storage key is namespaced to the product', () => {
	expect(THEME_STORAGE_KEY).toBe('plebeian.ui-theme')
})
