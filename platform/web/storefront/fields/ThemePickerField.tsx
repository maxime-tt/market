import type { StorefrontThemeId } from '@sdk/commerce/storefront/storefrontPage'
import {
	STOREFRONT_THEME_LIST,
	STOREFRONT_TUNE_AXES,
	getStorefrontPalette,
	getStorefrontTheme,
	normalizeStorefrontTune,
	storefrontPaletteSwatchColors,
	storefrontThemeSwatchColors,
	storefrontTuneWord,
	type StorefrontThemeTune,
	type StorefrontTuneAxis,
} from '@sdk/config/storefront/storefrontThemes'
import { cn } from '@ui/utils/cn'
import { Check, RotateCcw, Wand2 } from 'lucide-react'

/**
 * The theme picker.
 *
 * Modelled on the Plebeian Theme Studio (plebeian-theme-studio.pplx.app), which
 * walks the author through three steps and then exports one small `plebeian.site-theme` object. This file
 * reproduces that flow: the same three steps, the same six tune axes, and the
 * same value-band words ("Sharp … Pebble"), so the two surfaces read as one
 * feature rather than two.
 *
 * Everything here is presentational. It reads the registry, reports the
 * author's choice, and never invents a value — every number it can produce is
 * clamped by `normalizeStorefrontTune`.
 *
 * Here the steps are: 1 choose a layout (the page template), 2 choose colours
 * (one list of every look and colourway), 3 make it yours (the tune axes).
 */

/** One choice in the colour list: a layout's type and feel, in one of its colourways. */
export interface StorefrontColourOption {
	themeId: StorefrontThemeId
	paletteKey: string
	label: string
	swatch: string[]
}

/** A heading and its colourways. Single-colourway looks share one "Classic" group. */
export interface StorefrontColourGroup {
	label: string
	options: StorefrontColourOption[]
}

/**
 * Every look and colourway as one list, so the author picks colours in one
 * place. A layout with a single colourway is named by the layout; a layout with
 * several gets a heading and names each colourway under it.
 */
export function storefrontColourGroups(): StorefrontColourGroup[] {
	const classic: StorefrontColourOption[] = []
	const groups: StorefrontColourGroup[] = []
	for (const theme of STOREFRONT_THEME_LIST) {
		const options = theme.palettes.map((palette) => ({
			themeId: theme.id,
			paletteKey: palette.key,
			label: theme.palettes.length === 1 ? theme.label : palette.label,
			swatch: theme.palettes.length === 1 ? storefrontThemeSwatchColors(theme) : storefrontPaletteSwatchColors(palette),
		}))
		if (options.length === 1) classic.push(options[0])
		else groups.push({ label: theme.label, options })
	}
	return [{ label: 'Classic', options: classic }, ...groups]
}

/**
 * Step 2 — "Choose colours". Name and swatches only, nothing else, so the
 * whole list scans quickly. `columns` lets the wizard use two columns where
 * the sidebar has room for one.
 */
