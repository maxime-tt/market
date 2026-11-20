/**
 * `create-stepper.tsx` — the create form's **acceptance** stepper: what happened
 * to a just-published create (kind 1440), step by step.
 *
 * ## Why the form needs this at all
 *
 * A relay ACK is storage, not acceptance. The chain accepts a create by
 * publishing its own **create-admission** fact (`arena.createadmit.v1`, kind
 * 1449), and until that fact is read the app does not follow the lot at all
 * (`arenaAuctionRead.ts` `isFollowedAuction`). So the form cannot navigate on an
 * ACK and call the create listed: it has to say, in order, what is known —
 * the relays took the signed event, then the chain accepted it, or the chain
 * refused it in its own words, or neither has arrived yet. That last state is
 * *still reading*, never "accepted" and never "refused"
 * (`notes/DECISION-2026-11-18-refused-bids-are-not-committed.md` is the same
 * rule for bids).
 *
 * ## The shape it mirrors
 *
 * `ArenaBidSubmissionState` / `bidSubmissionStepper`
 * (`ui/auction/arena/bid-panel.tsx`) plus its pure transition helper
 * `nextPublishedBidState` (`platform/web/auctions/relay/arenaBidPublish.ts`):
 * a discriminated union of states, a derivation that maps one state to the
 * steps to render, and a presenter that only shows what the derivation
 * concluded. The transition helper lives on the platform side, next to the
 * publish path (`relay/arenaAuctionCreate.ts` `nextCreateAcceptanceState`),
 * for the same reason the bid's does.
 *
 * ## Each step rests on its own fact
 *
 * - **publish** — at least one relay ACKed the signed event (nothing before
 *   that lights it);
 * - **accept** — the chain's `arena.createadmit.v1` fact names this lot's
 *   coordinate. An ACK, a timeout and a read that has not settled never reach
 *   it. A kind-1450 refusal **fails** it, with the chain's reason verbatim.
 *
 * Props-only: no relay, no signer, no promise (`ui/AGENTS.md`).
 */

import { createRefusalLabel } from './model'

// =========================================================================
// State
// =========================================================================

/** What the publish path reported, and every later state carries through. */
export interface ArenaCreatePublishedFacts {
	/** The signed create's event id. */
	eventId: string
	/** `1440:<seller>:<d>` — the coordinate the chain accepts. */
	coordinate: string
	/** The relays that ACKed the signed event. Storage, not acceptance. */
	acceptedBy: string[]
	/** How many relays were offered the event. */
	totalRelays: number
}

/**
 * One create submission, from the relay ACKs to the chain's word.
 *
 * `published` is **still reading** (≥1 relay has the event and the chain has
 * said nothing yet); `accepted` and `refused` are the chain's own facts. There
 * is no earlier phase on purpose: the app's own publish work is the form's
 * pending button, and a publish that reached no relay has nothing to step
 * through — the form reports that failure where the seller can fix it and retry.
 */
export type ArenaCreateAcceptanceState =
	/**
	 * ≥1 relay ACKed the signed event and **the read has not yet delivered the
	 * chain's word** — neither a create-admission nor a refusal. This is a waiting
	 * state: the step says "still reading", and it never reads as accepted.
	 */
	| ({ phase: 'published' } & ArenaCreatePublishedFacts)
	/** The chain's `arena.createadmit.v1` fact names this lot's coordinate. */
	| ({ phase: 'accepted'; acceptedHeight: number } & ArenaCreatePublishedFacts)
	/** The chain published a kind-1450 refusal of this create. `reason` is verbatim. */
	| ({ phase: 'refused'; reason: string } & ArenaCreatePublishedFacts)

// =========================================================================
// The stepper
// =========================================================================

/** The two steps, in the order they happen. */
export const ARENA_CREATE_STEP_KEYS = ['publish', 'accept'] as const

export type ArenaCreateStepKey = (typeof ARENA_CREATE_STEP_KEYS)[number]

/** A step's status: done (its own fact holds), active (in progress), pending, or failed. */
export type ArenaCreateStepStatus = 'done' | 'active' | 'pending' | 'failed'

