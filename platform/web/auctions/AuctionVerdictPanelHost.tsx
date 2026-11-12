/**
 * platform/web/auctions/AuctionVerdictPanelHost.tsx — host for the auction verdict panel.
 *
 * Legacy source: `src/components/AuctionVerdictPanel.tsx` (deleted in this fused slice, D4 S4b).
 * It reads kind-30440 verdicts through `@platform/web/auctions/auctionsQuery`, parses them with
 * the `@sdk/commerce/auctions` schema, resolves each avatar through `AvatarHost`, and hands the
 * parsed list to the props-only `@ui/auction/auction-verdict-view` — so the host holds NO
 * `platform -> @/` edge and the view holds no query plumbing.
 */
import { useMemo } from 'react'
import { type ParsedValidatorVerdictEvent } from '@sdk/commerce/auctions/events'
import { parseValidatorVerdictEvent } from '@sdk/commerce/auctions/schemas/validatorEvents'
import { useAuctionVerdicts } from '@platform/web/auctions/auctionsQuery'
import { AvatarHost } from '@platform/web/profiles/userCardHosts'
import { AuctionVerdictView } from '@ui/auction/auction-verdict-view'

interface Props {
	auctionRootEventId: string
	auctionCoordinate: string
	/**
	 * The auction event's `auditors` tags (getAuctionAuditors). When
	 * provided it is sent as the relay `authors` filter for verdict events
	 * (review #1235, Should-fix 3 trust boundary). Optional for backwards
	 * compatibility; the signature check inside fetchAuctionVerdicts is
	 * live regardless.
	 */
	validatorPubkeys?: string[]
}

export function AuctionVerdictPanelHost({ auctionRootEventId, auctionCoordinate, validatorPubkeys }: Props) {
	const verdictsQuery = useAuctionVerdicts(auctionRootEventId, 500, auctionCoordinate, validatorPubkeys)
	const rawVerdicts = verdictsQuery.data ?? []

	const verdicts = useMemo<ParsedValidatorVerdictEvent[]>(() => {
		const out: ParsedValidatorVerdictEvent[] = []
		for (const event of rawVerdicts) {
			const parsed = parseValidatorVerdictEvent(event)
			if (parsed.ok) out.push(parsed.value)
		}
		// Newest first, by validator's own observed_at (the authoritative
		// validator timestamp) falling back to the event created_at.
		return out.sort((a, b) => (b.observedAt || b.createdAt) - (a.observedAt || a.createdAt))
	}, [rawVerdicts])

	return (
		<AuctionVerdictView
			verdicts={verdicts}
			isLoading={verdictsQuery.isLoading}
			renderAvatar={(pubkey) => <AvatarHost pubkey={pubkey} className="h-6 w-6" />}
		/>
	)
}
