import type { Ref } from 'react'
import { Button } from '../../primitives/button'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { StatusBadge } from '../../shared/status-badge'
import { cn } from '../../utils/cn'
import { ARENA_BID_ADVISORY, bidBlockedCopy, type ArenaBidCheck, type ArenaBidBlockedReason } from './bid-rules'
import type { ArenaAuctionDetailModel } from './model'

/**
 * The 1440-series **bid panel** — the entry surface inside the auction detail
 * view, and the honest record of a submission that may not have landed.
 *
 * ## Split from its host
 *
 * Props-only (`ui/AGENTS.md:118-120`): the host
 * (`platform/web/auctions/relay/AuctionBidHost.tsx`) owns the input state, the
 * clock, the viewer identity and the publish; this file owns markup and words.
 * Nothing here fetches, signs or publishes; `onSubmit` is the only way out.
 *
 * ## Ported presentation, new data source
 *
 * The layout is the retired bidder panel's (`ui/auction/auction-bidder-views.tsx`
 * `AuctionBidderView`): one amount field with the sats unit inline, one button
 * under it, the minimum stated in words, and the input pre-filled with the
 * minimum (`platform/web/auctions/AuctionBidderHost.tsx:425-428`) — a bidder
 * who types is editing the floor, not starting from nothing. What changed is
 * where the minimum comes from: the auction's **own** published terms read from
 * relays (`bid-rules.ts`), not a validator's opinion.
 *
 * ## The states, and why each is a sentence rather than a disabled button
 *
 * A greyed-out button with no reason is the failure this panel exists to avoid.
 * Every blocking reason has words (`bidBlockedCopy`), and the panel states
 * which one applies *before* the bidder types anything. "No wallet" is split
 * from "wallet unavailable", because the fix differs (`AGENTS.md:41-46`).
 *
 * ## After publishing: optimistic, but never a claim of acceptance
 *
 * See {@link ArenaBidSubmissionState}. Between the click and the relay
 * round-trip the bid is **presumed** — the row says "presumed", not "placed" —
 * and a publish that gets no relay ACK at all is a **failure**, matching the
 * app's existing fail-closed rule for a zero-ACK publish
 * (`platform/web/auctions/auctionPublishIo.ts:47-52`).
 */

// =========================================================================
// Submission state
// =========================================================================

/**
 * What the surface may say about a bid the bidder just submitted.
 *
 * Not two states (`AGENTS.md:41-46`): "the escrow is being locked", "the escrow
 * is locked and the event is being offered", "some relays acknowledged", "no
 * relay acknowledged", "a relay acknowledged but nothing has come back on the
 * read", "the chain admitted it", "the chain has not decided yet", and "the
 * chain has demonstrably stopped committing" are different facts, and collapsing
 * them into "success/failure" would hide the one case a bidder most needs to
 * know about.
 *
 * **The stepper's facts.** The three steps of the submission stepper
 * ({@link bidSubmissionStepper}) each rest on their own fact and nothing else:
 *
 * - **lock** — the app's own funding step completed ({@link phase: 'locking'}
 *   while it runs, past it once the escrow is locked);
 * - **relay publish** — at least one relay ACKed the signed event
 *   (`presumed` and everything after it carry `acceptedBy`);
 * - **validator confirmation** — an `arena.bidadmit.v1` fact names this bid id
 *   ({@link phase: 'admitted'}). No ACK, no timeout and no `highAmount` reaches
 *   it.
 *
 * **Waiting is not failing.** `unconfirmed` is the state for "the app has not
 * yet read the chain's word", and it says so; only a zero-ACK publish and a
 * signing failure are failures (`isArenaBidSubmissionUnsuccessful`), and the
 * chain's *demonstrated* stall is its own state, with the window that
 * demonstrates it.
 */
