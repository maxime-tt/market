import { useMemo, useState, type Dispatch, type Ref, type SetStateAction } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { AUCTION_MIN_BID_LEG_SATS, AUCTION_MIN_BID_SATS } from '@sdk/commerce/auctions'
import { AUCTION_SETTLEMENT_GRACE_PRESETS } from '@sdk/commerce/auctions/auctionForm'
import { Button } from '../primitives/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../primitives/collapsible'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { Slider } from '../primitives/slider'
import { DateTimePicker } from '../shared/datetime-picker'
import { InfoTooltip } from '../shared/info-tooltip'
import { cn } from '../utils/cn'
import { parseDatetimeLocalSeconds, toDatetimeLocal } from '../utils/datetime'
import { formatAbsolute, formatDuration } from '../utils/duration'
import { AntiSnipeCurveSettings } from './anti-snipe-curve-settings'
import { BidLadderPreview } from './bid-ladder-preview'
import { DURATION_PRESETS, DURATION_PRESETS_SHORTCUT } from './duration-presets'
import { type EndMode, type StartMode, type TabProps, type ValidationMessages } from './model'
import { SettlementGraceSettings } from './settlement-grace-settings'

/**
 * The auction form's "Auction" mechanics tab: start/end timing, the duration
 * presets + slider, the starting bid, and the collapsible Advanced block
 * (bid increment, reserve, bid-ladder preview, the anti-snipe curve card, the
 * settlement-grace picker and the trusted-mints list).
 *
 * T6.3 slice S5a: lifted verbatim out of
 * `ui/components/auction-editor/AuctionEditorTabs.tsx`, renamed from
 * `AuctionTabContent` to match the repo's `*-view` naming, and given the
 * `className`/`ref` contract from `ui/AGENTS.md`. Markup, copy, class strings,
 * hooks and the derived-timing logic are unchanged. It composes the S3/S4
 * modules (`BidLadderPreview`, `AntiSnipeCurveSettings`, `SettlementGraceSettings`).
 */

export type AuctionTabViewProps = TabProps & {
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
	className?: string
	ref?: Ref<HTMLDivElement>
}

export function AuctionTabView({
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
	className,
	ref,
}: AuctionTabViewProps) {
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
		<div ref={ref} className={cn('flex flex-col gap-4', className)}>
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
								antiSnipeWindowMinutes={formData.antiSnipeWindowMinutes}
								minBidCurveShape={formData.minBidCurveShape}
								minBidCurvePeakMultiplier={formData.minBidCurvePeakMultiplier}
								onFormPatch={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
								startAtSeconds={effectiveStartSeconds}
								endAtSeconds={virtualEndSeconds}
								maxEndAtSeconds={curveMaxEndSeconds}
								settlementGraceSeconds={AUCTION_SETTLEMENT_GRACE_PRESETS[formData.settlementGracePreset]}
								startingBid={startingBidNum}
								bidIncrement={bidIncrementNum}
								reserve={reserveNum}
							/>
							<SettlementGraceSettings
								value={formData.settlementGracePreset}
								onValueChange={(next) => setFormData((prev) => ({ ...prev, settlementGracePreset: next }))}
							/>
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
