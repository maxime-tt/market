import { describe, expect, test } from 'bun:test'

/*
 * Theme contrast checks — deterministic WCAG AA verification for UX-state
 * tokens defined in styles/globals-new.css.
 *
 * Values mirror styles/globals-new.css — update both when changing tokens.
 * Each test converts oklch → sRGB → relative luminance and asserts a
 * contrast ratio >= 4.5:1 (WCAG AA for normal text).
 */

/** Convert oklch to linear sRGB, then compute WCAG relative luminance. */
function oklchToLuminance(L: number, C: number, h: number): number {
	const hr = (h * Math.PI) / 180
	const a = C * Math.cos(hr)
	const b = C * Math.sin(hr)

	const l_ = L + 0.3963377774 * a + 0.2158037573 * b
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b
	const s_ = L - 0.0894841775 * a - 1.291485548 * b

	const l = l_ ** 3
	const m = m_ ** 3
	const s = s_ ** 3

	const r = Math.max(0, Math.min(1, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s))
	const g = Math.max(0, Math.min(1, -1.2684380041 * l + 2.6097574051 * m - 0.3413193965 * s))
	const bl = Math.max(0, Math.min(1, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s))

	function toLinear(c: number): number {
		return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
	}

	function srgbToLinear(c: number): number {
		if (c <= 0.03928) return c / 12.92
		return ((c + 0.055) / 1.055) ** 2.4
	}

	const R = srgbToLinear(toLinear(r))
	const G = srgbToLinear(toLinear(g))
	const B = srgbToLinear(toLinear(bl))

	return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

function contrastRatio(lum1: number, lum2: number): number {
	const lighter = Math.max(lum1, lum2)
	const darker = Math.min(lum1, lum2)
	return (lighter + 0.05) / (darker + 0.05)
}

// Token pairs from styles/globals-new.css — [fill, foreground] in oklch
type ToneTokens = {
	fill: readonly [number, number, number]
	fg: readonly [number, number, number]
	muted: readonly [number, number, number]
	mutedFg: readonly [number, number, number]
}

const LIGHT_MODE_TOKENS: Record<string, ToneTokens> = {
	info: { fill: [0.623, 0.188, 259.8], fg: [0.237, 0.059, 259], muted: [0.932, 0.032, 255.6], mutedFg: [0.237, 0.059, 259] },
	warning: { fill: [0.769, 0.165, 70.1], fg: [0.216, 0.006, 56], muted: [0.962, 0.058, 95.6], mutedFg: [0.216, 0.006, 56] },
	error: { fill: [0.637, 0.208, 25.3], fg: [0.205, 0.057, 23.5], muted: [0.936, 0.031, 17.7], mutedFg: [0.205, 0.057, 23.5] },
	success: { fill: [0.723, 0.192, 149.6], fg: [0.266, 0.063, 152.9], muted: [0.962, 0.043, 156.7], mutedFg: [0.266, 0.063, 152.9] },
}

const DARK_MODE_TOKENS: Record<string, ToneTokens> = {
	info: { fill: [0.714, 0.143, 254.6], fg: [0.237, 0.059, 259], muted: [0.346, 0.074, 256], mutedFg: [0.9, 0.04, 256] },
	warning: { fill: [0.837, 0.164, 84.4], fg: [0.216, 0.006, 56], muted: [0.286, 0.064, 53.8], mutedFg: [0.93, 0.06, 90] },
	error: { fill: [0.711, 0.166, 22.2], fg: [0.205, 0.057, 23.5], muted: [0.271, 0.101, 12.1], mutedFg: [0.92, 0.05, 20] },
	success: { fill: [0.8, 0.182, 151.7], fg: [0.266, 0.063, 152.9], muted: [0.3, 0.06, 152], mutedFg: [0.92, 0.06, 156] },
}

const WCAG_AA_NORMAL = 4.5
const WCAG_AA_NON_TEXT = 3

/**
 * Phase 0 — the Tier-1 role values and their boundaries.
 *
 * These mirror `styles/globals-new.css` literally, exactly as the UX-state
 * tables above do: change a token and this file changes in the same commit.
 * Text pairs must clear WCAG AA 4.5:1; the interactive boundary
 * (`--border-strong`) and the focus ring must clear the 3:1 of WCAG 1.4.11 /
 * 2.4.13. `--border-default` is a decorative hairline (1.4:1 by design, per
 * the warm-editorial direction) and is deliberately not asserted.
 *
 * Deviation: the frame (notes/artboards/browse/frames/Glje8eeQGh__browse-idle-1440.html)
 * uses --focus-ring: oklch(0.45 0.15 350) as a scheme-stable value. This cannot clear
 * 3:1 on dark ground (max 2.59:1 on pure black). The adopted single scheme-stable value
 * is oklch(0.58 0.15 350): 4.65:1 on light bg, 3.90:1 on dark bg.
 */
type RolePair = readonly [number, number, number]
type RoleTable = Record<string, RolePair>

const LIGHT_ROLES = {
	bg: [1, 0, 0],
	'surface-raised': [0.985, 0, 0],
	'surface-sunken': [0.96, 0.008, 350],
	'surface-hover': [0.93, 0.016, 350],
	'fill-accent': [0.34, 0.11, 350],
	'on-fill-accent': [0.99, 0, 0],
	'fill-ink': [0.688, 0.249, 348],
	'on-fill-ink': [0.145, 0, 0],
	'fill-ink-hover': [0.63, 0.24, 348],
	'text-high': [0.22, 0.02, 340],
	'text-mid': [0.48, 0.03, 340],
	'border-strong': [0.66, 0.03, 340],
	'focus-ring': [0.58, 0.15, 350],
} satisfies RoleTable

const DARK_ROLES = {
	bg: [0.2, 0, 0],
	'surface-raised': [0.24, 0, 0],
	'surface-sunken': [0.15, 0.0056, 350],
	'surface-hover': [0.19, 0.01, 350],
	'fill-accent': [0.34, 0.11, 350],
	'on-fill-accent': [0.99, 0, 0],
	'fill-ink': [0.85, 0.174, 348],
	'on-fill-ink': [0.12, 0, 0],
	'fill-ink-hover': [0.91, 0.168, 348],
	'text-high': [0.95, 0.014, 340],
	'text-mid': [0.76, 0.021, 340],
	'border-strong': [0.55, 0.021, 340],
	'focus-ring': [0.58, 0.15, 350],
} satisfies RoleTable

function roleTextPairs(roles: RoleTable): Array<[string, RolePair, RolePair]> {
	const pair = (label: string, a: string, b: string): [string, RolePair, RolePair] => [label, roles[a]!, roles[b]!]
	return [
		pair('--text-high on --bg', 'bg', 'text-high'),
		pair('--text-high on --surface-raised', 'surface-raised', 'text-high'),
		pair('--text-mid on --bg', 'bg', 'text-mid'),
		pair('--text-mid on --surface-raised', 'surface-raised', 'text-mid'),
		pair('--text-mid on --surface-sunken', 'surface-sunken', 'text-mid'),
		pair('--on-fill-accent on --fill-accent', 'fill-accent', 'on-fill-accent'),
		pair('--on-fill-ink on --fill-ink', 'fill-ink', 'on-fill-ink'),
		pair('--on-fill-ink on --fill-ink-hover', 'fill-ink-hover', 'on-fill-ink'),
	]
}

function expectPairs(minimum: number, pairs: Array<[string, RolePair, RolePair]>) {
	const failures = pairs
		.map(([label, a, b]) => [label, contrastRatio(oklchToLuminance(...a), oklchToLuminance(...b))] as const)
		.filter(([, ratio]) => ratio < minimum)
		.map(([label, ratio]) => `${label} = ${ratio.toFixed(2)}:1`)
	expect(failures).toEqual([])
}

describe('theme contrast — Tier-1 roles (Phase 0 warm-editorial values)', () => {
	for (const [mode, roles] of [
		['light', LIGHT_ROLES],
		['dark', DARK_ROLES],
	] as const) {
		test(`${mode}: every text pair clears ${WCAG_AA_NORMAL}:1`, () => {
			expectPairs(WCAG_AA_NORMAL, roleTextPairs(roles))
		})

		test(`${mode}: interactive boundary and focus ring clear ${WCAG_AA_NON_TEXT}:1`, () => {
			expectPairs(WCAG_AA_NON_TEXT, [
				['--border-strong on --bg', roles.bg, roles['border-strong']],
				['--focus-ring on --bg', roles.bg, roles['focus-ring']],
			])
		})
	}
})

describe('theme contrast — legacy fill/label pairs (≥ 4.5:1)', () => {
	// --primary/primary-foreground (+hover), --secondary/secondary-foreground,
	// --focus/focus-foreground (+hover) must all clear 4.5:1 in both modes.
	const legacyLight = {
		'--primary': { fill: [0.688, 0.249, 348] as RolePair, fg: [0.145, 0, 0] as RolePair, fgHover: [0.145, 0, 0] as RolePair },
		'--secondary': { fill: [0.688, 0.249, 348] as RolePair, fg: [0.145, 0, 0] as RolePair, fgHover: [0.145, 0, 0] as RolePair },
		'--focus': { fill: [0.688, 0.249, 348] as RolePair, fg: [0.145, 0, 0] as RolePair, fgHover: [0.12, 0, 0] as RolePair },
	} satisfies Record<string, { fill: RolePair; fg: RolePair; fgHover: RolePair }>
	for (const [name, { fill, fg, fgHover }] of Object.entries(legacyLight)) {
		test(`${name} foreground passes WCAG AA (light)`, () => {
			const ratio = contrastRatio(oklchToLuminance(...fill), oklchToLuminance(...fg))
			expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL)
		})
		test(`${name} foreground-hover passes WCAG AA (light)`, () => {
			const ratio = contrastRatio(oklchToLuminance(...fill), oklchToLuminance(...fgHover))
			expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL)
		})
	}
	const legacyDark = {
		'--primary': { fill: [0.85, 0.174, 348] as RolePair, fg: [0.12, 0, 0] as RolePair, fgHover: [0.12, 0, 0] as RolePair },
		'--secondary': { fill: [0.85, 0.174, 348] as RolePair, fg: [0.12, 0, 0] as RolePair, fgHover: [0.12, 0, 0] as RolePair },
		'--focus': { fill: [0.85, 0.174, 348] as RolePair, fg: [0.12, 0, 0] as RolePair, fgHover: [0.12, 0, 0] as RolePair },
	} satisfies Record<string, { fill: RolePair; fg: RolePair; fgHover: RolePair }>
	for (const [name, { fill, fg, fgHover }] of Object.entries(legacyDark)) {
		test(`${name} foreground passes WCAG AA (dark)`, () => {
			const ratio = contrastRatio(oklchToLuminance(...fill), oklchToLuminance(...fg))
			expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL)
		})
		test(`${name} foreground-hover passes WCAG AA (dark)`, () => {
			const ratio = contrastRatio(oklchToLuminance(...fill), oklchToLuminance(...fgHover))
			expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL)
		})
	}
})

