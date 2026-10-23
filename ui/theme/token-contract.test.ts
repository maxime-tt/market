import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The Tier-0/Tier-1 token contract (runs/union-1420/TOKEN-ARCHITECTURE-DECISION.md).
 *
 * This is the guard that stops the two failure modes the architecture exists to
 * remove, both of which were measured in this repo before it existed:
 *
 *  1. A name whose value changes *meaning* between light and dark. Legacy
 *     `--primary` was ink in light and brand pink in dark, so one token carried
 *     two roles and no call site could be read without knowing the mode.
 *  2. A token that is declared but never registered (unreachable as a utility)
 *     or registered but never declared (invalid at computed-value time). The
 *     audit found 12 of the former and two families of the latter.
 *
 * It reads the stylesheets as text on purpose: there is no CSS engine in the
 * unit suite, and the contract is about declarations, not computed values.
 */

const STYLES = join(import.meta.dir, '..', '..', 'styles')
const globalsCss = readFileSync(join(STYLES, 'globals.css'), 'utf8')
const globalsNewCss = readFileSync(join(STYLES, 'globals-new.css'), 'utf8')

/** Tier 0 — identity. Scheme-stable, never consumed directly by a component (R5). */
const TIER_0 = ['brand-pink'] as const

/** Tier 1 — the public design API. Names must never collide with a legacy name (R1a). */
const TIER_1_COLOUR = [
	'bg',
	'surface-raised',
	'surface-sunken',
	'surface-hover',
	'fill-accent',
	'on-fill-accent',
	'fill-ink',
	'on-fill-ink',
	'fill-ink-hover',
	'text-high',
	'text-mid',
	'border-default',
	'border-strong',
	'focus-ring',
	'focus-attention',
] as const

/** Tier-1 names that are not colours, so they are not expected to have a `--color-*` utility. */
const TIER_1_NON_COLOUR = ['radius-pill', 'tilt'] as const

const TIER_1 = [...TIER_0, ...TIER_1_COLOUR, ...TIER_1_NON_COLOUR]

/** Names that belong to the Tier-2 compatibility tier and must keep their legacy meaning. */
const TIER_2 = [
	'background',
	'foreground',
	'card',
	'card-foreground',
	'popover',
	'popover-foreground',
	'primary',
	'primary-foreground',
	'secondary',
	'secondary-foreground',
	'tertiary',
	'muted',
	'muted-foreground',
	'accent',
	'accent-foreground',
	'destructive',
	'destructive-foreground',
	'border',
	'input',
	'ring',
	'focus',
	'info',
	'warning',
	'error',
	'success',
	'light-gray',
	'off-black',
	'neo-purple',
	'neo-blue',
	'neo-gray',
	'secondary-black',
	'tertiary-black',
] as const

/**
 * Extract one scope's declarations. `selector` is matched literally and the
 * block is brace-matched, so a selector that also appears inside `@layer base`
 * (`.theme-new` does) still resolves to the first, authoritative block.
 */
function scopeDeclarations(css: string, selector: string): Map<string, string> {
	const start = css.indexOf(`${selector} {`)
	if (start === -1) throw new Error(`scope not found in stylesheet: ${selector}`)

	let depth = 0
	let end = start
	for (let i = css.indexOf('{', start); i < css.length; i++) {
		if (css[i] === '{') depth++
		else if (css[i] === '}') {
			depth--
			if (depth === 0) {
				end = i
				break
			}
		}
	}

	const body = css.slice(css.indexOf('{', start) + 1, end)
	const declarations = new Map<string, string>()
	for (const match of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
		declarations.set(match[1]!, match[2]!.trim())
	}
	return declarations
}

const lightLegacy = scopeDeclarations(globalsCss, ':root')
const darkLegacy = scopeDeclarations(globalsCss, '.dark')
const lightTheme = scopeDeclarations(globalsNewCss, '.theme-new')
const darkTheme = scopeDeclarations(globalsNewCss, '.dark .theme-new')

const SCOPES = {
	'legacy :root': lightLegacy,
	'legacy .dark': darkLegacy,
	'.theme-new': lightTheme,
	'.dark .theme-new': darkTheme,
} as const

const MODES = [
	{ name: 'light', a: 'legacy :root', b: '.theme-new' },
	{ name: 'dark', a: 'legacy .dark', b: '.dark .theme-new' },
] as const

describe('tier separation (R1a)', () => {
	test('no Tier-1 name collides with a Tier-2 name', () => {
		const collisions = TIER_1.filter((token) => (TIER_2 as readonly string[]).includes(token))
		expect(collisions).toEqual([])
	})

	test('the brand colour is not carried by --primary', () => {
		// The whole point of the architecture: legacy `--primary` is ink in light
		// and pink in dark, so it cannot also be the identity token. If a future
		// change re-adds `primary` to Tier 1, this fails.
		expect((TIER_1 as readonly string[]).includes('primary')).toBe(false)
		expect((TIER_0 as readonly string[]).includes('primary')).toBe(false)
	})

	test('the legacy --primary incoherence is still the compat tier, untouched by Tier 1', () => {
		// Recorded deliberately: this is what the migration removes (T6.5), not a bug here.
		expect(lightLegacy.get('primary')).toBe('#1d1d1d')
		expect(darkLegacy.get('primary')).toBe('#ff3eb5')
	})
})

describe('declared in all four scopes', () => {
	for (const token of TIER_1) {
		test(`--${token}`, () => {
			for (const [scopeName, declarations] of Object.entries(SCOPES)) {
				expect(`${scopeName}: ${declarations.has(token)}`).toBe(`${scopeName}: true`)
			}
		})
	}
})