export function ThemeColourList({
	themeId,
	paletteKey,
	onChange,
	readOnly,
	columns = 1,
}: {
	themeId: StorefrontThemeId
	/** Empty means the layout's first colourway. */
	paletteKey: string
	onChange: (next: { themeId: StorefrontThemeId; paletteKey: string }) => void
	readOnly?: boolean
	columns?: 1 | 2
}) {
	const current = getStorefrontPalette(getStorefrontTheme(themeId), paletteKey).key
	return (
		<div className="flex flex-col gap-3" data-testid="storefront-colour-list">
			{storefrontColourGroups().map((group) => (
				<section key={group.label} className="flex flex-col gap-1" aria-label={group.label}>
					<h5 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h5>
					<div className={cn('grid gap-1', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
						{group.options.map((option) => {
							const selected = option.themeId === themeId && option.paletteKey === current
							return (
								<button
									key={`${option.themeId}-${option.paletteKey}`}
									type="button"
									disabled={readOnly}
									aria-pressed={selected}
									onClick={() => onChange({ themeId: option.themeId, paletteKey: option.paletteKey })}
									data-testid={`storefront-colour-${option.themeId}-${option.paletteKey}`}
									className={cn(
										'flex h-8 items-center gap-2 rounded-md border px-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
										selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50',
									)}
								>
									<span className="flex shrink-0 -space-x-1">
										{option.swatch.map((color, index) => (
											// Hairline over a caller-supplied colour: the chip previews the
											// palette's literal value, so the theme cannot own its border.
											<span
												key={index}
												className="size-3.5 rounded-full border border-black/15"
												style={{ background: color }}
												aria-hidden
											/>
										))}
									</span>
									<span className="min-w-0 flex-1 truncate text-xs text-foreground">{option.label}</span>
									{selected && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
								</button>
							)
						})}
					</div>
				</section>
			))}
		</div>
	)
}

/** One slider, with the two end words and the current band word. */
function TuneSlider({
	axis,
	value,
	disabled,
	onInput,
}: {
	axis: StorefrontTuneAxis
	value: number
	disabled?: boolean
	onInput: (value: number) => void
}) {
	return (
		<div className="flex flex-col gap-1">
			<label className="flex items-baseline justify-between gap-2 text-xs" htmlFor={`storefront-tune-input-${axis.key}`}>
				<span className="font-medium text-foreground">{axis.label}</span>
				<span className="text-muted-foreground" data-testid={`storefront-tune-word-${axis.key}`}>
					{storefrontTuneWord(axis, value)}
				</span>
			</label>
			<input
				id={`storefront-tune-input-${axis.key}`}
				type="range"
				min={axis.min}
				max={axis.max}
				step={axis.step}
				value={value}
				disabled={disabled}
				data-testid={`storefront-tune-${axis.key}`}
				onChange={(event) => onInput(Number(event.target.value))}
				className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed"
			/>
			<div className="flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground/70">
				<span>{axis.ends[0]}</span>
				<span>{axis.ends[1]}</span>
			</div>
		</div>
	)
}

/**
 * Step 3 — "Make it yours". Six bounded axes plus the studio's two
 * conveniences: `Reset` back to the layout's own defaults, and `Surprise me`,
 * which nudges each axis by up to ±35% of its span around those defaults —
 * "a nudge, not chaos", in the studio's words.
 */
export function ThemeTunePanel({
	themeId,
	value,
	onChange,
	readOnly,
}: {
	themeId: StorefrontThemeId
	/** Partial is fine: anything missing or out of range resolves to the layout's default. */
	value?: Partial<StorefrontThemeTune>
	onChange: (tune: StorefrontThemeTune) => void
	readOnly?: boolean
}) {
	const theme = getStorefrontTheme(themeId)
	const effective = normalizeStorefrontTune(value, theme.tune)

	return (
		<div className="flex flex-col gap-3">
			{STOREFRONT_TUNE_AXES.map((axis) => (
				<TuneSlider
					key={axis.key}
					axis={axis}
					value={effective[axis.key]}
					disabled={readOnly}
					onInput={(next) => onChange(normalizeStorefrontTune({ ...effective, [axis.key]: next }, theme.tune))}
				/>
			))}
			<p className="text-[10px] text-muted-foreground">
				Hand-made adds slight tilts and uneven corners, so no two pages feel machine-stamped.
			</p>
			<div className="flex gap-1.5">
				<button
					type="button"
					disabled={readOnly}
					onClick={() => onChange({ ...theme.tune })}
					data-testid="storefront-tune-reset"
					className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:border-primary/50 disabled:opacity-60"
				>
					<RotateCcw className="size-3" aria-hidden /> Reset
				</button>
				<button
					type="button"
					disabled={readOnly}
					onClick={() => onChange(surpriseTune(theme.tune))}
					data-testid="storefront-tune-surprise"
					className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:border-primary/50 disabled:opacity-60"
				>
					<Wand2 className="size-3" aria-hidden /> Surprise me
				</button>
			</div>
		</div>
	)
}

/**
 * The studio's `Surprise me`: move each axis a random amount up to 35% of its
 * span away from the layout's own default, then re-clamp. Exotic but in range,
 * so a surprised page is still a page somebody designed.
 *
 * `random` is injectable so a test can pin the outcome.
 */
export function surpriseTune(base: StorefrontThemeTune, random: () => number = Math.random): StorefrontThemeTune {
	const drift: Partial<StorefrontThemeTune> = {}
	for (const axis of STOREFRONT_TUNE_AXES) {
		const span = axis.max - axis.min
		drift[axis.key] = base[axis.key] + (random() - 0.5) * span * 0.7
	}
	return normalizeStorefrontTune(drift, base)
}

/**
 * The studio's export object, reproduced field for field. This is the whole of
 * what a theme costs to store: page content is untouched, and another client
 * that understands this object can render the same shop.
 */
export function themeStudioExport(themeId: StorefrontThemeId, paletteKey: string, tune: StorefrontThemeTune) {
	const theme = getStorefrontTheme(themeId)
	const palette = getStorefrontPalette(theme, paletteKey)
	return {
		kind: 'plebeian.site-theme' as const,
		version: 1 as const,
		layout: theme.id,
		palette: {
			name: palette.label,
			key: palette.key,
			mode: palette.dark ? ('dark' as const) : ('light' as const),
			...palette.tokens,
			shadow: palette.shadowRgb,
		},
		tune: {
			radius_px: tune.radiusPx,
			shadow: tune.shadow,
			glass: tune.glass,
			spacing: tune.spacing,
			texture: tune.texture,
			handmade: tune.handmade,
		},
	}
}
