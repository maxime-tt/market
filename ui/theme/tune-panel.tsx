import { cn } from '../utils/cn'
import { Button } from '../wrappers/button'
import { TUNE_CONTROLS, type TuneSettings } from './tune'

export interface TunePanelProps {
	/** Current tune values; the panel is controlled. */
	value: TuneSettings
	/** Called with the complete next value on every slider move. */
	onChange: (next: TuneSettings) => void
	/** Restore the active preset's defaults. */
	onReset: () => void
	/** Nudge every control around the active preset. */
	onSurprise: () => void
	/** Optional: open/export the theme record. */
	onExport?: () => void
	className?: string
}

/**
 * The "Make it yours" panel from the Theme Studio proof of concept.
 *
 * Props-only by design: the widget book mounts it today and the CMS will mount
 * the same component later. It never reads or writes a theme store; the host
 * owns the `value` and the callbacks.
 */
export function TunePanel({ value, onChange, onReset, onSurprise, onExport, className }: TunePanelProps) {
	return (
		<section data-slot="tune-panel" className={cn('rounded-xl border bg-card p-4 text-card-foreground shadow-sm', className)}>
			<header className="mb-3">
				<h2 className="text-sm font-semibold">Make it yours</h2>
				<p className="text-xs text-muted-foreground">Small changes, big personality</p>
			</header>

			<div className="grid gap-3 sm:grid-cols-2">
				{TUNE_CONTROLS.map((control) => {
					const id = `tune-${control.key}`
					return (
						<div key={control.key} className="block">
							<div className="flex items-center justify-between text-xs font-medium">
								<label htmlFor={id}>{control.label}</label>
								<span className="text-muted-foreground tabular-nums">{value[control.key]}</span>
							</div>
							<input
								id={id}
								data-testid={id}
								type="range"
								min={control.min}
								max={control.max}
								step={control.step}
								value={value[control.key]}
								onChange={(event) => onChange({ ...value, [control.key]: Number(event.target.value) })}
								className="mt-1 w-full accent-primary"
							/>
							<div className="flex justify-between text-[10px] text-muted-foreground">
								<span>{control.ends[0]}</span>
								<span>{control.ends[1]}</span>
							</div>
						</div>
					)
				})}
			</div>

			<div className="mt-4 flex flex-wrap gap-2">
				<Button type="button" variant="outline" size="sm" data-testid="tune-surprise" onClick={onSurprise}>
					Surprise me
				</Button>
				<Button type="button" variant="outline" size="sm" data-testid="tune-reset" onClick={onReset}>
					Reset
				</Button>
				{onExport && (
					<Button type="button" size="sm" data-testid="tune-export" onClick={onExport}>
						Export
					</Button>
				)}
			</div>
		</section>
	)
}
