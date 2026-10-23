import type { ThemeTokens } from './theme-migration-wrapper'

/**
 * The six "human touch" controls from the Theme Studio proof of concept.
 *
 * These are pure data: the widget book renders them today, and the CMS will
 * render the same schema later. Keep them free of React so both consumers can
 * import the definitions without pulling in a renderer.
 */
export interface TuneSettings {
	/** Corner radius in px. */
	radius: number
	/** Shadow intensity, 0–1 (1 = the stylesheet's stock shadow). */
	shadow: number
	/** Glass/frost intensity, 0–1. */
	glass: number
	/** Spacing multiplier, 0.75–1.45. */
	spacing: number
	/** Grain/texture intensity, 0–1. */
	texture: number
	/** Hand-made irregularity (corners + tilt), 0–1. */
	handmade: number
}

export interface TuneControl {
	key: keyof TuneSettings
	label: string
	min: number
	max: number
	step: number
	/** Labels shown under the slider ends. */
	ends: [string, string]
}

export const TUNE_CONTROLS: TuneControl[] = [
	{ key: 'radius', label: 'Corners', min: 0, max: 32, step: 1, ends: ['Sharp', 'Round'] },
	{ key: 'shadow', label: 'Shadows', min: 0, max: 1, step: 0.01, ends: ['Flat', 'Deep'] },
	{ key: 'glass', label: 'Glass', min: 0, max: 1, step: 0.01, ends: ['Solid', 'Frosted'] },
	{ key: 'spacing', label: 'Spacing', min: 0.75, max: 1.45, step: 0.01, ends: ['Snug', 'Airy'] },
	{ key: 'texture', label: 'Texture', min: 0, max: 1, step: 0.01, ends: ['Clean', 'Paper'] },
	{ key: 'handmade', label: 'Hand-made', min: 0, max: 1, step: 0.01, ends: ['Precise', 'Hand-cut'] },
]

/** Neutral defaults that reproduce the current rendering. */
export const DEFAULT_TUNE: TuneSettings = {
	radius: 4,
	shadow: 1,
	glass: 0,
	spacing: 1,
	texture: 0,
	handmade: 0,
}

/**
 * Maps tune settings to the CSS custom properties the stylesheet consumes.
 *
 * `--radius` drives the Tailwind radius scale, `--shadow-scale` feeds the
 * shadow value tokens, and the effect tokens are read by `.glass`/`.grain`/
 * `.rounded-hand`/`.tilt` in `styles/globals-new.css`.
 */
export function tuneTokens(tune: TuneSettings): ThemeTokens {
	return {
		'--radius': `${tune.radius}px`,
		'--shadow-scale': String(tune.shadow),
		'--glass': String(tune.glass),
		'--gap': String(tune.spacing),
		'--grain': String(tune.texture),
		'--handmade': String(tune.handmade),
	}
}

/**
 * Nudges each value around the base by up to 70% of its range — a nudge, not
 * chaos, so a "Surprise me" click stays inside a usable theme.
 */
export function surpriseTune(base: TuneSettings, random: () => number = Math.random): TuneSettings {
	const next: TuneSettings = { ...base }
	for (const control of TUNE_CONTROLS) {
		const span = control.max - control.min
		const nudged = base[control.key] + (random() - 0.5) * span * 0.7
		const clamped = Math.max(control.min, Math.min(control.max, nudged))
		next[control.key] = control.step === 1 ? Math.round(clamped) : Number(clamped.toFixed(2))
	}
	return next
}
