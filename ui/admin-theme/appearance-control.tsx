import { Check, Palette } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '../utils/cn'
import {
	ADMIN_COLOR_OPTIONS,
	ADMIN_MODE_LABELS,
	ADMIN_MODES,
	ADMIN_STYLE_LABELS,
	ADMIN_STYLES,
	AVAILABLE_ADMIN_STYLES,
	type AdminAppearance,
	type ResolvedAdminMode,
} from './admin-appearance'

export interface AppearanceControlProps {
	value: AdminAppearance
	resolvedMode: ResolvedAdminMode
	onChange: (patch: Partial<AdminAppearance>) => void
	className?: string
	/** Icon-only trigger, for the phone title bar. */
	compact?: boolean
}

/**
 * The admin console's one appearance control: style, colour and mode, nothing
 * else. Rendered inline rather than through a portal so the panel stays inside
 * the admin theme scope it is changing.
 */
export function AppearanceControl({ value, resolvedMode, onChange, className, compact = false }: AppearanceControlProps) {
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)
	const panelId = useId()

	useEffect(() => {
		if (!open) return
		const onPointer = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false)
		}
		document.addEventListener('pointerdown', onPointer)
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('pointerdown', onPointer)
			document.removeEventListener('keydown', onKey)
		}
	}, [open])

	return (
		<div ref={rootRef} className={cn('relative', className)} data-slot="admin-appearance">
			<button
				type="button"
				className={cn('admin-chip', compact && 'admin-chip-compact')}
				aria-label={compact ? 'Appearance' : undefined}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => setOpen((next) => !next)}
				data-testid="admin-appearance-toggle"
			>
				<Palette className="w-4 h-4" aria-hidden="true" />
				{!compact && <span>Appearance</span>}
			</button>
			{open && (
				<div id={panelId} role="dialog" aria-label="Dashboard appearance" className="admin-popover" data-testid="admin-appearance-panel">
					<div className="admin-popover-title">Appearance</div>
					<p className="admin-popover-note">Only changes how the dashboard looks for you. Your public site keeps its own theme.</p>

					<div className="admin-popover-row">
						<span>Style</span>
						<div className="admin-seg" role="radiogroup" aria-label="Style">
							{ADMIN_STYLES.map((style) => {
								const available = AVAILABLE_ADMIN_STYLES.includes(style)
								return (
									<button
										key={style}
										type="button"
										role="radio"
										aria-checked={value.style === style}
										disabled={!available}
										title={available ? undefined : 'Coming soon'}
										onClick={() => onChange({ style })}
									>
										{ADMIN_STYLE_LABELS[style]}
									</button>
								)
							})}
						</div>
					</div>

					<div className="admin-popover-row">
						<span>Colour</span>
						<div className="admin-swatches" role="radiogroup" aria-label="Colour">
							{ADMIN_COLOR_OPTIONS.map((option) => (
								<button
									key={option.id}
									type="button"
									role="radio"
									aria-checked={value.color === option.id}
									aria-label={option.label}
									title={option.label}
									className="admin-swatch"
									style={{ background: option.swatch[resolvedMode] }}
									onClick={() => onChange({ color: option.id })}
								>
									{value.color === option.id && <Check className="w-3 h-3" aria-hidden="true" />}
								</button>
							))}
						</div>
					</div>

					<div className="admin-popover-row">
						<span>Mode</span>
						<div className="admin-seg" role="radiogroup" aria-label="Mode">
							{ADMIN_MODES.map((mode) => (
								<button key={mode} type="button" role="radio" aria-checked={value.mode === mode} onClick={() => onChange({ mode })}>
									{ADMIN_MODE_LABELS[mode]}
								</button>
							))}
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