export type ArenaBidSubmissionState =
	/** Nothing submitted since this page loaded. */
	| { phase: 'idle' }
	/** The app's own funding step is running: the escrow lock is being written at the mint. */
	| { phase: 'locking'; amount: number }
	/** The escrow is locked and the signed event is being offered to relays; nothing is ACKed yet. */
	| { phase: 'publishing'; amount: number }
	/** ≥1 relay ACKed the event, but the read has not yet delivered it back. **Presumed, not seen.** */
	| { phase: 'presumed'; amount: number; eventId: string; acceptedBy: string[]; totalRelays: number }
	/** The read delivered the bid back: the relays hold it. Still not an outcome (`bid-rules.ts`). */
	| { phase: 'seen'; amount: number; eventId: string; acceptedBy: string[]; totalRelays: number }
	/**
	 * The chain **admitted** this bid: an `arena.bidadmit.v1` fact (kind 1449)
	 * names this bid id, anchored at the bid's own committed height. This is the
	 * only state in which the panel may say the bid is in, and it carries the
	 * chain's own `position`/`highBid` for the bid.
	 */
	| {
			phase: 'admitted'
			amount: number
			eventId: string
			acceptedBy: string[]
			totalRelays: number
			/** The chain's admission fact for this bid, as the panel states it. */
			admission: { position: number; highBid: string; height: number; blockHash: string }
	  }
	/**
	 * The bid is on the relay but **not** in committed state while the chain is
	 * advancing, and **no `arena.bidadmit.v1` fact read names this bid**: the chain
	 * has not admitted it. **Not** a network problem. The escrow is locked until
	 * `locktime`, and the bidder can reclaim the funds through the lock's refund
	 * path. The panel never invents a reason — see the seam note on the
	 * `not-accepted` copy in {@link submissionLine}.
	 */
	| { phase: 'not-accepted'; amount: number; eventId: string; locktime: number | null; reclaimable: boolean }
	/**
	 * The bid is on the relay, the chain has committed nothing that shows whether
	 * it admitted it, and the app has **not** seen the chain advance. This is a
	 * *waiting* state, never a failure: no admission fact exists yet, so nothing
	 * is claimed about the bid and the surface keeps reading.
	 *
	 * `acceptedBy`/`totalRelays` are the relay ACKs it has carried since
	 * `presumed` (the app never drops a fact it holds), and `watchingSince`
	 * (unix seconds) is when the app began waiting — the window the stall claim
	 * is measured over (`arenaBidPublish.ts` `ARENA_CHAIN_STALLED_AFTER_SEC`).
	 */
	| { phase: 'unconfirmed'; amount: number; eventId: string; acceptedBy: string[]; totalRelays: number; watchingSince: number }
	/**
	 * The chain **recorded** a refusal of this bid (a kind-1450 naming its event
	 * id). `reason` is the chain's own words, verbatim. Only a bid refused at
	 * delivery is recorded; one refused at admission leaves no record, and the
	 * panel never supplies a reason the chain did not state.
	 */
	| { phase: 'refused'; amount: number; eventId: string; reason: string; locktime: number | null; reclaimable: boolean }
	/**
	 * The bid is on the relay but not in committed state and the app has read the
	 * chain's committed state stand still for long enough to demonstrate that the
	 * chain is not advancing: that is an infrastructure problem, not the bid.
	 * `stalledForSec` is the window the app itself watched — the only thing that
	 * makes the claim true — and the panel states it in words.
	 */
	| { phase: 'infrastructure'; amount: number; eventId: string; stalledForSec: number }
	/**
	 * Signed and offered, but **no** relay ACKed. Published nowhere — fail closed.
	 * `escrowLocked` is `true` when the escrow lock had already completed before
	 * the publish failed — the one fact the stepper's lock step rests on.
	 */
	| { phase: 'unpublished'; amount: number; eventId: string | null; reason: string; escrowLocked?: boolean }
	/**
	 * Signing failed, or the wallet refused; nothing was published and nothing was
	 * signed. `escrowLocked` as on `unpublished`.
	 */
	| { phase: 'failed'; amount: number; reason: string; escrowLocked?: boolean }

/** The submission is over and did not land: the bidder may retry the same amount. */
export function isArenaBidSubmissionUnsuccessful(state: ArenaBidSubmissionState): boolean {
	return state.phase === 'unpublished' || state.phase === 'failed'
}

// =========================================================================
// The submission stepper
//
// Three steps, in order: the app's own escrow lock, the signed event reaching a
// relay, and the chain's admission fact naming this bid. Each step's success
// rests on its OWN fact and nothing else — an ACK never lights the validator
// step, a timeout never lights it, and `highAmount` never lights it. The step in
// progress is the one a surface animates.
// =========================================================================