describe('theme contrast — legacy boundary pairs (≥ 3:1)', () => {
	const WCAG_NON_TEXT = 3
	const bgLight = [1, 0, 0] as RolePair
	const bgDark = [0.2, 0, 0] as RolePair
	const ring = [0.58, 0.15, 350] as RolePair
	const inputLight = [0.66, 0.03, 340] as RolePair
	const inputDark = [0.55, 0.021, 340] as RolePair

	test('--ring clears 3:1 on light bg', () => {
		expect(contrastRatio(oklchToLuminance(...bgLight), oklchToLuminance(...ring))).toBeGreaterThanOrEqual(WCAG_NON_TEXT)
	})
	test('--ring clears 3:1 on dark bg', () => {
		expect(contrastRatio(oklchToLuminance(...bgDark), oklchToLuminance(...ring))).toBeGreaterThanOrEqual(WCAG_NON_TEXT)
	})
	test('--input clears 3:1 on light bg', () => {
		expect(contrastRatio(oklchToLuminance(...bgLight), oklchToLuminance(...inputLight))).toBeGreaterThanOrEqual(WCAG_NON_TEXT)
	})
	test('--input clears 3:1 on dark bg', () => {
		expect(contrastRatio(oklchToLuminance(...bgDark), oklchToLuminance(...inputDark))).toBeGreaterThanOrEqual(WCAG_NON_TEXT)
	})
})

