/**
 * The admin console's appearance: one fixed design system for the dashboard
 * and settings ("business at the back"), independent of the instance's public
 * storefront theme ("party in the front"). See ADR-0022.
 *
 * This module is pure data: the closed lists of styles, colours and modes, the
 * default, and the parse step that turns whatever a browser stored into a
 * valid value. Persistence lives in the platform layer.
 */

export const ADMIN_STYLES = ['glass', 'solid', 'minimal'] as const
export type AdminStyle = (typeof ADMIN_STYLES)[number]

/** Styles an admin can pick today. Solid and Minimal follow in later passes. */
export const AVAILABLE_ADMIN_STYLES: readonly AdminStyle[] = ['glass', 'solid', 'minimal']

export const ADMIN_COLORS = ['teal', 'ocean', 'emerald', 'violet', 'sunset', 'graphite'] as const
export type AdminColor = (typeof ADMIN_COLORS)[number]

export const ADMIN_MODES = ['light', 'dark', 'auto'] as const
export type AdminMode = (typeof ADMIN_MODES)[number]
export type ResolvedAdminMode = Exclude<AdminMode, 'auto'>

export interface AdminAppearance {
	style: AdminStyle
	color: AdminColor
	mode: AdminMode
}

export const DEFAULT_ADMIN_APPEARANCE: AdminAppearance = { style: 'glass', color: 'teal', mode: 'light' }

/** Labels and swatches for the picker. Swatch values mirror styles/admin-theme.css. */
export const ADMIN_COLOR_OPTIONS: readonly { id: AdminColor; label: string; swatch: { light: string; dark: string } }[] = [
	{ id: 'teal', label: 'Teal', swatch: { light: '#0b7d72', dark: '#2dd4bf' } },
	{ id: 'ocean', label: 'Ocean', swatch: { light: '#2563eb', dark: '#60a5fa' } },
	{ id: 'emerald', label: 'Emerald', swatch: { light: '#15803d', dark: '#4ade80' } },
	{ id: 'violet', label: 'Violet', swatch: { light: '#7c3aed', dark: '#a78bfa' } },
	{ id: 'sunset', label: 'Sunset', swatch: { light: '#c2410c', dark: '#fb923c' } },
	{ id: 'graphite', label: 'Graphite', swatch: { light: '#334155', dark: '#cbd5e1' } },
]

export const ADMIN_STYLE_LABELS: Record<AdminStyle, string> = { glass: 'Glass', solid: 'Solid', minimal: 'Minimal' }
export const ADMIN_MODE_LABELS: Record<AdminMode, string> = { light: 'Light', dark: 'Dark', auto: 'Auto' }

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * Turns a stored value into a valid appearance. Anything unknown, including a
 * style that is not available yet, falls back field by field to the default,
 * so a bad or stale entry can never break the dashboard.
 */
export function parseAdminAppearance(raw: unknown): AdminAppearance {
	let value: unknown = raw
	if (typeof raw === 'string') {
		try {
			value = JSON.parse(raw)
		} catch {
			value = null
		}
	}
	const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
	return {
		style: pick(AVAILABLE_ADMIN_STYLES, record.style, DEFAULT_ADMIN_APPEARANCE.style),
		color: pick(ADMIN_COLORS, record.color, DEFAULT_ADMIN_APPEARANCE.color),
		mode: pick(ADMIN_MODES, record.mode, DEFAULT_ADMIN_APPEARANCE.mode),
	}
}

/** Resolves `auto` against the system preference. */
export function resolveAdminMode(mode: AdminMode, prefersDark: boolean): ResolvedAdminMode {
	if (mode === 'auto') return prefersDark ? 'dark' : 'light'
	return mode
}
