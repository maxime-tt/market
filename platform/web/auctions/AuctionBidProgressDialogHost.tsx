/**
 * platform/web/auctions/AuctionBidProgressDialogHost.tsx — host for the bid progress dialog.
 *
 * Moved verbatim out of `src/components/AuctionBidProgressDialog.tsx` (the component retires
 * in this fused commit): this half owns the kind-30440 verdict query through
 * `@platform/web/auctions/auctionsQuery`, the verdict parsing, and the quorum resolution
 * (#1235 Blocking 5 — verdict binding is scoped to the CURRENT session's published bid
 * event), then hands the resolved booleans and the validator avatars to the props-only
 * `@ui/auction/auction-bid-progress-view`. The host holds no `platform -> @/` edge.
 */
import { useMemo } from 'react'
import { useAuctionVerdicts } from '@platform/web/auctions/auctionsQuery'
import { parseValidatorVerdictEvent } from '@sdk/commerce/auctions/schemas/validatorEvents'
import type { ParsedValidatorVerdictEvent } from '@sdk/commerce/auctions/events'
import { computeVerdictQuorum, type VerdictQuorumResult } from '@sdk/commerce/auctions/verdictQuorum'
import type { AuctionBidFundingLifecycleState } from '@platform/web/auctions/useAuctionBidFunding'
import { AvatarHost } from '@platform/web/profiles/userCardHosts'
import { AuctionBidProgressDialogView } from '@ui/auction/auction-bid-progress-view'

export interface AuctionBidProgressDialogHostProps {
	open: boolean
	onClose: () => void
	lifecycleState: AuctionBidFundingLifecycleState
	auctionRootEventId: string
	auctionCoordinates: string
	validatorPubkeys: string[]
	bidEventId?: string
	auditorQuorum?: number
	bidAmount?: number
	refundLocktime?: number
	onRetryPublish?: () => void
	/**
	 * #1235 round-3 fix 3 (felixfelix #6) — true when the CURRENT session's
	 * leg ended in an uncertain lock outcome (a lock request may already
	 * have been sent to the mint; a recovery record with the refund key was
	 * saved). Renders an honest uncertain-lock variant of the publish-failed
	 * state (mirroring the deposit_outcome_uncertain branch): neither
	 * "funding completed" nor a retry affordance is claimed.
	 */
	lockOutcomeUncertain?: boolean
}

/**
 * Quorum result shown while the current funding session has not yet produced a
 * published bid event id (#1235 Blocking 5): no verdicts bound, nothing
 * confirmed, nothing condemned.
 */
export const NO_SESSION_VERDICT_QUORUM: VerdictQuorumResult = {
	representativeVerdict: null,
	confirmCount: 0,
	condemnCount: 0,
	hasPositiveVerdict: false,
	hasNegativeVerdict: false,
	hasNeutralVerdict: false,
}

/**
 * #1235 Blocking 5 — cross-leg verdict leak: verdict binding is scoped to the
 * CURRENT session's published bid event.
 *
 * The dialog must never display a validator verdict bound to an event id
 * other than the bid published in the current session. `bidEventId` is
 * undefined until the current session's publish attempt produced an id (e.g.
 * a rebid's new leg at `ecash_minted` / `bid_publish_attempted`); until then
 * NO verdict may be attributed to the bid at all — `computeVerdictQuorum`
 * without an id falls back to a legacy no-filter mode that would happily
 * count the PREVIOUS leg's confirm verdicts and render "Bid successfully
 * placed!" for a bid that has not been published yet.
 *
 * Exported for unit tests (the dialog itself is portal-rendered, so its output
 * is not directly assertable in the SSR-based unit suite).
 */
export const resolveProgressDialogVerdictQuorum = (
	verdicts: ParsedValidatorVerdictEvent[],
	bidEventId: string | undefined,
	validatorPubkeys: string[],
	auditorQuorum: number | undefined,
): VerdictQuorumResult =>
	bidEventId ? computeVerdictQuorum(verdicts, bidEventId, validatorPubkeys, auditorQuorum) : NO_SESSION_VERDICT_QUORUM

export function AuctionBidProgressDialogHost({
	open,
	onClose,
	lifecycleState,
	auctionRootEventId,
	auctionCoordinates,
	validatorPubkeys,
	bidEventId,
	auditorQuorum,
	bidAmount,
	refundLocktime,
	onRetryPublish,
	lockOutcomeUncertain,
}: AuctionBidProgressDialogHostProps) {
	const verdictsQuery = useAuctionVerdicts(auctionRootEventId, 500, auctionCoordinates, validatorPubkeys)

	const parsedVerdicts = useMemo(
		() =>
			(verdictsQuery.data ?? [])
				.map(parseValidatorVerdictEvent)
				.filter((r): r is { ok: true; value: ParsedValidatorVerdictEvent } => r.ok)
				.map((r) => r.value),
		[verdictsQuery.data],
	)

	const { representativeVerdict, hasPositiveVerdict, hasNegativeVerdict, hasNeutralVerdict } = useMemo(
		() => resolveProgressDialogVerdictQuorum(parsedVerdicts, bidEventId, validatorPubkeys, auditorQuorum),
		[parsedVerdicts, bidEventId, validatorPubkeys, auditorQuorum],
	)

	return (
		<AuctionBidProgressDialogView
			open={open}
			onClose={onClose}
			lifecycleState={lifecycleState}
			hasPositiveVerdict={hasPositiveVerdict}
			hasNegativeVerdict={hasNegativeVerdict}
			hasNeutralVerdict={hasNeutralVerdict}
			representativeVerdictClaim={representativeVerdict?.claim}
			validatorPubkeys={validatorPubkeys}
			renderValidatorAvatar={(pubkey) => <AvatarHost pubkey={pubkey} className="h-5 w-5" />}
			bidAmount={bidAmount}
			refundLocktime={refundLocktime}
			onRetryPublish={onRetryPublish}
			lockOutcomeUncertain={lockOutcomeUncertain}
		/>
	)
}