/** The three steps, in the order they happen. */
export const ARENA_BID_STEP_KEYS = ['lock', 'publish', 'admit'] as const

export type ArenaBidStepKey = (typeof ARENA_BID_STEP_KEYS)[number]

/** A step's status: done (its own fact holds), active (in progress), pending, or failed. */
export type ArenaBidStepStatus = 'done' | 'active' | 'pending' | 'failed'

export interface ArenaBidStep {
	key: ArenaBidStepKey
	/** The word the step is named by — the same three names the protocol uses. */
	label: string
	status: ArenaBidStepStatus
	/** The one sentence this step states about itself, from its own fact only. */
	detail: string
}

export interface ArenaBidStepper {
	steps: ArenaBidStep[]
	/** The step in progress (the one to animate), or `null` when none is. */
	active: ArenaBidStepKey | null
	/** True only when all three steps are done — the one state in which the bid is in. */
	complete: boolean
}

const STEP_LABELS: Record<ArenaBidStepKey, string> = {
	lock: 'Lock',
	publish: 'Relay publish',
	admit: 'Validator confirmation',
}

const STEP_DETAILS = {
	lockActive: 'Locking the escrow at the mint…',
	lockDone: 'The escrow for this bid is locked at the mint.',
	lockPending: 'The escrow lock has not started.',
	lockMissing: 'This submission reached no escrow lock.',
	publishActive: 'Offering the signed bid to the relays…',
	publishPending: 'No relay has acknowledged the signed event.',
	publishCarried: 'The relays stored this signed bid; this view no longer holds the ACK count.',
	publishFailed: 'No relay accepted the signed event.',
	admitActive: 'Waiting for the chain’s admission fact (arena.bidadmit.v1) naming this bid…',
	admitPending: 'No admission fact names this bid yet.',
	admitFailed: 'The chain recorded a refusal of this bid.',
} as const

/**
 * Can this state carry the relay-ACK count? `presumed` and everything after it
 * do — except an `admitted` state that arrived from a concluded one, which
 * leaves the count behind (`arenaBidPublish.ts` `nextPublishedBidState`): `null`
 * then says "this view does not hold the number", never "no relay stored it".
 */
function acceptedCount(state: ArenaBidSubmissionState): { accepted: number; total: number } | null {
	switch (state.phase) {
		case 'presumed':
		case 'seen':
		case 'unconfirmed':
			return { accepted: state.acceptedBy.length, total: state.totalRelays }
		case 'admitted':
			return state.acceptedBy.length === 0 && state.totalRelays === 0
				? null
				: { accepted: state.acceptedBy.length, total: state.totalRelays }
		default:
			return null
	}
}

function publishDetail(acks: { accepted: number; total: number } | null): string {
	if (acks === null) return STEP_DETAILS.publishPending
	return `A relay acknowledged the signed bid (${acks.accepted} of ${acks.total}). That is storage, not admission.`
}

/**
 * The stepper for a submission, or `null` when nothing has been submitted and
 * there is nothing to step through.
 *
 * Every status comes from the state's own fact for that step:
 *
 * - `lock` is `done` in every phase past the local funding step and `active`
 *   only while it runs; a failure that reached no lock says so.
 * - `publish` is `done` only when the state carries relay ACKs (≥1).
 * - `admit` is `done` **only** in `admitted`, the one phase an
 *   `arena.bidadmit.v1` fact produced. An ACK, a timeout or a `highAmount`
 *   never reaches it; `refused` fails it (the chain said no, in its words).
 */
