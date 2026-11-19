import './catalogue-theme.css'
import type { ReactNode } from 'react'
import { catalogueCssVars, type CatalogueMode } from './catalogue-preset'
import {
	bidCountLabel,
	priceLine,
	ARENA_UNKNOWN_END_LABEL,
	phaseLabel,
	type ArenaAuctionCardModel,
	type ArenaRelayHealth,
	type ArenaSurfaceStatus,
} from '@ui/auction/arena/model'

/**
 * The Catalogue list, Layout A — the pplx baseline's light editorial grid.
 *
 * Props-only by the house rule (`ui/AGENTS.md:18-28`, `:120`): the host owns
 * the read and the clock, this component owns the arrangement. It receives the
 * arena read-model (`ArenaAuctionCardModel`, projected by
 * `platform/web/auctions/relay/auctionSurfacesRead.ts`) and renders it — it
 * opens no relay and reads no document.
 *
 * Three flat fields the demo surface carried have **no arena equivalent** and
 * are not rendered here rather than defaulted (the honesty rule, `model.ts`):
 *
 *   - `fundingMode` — the arena escrow is mint-backed, not
 *     `custodial_reservation_v1`; the read carries no funding mode at all, so
 *     the Layout A banner states the escrow instead of a demo funding mode;
 *   - `status` — split into the read-model's `phase` + `verdict` + the read's
 *     five-word `state` + `divergent`, each rendered in words;
 *   - `endTime` — the read's create-derived `endsAt`, which is `null` when the
 *     create stated no duration; `null` renders {@link ARENA_UNKNOWN_END_LABEL},
 *     never a `0`.
 *
 * The price and bid-count sentences are the arena read-model's own
 * (`priceLine`, `bidCountLabel`) so the list and every other arena surface state
 * the same facts the same way; a second copy of the honesty rule would
 * eventually disagree with the first.
 */
export interface CatalogueViewProps {
	/** Light (default) or the Arena dark tokens (`catalogue-preset.ts`). */
	mode?: CatalogueMode
	/** The lots the host selected, already projected to the read-model. */
	cards: readonly ArenaAuctionCardModel[]
	/** The read's five-word state, so a count never reads as a finished verdict. */
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
	/** Unix seconds, supplied by the host so the countdown never runs off the browser clock. */
	now: number
	/** Host-resolved link target for one lot. */
	hrefFor: (card: ArenaAuctionCardModel) => string
	/** The sort / hide-ended controls under the title ({@link CatalogueToolbar}). */
	toolbar?: ReactNode
	/** The "Create auction" call to action beside the title; omitted when absent. */
	onCreate?: () => void
	/** A read-state note above the grid (partial read). */
	notice?: ReactNode
	/**
	 * The Arena demo's three-panel lot (media, clock and bid, bids/chat/chain),
	 * rendered above the list. When present it replaces the list's own ticker,
	 * title and escrow note, so the page carries one h1: the featured lot's.
	 */
	featured?: ReactNode
	/** Rendered in place of the grid when there are no cards to show. */
	empty?: ReactNode
}

