import { Fragment, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { AUCTION_MIN_BID_LEG_SATS, AUCTION_MIN_BID_SATS } from '@sdk/commerce/auctions'
import {
	AUCTION_ANTI_SNIPE_WINDOW_PRESETS_MINUTES,
	AUCTION_MIN_BID_CURVE_PEAK_PRESETS,
	AUCTION_SETTLEMENT_GRACE_PRESETS,
	type AuctionAntiSnipeWindowMinutesPreset,
	type AuctionFormData,
	type AuctionMinBidCurvePeakPreset,
	type AuctionMinBidCurveShape,
	type AuctionSettlementGracePreset,
} from '@sdk/commerce/auctions/auctionForm'
import { getAuctionPublishValidationIssues } from '@sdk/commerce/auctions/auctionPublishValidation'
import { Button } from '../../primitives/button'
import { Checkbox } from '../../primitives/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../primitives/collapsible'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../primitives/select'
import { Slider } from '../../primitives/slider'
import { Switch } from '../../primitives/switch'
import { DateTimePicker } from '../../shared/datetime-picker'
import { InfoTooltip } from '../../shared/info-tooltip'
import { UiLink } from '../../provider/UiProvider'
import { AuctionTimelinePreview } from '../../auction/auction-timeline-preview'
import { BidLadderPreview } from '../../auction/bid-ladder-preview'
import { DURATION_PRESETS, DURATION_PRESETS_SHORTCUT } from '../../auction/duration-presets'
import { parseDatetimeLocalSeconds, toDatetimeLocal } from '../../utils/datetime'
import { formatAbsolute, formatDuration } from '../../utils/duration'
import {
	describeShipping,
	type AuctionImage,
	type AuctionShippingOptionSummary,
	type AuctionShippingViewProps,
	type EndMode,
	type RenderAuctionImageUploader,
	type StartMode,
	type TabProps,
	type ValidationMessages,
} from '../../auction/model'

// T6.3 slice S1 moved the pure helpers and the shared types above into
// `ui/utils/*` and `ui/auction/*`. Re-export the module's previous public
// surface so no existing importer breaks during the transition.
export { parseDatetimeLocalSeconds, toDatetimeLocal } from '../../utils/datetime'
export type {
	AuctionImage,
	AuctionShippingOptionSummary,
	AuctionShippingViewProps,
	AuctionValidationMessages,
	EndMode,
	RenderAuctionImageUploader,
	StartMode,
	TabProps,
} from '../../auction/model'

export function NameTab({ formData, setFormData }: TabProps) {
	return (
		<div className="flex flex-col gap-4">
			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-title">
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Title</span>
				</Label>
				<Input
					id="auction-title"
					value={formData.title}
					onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
					placeholder="e.g. Rare print run #1"
				/>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-summary">Summary</Label>
				<Input
					id="auction-summary"
					value={formData.summary}
					onChange={(e) => setFormData((prev) => ({ ...prev, summary: e.target.value }))}
					placeholder="Short one-liner for list view"
				/>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-description">
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Description</span>
				</Label>
				<textarea
					id="auction-description"
					value={formData.description}
					onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
					className="border-2 min-h-24 p-2 rounded-md"
					placeholder="Describe the item, condition, and shipping notes."
				/>
			</div>

			<div className="flex items-start space-x-3 p-3 border rounded-lg bg-amber-50/50 border-amber-200">
				<Checkbox
					id="auction-nsfw-content"
					checked={formData.isNSFW}
					onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, isNSFW: checked === true }))}
					className="mt-0.5"
				/>
				<div className="space-y-1">
					<Label htmlFor="auction-nsfw-content" className="text-sm font-medium cursor-pointer">
						This auction contains adult/sensitive content
					</Label>
				</div>
			</div>
		</div>
	)
}

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
 */