export function bidSubmissionStepper(state: ArenaBidSubmissionState): ArenaBidStepper | null {
	if (state.phase === 'idle') return null

	const acks = acceptedCount(state)
	const published = acks !== null && acks.accepted > 0
	const admitted = state.phase === 'admitted'

	const step = (key: ArenaBidStepKey, status: ArenaBidStepStatus, detail: string): ArenaBidStep => ({
		key,
		label: STEP_LABELS[key],
		status,
		detail,
	})

	let lock: ArenaBidStep
	let publish: ArenaBidStep
	let admit: ArenaBidStep
	let active: ArenaBidStepKey | null

	switch (state.phase) {
		case 'locking':
			lock = step('lock', 'active', STEP_DETAILS.lockActive)
			publish = step('publish', 'pending', STEP_DETAILS.publishPending)
			admit = step('admit', 'pending', STEP_DETAILS.admitPending)
			active = 'lock'
			break
		case 'publishing':
			lock = step('lock', 'done', STEP_DETAILS.lockDone)
			publish = step('publish', 'active', STEP_DETAILS.publishActive)
			admit = step('admit', 'pending', STEP_DETAILS.admitPending)
			active = 'publish'
			break
		case 'admitted':
			lock = step('lock', 'done', STEP_DETAILS.lockDone)
			publish = step('publish', 'done', acks === null ? STEP_DETAILS.publishCarried : publishDetail(acks))
			admit = step(
				'admit',
				'done',
				`The chain admitted this bid at height ${state.admission.height} — position ${state.admission.position.toLocaleString()} sats.`,
			)
			active = null
			break
		case 'refused':
			lock = step('lock', 'done', STEP_DETAILS.lockDone)
			publish = step('publish', 'done', STEP_DETAILS.publishPending)
			admit = step('admit', 'failed', STEP_DETAILS.admitFailed)
			active = null
			break
		case 'unpublished':
			lock = state.escrowLocked === true ? step('lock', 'done', STEP_DETAILS.lockDone) : step('lock', 'pending', STEP_DETAILS.lockMissing)
			publish = step('publish', 'failed', STEP_DETAILS.publishFailed)
			admit = step('admit', 'pending', STEP_DETAILS.admitPending)
			active = null
			break
		case 'failed':
			lock = state.escrowLocked === true ? step('lock', 'done', STEP_DETAILS.lockDone) : step('lock', 'pending', STEP_DETAILS.lockMissing)
			publish = step('publish', 'pending', STEP_DETAILS.publishPending)
			admit = step('admit', 'pending', STEP_DETAILS.admitPending)
			active = null
			break
		default:
			// `presumed`, `seen`, `unconfirmed`, `not-accepted`, `infrastructure`:
			// the bid is on the relays and the app is waiting for the chain's word.
			lock = step('lock', 'done', STEP_DETAILS.lockDone)
			publish = step('publish', 'done', publishDetail(acks))
			admit = step('admit', 'active', STEP_DETAILS.admitActive)
			active = 'admit'
			break
	}

	return { steps: [lock, publish, admit], active, complete: lock.status === 'done' && published && admitted }
}

// =========================================================================
// Props
// =========================================================================

export interface ArenaBidPanelProps {
	/** The auction, as read. `null` when nothing was read — the panel then says so. */
	model: ArenaAuctionDetailModel | null
	/** The read state. A partial read disables bidding: the floor may be stale. */
	readStatus: 'loading' | 'settled' | 'incomplete' | 'no-relays' | 'error'
	/** The check the host ran on the current input, or `null` when no auction was read. */
	check: ArenaBidCheck | null
	/** The check that blocks bidding regardless of the amount, e.g. `own-auction`; `null` when none does. */
	blockedReason: ArenaBidBlockedReason | null
	/** The typed amount, verbatim. */
	amountInput: string
	onAmountChange: (value: string) => void
	/** True while a submission is in flight: the input and the button are both inert. */
	pending: boolean
	/** The most recent submission's state. */
	submission: ArenaBidSubmissionState
	onSubmit: () => void
	className?: string
	ref?: Ref<HTMLDivElement>
}

// =========================================================================
// Helpers
// =========================================================================

/** The button's label — the same progression the retired panel used ("Submitting..." → idle). */
export function bidButtonLabel(blockedReason: ArenaBidBlockedReason | null, check: ArenaBidCheck | null, pending: boolean): string {
	if (pending) return 'Submitting…'
	if (blockedReason !== null) {
		const labels: Partial<Record<ArenaBidBlockedReason, string>> = {
			'own-auction': 'Your auction',
			concluded: 'Auction concluded',
			ended: 'Bidding closed',
			'not-accepted': 'Not accepted by the chain',
			'end-unknown': 'No end time stated',
			'no-wallet': 'Sign in to bid',
			'wallet-unavailable': 'Wallet not ready',
			'not-started': 'Not open yet',
			'auction-not-read': 'Auction not read',
		}
		return labels[blockedReason] ?? 'Place bid'
	}
	if (check === null) return 'Reading terms…'
	return 'Place bid'
}

