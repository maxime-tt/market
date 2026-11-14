import type { Ref } from 'react'
import { Media } from '../../shared/media'
import { StatusBadge } from '../../shared/status-badge'
import { cn } from '../../utils/cn'
import {
	phaseLabel,
	phaseTone,
	shortKey,
	type ArenaAuctionCardModel,
	type ArenaRelayHealth,
	type ArenaSurfaceStatus,
} from './model'

/**
 * The 1440-series auction **card** — one auction in a list, read from relays
 * through `arenaAuctionRead`.
 *
 * Ported from `ui/auction/auction-card-view.tsx` (the retired 30408 card): the
 * image frame, the corner badge, the title row and the price/bid pair are the
 * same presentation. What is different is what the card is allowed to *say*,
 * because the data now comes from a multi-relay read that can be partial:
 *
 * - a count is a verdict, and a verdict needs a finished read. While the read
 *   runs, the card says "N bids so far", never "N bids";
 * - an auction with no stated duration renders {@link ARENA_UNKNOWN_END_LABEL}
 *   rather than a made-up end;
 * - `bidsWithoutAmount > 0` means the derived total is incomplete, so the card
 *   refuses to print a price as if it were the whole picture;
 * - a verdict is labelled *relay-reported*: the relay notifies, the chain
 *   decides. No verdict is "unknown", which is not the same as "no outcome".
 *
 * Props-only (`ui/AGENTS.md:38-41`): the host reads and passes a plain model;
 * `href` is a string the host resolved, and `null` renders an inert card for an
 * auction that has no route yet.
 */

export interface ArenaAuctionCardProps {
	/** The auction, or `null` when the read delivered nothing for it. */
	model: ArenaAuctionCardModel | null
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
	/** Host-resolved link target, or `null` for an inert card. */
	href: string | null
	className?: string
	ref?: Ref<HTMLElement>
}

interface ReadMessage {
	title: string
	detail: string
}

/**
 * What a surface says when the read delivered no model. Each state gets its own
 * sentence: they are not interchangeable, and collapsing them into one
 * "nothing here" is the bug this exists to prevent.
 */
export function readStateMessage(status: ArenaSurfaceStatus, subject = 'this auction'): ReadMessage | null {
	switch (status) {
		case 'loading':
			return {
				title: `Reading ${subject} from relays…`,
				detail: 'Nothing has arrived yet. An empty card here means the read has not finished, not that the auction is missing.',
			}
		case 'no-relays':
			return {
				title: `No relay answered, so ${subject} could not be read.`,
				detail: 'This is not the same as the auction not existing.',
			}
		case 'incomplete':
			return {
				title: `The read stopped before every relay answered.`,
				detail: `Anything shown for ${subject} is what arrived, not the whole picture.`,
			}
		case 'error':
			return {
				title: `${subject[0].toUpperCase()}${subject.slice(1)} could not be read right now.`,
				detail: 'The read failed rather than answering. Retrying is the only honest next step.',
			}
		case 'settled':
			return {
				title: `No such auction was read.`,
				detail: 'Every relay answered and none of them carried it.',
			}
	}
}

/** `N bids` once the read is finished; `N bids so far` while it is not. */
export function bidCountLabel(count: number, status: ArenaSurfaceStatus): string {
	const noun = count === 1 ? 'bid' : 'bids'
	if (status === 'settled') return `${count} ${noun}`
	return `${count} ${noun} so far`
}

/** The price line, which must never assert a total it cannot support. */
export function priceLine(model: ArenaAuctionCardModel): string {
	if (model.topBidTotal !== null) return `${model.topBidTotal.toLocaleString()} sats`
	if (model.bidsWithoutAmount > 0) {
		const n = model.bidsWithoutAmount
		return `${n} ${n === 1 ? 'bid carries' : 'bids carry'} no readable amount — total unknown`
	}
	if (model.startingBid !== null) return `No bids · starting ${model.startingBid.toLocaleString()} sats`
	return 'No bid amount stated'
}

function StateCard({ status, relayHealth, className, ref }: Omit<ArenaAuctionCardProps, 'model' | 'href'>) {
	const message = readStateMessage(status)
	if (message === null) return null
	return (
		<article
			ref={ref}
			data-slot="arena-auction-card-state"
			data-state={status}
			role="status"
			className={cn(
				'flex flex-col gap-1 rounded-lg border border-dashed border-border-default bg-surface-sunken p-4 text-sm',
				className,
			)}
		>
			<p className="font-medium text-text-high">{message.title}</p>
			<p className="text-xs text-text-mid">{message.detail}</p>
			{relayHealth.total > 0 && (
				<p className="text-[11px] text-text-mid opacity-80">
					{relayHealth.answered} of {relayHealth.total} relays answered
				</p>
			)}
		</article>
	)
}

export function ArenaAuctionCard({ model, status, relayHealth, href, className, ref }: ArenaAuctionCardProps) {
	if (model === null) return <StateCard status={status} relayHealth={relayHealth} className={className} ref={ref} />

	const label = model.title?.trim() || model.d
	const title = href ? (
		<a href={href} className="hover:underline">
			{label}
		</a>
	) : (
		<span>{label}</span>
	)

	return (
		<article
			ref={ref}
			data-slot="arena-auction-card"
			data-state={status}
			data-phase={model.phase}
			data-verdict={model.verdict ?? 'unknown'}
			className={cn(
				'flex w-full max-w-full flex-col overflow-hidden rounded-lg border border-border-default bg-bg shadow-sm transition-shadow hover:shadow-md',
				className,
			)}
		>
			<div className="relative aspect-square overflow-hidden border-b border-border-default">
				{model.imageUrl ? (
					<Media
						src={model.imageUrl}
						alt={label}
						className="h-full w-full rounded-t-[calc(var(--radius)-1px)] object-cover"
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center rounded-lg bg-surface-sunken text-text-mid">
						No image
					</div>
				)}
				<StatusBadge
					status={phaseLabel(model.phase)}
					tone={phaseTone(model.phase)}
					className="absolute right-2 top-2 text-[10px] font-bold"
				/>
			</div>

			<div className="flex flex-grow flex-col gap-2 p-3">
				<h2 className="overflow-hidden text-ellipsis whitespace-nowrap border-b border-border-default pb-2 text-sm font-medium">
					{title}
				</h2>

				<p className="text-xs text-text-mid">by {shortKey(model.seller)}</p>

				<div className="flex items-center justify-between gap-2">
					<p data-slot="arena-auction-card-price" className="text-sm font-semibold text-text-high">
						{priceLine(model)}
					</p>
					<span className="rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-text-mid">
						{bidCountLabel(model.bidCount, status)}
					</span>
				</div>

				{model.divergent && (
					<p data-slot="arena-auction-card-divergence" className="text-xs font-medium text-warning-muted-foreground">
						Relays disagree about this auction&apos;s outcome.
					</p>
				)}

				{model.verdict !== null ? (
					<p data-slot="arena-auction-card-verdict" className="text-xs text-text-high">
						Outcome: {model.verdict} (relay-reported)
					</p>
				) : model.phase === 'ended' ? (
					<p data-slot="arena-auction-card-unverified" className="text-xs text-text-mid">
						Outcome not verified yet.
					</p>
				) : null}

				<p className="mt-auto text-[11px] text-text-mid opacity-80">
					Read from {model.relayCount} {model.relayCount === 1 ? 'relay' : 'relays'}
					{status !== 'settled' &&
						relayHealth.total > 0 &&
						` · ${relayHealth.answered} of ${relayHealth.total} answered`}
				</p>
			</div>
		</article>
	)
}