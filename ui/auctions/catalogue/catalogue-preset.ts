/**
 * The Catalogue theme preset — Layout A of the pplx baseline, as data.
 *
 * Rebuilt from `notes/artboards/auctions/reference/EXTRACTION-STRUCTURE.md`,
 * the recorded extraction of the reference app, because the earlier preset
 * worktree (`wt-theme-pplx`) was never committed and no longer exists. Every
 * value below carries the extraction's own citation so a reader can check it
 * against the source rather than trusting this file.
 *
 * Two modes: Layout A is light (`--bg #F4ECE3`), and the extraction's dark set
 * (`S:32`) belongs to the same reference app's Live Show / Arena layouts. The
 * dark set is carried here so a later surface does not have to re-derive it,
 * but the Catalogue list itself is light-only — the owner's ruling is that
 * Layout A is the baseline.
 *
 * This is a token artefact, not a UI: `catalogueCssVars()` is the only export
 * the view consumes, so a change here moves every styled element at once.
 */

export type CatalogueMode = 'light' | 'dark'

/** The extraction's token table, transcribed (EXTRACTION-STRUCTURE.md:260-274). */
export interface CatalogueTokens {
	/** Brand */
	pink: string
	pinkDeep: string
	orange: string
	lime: string
	/** Semantic states */
	win: string
	lose: string
	info: string
	/** Surfaces and ink */
	bg: string
	surface: string
	surface2: string
	ink: string
	muted: string
	line: string
	accent: string
	accentInk: string
}

export const CATALOGUE_LIGHT: CatalogueTokens = {
	pink: '#FF3EB5', // S:12
	pinkDeep: '#C8157F', // S:12
	orange: '#F7931A', // S:12
	lime: '#C6FF3D', // S:12
	win: '#16A35A', // S:13
	lose: '#E5484D', // S:13
	info: '#3B6FE0', // S:13
	bg: '#F4ECE3', // S:17
	surface: '#FFFCF8', // S:17
	surface2: '#F0E2D5', // S:17
	ink: '#1B1718', // S:17
	muted: '#6E625A', // S:17
	line: '#E2D3C4', // S:17
	accent: '#C8157F', // S:18 — `var(--pink-deep)`, resolved
	accentInk: '#FFFFFF', // S:18
}

export const CATALOGUE_DARK: CatalogueTokens = {
	pink: '#FF3EB5', // S:12
	pinkDeep: '#C8157F', // S:12
	orange: '#F7931A', // S:12
	lime: '#C6FF3D', // S:12
	win: '#16A35A', // S:13
	lose: '#E5484D', // S:13
	info: '#3B6FE0', // S:13
	bg: '#0E0D0E', // S:32
	surface: '#1A181A', // S:32
	surface2: '#242124', // S:32
	ink: '#F6EFEA', // S:32
	muted: '#A69B95', // S:32
	line: '#2F2B2F', // S:32
	accent: '#FF3EB5', // S:32 — `var(--pink)`, resolved
	accentInk: '#111111', // S:32
}

/** Font stacks, verbatim from the extraction (S:9-11). */
export const CATALOGUE_FONTS = {
	serif: "'Instrument Serif', 'Times New Roman', serif",
	sans: "'DM Sans', system-ui, sans-serif",
	mono: "'JetBrains Mono', ui-monospace, monospace",
} as const

/** The extraction's single radius and easing (S:14-15). */
export const CATALOGUE_RADIUS = '14px'
export const CATALOGUE_EASE = 'cubic-bezier(.2, .8, .2, 1)'

export function catalogueTokens(mode: CatalogueMode): CatalogueTokens {
	return mode === 'dark' ? CATALOGUE_DARK : CATALOGUE_LIGHT
}

/**
 * The CSS custom properties the view sets on its root, so the stylesheet reads
 * `var(--cat-*)` and this file is the single source of the values.
 *
 * The prefixes are deliberately `--cat-*`: they must not collide with the app's
 * own `--surface`/`--ink` tokens, which describe a different theme.
 */
export function catalogueCssVars(mode: CatalogueMode = 'light'): Record<string, string> {
	const t = catalogueTokens(mode)
	return {
		'--cat-pink': t.pink,
		'--cat-pink-deep': t.pinkDeep,
		'--cat-orange': t.orange,
		'--cat-lime': t.lime,
		'--cat-win': t.win,
		'--cat-lose': t.lose,
		'--cat-info': t.info,
		'--cat-bg': t.bg,
		'--cat-surface': t.surface,
		'--cat-surface-2': t.surface2,
		'--cat-ink': t.ink,
		'--cat-muted': t.muted,
		'--cat-line': t.line,
		'--cat-accent': t.accent,
		'--cat-accent-ink': t.accentInk,
		'--cat-serif': CATALOGUE_FONTS.serif,
		'--cat-sans': CATALOGUE_FONTS.sans,
		'--cat-mono': CATALOGUE_FONTS.mono,
		'--cat-radius': CATALOGUE_RADIUS,
		'--cat-ease': CATALOGUE_EASE,
	}
}