/** The sentence under the input: the floor, in words. */
export function bidFloorLabel(model: ArenaAuctionDetailModel, check: ArenaBidCheck | null): string {
	if (check === null || check.minimum === null) {
		if (model.startingBid === null) return 'This auction published no starting bid.'
		return 'The minimum for your next bid cannot be computed from what has been read so far.'
	}
	if (check.ownPosition !== null) {
		return `Bids add to your position. Yours is ${check.ownPosition.toLocaleString()} sats; your position must reach at least ${check.minimum.toLocaleString()} sats.`
	}
	if (model.bidCount === 0) return `Opening bid: at least ${check.minimum.toLocaleString()} sats.`
	return `Next bid: at least ${check.minimum.toLocaleString()} sats.`
}

/** The label the submission state renders. Always a fact about relays, never about money. */
export function submissionLine(
	state: ArenaBidSubmissionState,
): { title: string; detail: string; tone: 'neutral' | 'success' | 'warning' | 'error' } | null {
	switch (state.phase) {
		case 'idle':
			return null
		case 'locking':
			return {
				title: `Locking ${state.amount.toLocaleString()} sats in escrow…`,
				detail: 'The app is writing this bid’s escrow lock at the mint. Nothing has been published yet.',
				tone: 'neutral',
			}
		case 'publishing':
			return {
				title: `Publishing ${state.amount.toLocaleString()} sats…`,
				detail:
					'The escrow is locked and the signed bid is being offered to every relay this app writes to. Nothing has been acknowledged yet, and a relay acknowledgment is not the chain taking the bid.',
				tone: 'neutral',
			}
		case 'presumed':
			return {
				title: `Bid on the relays — ${state.acceptedBy.length} of ${state.totalRelays} relays acknowledged it.`,
				detail: `Your signed bid was stored by ${state.acceptedBy.length === 1 ? 'a relay' : 'relays'}, so it is on the network this app writes to. That is storage, not admission: the chain has not yet published an admission fact naming this bid. This view keeps reading until the chain admits it or demonstrably does not.`,
				tone: 'neutral',
			}
		case 'seen':
			return {
				title: `Bid on the relays — ${state.acceptedBy.length} of ${state.totalRelays} relays acknowledged it.`,
				detail:
					'The relays that answered delivered your bid back to this view. That is storage, not admission: the chain decides, and this view has not read an admission fact naming this bid yet. It keeps reading.',
				tone: 'neutral',
			}
		case 'admitted':
			return {
				title: `The chain admitted this bid — your position is ${state.admission.position.toLocaleString()} sats.`,
				detail: `An admission fact (arena.bidadmit.v1) names this bid, anchored at height ${state.admission.height}. This is the chain’s own record that it took the bid, and the position it belongs to. It is not a win: the verdict names the winner when the lot closes, and no money has moved.`,
				tone: 'success',
			}
		case 'refused': {
			const locktimeCopy =
				state.locktime !== null
					? ` Your escrow stays locked until ${new Date(state.locktime * 1000).toISOString()}, after which the lock's own refund path returns the funds to your wallet.`
					: ' The escrow locktime is not known to this view.'
			const reclaimCopy = state.reclaimable
				? ' You can reclaim the locked sats once that locktime has passed.'
				: ' Do not bid the same amount again from this wallet — that would lock a second escrow.'
			return {
				title: 'The chain refused this bid.',
				detail: `The chain recorded its refusal in committed state and gave this reason, in its own words: “${state.reason}”.${locktimeCopy}${reclaimCopy}`,
				tone: 'error',
			}
		}
		case 'not-accepted': {
			// The chain is advancing, this bid is not in committed state, and no
			// admission fact names it: the chain has not admitted this bid. This is
			// emphatically NOT a network problem.
			//
			// SEAM — the refusal reason. The owner has not yet ruled on publishing a
			// refusal fact (`arena.bidrefuse.v1`, the counterpart of the admission
			// fact), so the chain publishes no reason the app can read for a bid it
			// did not admit, and this app states none. Do NOT invent a reason and do
			// NOT implement that publication here. When the ruling lands, the reason
			// is stated in the chain's own words and this copy changes with it.
			const locktimeCopy =
				state.locktime !== null
					? ` Your escrow stays locked until ${new Date(state.locktime * 1000).toISOString()}, after which the lock's own refund path returns the funds to your wallet.`
					: ' The escrow locktime is not known to this view.'
			const reclaimCopy = state.reclaimable
				? ' You can reclaim the locked sats once that locktime has passed.'
				: ' Do not bid the same amount again from this wallet — that would lock a second escrow.'
			return {
				title: 'The chain has not admitted this bid.',
				detail: `The chain is advancing and no admission fact (arena.bidadmit.v1) names this bid, so it has not recorded taking it. This is not a network problem. The chain publishes no reason here, and this app will not invent one — a refusal fact the chain does not publish leaves this app silent on the reason.${locktimeCopy}${reclaimCopy}`,
				tone: 'warning',
			}
		}
		case 'unconfirmed':
			return {
				title: 'Waiting for the chain to admit the bid…',
				detail: `The relays have your bid${state.acceptedBy.length > 0 ? ` (${state.acceptedBy.length} of ${state.totalRelays} acknowledged it)` : ''}. No admission fact (arena.bidadmit.v1) names this bid yet, so this app has nothing from the chain — and no admission fact is not a refusal: nothing here says the bid was refused, and it may still be admitted. This view keeps reading.`,
				tone: 'neutral',
			}
		case 'infrastructure': {
			// The claim is the app's own observation, and it says how long it
			// watched: a missed freshness window in one read is not this, and only
			// a window long enough to demonstrate a stall reaches here
			// (`arenaBidPublish.ts` `ARENA_CHAIN_STALLED_AFTER_SEC`).
			const minutes = Math.max(1, Math.round(state.stalledForSec / 60))
			return {
				title: 'The chain is not advancing.',
				detail: `The relays have your bid, but this app has read the chain’s committed state for ${minutes} minutes without seeing it advance, so it cannot say whether the bid will be admitted. This is an infrastructure problem, not a problem with your bid — nothing here says the bid was refused.`,
				tone: 'warning',
			}
		}
		case 'unpublished':
			return {
				title: 'Your bid was not published — no relay accepted it.',
				detail: `${state.reason} The event was signed by your key but stored nowhere this app writes to, so it is not on the network and is not counted. You can submit again.`,
				tone: 'error',
			}
		case 'failed':
			return {
				title: 'Your bid was not submitted.',
				detail: `${state.reason} Nothing was published.`,
				tone: 'error',
			}
	}
}

