import { describe, expect, test } from 'bun:test'
import { STOREFRONT_THEME_IDS } from '@sdk/commerce/storefront/storefrontPage'
import {
	getStorefrontTheme,
	isPaletteInTheme,
	storefrontThemeCssVars,
	storefrontThemePaletteKeys,
	storefrontThemeSwatchColors,
	validateStorefrontThemeSelection,
	RETIRED_STOREFRONT_THEMES,
	STOREFRONT_THEMES,
	STOREFRONT_THEME_LIST,
} from './storefrontThemes'

const OKLCH_PATTERN = /^oklch\([\d.]+ [\d.]+ [\d.]+\)$/

describe('STOREFRONT_THEMES registry', () => {
	test('has exactly one entry per id in the schema — the CMS and the schema can never list different themes', () => {
		const registryIds = Object.keys(STOREFRONT_THEMES).sort()
		expect(registryIds).toEqual([...STOREFRONT_THEME_IDS].sort())
	})

	test('STOREFRONT_THEME_LIST follows the schema-declared order, without retired looks', () => {
		const offered = STOREFRONT_THEME_IDS.filter((id) => !RETIRED_STOREFRONT_THEMES[id])
		expect(STOREFRONT_THEME_LIST.map((t) => t.id)).toEqual([...offered])
		expect(STOREFRONT_THEME_LIST.map((t) => t.id)).not.toContain('brut')
	})

	test('a retired look renders as the look it was folded into', () => {
		expect(getStorefrontTheme('brut').id).toBe('pleb')
	})

	test('Brutalist and Neon are listed once, under Plebeian', () => {
		for (const key of ['brutal', 'neon']) {
			const owners = STOREFRONT_THEME_LIST.filter((t) => t.palettes.some((p) => p.key === key)).map((t) => t.id)
			expect(owners, key).toEqual(['pleb'])
		}
	})

	test('every theme defines all ten tokens as non-empty oklch() strings', () => {
		const tokenKeys: (keyof (typeof STOREFRONT_THEMES)['default']['tokens'])[] = [
			'background',
			'foreground',
			'card',
			'cardForeground',
			'primary',
			'primaryForeground',
			'secondary',
			'muted',
			'mutedForeground',
			'border',
		]

		for (const theme of STOREFRONT_THEME_LIST) {
			for (const key of tokenKeys) {
				const value = theme.tokens[key]
				expect(value, `${theme.id}.${key}`).toMatch(OKLCH_PATTERN)
			}
		}
	})

	test('every theme has a label and a description', () => {
		for (const theme of STOREFRONT_THEME_LIST) {
			expect(theme.label.length, theme.id).toBeGreaterThan(0)
			expect(theme.description.length, theme.id).toBeGreaterThan(0)
		}
	})

	test('id field matches the key it is stored under', () => {
		for (const [key, theme] of Object.entries(STOREFRONT_THEMES)) {
			expect(theme.id as string).toBe(RETIRED_STOREFRONT_THEMES[key as keyof typeof RETIRED_STOREFRONT_THEMES] ?? key)
		}
	})
})

describe('getStorefrontTheme', () => {
	test('returns the matching theme for a valid id', () => {
		expect(getStorefrontTheme('midnight').id).toBe('midnight')
	})

	test('falls back to default for an id outside the closed set, rather than throwing', () => {
		expect(getStorefrontTheme('nonexistent-theme').id).toBe('default')
		expect(getStorefrontTheme('__proto__').id).toBe('default')
		expect(getStorefrontTheme('constructor').id).toBe('default')
	})

	test('falls back to default for undefined', () => {
		expect(getStorefrontTheme(undefined).id).toBe('default')
	})
})

describe('storefrontThemeCssVars', () => {
	test('produces every custom property name the storefront components read', () => {
		const vars = storefrontThemeCssVars(STOREFRONT_THEMES.midnight) as Record<string, string>
		expect(vars).toEqual({
			'--background': STOREFRONT_THEMES.midnight.tokens.background,
			'--foreground': STOREFRONT_THEMES.midnight.tokens.foreground,
			'--card': STOREFRONT_THEMES.midnight.tokens.card,
			'--card-foreground': STOREFRONT_THEMES.midnight.tokens.cardForeground,
			'--primary': STOREFRONT_THEMES.midnight.tokens.primary,
			'--primary-foreground': STOREFRONT_THEMES.midnight.tokens.primaryForeground,
			'--secondary': STOREFRONT_THEMES.midnight.tokens.secondary,
			'--muted': STOREFRONT_THEMES.midnight.tokens.muted,
			'--muted-foreground': STOREFRONT_THEMES.midnight.tokens.mutedForeground,
			'--border': STOREFRONT_THEMES.midnight.tokens.border,
		})
	})
})

describe('storefrontThemeSwatchColors', () => {
	test('returns five colors for the picker dots', () => {
		expect(storefrontThemeSwatchColors(STOREFRONT_THEMES.default)).toHaveLength(5)
	})
})

