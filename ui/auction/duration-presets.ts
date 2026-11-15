/**
 * Auction duration presets — data, not a component.
 *
 * The slider indexes `DURATION_PRESETS` directly (value 1 maps to index 0), so the array
 * order is part of the contract; `DURATION_PRESETS_SHORTCUT` is the subset of presets
 * offered as one-tap buttons, derived from the ladder so the two cannot drift apart.
 *
 * The ladder stops at **three days** because the kind-1440 create's `durationSec` accepts
 * 20 s … 259200 s (`auctionPublishValidation.ts`). The old ladder ran to 30 days, which the
 * settled protocol refuses; offering it would be a choice the publish path then rejects.
 */
import { AUCTION_MAX_DURATION_SEC, AUCTION_MIN_DURATION_SEC } from '@sdk/commerce/auctions/auctionPublishValidation'

/** One selectable auction duration. */
export type AuctionDurationPreset = { label: string; seconds: number }

const PRESETS: AuctionDurationPreset[] = [
	{ label: '1m', seconds: 60 },
	{ label: '2m', seconds: 2 * 60 },
	{ label: '3m', seconds: 3 * 60 },
	{ label: '4m', seconds: 4 * 60 },
	{ label: '5m', seconds: 5 * 60 },
	{ label: '10m', seconds: 10 * 60 },
	{ label: '15m', seconds: 15 * 60 },
	{ label: '30m', seconds: 30 * 60 },
	{ label: '45m', seconds: 45 * 60 },
	{ label: '1h', seconds: 3600 },
	{ label: '2h', seconds: 2 * 3600 },
	{ label: '3h', seconds: 3 * 3600 },
	{ label: '4h', seconds: 4 * 3600 },
	{ label: '5h', seconds: 5 * 3600 },
	{ label: '6h', seconds: 6 * 3600 },
	{ label: '7h', seconds: 7 * 3600 },
	{ label: '8h', seconds: 8 * 3600 },
	{ label: '9h', seconds: 9 * 3600 },
	{ label: '10h', seconds: 10 * 3600 },
	{ label: '12h', seconds: 12 * 3600 },
	{ label: '14h', seconds: 14 * 3600 },
	{ label: '16h', seconds: 16 * 3600 },
	{ label: '18h', seconds: 18 * 3600 },
	{ label: '20h', seconds: 20 * 3600 },
	{ label: '22h', seconds: 22 * 3600 },
	{ label: '1d', seconds: 86400 },
	{ label: '2d', seconds: 2 * 86400 },
	{ label: '3d', seconds: 3 * 86400 },
]

/** The full preset ladder, in slider order — every entry inside the protocol's range. */
export const DURATION_PRESETS: AuctionDurationPreset[] = PRESETS.filter(
	(preset) => preset.seconds >= AUCTION_MIN_DURATION_SEC && preset.seconds <= AUCTION_MAX_DURATION_SEC,
)

/** The one-tap shortcuts shown above the duration slider. */
export const DURATION_PRESETS_SHORTCUT: AuctionDurationPreset[] = DURATION_PRESETS.filter((preset) =>
	['1h', '12h', '1d', '3d'].includes(preset.label),
)