// =========================================================================
// The view
// =========================================================================

/**
 * The three-step submission stepper. Its step statuses come only from
 * {@link bidSubmissionStepper} — this component decides no fact, it only shows
 * one. The step in progress carries an animated indicator (`animate-spin`); each
 * step states its own fact, never another step's.
 */
export function BidStepper({ stepper, className }: { stepper: ArenaBidStepper; className?: string }) {
	return (
		<ol
			data-slot="arena-bid-stepper"
			data-active={stepper.active ?? 'none'}
			data-complete={stepper.complete ? 'true' : 'false'}
			className={cn('flex flex-col gap-2', className)}
		>
			{stepper.steps.map((step, index) => (
				<li key={step.key} data-slot="arena-bid-step" data-step={step.key} data-status={step.status} className="flex items-start gap-3">
					<span
						aria-hidden="true"
						className={cn(
							'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
							step.status === 'done' && 'border-success bg-success-muted text-success-muted-foreground',
							step.status === 'active' && 'border-focus text-focus',
							step.status === 'failed' && 'border-error bg-error-muted text-error',
							step.status === 'pending' && 'border-border-default text-text-mid',
						)}
					>
						{step.status === 'active' ? (
							<span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" role="progressbar" aria-label={`${step.label} in progress`} />
						) : step.status === 'done' ? (
							'✓'
						) : (
							index + 1
						)}
					</span>
					<span className="min-w-0">
						<span className="block text-xs font-medium">{step.label}</span>
						<span className="block text-[11px] text-text-mid opacity-90">{step.detail}</span>
					</span>
				</li>
			))}
		</ol>
	)
}

