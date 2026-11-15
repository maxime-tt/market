import { useMemo, useState, type Ref } from 'react'
import { AUCTION_MIN_BID_LEG_SATS, AUCTION_MIN_BID_SATS } from '@sdk/commerce/auctions'
import {
	AUCTION_MAX_ANTISNIPE_WINDOW_SEC,
	AUCTION_MIN_ANTISNIPE_WINDOW_SEC,
} from '@sdk/commerce/auctions/auctionPublishValidation'
import { Button } from '../primitives/button'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { Slider } from '../primitives/slider'
import { cn } from '../utils/cn'
import { formatAbsolute, formatDuration } from '../utils/duration'
import { DURATION_PRESETS, DURATION_PRESETS_SHORTCUT } from './duration-presets'
import { type TabProps, type ValidationMessages } from './model'

/**
 * The auction form's "Auction" mechanics tab: duration, the starting price, the increment
 * and the two protocol modes.
 *
 * Every control here maps to a field the kind-1440 create actually carries. Start/end
 * scheduling is gone (the create has `durationSec`, not `start_at`/`end_at`), and so are
 * the retired knobs — reserve, the anti-snipe floor curve, settlement grace and the
 * trusted-mint list have no field in the settled protocol, so they have no control here.
 * `windowSec` is rendered only for `mode: 'antisnipe'`, because a fixed-time auction
 * publishes `windowSec: 0` and a visible knob that is always overwritten is a lie.
 */

/** One-tap anti-snipe windows. All inside the protocol's 60…900 s range. */
const ANTISNIPE_WINDOWS: { label: string; seconds: number }[] = [
	{ label: '1m', seconds: 60 },
	{ label: '5m', seconds: 300 },
	{ label: '15m', seconds: 900 },
]

export type AuctionTabViewProps = TabProps & {
	validationMessages: ValidationMessages
	className?: string
	ref?: Ref<HTMLDivElement>
}

