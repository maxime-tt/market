import type { ThemeTokens } from '@ui/theme/theme-migration-wrapper'
import { THEME_PRESETS, type ThemePreset } from '@ui/theme/presets'
import { DEFAULT_TUNE, TUNE_CONTROLS, tuneTokens, type TuneSettings } from '@ui/theme/tune'

/**
 * The app shell's persisted theme value. Small and stable by design: the shell
 * stores which preset is active and the six tune dimensions, then recomputes
 * the full token record from the preset table. This keeps the stored payload
 * independent of any token value changes.
 */
export interface AppThemeState {
	presetIndex: number
	tune: TuneSettings
}

/** localStorage key for the persisted theme value. */
export const THEME_STORAGE_KEY = 'plebeian.ui-theme'

/** The default value: the first preset and its tune. */
export function defaultThemeState(presets: readonly ThemePreset[] = THEME_PRESETS): AppThemeState {
	const preset = presets[0]
	return { presetIndex: 0, tune: preset ? preset.tune : DEFAULT_TUNE }
}

/**
 * Coerces a parsed value into a usable tune. Each numeric control is clamped to
 * its declared range; a missing or non-numeric value keeps the preset default.
 */
function clampTune(raw: unknown, fallback: TuneSettings): TuneSettings {
	const candidate = raw && typeof raw === 'object' ? (raw as Partial<Record<keyof TuneSettings, unknown>>) : {}
	const next: TuneSettings = { ...fallback }
	for (const control of TUNE_CONTROLS) {
		const value = candidate[control.key]
		if (typeof value !== 'number' || !Number.isFinite(value)) continue
		next[control.key] = Math.max(control.min, Math.min(control.max, value))
	}
	return next
}

/**
 * Validates an untrusted value (a parsed localStorage payload or an exported
 * theme record's `tune` + `presetIndex`) against the preset table. An invalid
 * preset index falls back to the first preset; a tune key outside its control
 * range is clamped rather than rejected, so one stale value cannot discard the
 * rest of a user's theme.
 */
export function normalizeThemeState(presets: readonly ThemePreset[], raw: unknown): AppThemeState {
	const fallback = defaultThemeState(presets)
	if (!raw || typeof raw !== 'object') return fallback

	const candidate = raw as { presetIndex?: unknown; tune?: unknown }
	const presetIndex =
		typeof candidate.presetIndex === 'number' &&
		Number.isInteger(candidate.presetIndex) &&
		candidate.presetIndex >= 0 &&
		candidate.presetIndex < presets.length
			? candidate.presetIndex
			: 0

	return { presetIndex, tune: clampTune(candidate.tune, presets[presetIndex]?.tune ?? fallback.tune) }
}

/** Reads a stored string; malformed JSON degrades to the default, never throws. */
export function readThemeState(presets: readonly ThemePreset[], stored: string | null): AppThemeState {
	if (!stored) return defaultThemeState(presets)
	try {
		return normalizeThemeState(presets, JSON.parse(stored))
	} catch {
		return defaultThemeState(presets)
	}
}

/** Serialises the small persisted shape (preset index + tune only). */
export function serializeThemeState(state: AppThemeState): string {
	return JSON.stringify({ presetIndex: state.presetIndex, tune: state.tune })
}

/** Resolves the full token record the wrapper renders: preset tokens + tune. */
export function resolveThemeTokens(presets: readonly ThemePreset[], state: AppThemeState): ThemeTokens {
	const preset = presets[state.presetIndex] ?? presets[0]
	return { ...(preset?.tokens ?? {}), ...tuneTokens(state.tune) }
}