describe('theme contrast — WCAG AA for UX-state tokens (≥ 4.5:1)', () => {
	describe('light mode', () => {
		for (const [name, { fill, fg, muted, mutedFg }] of Object.entries(LIGHT_MODE_TOKENS)) {
			test(`${name} foreground on ${name} fill passes WCAG AA`, () => {
				const fillLum = oklchToLuminance(...fill)
				const fgLum = oklchToLuminance(...fg)
				const ratio = contrastRatio(fillLum, fgLum)
				expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL)
			})

			test(`${name} muted foreground on ${name} muted fill passes WCAG AA`, () => {
				const ratio = contrastRatio(oklchToLuminance(...muted), oklchToLuminance(...mutedFg))
				expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL)
			})
		}
	})

	describe('dark mode', () => {
		for (const [name, { fill, fg, muted, mutedFg }] of Object.entries(DARK_MODE_TOKENS)) {
			test(`${name} foreground on ${name} fill passes WCAG AA`, () => {
				const fillLum = oklchToLuminance(...fill)
				const fgLum = oklchToLuminance(...fg)
				const ratio = contrastRatio(fillLum, fgLum)
				expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL)
			})

			test(`${name} muted foreground on ${name} muted fill passes WCAG AA`, () => {
				const ratio = contrastRatio(oklchToLuminance(...muted), oklchToLuminance(...mutedFg))
				expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL)
			})
		}
	})
})
