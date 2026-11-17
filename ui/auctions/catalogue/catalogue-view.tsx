import './catalogue-theme.css'
import { catalogueCssVars } from './catalogue-preset'
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
	/** The lots the host selected, already projected to the read-model. */
	cards: readonly ArenaAuctionCardModel[]
	/** The read's five-word state, so a count never reads as a finished verdict. */
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
	/** Unix seconds, supplied by the host so the countdown never runs off the browser clock. */
	now: number
	/** Host-resolved link target for one lot. */
	hrefFor: (card: ArenaAuctionCardModel) => string
}

function formatRemaining(endsAt: number, now: number): string {
	const seconds = Math.max(0, endsAt - now)
	if (seconds === 0) return 'ended'
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
	return (
		<a
			data-slot="arena-auction-card"
			data-state={status}
			data-phase={card.phase}
			data-verdict={card.verdict ?? 'unknown'}
			className="cat__card"
			href={href}
		>
			<div className="cat__shot">{card.imageUrl ? <img src={card.imageUrl} alt="" /> : null}</div>
			<span className="cat__lot">Lot · {card.d}</span>
			<h2 className="cat__card-title">{lotLabel(card)}</h2>
			<div className="cat__meta">
				<span className="cat__price">{priceLine(card)}</span>
				<span className="cat__timer">{card.endsAt !== null ? formatRemaining(card.endsAt, now) : ARENA_UNKNOWN_END_LABEL}</span>
			</div>
			{card.divergent && <p className="cat__divergence">Relays disagree about this auction.</p>}
			<span className="cat__state">
				{phaseLabel(card.phase)}
				{card.verdict !== null ? ` · ${card.verdict}` : ''}
				{card.divergent ? ' · relays disagree' : ''} · {bidCountLabel(card.bidCount, status)}
			</span>
		</a>
	)
}

export interface CatalogueCardsProps {
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
export function CatalogueCards({ cards, status, relayHealth, now, hrefFor }: CatalogueCardsProps) {
	return (
		<div className="cat" style={{ ...catalogueCssVars('light'), minHeight: 0 }}>
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

export function CatalogueView({ cards, status, relayHealth, now, hrefFor }: CatalogueViewProps) {
	return (
		<div className="cat" style={catalogueCssVars('light')}>
			<div className="cat__wrap">
				<p className="cat__banner" data-testid="catalogue-escrow-notice">
					Sats are locked in escrow until the lot closes: they go to the seller if you win, and come back to you otherwise.
				</p>

				<header className="cat__head">
					<h1 className="cat__title">Auctions</h1>
					<span className="cat__sub" data-testid="catalogue-count">
						{cards.length} {cards.length === 1 ? 'lot' : 'lots'}
						{status === 'settled' ? '' : ' so far'}
					</span>
				</header>

				<div className="cat__grid" data-testid="catalogue-grid">
					{cards.map((card) => (
						<CatalogueLotCard key={card.coordinate} card={card} status={status} now={now} href={hrefFor(card)} />
					))}
				</div>
			</div>
		</div>
	)
}