export function ArenaBidPanel({
	model,
	readStatus,
	check,
	blockedReason,
	amountInput,
	onAmountChange,
	pending,
	submission,
	onSubmit,
	className,
	ref,
}: ArenaBidPanelProps) {
	const hardBlocked = blockedReason !== null
	const invalid = check !== null && !check.allowed && !hardBlocked && amountInput.trim() !== ''
	const disabled = hardBlocked || pending || check === null || !check.allowed
	const floor = model !== null ? bidFloorLabel(model, check) : null
	const invalidCopy = check !== null && !check.allowed && !hardBlocked ? bidBlockedCopy(check.reason, check) : null
	const line = submissionLine(submission)
	const stepper = bidSubmissionStepper(submission)

	return (
		<section
			ref={ref}
			data-slot="arena-bid-panel"
			data-state={submission.phase}
			aria-labelledby="arena-bid-panel-title"
			className={cn('space-y-3 rounded-xl border border-border-default bg-surface-raised p-4', className)}
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 id="arena-bid-panel-title" className="text-xs font-semibold uppercase tracking-[0.16em] text-text-mid">
					Place a bid
				</h2>
				{model !== null && model.phase === 'open' && !hardBlocked && <StatusBadge status="Bidding open" tone="success" />}
			</div>

			{hardBlocked && blockedReason !== null && (
				<p data-slot="arena-bid-blocked" className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-text-mid">
					{bidBlockedCopy(blockedReason, check ?? { minimum: null, ownPosition: null })}
				</p>
			)}

			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				{/* Always rendered, even while blocked: the bidder can see the amount
				    they would bid and the floor they would have to meet. A hidden
				    form on an ended auction hides why nothing can be done. */}
				<Label htmlFor="arena-bid-amount" className="sr-only">
					Bid amount in sats
				</Label>
				<div className="relative flex grow items-center">
					<Input
						id="arena-bid-amount"
						data-slot="arena-bid-amount"
						type="text"
						inputMode="numeric"
						autoComplete="off"
						placeholder={check !== null && check.minimum !== null ? `${check.minimum.toLocaleString()}` : 'Amount'}
						value={amountInput}
						onChange={(event) => onAmountChange(event.target.value)}
						disabled={hardBlocked || pending}
						aria-invalid={invalid}
						aria-describedby="arena-bid-floor"
						className="pr-14"
					/>
					<span className="pointer-events-none absolute right-3 text-xs text-text-mid">sats</span>
				</div>
				<Button
					type="button"
					onClick={onSubmit}
					disabled={disabled}
					variant={hardBlocked ? 'secondary' : 'default'}
					className="whitespace-nowrap sm:min-w-36"
				>
					{bidButtonLabel(blockedReason, check, pending)}
				</Button>
			</div>

			<p id="arena-bid-floor" data-slot="arena-bid-floor" className="text-xs text-text-mid">
				{floor ?? (readStatus === 'loading' ? 'Reading the auction’s terms from relays…' : 'No terms to state.')}
			</p>

			{invalidCopy !== null && (
				<p role="alert" data-slot="arena-bid-invalid" className="text-xs text-error">
					{invalidCopy}
				</p>
			)}

			{stepper !== null && <BidStepper stepper={stepper} className="rounded-lg bg-surface-sunken px-3 py-2" />}

			{line !== null && (
				<div
					role="status"
					data-slot="arena-bid-submission"
					data-phase={submission.phase}
					className={cn(
						'rounded-lg px-3 py-2 text-xs',
						line.tone === 'error' && 'bg-error-muted text-error-muted-foreground',
						line.tone === 'success' && 'bg-success-muted text-success-muted-foreground',
						line.tone === 'warning' && 'bg-warning-muted text-warning-muted-foreground',
						line.tone === 'neutral' && 'bg-surface-sunken text-text-mid',
					)}
				>
					<p className="font-medium">{line.title}</p>
					<p className="mt-0.5 opacity-90">{line.detail}</p>
				</div>
			)}

			<p className="text-[11px] text-text-mid opacity-80">{ARENA_BID_ADVISORY}</p>
		</section>
	)
}
