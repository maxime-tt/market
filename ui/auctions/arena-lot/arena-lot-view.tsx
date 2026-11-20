/**
 * `ui/auctions/arena-lot/arena-lot-view.tsx` — the single-lot auction page in
 * the layout of Plebeian Auctions Arena (the "C · Arena" template of
 * https://github.com/ChiefmonkeyArt/plebeian-arena-auctions).
 *
 * Only the presentation is ported. The demo's own functionality (fake sats,
 * its validator network, its browser wallet) is not: every figure on this page
 * is the arena read-model this app already builds (`@ui/auction/arena/model`),
 * and every bid goes through the host's existing check and publish path, handed
 * in as `bid`. The view is props-only (`ui/AGENTS.md`): it never sees a relay,
 * a signer or a promise.
 *
 * Honesty rules carried over from the catalogue view:
 *  - a field the read does not carry is said in words, never defaulted to 0;
 *  - the leader line names the top **derived position**, not a winner — the
 *    verdict is the authority on who won;
 *  - the Chat tab shows the host-provided live chat when one is passed, and says
 *    plainly that lot chat is not connected otherwise.
 */
import './arena-lot.css'
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
	ARENA_ESCROW_COPY,
	ARENA_NO_RECEIPT_LABEL,
	ARENA_POSITION_UNKNOWN_LABEL,
	antisnipeBehaviourLabel,
	createAcceptanceNotice,
	readStateMessage,
	refundReceiptLabel,
	settleReceiptLabel,
	shortKey,
	type ArenaAuctionDetailModel,
	type ArenaLotMediaItem,
	type ArenaRelayHealth,
	type ArenaSurfaceStatus,
} from '@ui/auction/arena/model'
import { bidBlockedCopy, type ArenaBidBlockedReason, type ArenaBidCheck } from '@ui/auction/arena/bid-rules'
import { bidButtonLabel, bidFloorLabel, bidSubmissionStepper, submissionLine, type ArenaBidSubmissionState } from '@ui/auction/arena/bid-panel'

// =========================================================================
// Props
// =========================================================================

/** The host's bid controller, as plain values and callbacks. */
export interface ArenaLotBidProps {
	/** The signed-in viewer, or `null`. Used only to mark "you" in the lists. */
	viewer: string | null
	check: ArenaBidCheck | null
	blockedReason: ArenaBidBlockedReason | null
	/** The typed amount — a **delta** added to the bidder's position. */
	amountInput: string
	onAmountChange: (value: string) => void
	pending: boolean
	submission: ArenaBidSubmissionState
	/** Publish `amountInput`. */
	onSubmit: () => void
	/** Publish this exact delta (the swipe), through the same check and path. */
	onSubmitAmount: (raw: string) => void
}

export interface ArenaLotViewProps {
	model: ArenaAuctionDetailModel | null
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
	/** Unix seconds; the route's one ticking clock. */
	now: number
	/** Host-rendered chain clock words, or `null`. */
	chainClockLabel?: string | null
	/** Host-owned seller identity node (avatar + name). */
	sellerIdentity?: ReactNode
	/** Host-owned display name for a pubkey; falls back to a short key. */
	renderName?: (pubkey: string) => ReactNode
	/** The bid controller, or `null` to render the page read-only. */
	bid?: ArenaLotBidProps | null
	/** Host-rendered verdict panel, shown under the leaderboard. */
	verdicts?: ReactNode
	/**
	 * Host-rendered live chat for this lot, shown in the Chat tab. The host owns
	 * the read and the publish; the view only places it. When absent the tab says
	 * so in words rather than pretending.
	 */
	chat?: ReactNode
	backHref?: string | null
}

// =========================================================================
// Pure helpers (exported for tests)
// =========================================================================

/** SVG ring circumference for r = 88. */
export const ARENA_RING_LENGTH = 2 * Math.PI * 88

