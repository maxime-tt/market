import type { Ref } from 'react'
import { type AuctionSettlementGracePreset } from '@sdk/commerce/auctions/auctionForm'
import { Label } from '../primitives/label'
import { cn } from '../utils/cn'

/**
 * Settlement-grace picker — 5 min / 1 h / 3 h. AUCTIONS.md §4.1.
 *
 * The grace is the window the seller has between `max_end_at` and the
 * Cashu locktime to publish the kind-1024 settlement. Long enough that
 * a mint outage or relay flake doesn't cost the seller; short enough
 * that losing bidders aren't stranded for days.
 *
 * T6.3 S4: lifted out of `ui/components/auction-editor/AuctionEditorTabs.tsx`
 * and given the `className`/`ref` contract from `ui/AGENTS.md`. Markup, class
 * strings and behaviour are unchanged; it now takes the selected preset and an
 * `onValueChange` callback instead of the monolith's `formData`/`setFormData`.
 */

export interface SettlementGraceSettingsProps {
	value: AuctionSettlementGracePreset
	onValueChange: (next: AuctionSettlementGracePreset) => void
	className?: string
	ref?: Ref<HTMLDivElement>
}

export function SettlementGraceSettings({ value, onValueChange, className, ref }: SettlementGraceSettingsProps) {
	const presets: Array<{ value: AuctionSettlementGracePreset; label: string; sub: string }> = [
		{ value: '5min', label: '5 min', sub: 'tight, mint must be reliable' },
		{ value: '1h', label: '1 hour', sub: 'recommended' },
		{ value: '3h', label: '3 hours', sub: 'safest for losers' },
	]

	return (
		<div ref={ref} className={cn('grid w-full gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4', className)}>
			<div>
				<Label className="text-zinc-950">Settlement grace</Label>
				<p className="mt-1 text-xs text-zinc-500">
					How long after the auction end you have to publish the settlement before losing bidders can reclaim their funds. Bids carry the
					same locktime regardless of how many bids land.
				</p>
			</div>
			<div className="flex flex-wrap gap-2">
				{presets.map((option) => {
					const isActive = value === option.value
					return (
						<button
							key={option.value}
							type="button"
							onClick={() => onValueChange(option.value)}
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