function formatRemaining(endsAt: number, now: number): string {
	const seconds = Math.max(0, endsAt - now)
	if (seconds === 0) return 'ended'
	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	if (days > 0) return `${days}d ${hours}h`
	if (hours > 0) return `${hours}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`
	const minutes = Math.floor(seconds / 60)
	const rest = seconds % 60
	return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`
}

/** The one visible label a lot has; the `d` tag is the label of last resort (`model.ts:66`). */
function lotLabel(card: ArenaAuctionCardModel): string {
	return card.title?.trim() || card.d
}

export interface CatalogueLotCardProps {
	/** The lot, already projected to the read-model. */
	card: ArenaAuctionCardModel
	/** The read's five-word state, so a count never reads as a finished verdict. */
	status: ArenaSurfaceStatus
	/** Unix seconds, supplied by the host so the countdown never runs off the browser clock. */
	now: number
	/** Host-resolved link target for this lot. */
	href: string
}

/**
 * The Layout A **lot card** — one `<a>` in the grid.
 *
 * Extracted so every list surface that shows arena lots (the `/auctions` index,
 * the featured strip, the seller dashboard) renders the **same** card: one
 * presentation per behaviour, which is the whole point of retiring the arena
 * card beside it. It is a pure function of the read-model it is handed.
 *
 * The `data-slot`/`data-phase`/`data-verdict` attributes are the card's stable
 * contract for tests and the assembler; the `data-state` mirrors the read state.
 */
export function CatalogueLotCard({ card, status, now, href }: CatalogueLotCardProps) {
	const timer = card.endsAt !== null ? formatRemaining(card.endsAt, now) : ARENA_UNKNOWN_END_LABEL
	return (
		<a
			data-slot="arena-auction-card"
			data-state={status}
			data-phase={card.phase}
			data-verdict={card.verdict ?? 'unknown'}
			className="cat__card"
			href={href}
		>
			<div className="cat__shot">
				{card.imageUrl ? <img src={card.imageUrl} alt="" loading="lazy" /> : <span className="cat__shot-empty">No image published</span>}
				{card.phase === 'open' && card.endsAt !== null && (
					<span className="cat__live">
						<i />
						LIVE
					</span>
				)}
				{card.phase === 'ended' && <span className="cat__ended">ENDED</span>}
			</div>
			<div className="cat__body">
				<span className="cat__lot">Lot · {card.d}</span>
				<h2 className="cat__card-title">{lotLabel(card)}</h2>
				{card.divergent && <p className="cat__divergence">Relays disagree about this auction.</p>}
				<div className="cat__meta">
					<span className="cat__price">{priceLine(card)}</span>
					<span className="cat__timer">{timer}</span>
				</div>
				<span className="cat__state">
					{phaseLabel(card.phase)}
					{card.verdict !== null ? ` · ${card.verdict}` : ''}
					{card.divergent ? ' · relays disagree' : ''} · {bidCountLabel(card.bidCount, status)}
				</span>
			</div>
		</a>
	)
}

export interface CatalogueCardsProps {
	/** Light (default) or the Arena dark tokens (`catalogue-preset.ts`). */
	mode?: CatalogueMode
	/** The lots to render, already projected to the read-model. */
	cards: readonly ArenaAuctionCardModel[]
	/** The read's five-word state. */
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
	/** Unix seconds, supplied by the host. */
	now: number
	/** Host-resolved link target for one lot. */
	hrefFor: (card: ArenaAuctionCardModel) => string
}

/**
 * The Layout A **card grid**, mountable inside another surface's own chrome.
 *
 * {@link CatalogueView} is a whole page (its own banner, header and count); this
 * is just the grid of {@link CatalogueLotCard}s, so a strip or a dashboard panel
 * can render Layout A lots without the list page's frame. It carries the same
 * `.cat` token root, with the page's full-viewport `min-height` overridden to 0
 * so the tokens apply without the section claiming a screen.
 */
export function CatalogueCards({ cards, status, relayHealth, now, hrefFor, mode = 'light' }: CatalogueCardsProps) {
	return (
		<div className="cat" style={{ ...catalogueCssVars(mode), minHeight: 0 }}>
			<div
				className="cat__grid"
				data-testid="catalogue-grid"
				data-state={status}
				data-answered={relayHealth.answered}
				data-total={relayHealth.total}
			>
				{cards.map((card) => (
					<CatalogueLotCard key={card.coordinate} card={card} status={status} now={now} href={hrefFor(card)} />
				))}
			</div>
		</div>
	)
}

export function CatalogueView({
	cards,
	status,
	relayHealth,
	now,
	hrefFor,
	mode = 'light',
	toolbar,
	onCreate,
	notice,
	empty,
	featured,
}: CatalogueViewProps) {
	const openCount = cards.filter((card) => card.phase === 'open' && card.endsAt !== null).length
	const countLabel = `${cards.length} ${cards.length === 1 ? 'lot' : 'lots'}${status === 'settled' ? '' : ' so far'}`
	// The ticker repeats its items once so the -50% scroll loops seamlessly.
	const tickerItems = cards.slice(0, 8)
	return (
		<div className={`cat cat--page${featured ? ' cat--featured' : ''}`} style={catalogueCssVars(mode)}>
			{featured && (
				<div className="cat__featured" data-slot="catalogue-featured">
					{featured}
				</div>
			)}
			<div className="cat__wrap">
				{!featured && tickerItems.length > 0 && (
					<div className="cat__ticker" aria-hidden="true">
						<div className="cat__ticker-track">
							{[0, 1].map((copy) =>
								tickerItems.map((card) => (
									<span key={`${copy}-${card.coordinate}`}>
										{lotLabel(card)} <b>{priceLine(card)}</b>
									</span>
								)),
							)}
							<span>
								Escrow in <b>Cashu ecash</b>
							</span>
						</div>
					</div>
				)}

				{!featured && (
					<>
						<header className="cat__head">
							<div>
								<div className="cat__tags">
									{openCount > 0 && (
										<span className="cat__live">
											<i />
											LIVE · {openCount}
										</span>
									)}
									<span className="cat__tag" data-testid="catalogue-count">
										{countLabel}
									</span>
									<span className="cat__tag">Escrow in Cashu ecash</span>
								</div>
								<h1 className="cat__title">Auctions</h1>
							</div>
							{onCreate && (
								<button type="button" className="cat__cta" data-slot="catalogue-create" onClick={onCreate}>
									Create auction
								</button>
							)}
						</header>

						<p className="cat__banner" data-testid="catalogue-escrow-notice">
							Sats are locked in escrow until the lot closes: they go to the seller if you win, and come back to you otherwise.
						</p>
					</>
				)}

				<section className="cat__panel">
					<div className="cat__panel-head">
						<h2>On the block</h2>
						<span className="cat__sub">{featured ? `${countLabel} · escrow in Cashu ecash` : 'Lots read from your relays'}</span>
						{featured && onCreate && (
							<button type="button" className="cat__cta cat__cta--panel" data-slot="catalogue-create" onClick={onCreate}>
								Create auction
							</button>
						)}
					</div>

					{toolbar}
					{notice}

					{cards.length === 0 && empty ? (
						empty
					) : (
						<div className="cat__grid" data-testid="catalogue-grid">
							{cards.map((card) => (
								<CatalogueLotCard key={card.coordinate} card={card} status={status} now={now} href={hrefFor(card)} />
							))}
						</div>
					)}
				</section>
			</div>
		</div>
	)
}

export interface CatalogueToolbarProps {
	sortOptions: readonly { value: string; title: string }[]
	sort: string
	onSortChange: (value: string) => void
	hideEnded: boolean
	onToggleHideEnded: () => void
}

/**
 * The list's sort and hide-ended controls as Arena chips. Each chip is a real
 * button: the pressed one is the current sort, and "Hide ended" is a toggle.
 */
export function CatalogueToolbar({ sortOptions, sort, onSortChange, hideEnded, onToggleHideEnded }: CatalogueToolbarProps) {
	return (
		<div className="cat__toolbar" data-slot="catalogue-toolbar" role="toolbar" aria-label="Sort and filter lots">
			<div className="cat__seg" role="group" aria-label="Sort">
				{sortOptions.map((option) => (
					<button key={option.value} type="button" aria-pressed={sort === option.value} onClick={() => onSortChange(option.value)}>
						{option.title}
					</button>
				))}
			</div>
			<button type="button" className="cat__chip cat__chip--toggle" aria-pressed={hideEnded} onClick={onToggleHideEnded}>
				Hide ended
			</button>
		</div>
	)
}

export interface CatalogueEmptyProps {
	title: string
	detail: string
	/** A small footnote, e.g. how many relays answered. */
	footnote?: string
	/** Optional action, e.g. resetting the filters. */
	actionLabel?: string
	onAction?: () => void
	/** The read state, for tests. */
	state: string
}

/** The empty state inside the catalogue frame. */
export function CatalogueEmpty({ title, detail, footnote, actionLabel, onAction, state }: CatalogueEmptyProps) {
	return (
		<div className="cat__empty" data-slot="arena-auctions-list-empty" data-state={state} role="status">
			<h2 className="cat__empty-title">{title}</h2>
			<p className="cat__empty-detail">{detail}</p>
			{footnote && <p className="cat__empty-foot">{footnote}</p>}
			{actionLabel && onAction && (
				<button type="button" className="cat__chip" onClick={onAction}>
					{actionLabel}
				</button>
			)}
		</div>
	)
}
