import type { Ref } from 'react'
import {
	AUCTION_ANTI_SNIPE_WINDOW_PRESETS_MINUTES,
	AUCTION_MIN_BID_CURVE_PEAK_PRESETS,
	type AuctionAntiSnipeWindowMinutesPreset,
	type AuctionFormData,
	type AuctionMinBidCurvePeakPreset,
	type AuctionMinBidCurveShape,
} from '@sdk/commerce/auctions/auctionForm'
import { Label } from '../primitives/label'
import { Switch } from '../primitives/switch'
import { cn } from '../utils/cn'
import { AuctionTimelinePreview } from './auction-timeline-preview'

/**
 * Anti-snipe toggle + curve picker. Single card on the auction form
 * with basic anti-snipe enablement and curve controls:
 *
 *   1. Anti-snipe On/Off (Off = 0 min window, On = 5 min window).
 *   2. Curve shape (none / linear / exponential).
 *   3. Peak multiplier (2× / 5× / 10×) — disabled when shape = none.
 *
 * Picking shape ≠ none with window = 0 surfaces a validation hint via
 * `getAuctionPublishValidationIssues` (the form's per-field message
 * map). AUCTIONS.md §6.1.
 *
 * T6.3 S4: lifted out of `ui/components/auction-editor/AuctionEditorTabs.tsx`
 * and given the `className`/`ref` contract from `ui/AGENTS.md`. Markup, class
 * strings and behaviour are unchanged; the monolith's `formData`/`setFormData`
 * pair it read from is now the three-field slice below plus `onFormPatch`.
 */

/** The three `AuctionFormData` fields this card owns. */
export type AntiSnipeCurvePatch = Partial<
	Pick<AuctionFormData, 'antiSnipeWindowMinutes' | 'minBidCurveShape' | 'minBidCurvePeakMultiplier'>
>

export interface AntiSnipeCurveSettingsProps {
	antiSnipeWindowMinutes: AuctionAntiSnipeWindowMinutesPreset
	minBidCurveShape: AuctionMinBidCurveShape
	minBidCurvePeakMultiplier: AuctionMinBidCurvePeakPreset
	/** Resolved unix seconds derived by the parent form. */
	startAtSeconds: number
	endAtSeconds: number
	maxEndAtSeconds: number
	settlementGraceSeconds: number
	/** Parsed numeric form values for the timeline preview's baseline. */
	startingBid: number
	bidIncrement: number
	reserve: number
	onFormPatch: (patch: AntiSnipeCurvePatch) => void
	className?: string
	ref?: Ref<HTMLDivElement>
}