/** `m:ss`, `h:mm:ss`, or `Nd HHh` — the demo's clock, on the lot's real end. */
export function arenaClock(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds))
	const d = Math.floor(s / 86_400)
	const h = Math.floor((s % 86_400) / 3600)
	const m = Math.floor((s % 3600) / 60)
	const sec = s % 60
	const pad = (n: number) => String(n).padStart(2, '0')
	if (d > 0) return `${d}d ${pad(h)}h`
	if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`
	return `${m}:${pad(sec)}`
}

/** Ring stroke offset: full ring at the start, empty at the close. */
export function arenaRingOffset(remaining: number, durationSec: number | null): number {
	if (durationSec === null || durationSec <= 0) return remaining > 0 ? 0 : ARENA_RING_LENGTH
	const left = Math.min(1, Math.max(0, remaining / durationSec))
	return ARENA_RING_LENGTH * (1 - left)
}

export interface ArenaLadderStep {
	key: 'next' | 'jump' | 'big'
	label: string
	/** The position this step reaches — stated *beside* the published number. */
	target: number
	/** The delta this step publishes — **the number the button displays**. */
	delta: number
}

/**
 * NEXT / JUMP / BIG MOVE, as in the demo, on this lot's real floor.
 *
 * Bids are deltas on a position, so each button names **the delta it publishes**
 * and the **position that delta reaches**. The step is the published minimum
 * increment; a lot that published none steps by 5% of the floor, which only
 * picks suggested amounts — the floor itself is still the check's.
 *
 * The one bidder `arenaBidFloor` returns the **top** as the floor for is the
 * bidder already at or above it (`bid-rules.ts`, "a bidder improving their OWN
 * standing need only reach the top"). Reaching that same floor would publish
 * `max(1, minimum − own) = 1`: a legal self-raise under R2-A, and not a step. So
 * for that bidder the step reaches one increment **above their own position**,
 * and the same check holds the resulting delta to the floor like any other.
 */
export function arenaLadder(check: Pick<ArenaBidCheck, 'minimum' | 'ownPosition'> | null, minIncrement: number | null): ArenaLadderStep[] {
	if (check === null || check.minimum === null) return []
	const min = check.minimum
	const step = minIncrement !== null && minIncrement > 0 ? minIncrement : Math.max(1, Math.round(min * 0.05))
	const own = check.ownPosition ?? 0
	const first = own >= min ? own + step : min
	const make = (key: ArenaLadderStep['key'], label: string, target: number): ArenaLadderStep => ({
		key,
		label,
		target,
		delta: Math.max(1, target - own),
	})
	return [make('next', 'Next', first), make('jump', 'Jump', min + 2 * step), make('big', 'Big move', min + 5 * step)]
}

/** Short relative time for the feeds: `now`, `45s`, `3m`, `2h`, `4d`. */
export function arenaAgo(createdAt: number, now: number): string {
	const s = Math.max(0, now - createdAt)
	if (s < 5) return 'now'
	if (s < 60) return `${s}s`
	if (s < 3600) return `${Math.floor(s / 60)}m`
	if (s < 86_400) return `${Math.floor(s / 3600)}h`
	return `${Math.floor(s / 86_400)}d`
}

const AVATAR_COLOURS = ['#7B5CFA', '#F7931A', '#16A35A', '#3B6FE0', '#FF3EB5', '#0EA5A4', '#E5484D']

function avatarColour(pubkey: string): string {
	let h = 0
	for (let i = 0; i < Math.min(pubkey.length, 16); i++) h = (h * 31 + pubkey.charCodeAt(i)) >>> 0
	return AVATAR_COLOURS[h % AVATAR_COLOURS.length]!
}

/**
 * Each bid with the bidder's running position after it, newest first.
 *
 * A leg a kind-1443 refund receipt names is **dead** — the chain voided it — so
 * it adds nothing: the running position after it is what it was before, and the
 * newest row for a bidder shows the same number the read's own `positions` and
 * the panel's floor use. An unreadable `amount` still yields `null` (`arenaBidRows`
 * cannot invent a size), which is why the feed says "unreadable" rather than a
 * number for that row.
 */
export function arenaBidRows(
	model: ArenaAuctionDetailModel,
): Array<{ eventId: string; bidder: string; createdAt: number; amount: number | null; position: number | null }> {
	const refundedBidIds = new Set(model.receipts.filter((r) => r.outcome === 'refund').map((r) => r.bidId))
	const running = new Map<string, number>()
	const rows = [...model.bids]
		.sort((a, b) => a.createdAt - b.createdAt)
		.map((b) => {
			const amount = typeof b.amount === 'number' && Number.isFinite(b.amount) ? b.amount : null
			const added = refundedBidIds.has(b.eventId) ? 0 : amount
			const prev = running.get(b.bidder) ?? 0
			const position = added === null ? null : prev + added
			if (position !== null) running.set(b.bidder, position)
			return { eventId: b.eventId, bidder: b.bidder, createdAt: b.createdAt, amount, position }
		})
	return rows.reverse()
}

function sats(n: number): string {
	return n.toLocaleString('en-GB')
}

// =========================================================================
// Small parts
// =========================================================================

function Avatar({ pubkey }: { pubkey: string }) {
	return (
		<span className="arn-av" style={{ background: avatarColour(pubkey) }} aria-hidden="true">
			{pubkey.slice(0, 1)}
		</span>
	)
}

/** The gallery to show: the model's `media`, or the lone `imageUrl` when a host sent no list. */
export function lotGalleryOf(model: Pick<ArenaAuctionDetailModel, 'imageUrl'> & { media?: ArenaLotMediaItem[] }): ArenaLotMediaItem[] {
	if (model.media && model.media.length > 0) return model.media
	return model.imageUrl !== null ? [{ type: 'image', url: model.imageUrl }] : []
}

const MEDIA_LABEL: Record<ArenaLotMediaItem['type'], string> = { image: 'Photo', video: 'Video', live: 'Live stream' }

/**
 * The lot's media: one stage and, when there is more than one item, a row of
 * clickable thumbnails under it (scrolls sideways when it overflows). Photos are
 * the common case; a video plays with controls, a live stream starts muted.
 */
function LotGallery({ media, title, live }: { media: ArenaLotMediaItem[]; title: string | null; live: boolean }) {
	const [index, setIndex] = useState(0)
	const thumbs = useRef<HTMLDivElement>(null)
	const count = media.length
	const current = count > 0 ? media[Math.min(index, count - 1)] : null
	const select = (next: number) => {
		const i = (next + count) % count
		setIndex(i)
		const el = thumbs.current?.children[i] as HTMLElement | undefined
		el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
	}
	const alt = title ?? 'Lot photo'
	return (
		<>
			<div className="arn-screen" data-testid="arena-lot-stage">
				{current === null ? (
					<div className="arn-screen__empty">No image published</div>
				) : current.type === 'image' ? (
					<img key={current.url} src={current.url} alt={count > 1 ? `${alt}, photo ${index + 1} of ${count}` : alt} />
				) : (
					<video
						key={current.url}
						className="arn-screen__video"
						src={current.url}
						controls
						playsInline
						preload="metadata"
						autoPlay={current.type === 'live'}
						muted={current.type === 'live'}
						aria-label={`${alt}, ${MEDIA_LABEL[current.type].toLowerCase()}`}
					/>
				)}
				<LiveBadge live={live} />
				{count > 1 && (
					<>
						<button type="button" className="arn-nav is-prev" aria-label="Previous" onClick={() => select(index - 1)}>
							‹
						</button>
						<button type="button" className="arn-nav is-next" aria-label="Next" onClick={() => select(index + 1)}>
							›
						</button>
						<span className="arn-count" aria-hidden="true">
							{index + 1} / {count}
						</span>
					</>
				)}
			</div>
			{count > 1 && (
				<div className="arn-thumbs" ref={thumbs} role="group" aria-label="Lot gallery" data-testid="arena-lot-thumbs">
					{media.map((item, i) => (
						<button
							key={`${item.type}:${item.url}:${i}`}
							type="button"
							className={`arn-thumb${i === index ? ' is-on' : ''}`}
							aria-label={`${MEDIA_LABEL[item.type]} ${i + 1} of ${count}`}
							aria-pressed={i === index}
							onClick={() => select(i)}
						>
							{item.type === 'image' ? (
								<img src={item.url} alt="" loading="lazy" />
							) : (
								<span className={`arn-thumb__tile is-${item.type}`}>
									<i aria-hidden="true">{item.type === 'live' ? '' : '▶'}</i>
									{item.type === 'live' ? 'LIVE' : 'VIDEO'}
								</span>
							)}
						</button>
					))}
				</div>
			)}
		</>
	)
}

function LiveBadge({ live }: { live: boolean }) {
	return (
		<span className={live ? 'arn-live' : 'arn-live is-ended'} data-testid="arena-lot-live">
			<i />
			{live ? 'LIVE' : 'ENDED'}
		</span>
	)
}

/**
 * Drag the knob to the end to publish. Keyboard: Enter or Space.
 *
 * `amount` is the delta this control **publishes** and the number it **shows** —
 * one value, never a target shown over a delta published (`bid.onSubmitAmount`
 * takes exactly `String(amount)`). `reaches` states the position that delta
 * lands on.
 */
function SwipeToBid({
	label,
	amount,
	reaches,
	disabled,
	onConfirm,
}: {
	label: string
	amount: number
	reaches: number
	disabled: boolean
	onConfirm: () => void
}) {
	const track = useRef<HTMLDivElement>(null)
	const [x, setX] = useState(0)
	const [dragging, setDragging] = useState(false)
	const start = useRef(0)

	const max = () => Math.max(1, (track.current?.clientWidth ?? 300) - 54)
	const onDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
		if (disabled) return
		start.current = e.clientX - x
		setDragging(true)
		e.currentTarget.setPointerCapture(e.pointerId)
	}
	const onMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
		if (!dragging) return
		setX(Math.min(max(), Math.max(0, e.clientX - start.current)))
	}
	const onUp = () => {
		if (!dragging) return
		setDragging(false)
		if (x >= max() * 0.88) onConfirm()
		setX(0)
	}

	const reached = `reaching your position ${sats(reaches)} sats`
	return (
		<div
			ref={track}
			className={dragging ? 'arn-swipe' : 'arn-swipe is-settling'}
			role="button"
			tabIndex={disabled ? -1 : 0}
			aria-disabled={disabled}
			aria-label={`${label} ${sats(amount)} sats, ${reached}`}
			data-testid="arena-lot-swipe"
			data-publishes={amount}
			onKeyDown={(e) => {
				if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
					e.preventDefault()
					onConfirm()
				}
			}}
		>
			<div className="arn-swipe__fill" style={{ width: x + 50 }} />
			<span className="arn-swipe__label">
				{label} <b>{sats(amount)}</b>
				<em> · your position {sats(reaches)}</em>
			</span>
			<span
				className="arn-swipe__knob"
				style={{ transform: `translateX(${x}px)` }}
				onPointerDown={onDown}
				onPointerMove={onMove}
				onPointerUp={onUp}
				onPointerCancel={onUp}
				aria-hidden="true"
			>
				›
			</span>
		</div>
	)
}

// =========================================================================
// The view
// =========================================================================

export function ArenaLotView({
	model,
	status,
	relayHealth,
	now,
	chainClockLabel = null,
	sellerIdentity,
	renderName,
	bid: bidProp = null,
	verdicts,
	chat,
	backHref = null,
}: ArenaLotViewProps) {
	const [tab, setTab] = useState<'bids' | 'chat' | 'chain'>('bids')

	if (model === null) {
		const message = readStateMessage(status)
		return (
			<div className="arn" data-slot="arena-lot" data-state={status}>
				<div className="arn-wrap">
					<p className="arn-state" data-testid="arena-lot-state">
						{message?.title ?? 'Reading the auction from relays…'}
					</p>
				</div>
			</div>
		)
	}

	const name = (pubkey: string) => (renderName ? renderName(pubkey) : shortKey(pubkey))
	// **The gate, at the one place the page can enforce it.** A lot the chain has
	// not accepted (`arena.createadmit.v1`, kind 1449 — the phase `unaccepted`) is
	// not followed: nothing is offered on it that moves money, so the bid
	// controller is dropped here whatever the host passed. The page still states
	// which constraint failed, in the banner below.
	const unaccepted = model.phase === 'unaccepted'
	const bid = unaccepted ? null : bidProp
	const acceptanceNotice = createAcceptanceNotice(model.acceptance, model.createRefusal, status)
	const ended = model.verdict !== null || model.phase === 'ended' || (model.endsAt !== null && now >= model.endsAt)
	const live = model.phase === 'open' && !ended
	// An unaccepted lot's clock is not a deadline anyone can bid against, so no
	// countdown runs on it: the ring stays empty and the label states the gate.
	const remaining = unaccepted || model.endsAt === null ? 0 : Math.max(0, model.endsAt - now)
	const urgent = live && remaining > 0 && remaining <= 60
	const clock = unaccepted || model.endsAt === null ? '–:––' : ended ? '0:00' : arenaClock(remaining)
	const antisnipe = antisnipeBehaviourLabel(model.mode, model.windowSec)
	const modeTag = model.mode === 'antisnipe' ? 'Anti-snipe close' : model.mode === null ? 'Close mode not stated' : 'Fixed close'
	const ringLabel = unaccepted
		? 'Not accepted by the chain'
		: model.endsAt === null
			? 'End not stated'
			: ended
				? 'Closed'
				: model.mode === 'antisnipe'
					? 'Bids reset the clock'
					: 'Until close'

	// Known positions rank first, best first; a `null` total means the read could
	// not determine that bidder's position (`arenaAuctionRead.ts`), so they are
	// not ranked and are never shown as a `0`.
	const positions = [...model.positions].sort((a, b) => {
		if (a.total === null || b.total === null) {
			if (a.total === b.total) return a.bidder.localeCompare(b.bidder)
			return a.total === null ? 1 : -1
		}
		return b.total - a.total || a.bidder.localeCompare(b.bidder)
	})
	const positionsUnknown = model.positions.some((p) => p.total === null)
	// The leader is named only when the top is known: `topBidTotal === null` with
	// bids read means a bidder's position is unknown, and that bidder could be
	// above `positions[0]`.
	const leader = positionsUnknown ? null : (positions[0] ?? null)
	const hasBids = model.bidCount > 0
	const priceLabel = !hasBids ? 'Starting bid' : ended ? 'Top bid at close' : 'Current bid'
	// With bids read and no known top, the line says "not known" rather than
	// falling back to the starting bid, which would state there were no bids.
	const priceValue = hasBids ? model.topBidTotal : model.startingBid

	const rows = arenaBidRows(model)
	const topRowId = leader === null ? null : (rows.find((r) => r.bidder === leader.bidder)?.eventId ?? null)
	const viewer = bidProp?.viewer ?? null
	const viewerPos = viewer === null ? null : (positions.find((p) => p.bidder === viewer) ?? null)

	const ladder = bid === null ? [] : arenaLadder(bid.check, model.minIncrement)
	const hardBlocked = bid !== null && bid.blockedReason !== null
	// Closed for good: the controls would offer nothing, so only the reason shows.
	// Other blocks (sign in, own lot) keep the controls visible but inert.
	const closedForGood = bid !== null && (bid.blockedReason === 'ended' || bid.blockedReason === 'concluded')
	const controlsDisabled = bid === null || hardBlocked || bid.pending
	const submitDisabled = controlsDisabled || bid.check === null || !bid.check.allowed
	const invalidCopy =
		bid !== null && bid.check !== null && !bid.check.allowed && !hardBlocked ? bidBlockedCopy(bid.check.reason, bid.check) : null
	const line = bid === null ? null : submissionLine(bid.submission)
	const stepper = bid === null ? null : bidSubmissionStepper(bid.submission)
	const next = ladder[0] ?? null
	const maxPos = leader?.total ?? 0

	const tickerItems = (pass: string) =>
		rows.length > 0
			? rows.slice(0, 12).map((r) => (
					<span key={`${pass}${r.eventId}`}>
						{name(r.bidder)} bid <b>{r.amount === null ? 'an unreadable amount' : `${sats(r.amount)} sats`}</b> ·{' '}
						{arenaAgo(r.createdAt, now)}
					</span>
				))
			: [
					<span key={`${pass}a`}>
						Lot <b>{model.d}</b>
					</span>,
					<span key={`${pass}b`}>
						Starting bid <b>{model.startingBid === null ? 'not stated' : `${sats(model.startingBid)} sats`}</b>
					</span>,
					<span key={`${pass}c`}>Escrow in Cashu ecash</span>,
					<span key={`${pass}d`}>
						{relayHealth.total > 0 ? `${relayHealth.answered} of ${relayHealth.total} relays answered` : 'Relays not read'}
					</span>,
				]

	return (
		<div
			className="arn"
			data-slot="arena-lot"
			data-state={status}
			data-phase={live ? 'live' : unaccepted ? 'unaccepted' : 'ended'}
			data-accepted={model.acceptance.accepted ? 'true' : 'false'}
		>
			<div className="arn-wrap">
				<div className="arn-ticker" aria-hidden="true">
					<div className="arn-ticker__track">
						{tickerItems('a')}
						{tickerItems('b')}
					</div>
				</div>

				<header className="arn-head">
					<div style={{ minWidth: 0 }}>
						<div className="arn-tags">
							<LiveBadge live={live} />
							{backHref !== null && (
								<a className="arn-tag" href={backHref} style={{ textDecoration: 'none' }}>
									← All lots
								</a>
							)}
							<span className="arn-tag">Lot {model.d}</span>
							<span className="arn-tag">{modeTag}</span>
							{model.validatorCount > 0 && <span className="arn-tag">{model.validatorCount} validators</span>}
							{model.divergent && <span className="arn-tag arn-tag--note">Relays disagree on the verdict</span>}
						</div>
						<h1 className="arn-title" data-testid="arena-lot-title">
							{model.title ?? model.d}
						</h1>
					</div>
					<div className="arn-seller" data-testid="arena-lot-seller">
						{sellerIdentity ?? (
							<>
								<Avatar pubkey={model.seller} />
								<span>
									<b>{shortKey(model.seller)}</b>
									<small>Seller</small>
								</span>
							</>
						)}
					</div>
				</header>

				{!model.acceptance.accepted && (
					<p className="arn-blocked" role="alert" data-testid="arena-lot-acceptance" data-accepted="false">
						{acceptanceNotice}
					</p>
				)}

				<div className="arn-grid">
					<section className="arn-panel" aria-label="Lot media">
						<LotGallery key={model.coordinate} media={lotGalleryOf(model)} title={model.title} live={live} />
						<div className="arn-strip">
							<span>Signed listing</span>
							<span>·</span>
							<span>
								{model.relayCount} relay{model.relayCount === 1 ? '' : 's'}
							</span>
							{model.versions > 1 && (
								<>
									<span>·</span>
									<span>{model.versions} versions</span>
								</>
							)}
						</div>
					</section>

					<section className="arn-panel arn-core" id="arn-bid" aria-label="Bidding">
						<div className={`arn-ring${urgent ? ' is-urgent' : ''}${ended ? ' is-ended' : ''}`} data-testid="arena-lot-ring">
							<svg viewBox="0 0 200 200" aria-hidden="true">
								<circle cx="100" cy="100" r="88" className="arn-ring__bg" />
								<circle
									cx="100"
									cy="100"
									r="88"
									className="arn-ring__fg"
									style={
										{ strokeDasharray: ARENA_RING_LENGTH, strokeDashoffset: arenaRingOffset(remaining, model.durationSec) } as CSSProperties
									}
								/>
							</svg>
							<div className="arn-ring__inner">
								<div className={clock.length > 5 ? 'arn-ring__time is-long' : 'arn-ring__time'} data-testid="arena-lot-clock">
									{clock}
								</div>
								<div className="arn-label">{ringLabel}</div>
							</div>
						</div>

						<div className="arn-price">
							<div className="arn-label">{priceLabel}</div>
							<div className="arn-price__num" data-testid="arena-lot-price">
								{priceValue === null ? 'not stated' : sats(priceValue)}
								{priceValue !== null && <small>sats</small>}
							</div>
							<div className="arn-leader">
								{leader !== null ? (
									<>
										<span className="arn-crown" aria-hidden="true">
											♛
										</span>
										<b>{name(leader.bidder)}</b>
										<span className="arn-muted">{ended ? 'held the top position' : 'holds the top position'}</span>
									</>
								) : (
									<span className="arn-muted">
										{ended ? 'No bids were read' : positionsUnknown ? 'The top position is not known' : 'No bids yet. Open the arena.'}
									</span>
								)}
							</div>
							{viewerPos !== null && (
								<div className="arn-muted" style={{ marginTop: 4 }}>
									{viewerPos.total === null
										? `Your ${ARENA_POSITION_UNKNOWN_LABEL} — one of your legs could not be read as live.`
										: leader?.bidder === viewer
											? 'You hold the top position.'
											: `Your position: ${sats(viewerPos.total)} sats.`}
								</div>
							)}
						</div>

						{bid !== null && hardBlocked && bid.blockedReason !== null && (
							<p className="arn-blocked" data-testid="arena-lot-blocked">
								{bidBlockedCopy(bid.blockedReason, bid.check ?? { minimum: null, ownPosition: null })}
							</p>
						)}

						{bid !== null && !closedForGood && (
							<>
								<div className="arn-ladder" data-testid="arena-lot-ladder">
									{ladder.length === 0
										? (['Next', 'Jump', 'Big move'] as const).map((label) => (
												<button key={label} type="button" disabled>
													<small>{label}</small>
													<b>–</b>
												</button>
											))
										: ladder.map((step) => (
												<button
													key={step.key}
													type="button"
													className={String(step.delta) === bid.amountInput.trim() ? 'is-on' : undefined}
													disabled={controlsDisabled}
													onClick={() => bid.onAmountChange(String(step.delta))}
													aria-label={`${step.label}: bid ${sats(step.delta)} sats, reaching your position ${sats(step.target)} sats`}
													data-publishes={step.delta}
													data-reaches={step.target}
												>
													<small>{step.label}</small>
													<b>{sats(step.delta)}</b>
													<em className="arn-ladder__reaches">→ your position {sats(step.target)}</em>
												</button>
											))}
								</div>

								<form
									className="arn-custom"
									onSubmit={(e) => {
										e.preventDefault()
										if (!submitDisabled) bid.onSubmit()
									}}
								>
									<label className="arn-amount" data-invalid={invalidCopy !== null && bid.amountInput.trim() !== ''}>
										<input
											value={bid.amountInput}
											onChange={(e) => bid.onAmountChange(e.target.value)}
											inputMode="numeric"
											autoComplete="off"
											disabled={controlsDisabled}
											aria-label="Bid amount in sats"
											aria-describedby="arn-floor"
											data-testid="arena-lot-amount"
										/>
										<span>sats</span>
									</label>
									<button className="arn-btn" type="submit" disabled={submitDisabled} data-testid="arena-lot-place">
										{bidButtonLabel(bid.blockedReason, bid.check, bid.pending)}
									</button>
								</form>

								<p className="arn-floor" id="arn-floor">
									{bidFloorLabel(model, bid.check)}
								</p>
								{invalidCopy !== null && (
									<p className="arn-invalid" role="alert">
										{invalidCopy}
									</p>
								)}

								{!hardBlocked && next !== null && (
									<SwipeToBid
										label="Swipe to bid"
										amount={next.delta}
										reaches={next.target}
										disabled={controlsDisabled}
										onConfirm={() => bid.onSubmitAmount(String(next.delta))}
									/>
								)}

								{stepper !== null && (
									<ol
										className="arn-steps"
										data-slot="arena-bid-stepper"
										data-active={stepper.active ?? 'none'}
										data-complete={stepper.complete ? 'true' : 'false'}
									>
										{stepper.steps.map((step, index) => (
											<li key={step.key} data-slot="arena-bid-step" data-step={step.key} data-status={step.status}>
												<span className={`arn-steps__dot is-${step.status}`} aria-hidden="true">
													{step.status === 'active' ? (
														<span className="arn-steps__spin" role="progressbar" aria-label={`${step.label} in progress`} />
													) : step.status === 'done' ? (
														'✓'
													) : (
														index + 1
													)}
												</span>
												<span className="arn-steps__body">
													<b>{step.label}</b>
													<small>{step.detail}</small>
												</span>
											</li>
										))}
									</ol>
								)}

								{line !== null && (
									<div className="arn-status" role="status" data-tone={line.tone} data-phase={bid.submission.phase}>
										<p>
											<b>{line.title}</b>
										</p>
										<p>{line.detail}</p>
									</div>
								)}
							</>
						)}

						{/* The escrow sentence describes money this page can take from you.
						    A lot the chain has not accepted takes none, so it is not shown
						    there — the banner above states the gate in its place. */}
						{!unaccepted && <p className="arn-note">{ARENA_ESCROW_COPY}</p>}
					</section>

					<section className="arn-panel arn-feeds" aria-label="Activity">
						<div className="arn-tabs" role="tablist">
							{(
								[
									['bids', 'Bids'],
									['chat', 'Chat'],
									['chain', 'Chain'],
								] as const
							).map(([key, label]) => (
								<button
									key={key}
									type="button"
									role="tab"
									aria-selected={tab === key}
									onClick={() => setTab(key)}
									data-testid={`arena-lot-tab-${key}`}
								>
									{label} {key === 'bids' && <span>{model.bidCount}</span>}
								</button>
							))}
						</div>

						{tab === 'bids' && (
							<ol className="arn-pane" data-testid="arena-lot-bids">
								{rows.length === 0 && <li className="arn-empty">{ended ? 'No bids were read for this lot.' : 'The arena is quiet…'}</li>}
								{rows.map((r) => (
									<li key={r.eventId} className={r.eventId === topRowId ? 'arn-bid is-top' : 'arn-bid'}>
										<Avatar pubkey={r.bidder} />
										<span className="arn-bid__name">
											{name(r.bidder)}
											{r.bidder === viewer && <em className="arn-pill arn-pill--you">you</em>}
											{model.refundsByBidder[r.bidder] !== undefined && (
												<em className="arn-pill" title={refundReceiptLabel(model.refundsByBidder[r.bidder]!)}>
													refunded
												</em>
											)}
										</span>
										<span className="arn-bid__amt">{r.position === null ? 'unreadable' : sats(r.position)}</span>
										<time>{arenaAgo(r.createdAt, now)}</time>
									</li>
								))}
								{model.bidsWithoutAmount > 0 && (
									<li className="arn-empty">
										{model.bidsWithoutAmount} bid{model.bidsWithoutAmount === 1 ? '' : 's'} had no readable amount, so positions may be
										incomplete.
									</li>
								)}
							</ol>
						)}

						{tab === 'chat' && (
							<div className="arn-pane" data-testid="arena-lot-chat">
								{chat ?? (
									<p className="arn-empty">
										Lot chat is not connected on this server yet. Bids, receipts and verdicts are the live record for now.
									</p>
								)}
							</div>
						)}

						{tab === 'chain' && (
							<ol className="arn-pane" data-testid="arena-lot-chain">
								{chainClockLabel !== null && (
									<li className="arn-chain">
										<b>Chain clock</b>
										<small>{chainClockLabel}</small>
									</li>
								)}
								<li className="arn-chain">
									<b>Relays</b>
									<small>
										{relayHealth.total > 0 ? `${relayHealth.answered} of ${relayHealth.total} answered` : 'none configured'}
										{status === 'settled' ? '' : ' · still reading'}
									</small>
								</li>
								<li
									className="arn-chain"
									data-testid="arena-lot-chain-acceptance"
									data-accepted={model.acceptance.accepted ? 'true' : 'false'}
								>
									<b>Chain acceptance</b>
									<small>{acceptanceNotice}</small>
								</li>
								{model.settleReceipt !== null && (
									<li className="arn-chain">
										<b>Settled</b>
										<small>{settleReceiptLabel(model.settleReceipt)}</small>
									</li>
								)}
								{model.receipts
									.filter((r) => r !== model.settleReceipt)
									.map((r) => (
										<li key={r.eventId} className="arn-chain">
											<b>
												{r.outcome === 'refund' ? 'Refund' : 'Settle'} · {r.total === null ? 'amount not stated' : `${sats(r.total)} sats`}
											</b>
											<small>
												height {r.height} · {shortKey(r.blockHash)}
											</small>
										</li>
									))}
								{model.receipts.length === 0 && <li className="arn-empty">Money receipts: {ARENA_NO_RECEIPT_LABEL}.</li>}
							</ol>
						)}
					</section>
				</div>

				<section className="arn-board" aria-label="Leaderboard">
					<div className="arn-board__head">
						<h2>Leaderboard</h2>
						<span className="arn-muted">Position per bidder: bids add up</span>
					</div>
					<ol>
						{positions.length === 0 && <li className="arn-empty">Nobody has a position yet.</li>}
						{positions.map((p, i) => (
							<li key={p.bidder} className={p.total !== null && i === 0 ? 'arn-lb is-first' : 'arn-lb'}>
								<span className="arn-lb__rank">{p.total === null ? '–' : i + 1}</span>
								<Avatar pubkey={p.bidder} />
								<span className="arn-bid__name">
									{name(p.bidder)}
									{p.bidder === viewer && <em className="arn-pill arn-pill--you">you</em>}
								</span>
								<span className="arn-lb__bar">
									<i style={{ width: `${p.total !== null && maxPos > 0 ? Math.max(4, (p.total / maxPos) * 100) : 0}%` }} />
								</span>
								<span className="arn-lb__amt">{p.total === null ? ARENA_POSITION_UNKNOWN_LABEL : sats(p.total)}</span>
							</li>
						))}
					</ol>
					<div className="arn-stats">
						<div>
							<b>{model.bidCount}</b>
							<span>bids</span>
						</div>
						<div>
							<b>{positions.length}</b>
							<span>bidders</span>
						</div>
						<div>
							<b>{model.validatorCount}</b>
							<span>validators with a verdict</span>
						</div>
						<div>
							<b>
								{relayHealth.answered}/{relayHealth.total}
							</b>
							<span>relays answered</span>
						</div>
					</div>
				</section>

				<section className="arn-about" aria-label="About this lot">
					<h2>About this lot</h2>
					{model.description !== null && model.description.trim() !== '' ? (
						model.description.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)
					) : (
						<p className="arn-muted">The seller published no description.</p>
					)}
					<dl className="arn-terms">
						<div>
							<dt>Starting bid</dt>
							<dd>{model.startingBid === null ? 'not stated' : `${sats(model.startingBid)} sats`}</dd>
						</div>
						<div>
							<dt>Minimum increment</dt>
							<dd>{model.minIncrement === null ? 'not stated' : `${sats(model.minIncrement)} sats`}</dd>
						</div>
						<div>
							<dt>Close</dt>
							<dd>{antisnipe ?? modeTag}</dd>
						</div>
						<div>
							<dt>Ends</dt>
							<dd>{model.endsAt === null ? 'not stated' : new Date(model.endsAt * 1000).toUTCString().replace(' GMT', ' UTC')}</dd>
						</div>
					</dl>
				</section>

				{verdicts !== undefined && verdicts !== null && <div className="arn-verdicts">{verdicts}</div>}

				<div className="arn-sticky" data-testid="arena-lot-sticky">
					<div>
						<b>{priceValue === null ? 'not stated' : `${sats(priceValue)} sats`}</b>
						<span className="arn-sticky__time">{unaccepted ? 'Not accepted' : ended ? 'Closed' : clock}</span>
					</div>
					{live && bid !== null && !hardBlocked && next !== null ? (
						<a
							className="arn-btn"
							href="#arn-bid"
							style={{ textDecoration: 'none' }}
							onClick={() => bid.onAmountChange(String(next.delta))}
						>
							Bid {sats(next.target)}
						</a>
					) : (
						<button className="arn-btn" type="button" disabled>
							{bid === null ? (unaccepted ? 'Not accepted by the chain' : 'Bidding closed') : bidButtonLabel(bid.blockedReason, bid.check, false)}
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