function AntiSnipeCurveSettings({
	formData,
	setFormData,
	startAtSeconds,
	endAtSeconds,
	maxEndAtSeconds,
	settlementGraceSeconds,
	startingBid,
	bidIncrement,
	reserve,
}: {
	formData: AuctionFormData
	setFormData: Dispatch<SetStateAction<AuctionFormData>>
	/** Resolved unix seconds derived by the parent form. */
	startAtSeconds: number
	endAtSeconds: number
	maxEndAtSeconds: number
	settlementGraceSeconds: number
	/** Parsed numeric form values for the timeline preview's baseline. */
	startingBid: number
	bidIncrement: number
	reserve: number
}) {
	const windowOptions: AuctionAntiSnipeWindowMinutesPreset[] = [...AUCTION_ANTI_SNIPE_WINDOW_PRESETS_MINUTES]
	const shapeOptions: Array<{ value: AuctionMinBidCurveShape; label: string; sub: string }> = [
		{ value: 'none', label: 'None', sub: 'flat floor' },
		{ value: 'linear', label: 'Linear', sub: 'straight ramp' },
		{ value: 'exponential', label: 'Exponential', sub: 'steep finish' },
	]
	const peakOptions: AuctionMinBidCurvePeakPreset[] = [...AUCTION_MIN_BID_CURVE_PEAK_PRESETS]

	const antiSnipeEnabled = formData.antiSnipeWindowMinutes > 0 || formData.minBidCurveShape !== 'none'

	// `windowDisabled = true` when no anti-snipe window is selected —
	// disables curve shape AND peak multiplier in one go. With no window,
	// `max_end_at = end_at`, the curve has zero duration, and a non-`none`
	// shape would have no effect anyway. Disabling the controls visually
	// reinforces "this section is gated on having a window".
	const windowDisabled = formData.antiSnipeWindowMinutes === 0
	const curveDisabled = windowDisabled || formData.minBidCurveShape === 'none'

	return (
		<div className="grid w-full gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4">
			<div>
				<div className="flex items-center gap-3">
					<Label className="text-zinc-950">Anti-snipe</Label>
					<div className="flex items-center gap-3">
						<span className={`text-xs ${!antiSnipeEnabled ? 'text-zinc-900' : 'text-zinc-500'}`}>Off</span>
						<Switch
							id="auction-anti-snipe-enabled"
							checked={antiSnipeEnabled}
							onCheckedChange={(checked) =>
								setFormData((prev) =>
									checked
										? {
												...prev,
												antiSnipeWindowMinutes: 5,
												minBidCurveShape: 'linear',
												minBidCurvePeakMultiplier: 2,
											}
										: { ...prev, antiSnipeWindowMinutes: 0, minBidCurveShape: 'none' },
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
						const isActive = formData.antiSnipeWindowMinutes === minutes
						return (
							<button
								key={minutes}
								type="button"
								onClick={() =>
									setFormData((prev) =>
										minutes === 0
											? { ...prev, antiSnipeWindowMinutes: minutes, minBidCurveShape: 'none' }
											: { ...prev, antiSnipeWindowMinutes: minutes },
									)
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
						const isActive = formData.minBidCurveShape === option.value
						return (
							<button
								key={option.value}
								type="button"
								disabled={windowDisabled}
								onClick={() => setFormData((prev) => ({ ...prev, minBidCurveShape: option.value }))}
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
						const isActive = formData.minBidCurvePeakMultiplier === peak
						return (
							<button
								key={peak}
								type="button"
								disabled={curveDisabled}
								onClick={() => setFormData((prev) => ({ ...prev, minBidCurvePeakMultiplier: peak }))}
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
						Floor at auction end will be {formData.minBidCurvePeakMultiplier}× the floor when the anti-snipe ramp begins.
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
				curveShape={formData.minBidCurveShape}
				curvePeakMultiplier={formData.minBidCurvePeakMultiplier}
				startAtSeconds={startAtSeconds}
				endAtSeconds={endAtSeconds}
				maxEndAtSeconds={maxEndAtSeconds}
				settlementGraceSeconds={settlementGraceSeconds}
				showCurve={
					formData.minBidCurveShape !== 'none' &&
					formData.minBidCurvePeakMultiplier > 1 &&
					maxEndAtSeconds > endAtSeconds &&
					endAtSeconds > 0
				}
			/>
		</div>
	)
}

/**
 * Settlement-grace picker — 5 min / 1 h / 3 h. AUCTIONS.md §4.1.
 *
 * The grace is the window the seller has between `max_end_at` and the
 * Cashu locktime to publish the kind-1024 settlement. Long enough that
 * a mint outage or relay flake doesn't cost the seller; short enough
 * that losing bidders aren't stranded for days.
 */
function SettlementGraceSettings({
	formData,
	setFormData,
}: {
	formData: AuctionFormData
	setFormData: Dispatch<SetStateAction<AuctionFormData>>
}) {
	const presets: Array<{ value: AuctionSettlementGracePreset; label: string; sub: string }> = [
		{ value: '5min', label: '5 min', sub: 'tight, mint must be reliable' },
		{ value: '1h', label: '1 hour', sub: 'recommended' },
		{ value: '3h', label: '3 hours', sub: 'safest for losers' },
	]

	return (
		<div className="grid w-full gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4">
			<div>
				<Label className="text-zinc-950">Settlement grace</Label>
				<p className="mt-1 text-xs text-zinc-500">
					How long after the auction end you have to publish the settlement before losing bidders can reclaim their funds. Bids carry the
					same locktime regardless of how many bids land.
				</p>
			</div>
			<div className="flex flex-wrap gap-2">
				{presets.map((option) => {
					const isActive = formData.settlementGracePreset === option.value
					return (
						<button
							key={option.value}
							type="button"
							onClick={() => setFormData((prev) => ({ ...prev, settlementGracePreset: option.value }))}
							className={`flex flex-col items-start rounded-md border px-3 py-1.5 text-left text-xs ${
								isActive
									? 'border-emerald-500 bg-emerald-50 text-emerald-800'
									: 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
							}`}
						>
							<span className="font-semibold">{option.label}</span>
							<span className="text-[10px] text-zinc-500">{option.sub}</span>
						</button>
					)
				})}
			</div>
		</div>
	)
}

export function AuctionTabContent({
	formData,
	setFormData,
	availableMints,
	startMode,
	setStartMode,
	endMode,
	setEndMode,
	durationSeconds,
	setDurationSeconds,
	validationMessages,
	userRemovedMints,
	onUserRemovedMintsChange,
}: TabProps & {
	availableMints: readonly string[]
	startMode: StartMode
	setStartMode: Dispatch<SetStateAction<StartMode>>
	endMode: EndMode
	setEndMode: Dispatch<SetStateAction<EndMode>>
	durationSeconds: number
	setDurationSeconds: Dispatch<SetStateAction<number>>
	validationMessages: ValidationMessages
	userRemovedMints: Set<string>
	onUserRemovedMintsChange: (next: Set<string>) => void
}) {
	const [inputSliderValue, setInputSliderValue] = useState<number>(() => {
		const idx = DURATION_PRESETS.findIndex((p) => p.seconds === durationSeconds)
		return idx >= 0 ? idx + 1 : 1
	})

	const selectedMints = formData.trustedMints
	const unselectedMints = availableMints.filter((mint) => !selectedMints.includes(mint))
	const canRemoveMint = selectedMints.length > 1

	const removeMint = (mint: string) => {
		if (!canRemoveMint) return
		setFormData((prev) => ({ ...prev, trustedMints: prev.trustedMints.filter((m) => m !== mint) }))
		onUserRemovedMintsChange(new Set(userRemovedMints).add(mint))
	}

	const addMint = (mint: string) => {
		if (selectedMints.includes(mint)) return
		setFormData((prev) => ({ ...prev, trustedMints: [...prev.trustedMints, mint] }))
		if (userRemovedMints.has(mint)) {
			const next = new Set(userRemovedMints)
			next.delete(mint)
			onUserRemovedMintsChange(next)
		}
	}

	type Section = 'advanced'
	const [openSection, setOpenSection] = useState<Section | null>(null)
	const toggle = (s: Section) => (isOpen: boolean) => setOpenSection(isOpen ? s : null)

	const startingBidNum = parseInt(formData.startingBid, 10)
	const bidIncrementNum = parseInt(formData.bidIncrement, 10)
	const reserveNum = parseInt(formData.reserve ?? '', 10)
	const showBidLadder = formData.startingBid !== '' && startingBidNum > 0 && formData.bidIncrement !== '' && bidIncrementNum > 0
	const antiSnipeWindowSeconds = formData.antiSnipeWindowMinutes * 60
	const endTimeError = validationMessages.endAt ?? validationMessages.duration ?? validationMessages.startAt

	const effectiveStartSeconds = useMemo(() => {
		if (startMode === 'immediate') return Math.floor(Date.now() / 1000)
		const parsed = formData.startAt ? parseDatetimeLocalSeconds(formData.startAt) : null
		return parsed ?? Math.floor(Date.now() / 1000)
	}, [startMode, formData.startAt])

	const virtualEndSeconds = useMemo(() => {
		if (endMode === 'duration') return effectiveStartSeconds + durationSeconds
		return parseDatetimeLocalSeconds(formData.endAt) ?? 0
	}, [endMode, effectiveStartSeconds, durationSeconds, formData.endAt])

	const virtualDurationSeconds = useMemo(() => {
		if (endMode === 'duration') return durationSeconds
		if (!virtualEndSeconds) return 0
		return Math.max(0, virtualEndSeconds - effectiveStartSeconds)
	}, [endMode, durationSeconds, virtualEndSeconds, effectiveStartSeconds])

	// `max_end_at` preview — when no anti-snipe window is set this equals
	// `end_at` and the curve has zero duration. AUCTIONS.md §6.0.
	const curveMaxEndSeconds = useMemo(() => {
		if (!virtualEndSeconds) return 0
		if (antiSnipeWindowSeconds <= 0) return virtualEndSeconds
		return virtualEndSeconds + antiSnipeWindowSeconds
	}, [virtualEndSeconds, antiSnipeWindowSeconds])

	const handleStartImmediate = () => {
		setStartMode('immediate')
		setFormData((prev) => ({ ...prev, startAt: '' }))
	}

	const handleStartScheduled = () => {
		setStartMode('scheduled')
		setFormData((prev) => (prev.startAt ? prev : { ...prev, startAt: toDatetimeLocal(new Date(Date.now() + 15 * 60 * 1000)) }))
	}

	const handleEndAsDuration = () => {
		setEndMode('duration')
		setFormData((prev) => ({ ...prev, endAt: '' }))
	}

	const handleEndAsAbsolute = () => {
		setEndMode('absolute')
		setFormData((prev) => {
			if (prev.endAt) return prev
			const initial = new Date((effectiveStartSeconds + durationSeconds) * 1000)
			return { ...prev, endAt: toDatetimeLocal(initial) }
		})
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Section order: timing first (start + end), then bidding
			    mechanics (amounts + ladder), then auction-end policy
			    (anti-snipe curve + settlement grace). The curve preview
			    is embedded inside the anti-snipe card so its visual
			    feedback sits next to the inputs that drive it. */}

			<div className="grid w-full gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-4">
				<div className="flex items-center justify-between gap-2">
					<Label>Start Time</Label>
					<div className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5 text-xs">
						<button
							type="button"
							onClick={handleStartImmediate}
							className={`px-3 py-1 rounded ${startMode === 'immediate' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}
						>
							Immediate
						</button>
						<button
							type="button"
							onClick={handleStartScheduled}
							className={`px-3 py-1 rounded ${startMode === 'scheduled' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}
						>
							Schedule
						</button>
					</div>
				</div>

				{startMode === 'immediate' ? (
					<p className="text-xs text-zinc-500">The auction goes live the moment you publish.</p>
				) : (
					<DateTimePicker
						value={formData.startAt ?? ''}
						onChange={(next) => setFormData((prev) => ({ ...prev, startAt: next }))}
						placeholder="Pick a start date & time"
					/>
				)}
			</div>

			<div className="grid w-full gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4">
				<div className="flex items-center justify-between gap-2">
					<Label>
						<span className="after:content-['*'] after:ml-0.5 after:text-red-500">End Time</span>
					</Label>
					<div className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5 text-xs">
						<button
							type="button"
							onClick={handleEndAsDuration}
							className={`px-3 py-1 rounded ${endMode === 'duration' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}
						>
							Duration
						</button>
						<button
							type="button"
							onClick={handleEndAsAbsolute}
							className={`px-3 py-1 rounded ${endMode === 'absolute' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}
						>
							End date
						</button>
					</div>
				</div>

				{endMode === 'duration' ? (
					<div className="space-y-3">
						<div className="flex flex-wrap gap-1.5">
							{DURATION_PRESETS_SHORTCUT.map((preset) => {
								const isActive = durationSeconds === preset.seconds
								return (
									<button
										key={preset.label}
										type="button"
										onClick={() => {
											const indexSlider = DURATION_PRESETS.findIndex((v) => v.seconds === preset.seconds)
											setInputSliderValue(indexSlider + 1)
											setDurationSeconds(preset.seconds)
										}}
										className={`rounded-full px-3 py-1 text-xs font-semibold border ${
											isActive
												? 'border-border-default bg-surface-raised text-white'
												: 'border-zinc-300 bg-white text-zinc-700 hover:border-border-default'
										}`}
									>
										{preset.label}
									</button>
								)
							})}
						</div>

						<div>
							<Slider
								min={1}
								max={DURATION_PRESETS.length}
								value={[inputSliderValue]}
								onValueChange={(val) => {
									const sliderValue = val?.at(0)
									if (sliderValue) {
										setInputSliderValue(sliderValue)

										const value = DURATION_PRESETS[sliderValue - 1]
										setDurationSeconds(value.seconds)
									}
								}}
								className="w-full accent-secondary"
							/>
							<div className="flex items-center justify-between text-[10px] text-zinc-500">
								<span>1m</span>
								<span>30d</span>
							</div>
						</div>

						<div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
							<p>
								<span className="font-semibold text-zinc-900">Runs for:</span> {formatDuration(durationSeconds)}
							</p>
							<p className="mt-0.5">
								<span className="font-semibold text-zinc-900">Ends:</span> {formatAbsolute(virtualEndSeconds)}
							</p>
						</div>
						{endTimeError && <p className="text-xs text-red-600">{endTimeError}</p>}
					</div>
				) : (
					<div className="space-y-2">
						<DateTimePicker
							value={formData.endAt}
							onChange={(next) => setFormData((prev) => ({ ...prev, endAt: next }))}
							placeholder="Pick an end date & time"
						/>
						{virtualEndSeconds > 0 && (
							<p className="text-xs text-zinc-500">Runs for approximately {formatDuration(virtualDurationSeconds)}.</p>
						)}
						{endTimeError && <p className="text-xs text-red-600">{endTimeError}</p>}
					</div>
				)}
			</div>

			<div className="grid w-full gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-4">
				<Label htmlFor="auction-starting-bid">
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Starting Bid (sats)</span>
				</Label>
				<p className="text-xs text-zinc-500">Amount bidders must meet or exceed to place the first bid.</p>
				<Input
					id="auction-starting-bid"
					type="number"
					min={AUCTION_MIN_BID_SATS}
					step="1"
					value={formData.startingBid}
					onChange={(e) => setFormData((prev) => ({ ...prev, startingBid: e.target.value }))}
				/>
				{validationMessages.startingBid && <p className="text-xs text-red-600">{validationMessages.startingBid}</p>}
			</div>

			<div>
				<Collapsible open={openSection === 'advanced'} onOpenChange={toggle('advanced')}>
					<CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
						Advanced
						<ChevronDown className={`w-4 h-4 text-zinc-700 transition-transform ${openSection === 'advanced' ? 'rotate-180' : ''}`} />
					</CollapsibleTrigger>
					<CollapsibleContent>
						<div className="mt-2 space-y-2">
							<div className="grid w-full gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-4">
								<div className="grid w-full gap-1.5">
									<Label htmlFor="auction-bid-increment">
										<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Bid Increment (sats)</span>
									</Label>
									<p className="text-xs text-zinc-500">Minimum amount each new bid must exceed the previous by.</p>
									<Input
										id="auction-bid-increment"
										type="number"
										min={AUCTION_MIN_BID_LEG_SATS}
										step="1"
										value={formData.bidIncrement}
										onFocus={(e) => e.target.select()}
										onChange={(e) => setFormData((prev) => ({ ...prev, bidIncrement: e.target.value.replace(/^0+(\d)/, '$1') }))}
									/>
									{validationMessages.bidIncrement && <p className="text-xs text-red-600">{validationMessages.bidIncrement}</p>}
								</div>

								<div className="space-y-3">
									<div className="grid w-full gap-1.5">
										<div className="flex items-center space-x-2">
											<Label htmlFor="auction-reserve">Reserve (sats)</Label>
											<InfoTooltip content="Minimum bid required for the auction to have a winner. No winner if highest bid is lower than the reserve. Leave empty for no reserve." />
										</div>
										<Input
											id="auction-reserve"
											type="number"
											min="0"
											placeholder="Optional — no reserve if left empty"
											value={formData.reserve ?? ''}
											onFocus={(e) => e.target.select()}
											onChange={(e) => setFormData((prev) => ({ ...prev, reserve: e.target.value }))}
										/>
										{validationMessages.reserve && <p className="text-xs text-red-600">{validationMessages.reserve}</p>}
									</div>
								</div>

								{showBidLadder && <BidLadderPreview startingBid={startingBidNum} bidIncrement={bidIncrementNum} reserve={reserveNum} />}
							</div>
							<AntiSnipeCurveSettings
								formData={formData}
								setFormData={setFormData}
								startAtSeconds={effectiveStartSeconds}
								endAtSeconds={virtualEndSeconds}
								maxEndAtSeconds={curveMaxEndSeconds}
								settlementGraceSeconds={AUCTION_SETTLEMENT_GRACE_PRESETS[formData.settlementGracePreset]}
								startingBid={startingBidNum}
								bidIncrement={bidIncrementNum}
								reserve={reserveNum}
							/>
							<SettlementGraceSettings formData={formData} setFormData={setFormData} />
							<div className="grid w-full gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-4">
								<Label className="text-zinc-950">Trusted Mints</Label>
								<p className="text-xs text-zinc-500">
									Bids will be rejected unless the token is minted by one of these mints. At least one is required.
								</p>
								{validationMessages.trustedMints && <p className="text-xs text-red-600">{validationMessages.trustedMints}</p>}

								<div className="space-y-2 mt-1">
									{selectedMints.map((mint) => (
										<div
											key={mint}
											className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
										>
											<span className="truncate text-sm text-zinc-900" title={mint}>
												{mint}
											</span>
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() => removeMint(mint)}
												disabled={!canRemoveMint}
												className="text-red-600 hover:text-red-700 disabled:opacity-40"
												title={canRemoveMint ? 'Remove mint' : 'At least one mint is required'}
											>
												<X className="w-4 h-4" />
											</Button>
										</div>
									))}
								</div>

								{unselectedMints.length > 0 && (
									<div className="space-y-2 mt-3">
										<p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Add a mint</p>
										{unselectedMints.map((mint) => (
											<button
												key={mint}
												type="button"
												onClick={() => addMint(mint)}
												className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-left text-sm text-zinc-700 hover:border-border-default"
											>
												<span className="truncate" title={mint}>
													{mint}
												</span>
												<Plus className="w-4 h-4 text-zinc-500 shrink-0" />
											</button>
										))}
									</div>
								)}
							</div>
						</div>
					</CollapsibleContent>
				</Collapsible>
			</div>
		</div>
	)
}

export function CategoryTab({
	formData,
	setFormData,
	subCategoryInput,
	setSubCategoryInput,
	mainCategories,
}: TabProps & {
	subCategoryInput: string
	setSubCategoryInput: Dispatch<SetStateAction<string>>
	mainCategories: readonly string[]
}) {
	return (
		<div className="flex flex-col gap-4">
			<div className="grid w-full gap-1.5">
				<Label>Main Category</Label>
				<Select value={formData.mainCategory} onValueChange={(value) => setFormData((prev) => ({ ...prev, mainCategory: value }))}>
					<SelectTrigger>
						<SelectValue placeholder="Select category" />
					</SelectTrigger>
					<SelectContent>
						{mainCategories.map((category) => (
							<SelectItem key={category} value={category}>
								{category}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-sub-categories">Sub Categories (comma or newline separated)</Label>
				<textarea
					id="auction-sub-categories"
					value={subCategoryInput}
					onChange={(e) => setSubCategoryInput(e.target.value)}
					className="border-2 min-h-20 p-2 rounded-md"
					placeholder="Collectibles, Art, Bitcoin"
				/>
			</div>
		</div>
	)
}

export function SpecTab({ formData, setFormData }: TabProps) {
	const specs = formData.specs

	const updateSpec = (index: number, field: 'key' | 'value', value: string) => {
		setFormData((prev) => {
			const next = [...prev.specs]
			next[index] = { ...next[index], [field]: value }
			return { ...prev, specs: next }
		})
	}

	const addSpec = () => {
		setFormData((prev) => ({ ...prev, specs: [...prev.specs, { key: '', value: '' }] }))
	}

	const removeSpec = (index: number) => {
		setFormData((prev) => ({ ...prev, specs: prev.specs.filter((_, i) => i !== index) }))
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="space-y-1">
				<Label className="text-base font-medium">Item Specifications</Label>
				<p className="text-sm text-zinc-600">
					Key/value pairs describing the item (e.g. brand, model, condition). Shown on the auction detail page.
				</p>
			</div>

			<div className="space-y-3">
				{specs.map((spec, index) => (
					<div key={index} className="flex gap-2 items-start">
						<Input
							placeholder="Name (e.g. Brand)"
							value={spec.key}
							onChange={(e) => updateSpec(index, 'key', e.target.value)}
							className="flex-1"
						/>
						<Input
							placeholder="Value (e.g. Leica)"
							value={spec.value}
							onChange={(e) => updateSpec(index, 'value', e.target.value)}
							className="flex-1"
						/>
						<Button type="button" variant="outline" size="sm" onClick={() => removeSpec(index)} className="text-red-600 hover:text-red-700">
							<X className="w-4 h-4" />
						</Button>
					</div>
				))}

				<Button type="button" variant="outline" onClick={addSpec} className="w-full flex items-center gap-2">
					<Plus className="w-4 h-4" />
					Add Specification
				</Button>
			</div>
		</div>
	)
}

export function ImagesTab({
	images,
	setImages,
	error,
	renderUploader,
}: {
	images: AuctionImage[]
	setImages: Dispatch<SetStateAction<AuctionImage[]>>
	error?: string
	renderUploader: RenderAuctionImageUploader
}) {
	const [needsUploader, setNeedsUploader] = useState(true)

	const handleSaveImage = ({ url, index }: { url: string; index: number }) => {
		if (index >= 0) {
			setImages((prev) => {
				const next = [...prev]
				next[index] = { ...next[index], imageUrl: url }
				return next
			})
		} else {
			setImages((prev) => [...prev, { imageUrl: url, imageOrder: prev.length }])
			setNeedsUploader(true)
		}
	}

	const handleDeleteImage = (index: number) => {
		setImages((prev) => prev.filter((_, i) => i !== index).map((img, i) => ({ ...img, imageOrder: i })))
	}

	const handlePromoteImage = (index: number) => {
		if (index <= 0) return
		setImages((prev) => {
			const next = [...prev]
			const tmp = next[index]
			next[index] = next[index - 1]
			next[index - 1] = tmp
			return next.map((img, i) => ({ ...img, imageOrder: i }))
		})
	}

	const handleDemoteImage = (index: number) => {
		setImages((prev) => {
			if (index >= prev.length - 1) return prev
			const next = [...prev]
			const tmp = next[index]
			next[index] = next[index + 1]
			next[index + 1] = tmp
			return next.map((img, i) => ({ ...img, imageOrder: i }))
		})
	}

	return (
		<div className="space-y-4">
			<p className="text-gray-600">We recommend using square images of 1600x1600 and under 2mb.</p>

			<div className="flex flex-col gap-4">
				<Label>
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Image Upload</span>
					<span className="sr-only">required</span>
					{error && <span className="text-sm text-red-500 ml-2">({error})</span>}
				</Label>

				{images.map((image, i) => (
					<Fragment key={i}>
						{renderUploader({
							src: image.imageUrl,
							index: i,
							imagesLength: images.length,
							onSave: handleSaveImage,
							onDelete: handleDeleteImage,
							onPromote: handlePromoteImage,
							onDemote: handleDemoteImage,
						})}
					</Fragment>
				))}

				{needsUploader &&
					renderUploader({ src: null, index: -1, imagesLength: 0, onSave: handleSaveImage, onDelete: () => setNeedsUploader(false) })}
			</div>
		</div>
	)
}

export function AuctionShippingView({
	attached,
	unselected,
	hasUser,
	isLoading,
	hasAnyOptions,
	extraCostErrors,
	onAdd,
	onRemove,
	onExtraCostChange,
}: AuctionShippingViewProps) {
	return (
		<div className="flex flex-col gap-6">
			<div className="space-y-1">
				<Label className="text-base font-medium">Shipping Options</Label>
				<p className="text-sm text-zinc-600">Attach the shipping options buyers can choose from after winning this auction.</p>
			</div>

			{attached.length > 0 && (
				<div className="space-y-3">
					<h3 className="text-sm font-semibold">Attached</h3>
					{attached.map(({ shippingRef, extraCost, option }, index) => (
						<div key={`${shippingRef}-${index}`} className="rounded-lg border border-zinc-200 bg-white p-3">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0 flex-1">
									<p className="font-medium text-zinc-900 truncate">{option?.name ?? 'Unknown shipping option'}</p>
									<p className="text-xs text-zinc-500 break-all">{shippingRef}</p>
									{option && (
										<p className="text-xs text-zinc-600 mt-1">
											Base: {option.price} {option.currency}
											{describeShipping(option)}
										</p>
									)}
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => onRemove(index)}
									className="text-red-600 hover:text-red-700"
								>
									<X className="w-4 h-4" />
								</Button>
							</div>
							<div className="mt-3 grid gap-1.5">
								<Label htmlFor={`auction-shipping-extra-${index}`} className="text-xs text-zinc-600">
									Extra cost (sats, optional)
								</Label>
								<Input
									id={`auction-shipping-extra-${index}`}
									type="number"
									min="0"
									placeholder="0"
									value={extraCost}
									onChange={(e) => onExtraCostChange(index, e.target.value)}
								/>
								{extraCostErrors[index] && <p className="text-xs text-red-600">{extraCostErrors[index]}</p>}
							</div>
						</div>
					))}
				</div>
			)}

			<div className="space-y-3">
				<h3 className="text-sm font-semibold">Available</h3>
				{!hasUser ? (
					<p className="text-sm text-zinc-500">Connect your wallet to load your shipping options.</p>
				) : isLoading ? (
					<p className="text-sm text-zinc-500">Loading shipping options...</p>
				) : !hasAnyOptions ? (
					<div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
						You don&apos;t have any shipping options yet. Create some from the{' '}
						<UiLink href="/dashboard/products/shipping-options" className="text-fill-accent underline">
							shipping options
						</UiLink>{' '}
						page, then come back here.
					</div>
				) : unselected.length === 0 ? (
					<p className="text-sm text-zinc-500">All of your shipping options are already attached.</p>
				) : (
					<div className="space-y-2">
						{unselected.map((option) => (
							<button
								key={option.id}
								type="button"
								onClick={() => onAdd(option)}
								className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-left hover:border-border-default"
							>
								<div className="min-w-0 flex-1">
									<p className="font-medium text-zinc-900 truncate">{option.name}</p>
									<p className="text-xs text-zinc-600">
										{option.price} {option.currency}
										{describeShipping(option)}
									</p>
								</div>
								<Plus className="w-4 h-4 text-zinc-500" />
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	)
}