export interface ArenaCreateStep {
	key: ArenaCreateStepKey
	/** The word the step is named by. */
	label: string
	status: ArenaCreateStepStatus
	/** The one sentence this step states about itself, from its own fact only. */
	detail: string
}

export interface ArenaCreateStepper {
	steps: ArenaCreateStep[]
	/** The step in progress (the one to animate), or `null` when none is. */
	active: ArenaCreateStepKey | null
	/** True only when both steps are done — the one state in which the chain has accepted. */
	complete: boolean
}

const STEP_LABELS: Record<ArenaCreateStepKey, string> = {
	publish: 'Relay publish',
	accept: 'Chain acceptance',
}

const ACCEPT_ACTIVE_DETAIL =
	'Waiting for the chain’s create-admission fact (arena.createadmit.v1) naming this listing. A relay ACK is not acceptance.'

/**
 * The stepper for one submission. Every status comes from the state's own fact
 * for that step: an ACK lights `publish` and nothing else, and `accept` is
 * `done` **only** in `accepted` — the one phase a `arena.createadmit.v1` fact
 * produced. `refused` fails `accept` (the chain said no, in its words), and
 * `published` leaves it `active`, which is *still reading*.
 */
export function createAcceptanceStepper(state: ArenaCreateAcceptanceState): ArenaCreateStepper {
	const step = (key: ArenaCreateStepKey, status: ArenaCreateStepStatus, detail: string): ArenaCreateStep => ({
		key,
		label: STEP_LABELS[key],
		status,
		detail,
	})

	switch (state.phase) {
		case 'published':
			return {
				steps: [
					step('publish', 'done', publishDetail(state)),
					step('accept', 'active', ACCEPT_ACTIVE_DETAIL),
				],
				active: 'accept',
				complete: false,
			}
		case 'accepted':
			return {
				steps: [
					step('publish', 'done', publishDetail(state)),
					step(
						'accept',
						'done',
						`The chain accepted this listing at height ${state.acceptedHeight.toLocaleString()}.`,
					),
				],
				active: null,
				complete: true,
			}
		case 'refused':
			return {
				steps: [
					step('publish', 'done', publishDetail(state)),
					step('accept', 'failed', createRefusalLabel(state.reason)),
				],
				active: null,
				complete: false,
			}
	}
}

/** The publish step's sentence, from the ACK count it actually carries. */
function publishDetail(state: ArenaCreatePublishedFacts): string {
	return `A relay acknowledged the signed create (${state.acceptedBy.length} of ${state.totalRelays}). That is storage, not acceptance.`
}

// =========================================================================
// The presenter
// =========================================================================

/**
 * The steps, as the form shows them. It decides no fact — it renders what
 * {@link createAcceptanceStepper} concluded, and states the active and complete
 * steps in data attributes so a test (and a stylesheet) can tell them apart.
 */
export function CreateAcceptanceStepper({ stepper }: { stepper: ArenaCreateStepper }) {
	return (
		<ol
			className="flex flex-col gap-3"
			data-slot="arena-create-stepper"
			data-active={stepper.active ?? 'none'}
			data-complete={stepper.complete ? 'true' : 'false'}
		>
			{stepper.steps.map((step, index) => (
				<li key={step.key} className="flex items-start gap-3" data-slot="arena-create-step" data-step={step.key} data-status={step.status}>
					<span
						aria-hidden="true"
						className={
							'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ' +
							(step.status === 'done'
								? 'bg-emerald-500/15 text-emerald-500'
								: step.status === 'failed'
									? 'bg-red-500/15 text-red-500'
									: step.status === 'active'
										? 'bg-amber-500/15 text-amber-500'
										: 'bg-surface-raised text-text-mid')
						}
					>
						{step.status === 'done' ? '✓' : step.status === 'failed' ? '✕' : index + 1}
					</span>
					<span className="flex min-w-0 flex-col">
						<b className="text-sm text-text-high">{step.label}</b>
						<small className="text-xs text-text-mid">{step.detail}</small>
					</span>
				</li>
			))}
		</ol>
	)
}