export function AuctionTabView({ formData, setFormData, validationMessages, className, ref }: AuctionTabViewProps) {
	const [sliderValue, setSliderValue] = useState<number>(() => {
		const index = DURATION_PRESETS.findIndex((preset) => preset.seconds === formData.durationSec)
		return index >= 0 ? index + 1 : 1
	})

	const durationSec = formData.durationSec
	const nowSeconds = useMemo(() => Math.floor(Date.now() / 1000), [])
	const endSeconds = nowSeconds + (Number.isFinite(durationSec) ? durationSec : 0)
	const windowSec = parseInt(formData.windowSec, 10)
	const windowOutOfRange =
		Number.isFinite(windowSec) && (windowSec < AUCTION_MIN_ANTISNIPE_WINDOW_SEC || windowSec > AUCTION_MAX_ANTISNIPE_WINDOW_SEC)

	const setDuration = (seconds: number) => {
		setFormData((prev) => ({ ...prev, durationSec: seconds }))
	}

	const setMode = (mode: 'fixed' | 'antisnipe') => {
		setFormData((prev) => ({
			...prev,
			mode,
			// A fixed-time auction carries no window; clearing it here means the sent
			// content can never disagree with the mode the seller picked.
			windowSec: mode === 'antisnipe' ? prev.windowSec || '60' : '',
		}))
	}

	return (
		<div ref={ref} className={cn('flex flex-col gap-4', className)}>
			<div className="grid w-full gap-3 rounded-lg border border-border-default bg-surface-raised px-4 py-4">
				<div className="flex items-center justify-between gap-2">
					<Label>
						<span className="after:content-['*'] after:ml-0.5 after:text-error">Duration</span>
					</Label>
					<span className="text-xs text-text-mid">20 seconds to 3 days</span>
				</div>

				<div className="flex flex-wrap gap-1.5">
					{DURATION_PRESETS_SHORTCUT.map((preset) => {
						const isActive = durationSec === preset.seconds
						return (
							<button
								key={preset.label}
								type="button"
								onClick={() => {
									const index = DURATION_PRESETS.findIndex((value) => value.seconds === preset.seconds)
									setSliderValue(index + 1)
									setDuration(preset.seconds)
								}}
								className={`rounded-full px-3 py-1 text-xs font-semibold border ${
									isActive
										? 'border-border-default bg-surface-raised text-text-high'
										: 'border-border-default bg-surface-raised text-text-high hover:border-border-default'
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
						value={[sliderValue]}
						onValueChange={(val) => {
							const next = val?.at(0)
							if (next) {
								setSliderValue(next)
								setDuration(DURATION_PRESETS[next - 1].seconds)
							}
						}}
						className="w-full accent-secondary"
					/>
					<div className="flex items-center justify-between text-[10px] text-text-mid">
						<span>1m</span>
						<span>3d</span>
					</div>
				</div>

				<div className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-text-high">
					<p>
						<span className="font-semibold text-text-high">Runs for:</span> {formatDuration(durationSec)}
					</p>
					<p className="mt-0.5">
						<span className="font-semibold text-text-high">Ends:</span> {formatAbsolute(endSeconds)}
					</p>
				</div>
				{validationMessages.durationSec && <p className="text-xs text-error">{validationMessages.durationSec}</p>}
			</div>

			<div className="grid w-full gap-1.5 rounded-lg border border-border-default bg-surface-raised px-4 py-4">
				<Label htmlFor="auction-starting-bid">
					<span className="after:content-['*'] after:ml-0.5 after:text-error">Starting Bid (sats)</span>
				</Label>
				<p className="text-xs text-text-mid">Amount bidders must meet or exceed to place the first bid.</p>
				<Input
					id="auction-starting-bid"
					type="number"
					min={AUCTION_MIN_BID_SATS}
					step="1"
					value={formData.startPrice}
					onChange={(e) => setFormData((prev) => ({ ...prev, startPrice: e.target.value }))}
				/>
				{validationMessages.startPrice && <p className="text-xs text-error">{validationMessages.startPrice}</p>}
			</div>

			<div className="grid w-full gap-1.5 rounded-lg border border-border-default bg-surface-raised px-4 py-4">
				<Label htmlFor="auction-bid-increment">
					<span className="after:content-['*'] after:ml-0.5 after:text-error">Bid Increment (sats)</span>
				</Label>
				<p className="text-xs text-text-mid">Minimum amount each new bid must exceed the previous by.</p>
				<Input
					id="auction-bid-increment"
					type="number"
					min={AUCTION_MIN_BID_LEG_SATS}
					step="1"
					value={formData.minIncrement}
					onFocus={(e) => e.target.select()}
					onChange={(e) => setFormData((prev) => ({ ...prev, minIncrement: e.target.value.replace(/^0+(\d)/, '$1') }))}
				/>
				{validationMessages.minIncrement && <p className="text-xs text-error">{validationMessages.minIncrement}</p>}
			</div>

			<div className="grid w-full gap-3 rounded-lg border border-border-default bg-surface-raised px-4 py-4">
				<Label>Closing rule</Label>
				<div className="inline-flex w-fit rounded-md border border-border-default bg-surface-sunken p-0.5 text-xs">
					<Button
						type="button"
						variant={formData.mode === 'fixed' ? 'secondary' : 'ghost'}
						size="sm"
						onClick={() => setMode('fixed')}
					>
						Fixed time
					</Button>
					<Button
						type="button"
						variant={formData.mode === 'antisnipe' ? 'secondary' : 'ghost'}
						size="sm"
						onClick={() => setMode('antisnipe')}
					>
						Anti-snipe
					</Button>
				</div>

				{formData.mode === 'antisnipe' ? (
					<div className="space-y-2">
						<p className="text-xs text-text-mid">
							A bid inside the last {formatDuration(windowSec > 0 ? windowSec : 0)} pushes the close back by the same
							amount. The window must be 1 to 15 minutes.
						</p>
						<div className="flex flex-wrap gap-1.5">
							{ANTISNIPE_WINDOWS.map((preset) => {
								const isActive = windowSec === preset.seconds
								return (
									<button
										key={preset.label}
										type="button"
										onClick={() => setFormData((prev) => ({ ...prev, windowSec: String(preset.seconds) }))}
										className={`rounded-full px-3 py-1 text-xs font-semibold border ${
											isActive
												? 'border-border-default bg-surface-raised text-text-high'
												: 'border-border-default bg-surface-raised text-text-high hover:border-border-default'
										}`}
									>
										{preset.label}
									</button>
								)
							})}
						</div>
						{validationMessages.windowSec && <p className="text-xs text-error">{validationMessages.windowSec}</p>}
						{windowOutOfRange && !validationMessages.windowSec && (
							<p className="text-xs text-error">
								An anti-snipe window must be between {AUCTION_MIN_ANTISNIPE_WINDOW_SEC} and{' '}
								{AUCTION_MAX_ANTISNIPE_WINDOW_SEC} seconds.
							</p>
						)}
					</div>
				) : (
					<p className="text-xs text-text-mid">The auction closes when its duration runs out, and no later.</p>
				)}
				{validationMessages.mode && <p className="text-xs text-error">{validationMessages.mode}</p>}
			</div>
		</div>
	)
}