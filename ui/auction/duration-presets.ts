/**
 * Auction duration presets — data, not a component.
 *
 * Extracted from the `auction-editor` monolith (T6.3 slice S1). The slider
 * indexes `DURATION_PRESETS` directly (value 1 maps to index 0), so the array
 * order is part of the contract; `DURATION_PRESETS_SHORTCUT` is the subset of
 * presets offered as one-tap buttons, kept as references so the two cannot
 * drift apart.
 */

/** One selectable auction duration. */
export type AuctionDurationPreset = { label: string; seconds: number }

/** The full preset ladder, in slider order (1 minute … 30 days). */
export const DURATION_PRESETS: AuctionDurationPreset[] = [
	{ label: '1m', seconds: 1 * 60 },
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
	{ label: '4d', seconds: 4 * 86400 },
	{ label: '5d', seconds: 5 * 86400 },
	{ label: '6d', seconds: 6 * 86400 },
	{ label: '7d', seconds: 7 * 86400 },
	{ label: '8d', seconds: 8 * 86400 },
	{ label: '9d', seconds: 9 * 86400 },
	{ label: '10d', seconds: 10 * 86400 },
	{ label: '11d', seconds: 11 * 86400 },
	{ label: '12d', seconds: 12 * 86400 },
	{ label: '13d', seconds: 13 * 86400 },
	{ label: '14d', seconds: 14 * 86400 },
	{ label: '15d', seconds: 15 * 86400 },
	{ label: '20d', seconds: 20 * 86400 },
	{ label: '25d', seconds: 25 * 86400 },
	{ label: '30d', seconds: 30 * 86400 },
]

/** The one-tap shortcuts shown above the duration slider. */
export const DURATION_PRESETS_SHORTCUT: AuctionDurationPreset[] = [
	DURATION_PRESETS[9], // 1 Hour
	DURATION_PRESETS[19], // 12 Hours
	DURATION_PRESETS[25], // 1 Day
	DURATION_PRESETS[31], // 7 Days
	DURATION_PRESETS[38], // 14 Days
	DURATION_PRESETS[42], // 30 Days
]
