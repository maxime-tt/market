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
 *  - the Chat tab says plainly that lot chat is not connected.
 */
import './arena-lot.css'
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
	ARENA_ESCROW_COPY,
	ARENA_NO_RECEIPT_LABEL,
	antisnipeBehaviourLabel,
	readStateMessage,
	refundReceiptLabel,
	settleReceiptLabel,
	shortKey,
	type ArenaAuctionDetailModel,
	type ArenaRelayHealth,
	type ArenaSurfaceStatus,
} from '@ui/auction/arena/model'
import { bidBlockedCopy, type ArenaBidBlockedReason, type ArenaBidCheck } from '@ui/auction/arena/bid-rules'
import { bidButtonLabel, bidFloorLabel, submissionLine, type ArenaBidSubmissionState } from '@ui/auction/arena/bid-panel'

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
	/** The position the bidder would reach. */
	target: number
	/** The delta to publish to reach it. */
	delta: number
}

/**
 * NEXT / JUMP / BIG MOVE, as in the demo, on this lot's real floor.
 *
 * Bids are deltas on a position, so each button names the position it reaches
 * and publishes `target − ownPosition`. The step is the published minimum
 * increment; a lot that published none steps by 5% of the floor, which only
 * picks suggested amounts — the floor itself is still the check's.
 */
export function arenaLadder(check: Pick<ArenaBidCheck, 'minimum' | 'ownPosition'> | null, minIncrement: number | null): ArenaLadderStep[] {
	if (check === null || check.minimum === null) return []
	const min = check.minimum
	const step = minIncrement !== null && minIncrement > 0 ? minIncrement : Math.max(1, Math.round(min * 0.05))
	const own = check.ownPosition ?? 0
	const make = (key: ArenaLadderStep['key'], label: string, target: number): ArenaLadderStep => ({
		key,
		label,
		target,
		delta: Math.max(1, target - own),
	})
	return [make('next', 'Next', min), make('jump', 'Jump', min + 2 * step), make('big', 'Big move', min + 5 * step)]
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

/** Each bid with the bidder's running position after it, newest first. */
export function arenaBidRows(
	model: ArenaAuctionDetailModel,
): Array<{ eventId: string; bidder: string; createdAt: number; amount: number | null; position: number | null }> {
	const running = new Map<string, number>()
	const rows = [...model.bids]
		.sort((a, b) => a.createdAt - b.createdAt)
		.map((b) => {
			const amount = typeof b.amount === 'number' && Number.isFinite(b.amount) ? b.amount : null
			const prev = running.get(b.bidder) ?? 0
			const position = amount === null ? null : prev + amount
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

function LiveBadge({ live }: { live: boolean }) {
	return (
		<span className={live ? 'arn-live' : 'arn-live is-ended'} data-testid="arena-lot-live">
			<i />
			{live ? 'LIVE' : 'ENDED'}
		</span>
	)
}

/** Drag the knob to the end to publish. Keyboard: Enter or Space. */
function SwipeToBid({ label, amount, disabled, onConfirm }: { label: string; amount: string; disabled: boolean; onConfirm: () => void }) {
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

	return (
		<div
			ref={track}
			className={dragging ? 'arn-swipe' : 'arn-swipe is-settling'}
			role="button"
			tabIndex={disabled ? -1 : 0}
			aria-disabled={disabled}
			aria-label={`${label} ${amount} sats`}
			data-testid="arena-lot-swipe"
			onKeyDown={(e) => {
				if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
					e.preventDefault()
					onConfirm()
				}
			}}
		>
			<div className="arn-swipe__fill" style={{ width: x + 50 }} />
			<span className="arn-swipe__label">
				{label} <b>{amount}</b>
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
	bid = null,
	verdicts,
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
	const ended = model.verdict !== null || model.phase === 'ended' || (model.endsAt !== null && now >= model.endsAt)
	const live = model.phase === 'open' && !ended
	const remaining = model.endsAt === null ? 0 : Math.max(0, model.endsAt - now)
	const urgent = live && remaining > 0 && remaining <= 60
	const clock = model.endsAt === null ? '–:––' : ended ? '0:00' : arenaClock(remaining)
	const antisnipe = antisnipeBehaviourLabel(model.mode, model.windowSec)
	const modeTag = model.mode === 'antisnipe' ? 'Anti-snipe close' : model.mode === null ? 'Close mode not stated' : 'Fixed close'
	const ringLabel =
		model.endsAt === null ? 'End not stated' : ended ? 'Closed' : model.mode === 'antisnipe' ? 'Bids reset the clock' : 'Until close'

	const positions = [...model.positions].sort((a, b) => b.total - a.total)
	const leader = positions[0] ?? null
	const hasBids = model.bidCount > 0 && model.topBidTotal !== null
	const priceLabel = !hasBids ? 'Starting bid' : ended ? 'Top bid at close' : 'Current bid'
	const priceValue = hasBids ? model.topBidTotal : model.startingBid

	const rows = arenaBidRows(model)
	const topRowId = leader === null ? null : (rows.find((r) => r.bidder === leader.bidder)?.eventId ?? null)
	const viewer = bid?.viewer ?? null
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
		<div className="arn" data-slot="arena-lot" data-state={status} data-phase={live ? 'live' : 'ended'}>
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

				<div className="arn-grid">
					<section className="arn-panel" aria-label="Lot media">
						<div className="arn-screen">
							{model.imageUrl !== null ? (
								<img src={model.imageUrl} alt={model.title ?? 'Lot photo'} />
							) : (
								<div className="arn-screen__empty">No image published</div>
							)}
							<LiveBadge live={live} />
						</div>
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
									<span className="arn-muted">{ended ? 'No bids were read' : 'No bids yet. Open the arena.'}</span>
								)}
							</div>
							{viewerPos !== null && (
								<div className="arn-muted" style={{ marginTop: 4 }}>
									{leader?.bidder === viewer ? 'You hold the top position.' : `Your position: ${sats(viewerPos.total)} sats.`}
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
													aria-label={`${step.label}: reach ${sats(step.target)} sats`}
												>
													<small>{step.label}</small>
													<b>{sats(step.target)}</b>
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
										amount={sats(next.target)}
										disabled={controlsDisabled}
										onConfirm={() => bid.onSubmitAmount(String(next.delta))}
									/>
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

						<p className="arn-note">{ARENA_ESCROW_COPY}</p>
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
								<p className="arn-empty">
									Lot chat is not connected on this server yet. Bids, receipts and verdicts are the live record for now.
								</p>
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
							<li key={p.bidder} className={i === 0 ? 'arn-lb is-first' : 'arn-lb'}>
								<span className="arn-lb__rank">{i + 1}</span>
								<Avatar pubkey={p.bidder} />
								<span className="arn-bid__name">
									{name(p.bidder)}
									{p.bidder === viewer && <em className="arn-pill arn-pill--you">you</em>}
								</span>
								<span className="arn-lb__bar">
									<i style={{ width: `${maxPos > 0 ? Math.max(4, (p.total / maxPos) * 100) : 0}%` }} />
								</span>
								<span className="arn-lb__amt">{sats(p.total)}</span>
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
						<span className="arn-sticky__time">{ended ? 'Closed' : clock}</span>
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
							{bid === null ? 'Bidding closed' : bidButtonLabel(bid.blockedReason, bid.check, false)}
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
