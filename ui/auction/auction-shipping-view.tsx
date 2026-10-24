import type { Ref } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '../primitives/button'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { UiLink } from '../provider/UiProvider'
import { cn } from '../utils/cn'
import { describeShipping, type AuctionShippingViewProps } from './model'

/**
 * The shipping-options panel of the auction editor: the attached options with
 * their extra-cost inputs, and the available options the host can add — with
 * its four degenerate states (no wallet, loading, no options at all, all
 * already attached).
 *
 * T6.3 slice S5a: lifted verbatim out of
 * `ui/components/auction-editor/AuctionEditorTabs.tsx` and given the
 * `className`/`ref` contract from `ui/AGENTS.md`. Props are the existing
 * `AuctionShippingViewProps` verbatim, plus `className`/`ref`. Markup, copy and
 * class strings are unchanged. Adopting the shared `empty-state`/`loading-state`
 * kit for the degenerate branches is slice S5b, a *declared* change, and is
 * deliberately not done here.
 */
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
	className,
	ref,
}: AuctionShippingViewProps & { className?: string; ref?: Ref<HTMLDivElement> }) {
	return (
		<div ref={ref} className={cn('flex flex-col gap-6', className)}>
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