describe('mode agreement between the legacy and theme scopes', () => {
	for (const mode of MODES) {
		for (const token of TIER_1) {
			test(`${mode.name}: --${token}`, () => {
				const legacy = SCOPES[mode.a].get(token)
				const theme = SCOPES[mode.b].get(token)
				expect(theme).toBe(legacy)
			})
		}
	}
})

describe('scheme-stable identity (R1/R5)', () => {
	for (const token of ['brand-pink', 'fill-accent', 'focus-ring'] as const) {
		test(`--${token} is identical in light and dark`, () => {
			expect(darkLegacy.get(token)).toBe(lightLegacy.get(token))
			expect(darkTheme.get(token)).toBe(lightTheme.get(token))
		})
	}

	test('the two inverting roles really do invert', () => {
		// If these ever become scheme-stable they stop being roles and the
		// ink/accent split has silently collapsed.
		expect(darkLegacy.get('fill-ink')).not.toBe(lightLegacy.get('fill-ink'))
		expect(darkLegacy.get('bg')).not.toBe(lightLegacy.get('bg'))
	})
})

describe('every Tier-1 colour token is reachable as a utility', () => {
	for (const token of TIER_1_COLOUR) {
		test(`--color-${token}`, () => {
			expect(globalsCss).toContain(`--color-${token}: var(--${token});`)
		})
	}

	test('Tier 0 is deliberately NOT registered (R5)', () => {
		expect(globalsCss).not.toContain('--color-brand-pink:')
	})
})

/**
 * Group B of Tier 1 — tokens adopted IN PLACE, so they are counted here rather than
 * declared by T6.0. The arithmetic is the R8 budget check: the review found the
 * earlier "46" and "47" figures unreconciled, so the count is pinned in code.
 */
const ADOPTED_IN_PLACE = {
	shadow: 6, // --shadow-{scale,tint} + --shadow-{xs,sm,md,lg}-value
	dims: 4, // --gap, --glass, --grain, --handmade
	fonts: 3, // --font-{body,header,theylive}
	chart: 5, // --chart-1..5 (see ruling R1b: not declared in legacy .dark)
	states: 12, // 4 families x {base, -foreground, -muted} after the collapse
} as const

const TIER_1_BUDGET = 50

function appSources(directory: string): string[] {
	const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
	const files: string[] = []
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
		const full = join(directory, entry.name)
		if (entry.isDirectory()) files.push(...appSources(full))
		// The guard is about APP consumers; a test (including this one) is not one.
		else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full)
	}
	return files
}

function countMatches(pattern: RegExp): { total: number; hits: string[] } {
	const root = join(import.meta.dir, '..', '..')
	let total = 0
	const hits: string[] = []
	for (const tree of ['ui', 'src', 'platform']) {
		for (const file of appSources(join(root, tree))) {
			const matches = readFileSync(file, 'utf8').match(pattern)
			if (!matches) continue
			total += matches.length
			hits.push(`${file.replace(`${root}/`, '')} (${matches.length})`)
		}
	}
	return { total, hits }
}

describe('the R8 token budget is enforced, not an honour system', () => {
	test('Tier 1 stays within 50 names', () => {
		const declared = TIER_1.length
		const adopted = Object.values(ADOPTED_IN_PLACE).reduce((sum, n) => sum + n, 0)
		expect(declared + adopted).toBeLessThanOrEqual(TIER_1_BUDGET)
	})

	test('Group A (declared by T6.0) is 18 names', () => {
		expect(TIER_1.length).toBe(18)
	})
})

describe('deferred fixes stay honestly deferred (S1)', () => {
	// F3 declares --chart-* / --sidebar-* at :root. That is only "inert" while
	// nothing consumes them, so the zero count is asserted rather than assumed:
	// the first future consumer fails this test and forces the F3 decision.
	test('F3: no chart utility has a consumer outside styles/ yet', () => {
		const { total, hits } = countMatches(/\b(?:bg|text|border|fill|stroke)-chart-[0-9]\b/g)
		expect({ total, hits }).toEqual({ total: 0, hits: [] })
	})

	test('F3: no sidebar token has a consumer outside styles/ yet', () => {
		const { total, hits } = countMatches(/\b(?:bg|text|border|ring)-sidebar(?:-[a-z-]+)?\b/g)
		expect({ total, hits }).toEqual({ total: 0, hits: [] })
	})

	test('F4: the two font-body/font-header consumers are recorded, not silently fixed', () => {
		// Declaring these at :root (F4) is a visible change: sidebar-nav's heading
		// asks for font-header, which is undefined outside .theme-new today, so it
		// currently inherits IBM Plex Mono. If a third consumer appears, this fails
		// and the F4 commit has to be re-scoped.
		const { total, hits } = countMatches(/\bfont-(?:body|header)\b/g)
		expect(total).toBe(2)
		expect(hits.map((hit) => hit.split(' (')[0]).sort()).toEqual(['ui/nav/sidebar-nav.tsx', 'ui/nostr/user-card.tsx'])
	})
})

describe('T6.0 fixes', () => {
	test('F1: the dead hover tokens are gone from every scope', () => {
		for (const declarations of Object.values(SCOPES)) {
			expect(declarations.has('primary-hover')).toBe(false)
			expect(declarations.has('secondary-hover')).toBe(false)
		}
	})

	test('F2: --tilt is defined where .tilt consumes it', () => {
		expect(lightLegacy.get('tilt')).toBe('0')
	})
})