describe('isPaletteInTheme — a colourway belongs to a layout, not to the app', () => {
	test('a layout offers its own colourways', () => {
		expect(isPaletteInTheme('elec', 'hi-vis')).toBe(true)
		expect(isPaletteInTheme('cards', 'holo-night')).toBe(true)
	})

	test('a colourway from another layout does not belong', () => {
		expect(isPaletteInTheme('elec', 'holo-night')).toBe(false)
		expect(isPaletteInTheme('cards', 'hi-vis')).toBe(false)
		// `concrete` and `acid` are brut's alone; nothing else offers them.
		expect(isPaletteInTheme('elec', 'concrete')).toBe(false)
		expect(isPaletteInTheme('farm', 'acid')).toBe(false)
	})

	test('Brutalist and Neon belong to Plebeian only', () => {
		expect(isPaletteInTheme('pleb', 'brutal')).toBe(true)
		expect(isPaletteInTheme('pleb', 'neon')).toBe(true)
		expect(isPaletteInTheme('elec', 'brutal')).toBe(false)
		expect(isPaletteInTheme('arena', 'neon')).toBe(false)
	})

	test('every layout accepts every key it actually offers', () => {
		for (const theme of STOREFRONT_THEME_LIST) {
			for (const key of storefrontThemePaletteKeys(theme.id)) {
				expect(isPaletteInTheme(theme.id, key), `${theme.id}/${key}`).toBe(true)
			}
		}
	})
})

describe('validateStorefrontThemeSelection — the pairing the schema cannot check', () => {
	test('accepts a colourway that belongs to the layout', () => {
		expect(validateStorefrontThemeSelection({ theme: 'elec', palette: 'hi-vis' })).toEqual([])
	})

	test('accepts an empty key, which means "this layout default"', () => {
		expect(validateStorefrontThemeSelection({ theme: 'elec', palette: '' })).toEqual([])
		expect(validateStorefrontThemeSelection({ theme: 'elec' })).toEqual([])
	})

	test('rejects the exact pairing a real published page shipped with', () => {
		// theme=elec alongside the `cards` colourway holo-night — and `cards`'
		// default tune. The layout switch wrote only the layout.
		const errors = validateStorefrontThemeSelection({ theme: 'elec', palette: 'holo-night' })
		expect(errors).toHaveLength(1)
		expect(errors[0]).toContain('holo-night')
		expect(errors[0]).toContain('Live Wire')
		expect(errors[0]).toContain('hi-vis')
	})

	test('agrees with isPaletteInTheme across every layout and every key in the app', () => {
		const everyKey = Array.from(new Set(STOREFRONT_THEME_LIST.flatMap((theme) => storefrontThemePaletteKeys(theme.id))))
		for (const theme of STOREFRONT_THEME_LIST) {
			for (const key of everyKey) {
				const accepted = validateStorefrontThemeSelection({ theme: theme.id, palette: key }).length === 0
				expect(accepted, `${theme.id}/${key}`).toBe(isPaletteInTheme(theme.id, key))
			}
		}
	})

	test('an unknown layout id resolves to default rather than throwing', () => {
		expect(validateStorefrontThemeSelection({ theme: 'not-a-layout', palette: '' })).toEqual([])
		expect(validateStorefrontThemeSelection({ theme: 'not-a-layout', palette: 'holo-night' })).toHaveLength(1)
	})
})

/**
 * Arena is adapted from the Plebeian Auctions Arena C layout. These pin what
 * makes it that theme rather than another dark one, and check that every
 * text-on-surface pair it ships reads at WCAG AA (4.5:1).
 */
describe('arena theme', () => {
	/** oklch → WCAG relative luminance, via linear sRGB (no gamma round-trip needed). */
	function luminance(oklch: string): number {
		const [L, C, h] = oklch.slice(6, -1).split(' ').map(Number)
		const hr = (h * Math.PI) / 180
		const a = C * Math.cos(hr)
		const b = C * Math.sin(hr)
		const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
		const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
		const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
		const clamp = (x: number) => Math.max(0, Math.min(1, x))
		const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
		const g = clamp(-1.2684380041 * l + 2.6097574051 * m - 0.3413193965 * s)
		const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
		return 0.2126 * r + 0.7152 * g + 0.0722 * bl
	}
	function contrast(x: string, y: string): number {
		const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p)
		return (hi + 0.05) / (lo + 0.05)
	}

	const arena = STOREFRONT_THEMES.arena

	test('defaults to the dark Arena palette with its big panel corners', () => {
		expect(arena.palettes[0].key).toBe('arena')
		expect(arena.palettes[0].dark).toBe(true)
		expect(arena.tune.radiusPx).toBe(22)
	})

	test('keeps the hot pink the auction app and the market share', () => {
		expect(arena.tokens.primary).toBe('oklch(0.688 0.249 348.0)')
	})

	test('offers its own four colourways', () => {
		for (const key of ['arena', 'arena-lime', 'sats-orange', 'arena-day'] as const) {
			expect(isPaletteInTheme('arena', key), key).toBe(true)
		}
	})

	test('every palette reads at WCAG AA for body text and buttons', () => {
		for (const palette of arena.palettes) {
			const t = palette.tokens
			expect(contrast(t.foreground, t.background), `${palette.key} text`).toBeGreaterThanOrEqual(4.5)
			expect(contrast(t.cardForeground, t.card), `${palette.key} card`).toBeGreaterThanOrEqual(4.5)
			expect(contrast(t.primaryForeground, t.primary), `${palette.key} button`).toBeGreaterThanOrEqual(4.5)
			expect(contrast(t.mutedForeground, t.background), `${palette.key} muted`).toBeGreaterThanOrEqual(4.5)
		}
	})
})
