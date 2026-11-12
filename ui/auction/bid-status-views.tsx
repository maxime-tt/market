import type { BidGroupStatus } from '@sdk/commerce/auctions/bidGroupStatus'
import { Notice } from '../shared/notice'
import { StatusBadge } from '../shared/status-badge'
import type { StatusTone } from '../shared/status-badge'

export interface BidStatusDisplayInput {
	status: BidGroupStatus
	reclaimableCount: number
	waitingForReclaim: boolean
	hasTrackedTokens: boolean
	latestLocktime: number
	/** Host-formatted countdown, e.g. "Reclaim opens in 4m 10s"; used while reclaim has not opened. */
	reclaimCountdownLabel: string
}

export interface BidStatusCopy {
	label: string
	helper: string
	tone: StatusTone
}

const NO_LOCAL_TOKEN = 'This device has no tracked reclaim token for the bid chain.'

const formatMaybeDate = (timestamp: number): string => (timestamp ? new Date(timestamp * 1000).toLocaleString() : 'N/A')

export function getBidStatusCopy(input: BidStatusDisplayInput): BidStatusCopy {
	const waitingOr = (otherwise: string) => (input.waitingForReclaim ? input.reclaimCountdownLabel : otherwise)

	switch (input.status) {
		case 'winning':
			return {
				label: 'Winning bid',
				helper: 'This bid won the auction. Submit your shipping address from the auction page.',
				tone: 'success',
			}
		case 'refund_received':
			return {
				label: 'Refund received',
				helper: 'The seller settlement refund has already been claimed into your wallet.',
				tone: 'success',
			}
		case 'reclaimed':
			return {
				label: 'Reclaimed',
				helper: 'You reclaimed this locked bid chain back into your wallet after locktime.',
				tone: 'info',
			}
		case 'reclaim_available': {
			const count = input.reclaimableCount
			return {
				label: 'Reclaim available',
				helper: `${count} locked bid ${count === 1 ? 'part is' : 'parts are'} past locktime and can be reclaimed now.`,
				tone: 'warning',
			}
		}
		case 'outbid':
			return {
				label: 'Outbid',
				helper: waitingOr(input.hasTrackedTokens ? 'Your bid stays timelocked until reclaim opens after locktime.' : NO_LOCAL_TOKEN),
				tone: 'neutral',
			}
		case 'reserve_not_met':
			return {
				label: 'Reserve not met',
				helper: waitingOr(input.hasTrackedTokens ? 'Reclaim opens automatically after the bid locktime.' : NO_LOCAL_TOKEN),
				tone: 'warning',
			}
		case 'cancelled':
			return {
				label: 'Auction cancelled',
				helper: waitingOr(input.hasTrackedTokens ? 'Reclaim opens automatically after the bid locktime.' : NO_LOCAL_TOKEN),
				tone: 'error',
			}
		case 'locked':
			return {
				label: 'Locked',
				helper: waitingOr(`No settlement refund yet. Manual reclaim opens after ${formatMaybeDate(input.latestLocktime)}.`),
				tone: 'info',
			}
		case 'recorded':
			return {
				label: 'Bid recorded',
				helper: input.hasTrackedTokens
					? 'Waiting for settlement or for locktime reclaim to open.'
					: 'This device is missing the local reclaim token for this bid.',
				tone: 'neutral',
			}
	}
}

export function BidStatusPill({ copy }: { copy: BidStatusCopy }) {
	return <StatusBadge status={copy.label} tone={copy.tone} />
}

export function BidStatusBanner({ copy }: { copy: BidStatusCopy }) {
	return (
		<Notice tone={copy.tone === 'neutral' ? 'info' : copy.tone} title={copy.label}>
			{copy.helper}
		</Notice>
	)
}
