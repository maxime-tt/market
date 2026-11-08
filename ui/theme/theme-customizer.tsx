import { useId, useState } from 'react'

import { cn } from '../utils/cn'
import { Button } from '../wrappers/button'
import { surpriseTune, tuneTokens, type TuneSettings } from './tune'
import { TunePanel } from './tune-panel'
import type { ThemePreset } from './presets'

/**
 * The controlled theme value the host owns: which preset is active and the
 * six tune dimensions layered on top of it. Kept separate from the token
 * record so the shell can persist a small, stable shape and recompute the
 * tokens from the preset table.
 */
export interface ThemeCustomizerValue {
	presetIndex: number
	tune: TuneSettings
}

export interface ThemeCustomizerProps {
	/** The preset table the picker cycles through. */
	presets: readonly ThemePreset[]
	/** Current preset + tune. The component never owns theme state. */
	value: ThemeCustomizerValue
	/** Called with the complete next value on preset, tune, reset or surprise. */
	onChange: (next: ThemeCustomizerValue) => void
	className?: string
}

/**
 * Serialises the active theme as the portable `plebeian.ui-theme` record the
 * widget book already exports. Pure: the same value the host renders is the
 * same value the user copies out.
 */
export function themeRecord(presets: readonly ThemePreset[], value: ThemeCustomizerValue): string {
	const preset = presets[value.presetIndex] ?? presets[0]
	return JSON.stringify(
		{
			kind: 'plebeian.ui-theme',
			version: 1,
			preset: preset?.name ?? 'default',
			tune: value.tune,
			tokens: { ...(preset?.tokens ?? {}), ...tuneTokens(value.tune) },
		},
		null,
		2,
	)
}

/**
 * Fixed bottom-right theme launcher that expands into preset picker +
 * `TunePanel` + the portable theme record. Props-only by design: the shell
 * owns `value` and persists it; the widget book mounts the same component.
 *
 * Rendered INSIDE `ThemeMigrationWrapper` so the panel restyles itself as the
 * token record changes. Pass `className` position overrides (for example
 * `relative bottom-auto right-auto`) when embedding it in a flow.
 */
export function ThemeCustomizer({ presets, value, onChange, className }: ThemeCustomizerProps) {
	const [open, setOpen] = useState(false)
	const [exported, setExported] = useState<string | null>(null)
	const panelId = useId()

	const preset = presets[value.presetIndex] ?? presets[0]

	const selectPreset = (presetIndex: number) => {
		const next = presets[presetIndex]
		setExported(null)
		onChange({ presetIndex, tune: next ? next.tune : value.tune })
	}

	const setTune = (tune: TuneSettings) => {
		setExported(null)
		onChange({ presetIndex: value.presetIndex, tune })
	}

	const reset = () => {
		setExported(null)
		onChange({ presetIndex: value.presetIndex, tune: preset?.tune ?? value.tune })
	}

	const surprise = () => {
		setExported(null)
		onChange({ presetIndex: value.presetIndex, tune: surpriseTune(preset?.tune ?? value.tune) })
	}

	return (
		<div className={cn('fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2', className)}>
			{open && (
				<section
					id={panelId}
					aria-label="Theme customizer"
					data-testid="theme-customizer-panel"
					className="max-h-[70vh] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border-default bg-surface-raised p-4 text-text-high shadow-lg"
				>
					<header className="mb-3 flex items-start justify-between gap-2">
						<div>
							<h2 className="text-sm font-semibold">Theme</h2>
							<p className="text-xs text-text-mid" data-testid="theme-customizer-preset">
								{preset?.name ?? 'default'} — {preset?.blurb ?? ''}
							</p>
						</div>
						<Button type="button" variant="ghost" size="xs" onClick={() => setOpen(false)}>
							Close
						</Button>
					</header>

					<div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Presets">
						{presets.map((candidate, index) => {
							const active = index === value.presetIndex
							return (
								<button
									key={candidate.name}
									type="button"
									aria-pressed={active}
									data-testid={`theme-customizer-preset-${candidate.name}`}
									onClick={() => selectPreset(index)}
									className={cn(
										'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
										active
											? 'border-border-strong bg-fill-ink text-on-fill-ink'
											: 'border-border-default bg-bg text-text-high hover:bg-surface-hover',
									)}
								>
									{candidate.name}
								</button>
							)
						})}
					</div>

					<TunePanel
						value={value.tune}
						onChange={setTune}
						onReset={reset}
						onSurprise={surprise}
						onExport={() => setExported(themeRecord(presets, value))}
					/>

					{exported && (
						<pre
							data-testid="theme-customizer-json"
							className="mt-3 max-h-40 overflow-auto rounded-md border border-border-default bg-surface-sunken p-3 text-xs text-text-mid"
						>
							{exported}
						</pre>
					)}
				</section>
			)}

			<Button
				type="button"
				variant="outline"
				size="sm"
				aria-expanded={open}
				aria-controls={panelId}
				data-testid="theme-customizer-launcher"
				onClick={() => setOpen((current) => !current)}
				className="rounded-full shadow-lg"
			>
				{open ? 'Hide theme' : 'Theme'}
			</Button>
		</div>
	)
}
