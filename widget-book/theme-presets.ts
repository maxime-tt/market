import type { ThemeTokens } from '@ui/theme/theme-migration-wrapper'
import type { TuneSettings } from '@ui/theme/tune'

/**
 * Demo presets for the widget book. Each preset is one token record — colours,
 * fonts, and the six tune dimensions. The CMS will store the same shape.
 *
 * Fonts are loaded by `widget-book/index.html` from Google Fonts. Licensing is
 * a production decision; the harness only needs representative families.
 */
export interface ThemePreset {
	name: string
	/** One-line description shown under the switcher. */
	blurb: string
	tokens: ThemeTokens
	tune: TuneSettings
}

export const THEME_PRESETS: ThemePreset[] = [
	{
		name: 'Brand',
		blurb: 'The current Plebeian token baseline.',
		tokens: {},
		tune: { radius: 4, shadow: 1, glass: 0, spacing: 1, texture: 0, handmade: 0 },
	},
	{
		name: 'Hedgerow',
		blurb: 'Organic farmer — warm paper, sage and terracotta, hand-cut corners.',
		tokens: {
			'--background': 'oklch(0.96 0.02 90)',
			'--foreground': 'oklch(0.28 0.03 140)',
			'--card': 'oklch(0.98 0.015 90)',
			'--card-foreground': 'oklch(0.28 0.03 140)',
			'--popover': 'oklch(0.98 0.015 90)',
			'--popover-foreground': 'oklch(0.28 0.03 140)',
			'--primary': 'oklch(0.42 0.07 145)',
			'--primary-foreground': 'oklch(0.98 0.015 90)',
			'--primary-border': 'oklch(0.42 0.07 145)',
			'--secondary': 'oklch(0.62 0.13 55)',
			'--secondary-foreground': 'oklch(0.98 0.015 90)',
			'--muted': 'oklch(0.93 0.02 90)',
			'--muted-foreground': 'oklch(0.48 0.03 130)',
			'--accent': 'oklch(0.9 0.04 90)',
			'--accent-foreground': 'oklch(0.3 0.03 140)',
			'--border': 'oklch(0.86 0.03 85)',
			'--input': 'oklch(0.75 0.04 85)',
			'--ring': 'oklch(0.55 0.1 145)',
			'--font-body': "'DM Sans', sans-serif",
			'--font-header': "'Fraunces', serif",
		},
		tune: { radius: 14, shadow: 0.35, glass: 0.55, spacing: 1.1, texture: 0.5, handmade: 0.6 },
	},
	{
		name: 'Salon',
		blurb: 'Artist portfolio — gallery white, ink serif, sharp corners.',
		tokens: {
			'--background': 'oklch(0.98 0.005 90)',
			'--foreground': 'oklch(0.2 0.01 90)',
			'--card': 'oklch(1 0 0)',
			'--card-foreground': 'oklch(0.2 0.01 90)',
			'--popover': 'oklch(1 0 0)',
			'--popover-foreground': 'oklch(0.2 0.01 90)',
			'--primary': 'oklch(0.25 0.02 90)',
			'--primary-foreground': 'oklch(0.98 0.005 90)',
			'--primary-border': 'oklch(0.25 0.02 90)',
			'--secondary': 'oklch(0.7 0.08 20)',
			'--secondary-foreground': 'oklch(0.2 0.01 90)',
			'--muted': 'oklch(0.95 0.005 90)',
			'--muted-foreground': 'oklch(0.5 0.01 90)',
			'--accent': 'oklch(0.94 0.01 20)',
			'--accent-foreground': 'oklch(0.25 0.02 20)',
			'--border': 'oklch(0.88 0.01 90)',
			'--input': 'oklch(0.8 0.01 90)',
			'--ring': 'oklch(0.4 0.02 90)',
			'--font-body': "'DM Sans', sans-serif",
			'--font-header': "'Instrument Serif', serif",
		},
		tune: { radius: 0, shadow: 0.12, glass: 0.25, spacing: 1.3, texture: 0.1, handmade: 0 },
	},
	{
		name: 'Vault',
		blurb: 'BTC trading cards — deep night, mono body, display headings.',
		tokens: {
			'--background': 'oklch(0.16 0.02 280)',
			'--foreground': 'oklch(0.95 0.01 280)',
			'--card': 'oklch(0.22 0.03 280)',
			'--card-foreground': 'oklch(0.95 0.01 280)',
			'--popover': 'oklch(0.22 0.03 280)',
			'--popover-foreground': 'oklch(0.95 0.01 280)',
			'--primary': 'oklch(0.75 0.18 330)',
			'--primary-foreground': 'oklch(0.16 0.02 280)',
			'--primary-border': 'oklch(0.75 0.18 330)',
			'--secondary': 'oklch(0.35 0.06 280)',
			'--secondary-foreground': 'oklch(0.95 0.01 280)',
			'--muted': 'oklch(0.28 0.03 280)',
			'--muted-foreground': 'oklch(0.75 0.02 280)',
			'--accent': 'oklch(0.32 0.05 330)',
			'--accent-foreground': 'oklch(0.95 0.01 280)',
			'--border': 'oklch(0.32 0.03 280)',
			'--input': 'oklch(0.4 0.04 280)',
			'--ring': 'oklch(0.75 0.18 330)',
			'--font-body': "'JetBrains Mono', monospace",
			'--font-header': "'Bricolage Grotesque', sans-serif",
		},
		tune: { radius: 14, shadow: 0.8, glass: 0.7, spacing: 1, texture: 0.15, handmade: 0.1 },
	},
	{
		name: 'Ledger',
		blurb: 'Accountant — crisp paper, tabular mono, tight radius.',
		tokens: {
			'--background': 'oklch(0.99 0.002 90)',
			'--foreground': 'oklch(0.22 0.01 90)',
			'--card': 'oklch(1 0 0)',
			'--card-foreground': 'oklch(0.22 0.01 90)',
			'--popover': 'oklch(1 0 0)',
			'--popover-foreground': 'oklch(0.22 0.01 90)',
			'--primary': 'oklch(0.35 0.06 250)',
			'--primary-foreground': 'oklch(1 0 0)',
			'--primary-border': 'oklch(0.35 0.06 250)',
			'--secondary': 'oklch(0.6 0.09 170)',
			'--secondary-foreground': 'oklch(0.15 0.01 170)',
			'--muted': 'oklch(0.96 0.004 90)',
			'--muted-foreground': 'oklch(0.5 0.01 90)',
			'--accent': 'oklch(0.94 0.01 250)',
			'--accent-foreground': 'oklch(0.25 0.03 250)',
			'--border': 'oklch(0.9 0.005 90)',
			'--input': 'oklch(0.82 0.005 90)',
			'--ring': 'oklch(0.5 0.06 250)',
			'--font-body': "'DM Sans', sans-serif",
			'--font-header': "'JetBrains Mono', monospace",
		},
		tune: { radius: 8, shadow: 0.25, glass: 0.3, spacing: 1, texture: 0, handmade: 0 },
	},
]
