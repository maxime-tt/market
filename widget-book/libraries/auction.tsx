import { AuctionActivityRow } from '@ui/auction/auction-overview-views'
import {
	AuctionDetailCard,
	AuctionPartyCard,
	AuctionSettlementBadge,
	AuctionStatusBadge,
	AuctionTechnicalRow,
} from '@ui/auction/auction-detail-views'
import type { WidgetLibrary } from '../libraries'

/**
 * Auction detail presentations. Every entry is a literal-prop render so the
 * gallery and the Playwright spec show a deterministic state.
 *
 * The components are presentation-only: the host resolves status, settlement
 * state, pubkeys and copy values and passes them in, so the library needs no
 * query plumbing. `AuctionPartyCard` receives its identity cluster as a node
 * because resolving a pubkey to an avatar and display name is host work.
 */

/** Stand-in for the host's `<AvatarUser>` + `<ProfileName>` cluster. */
function SamplePartyIdentity() {
	return (
		<span className="flex items-center gap-2">
			<span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
				S
			</span>
			<span className="text-sm font-medium text-foreground">satoshi</span>
		</span>
	)
}

export const auction: WidgetLibrary = {
	name: 'auction',
	entries: [
		{
			name: 'AuctionStatusBadge',
			render: () => (
				<div className="flex flex-wrap gap-2">
					<AuctionStatusBadge status="Live" />
					<AuctionStatusBadge status="Scheduled" />
					<AuctionStatusBadge status="Ended" />
				</div>
			),
		},
		{
			name: 'AuctionSettlementBadge',
			render: () => (
				<div className="flex flex-wrap gap-2">
					<AuctionSettlementBadge state="awaiting" />
					<AuctionSettlementBadge state="ready" />
					<AuctionSettlementBadge state="settled" />
					<AuctionSettlementBadge state="reserve_not_met" />
					<AuctionSettlementBadge state="cancelled" />
				</div>
			),
		},
		{
			name: 'AuctionDetailCard',
			render: () => (
				<div className="grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
					<AuctionDetailCard label="Auction type" value="English" helper="Primary format shown to buyers." />
					<AuctionDetailCard label="Currency" value="sats" helper="Display currency for bidding." />
					<AuctionDetailCard label="Schedule" value="Oct 20, 2026 to Oct 22, 2026" />
				</div>
			),
		},
		{
			name: 'AuctionPartyCard',
			render: () => (
				<div className="grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
					<AuctionPartyCard label="Seller" helper="You" identity={<SamplePartyIdentity />} />
					<AuctionPartyCard label="Winner" identity={<SamplePartyIdentity />} />
				</div>
			),
		},
		{
			name: 'AuctionActivityRow',
			render: () => (
				<div className="max-w-xs space-y-3 rounded-xl border p-5">
					<AuctionActivityRow header="Bids" unit="Bid" count={3} newCount={1} />
					<AuctionActivityRow header="Comments" unit="Comment" count={1} newCount={0} />
					<AuctionActivityRow header="Live Chat" unit="Message" count={0} newCount={0} />
				</div>
			),
		},
		{
			name: 'AuctionTechnicalRow',
			render: () => (
				<div className="max-w-md space-y-3">
					<AuctionTechnicalRow
						label="Bidder pubkey"
						value="d943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782"
						copyValue="d943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782"
					/>
					<AuctionTechnicalRow label="Schema" value="N/A" />
					<AuctionTechnicalRow label="Trusted mints" value={'mint.one\nmint.two'} stacked />
				</div>
			),
		},
	],
}