export function AntiSnipeCurveSettings({
	antiSnipeWindowMinutes,
	minBidCurveShape,
	minBidCurvePeakMultiplier,
	startAtSeconds,
	endAtSeconds,
	maxEndAtSeconds,
	settlementGraceSeconds,
	startingBid,
	bidIncrement,
	reserve,
	onFormPatch,
	className,
	ref,
}: AntiSnipeCurveSettingsProps) {
	const windowOptions: AuctionAntiSnipeWindowMinutesPreset[] = [...AUCTION_ANTI_SNIPE_WINDOW_PRESETS_MINUTES]
	const shapeOptions: Array<{ value: AuctionMinBidCurveShape; label: string; sub: string }> = [
		{ value: 'none', label: 'None', sub: 'flat floor' },
		{ value: 'linear', label: 'Linear', sub: 'straight ramp' },
		{ value: 'exponential', label: 'Exponential', sub: 'steep finish' },
	]
	const peakOptions: AuctionMinBidCurvePeakPreset[] = [...AUCTION_MIN_BID_CURVE_PEAK_PRESETS]

	const antiSnipeEnabled = antiSnipeWindowMinutes > 0 || minBidCurveShape !== 'none'

	// `windowDisabled = true` when no anti-snipe window is selected —
	// disables curve shape AND peak multiplier in one go. With no window,
	// `max_end_at = end_at`, the curve has zero duration, and a non-`none`
	// shape would have no effect anyway. Disabling the controls visually
	// reinforces "this section is gated on having a window".
	const windowDisabled = antiSnipeWindowMinutes === 0
	const curveDisabled = windowDisabled || minBidCurveShape === 'none'

	return (
		<div ref={ref} className={cn('grid w-full gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4', className)}>
			<div>
				<div className="flex items-center gap-3">
					<Label className="text-zinc-950">Anti-snipe</Label>
					<div className="flex items-center gap-3">
						<span className={`text-xs ${!antiSnipeEnabled ? 'text-zinc-900' : 'text-zinc-500'}`}>Off</span>
						<Switch
							id="auction-anti-snipe-enabled"
							checked={antiSnipeEnabled}
							onCheckedChange={(checked) =>
								onFormPatch(
									checked
										? {
												antiSnipeWindowMinutes: 5,
												minBidCurveShape: 'linear',
												minBidCurvePeakMultiplier: 2,
											}
										: { antiSnipeWindowMinutes: 0, minBidCurveShape: 'none' },
								)
							}
						/>
						<span className={`text-xs ${antiSnipeEnabled ? 'text-zinc-900' : 'text-zinc-500'}`}>On</span>
					</div>
				</div>
			</div>

			<div className="grid gap-1.5">
				<Label className="text-xs uppercase tracking-wide text-zinc-500">Anti-snipe protection window</Label>
				<p className="text-xs text-zinc-500">
					Adds extra minutes to the end of the auction, where the minimum bid increment rises to make sniping more expensive
				</p>
				<div className="flex flex-wrap gap-2">
					{windowOptions.map((minutes) => {
						const isActive = antiSnipeWindowMinutes === minutes
						return (
							<button
								key={minutes}
								type="button"
								onClick={() =>
									minutes === 0
										? onFormPatch({ antiSnipeWindowMinutes: minutes, minBidCurveShape: 'none' })
										: onFormPatch({ antiSnipeWindowMinutes: minutes })
								}
								className={`rounded-md border px-3 py-1.5 text-xs ${
									isActive
										? 'border-emerald-500 bg-emerald-50 text-emerald-800'
										: 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
								}`}
							>
								{minutes === 0 ? 'No window' : `${minutes} min`}
							</button>
						)
					})}
				</div>
			</div>

			<div className="grid gap-1.5">
				<Label className={`text-xs uppercase tracking-wide ${windowDisabled ? 'text-zinc-300' : 'text-zinc-500'}`}>Bid curve</Label>
				<p className={`text-xs ${windowDisabled ? 'text-zinc-300' : 'text-zinc-500'}`}>The shape of the bid curve</p>
				<div className="flex flex-wrap gap-2">
					{shapeOptions.map((option) => {
						const isActive = minBidCurveShape === option.value
						return (
							<button
								key={option.value}
								type="button"
								disabled={windowDisabled}
								onClick={() => onFormPatch({ minBidCurveShape: option.value })}
								className={`flex flex-col items-start rounded-md border px-3 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
									isActive && !windowDisabled
										? 'border-emerald-500 bg-emerald-50 text-emerald-800'
										: 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 disabled:hover:border-zinc-200'
								}`}
							>
								<span className="font-semibold">{option.label}</span>
								<span className="text-[10px] text-zinc-500">{option.sub}</span>
							</button>
						)
					})}
				</div>
				{windowDisabled && <p className="text-[11px] text-amber-700">Pick a window above to enable the curve.</p>}
			</div>

			<div className="grid gap-1.5">
				<Label className={`text-xs uppercase tracking-wide ${curveDisabled ? 'text-zinc-300' : 'text-zinc-500'}`}>Multiplier</Label>
				<p className={`text-xs ${curveDisabled ? 'text-zinc-300' : 'text-zinc-500'}`}>
					How much the bidding floor raises relative to the last bid
				</p>
				<div className="flex flex-wrap gap-2">
					{peakOptions.map((peak) => {
						const isActive = minBidCurvePeakMultiplier === peak
						return (
							<button
								key={peak}
								type="button"
								disabled={curveDisabled}
								onClick={() => onFormPatch({ minBidCurvePeakMultiplier: peak })}
								className={`rounded-md border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
									isActive && !curveDisabled
										? 'border-emerald-500 bg-emerald-50 text-emerald-800'
										: 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 disabled:hover:border-zinc-200'
								}`}
							>
								{peak}×
							</button>
						)
					})}
				</div>
				{!curveDisabled && (
					<p className="text-[11px] text-zinc-500">
						Floor at auction end will be {minBidCurvePeakMultiplier}× the floor when the anti-snipe ramp begins.
					</p>
				)}
			</div>

			{/* Timeline preview lives INSIDE this card now — the chart's
			    inputs (window, shape, multiplier) are all here, so the
			    feedback belongs alongside them rather than in the bid
			    ladder card. */}
			<AuctionTimelinePreview
				startingBid={startingBid}
				bidIncrement={bidIncrement}
				reserve={reserve}
				curveShape={minBidCurveShape}
				curvePeakMultiplier={minBidCurvePeakMultiplier}
				startAtSeconds={startAtSeconds}
				endAtSeconds={endAtSeconds}
				maxEndAtSeconds={maxEndAtSeconds}
				settlementGraceSeconds={settlementGraceSeconds}
				showCurve={minBidCurveShape !== 'none' && minBidCurvePeakMultiplier > 1 && maxEndAtSeconds > endAtSeconds && endAtSeconds > 0}
			/>
		</div>
	)
}
