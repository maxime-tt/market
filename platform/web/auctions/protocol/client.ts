/**
 * The auctions backend's wire protocol, as a client.
 *
 * Source of truth: `notes/HANDOVER-AUCTIONS-FRONTEND-WIRING.md`. This module is
 * the only place in the app that knows the backend's shapes, and it is pure
 * transport: every side effect (signing, the WebSocket, fetch) arrives through
 * `AuctionsProtocolPorts`, so a test needs neither a chain nor a relay.
 *
 * Four facts drive the design, each of them measured on the running demo:
 *
 * 1. **Only four kinds are transported** — create `28640`, bid `28641`, refund
 *    `28642`, outcome `28645`. An event of any other kind is stored by the
 *    relay, reported `success` to the publisher, and never committed. There is
 *    no error that names the kind, so a typo is silent; the constants here are
 *    the only source of them.
 * 2. **Subscribe before publishing.** The kinds are NIP-01 ephemeral and the
 *    demo relay keeps nothing: an event published while no observer is
 *    listening is gone. `publish` therefore awaits `subscribe` first.
 * 3. **Time is block time.** Deadlines, the anti-snipe extension and the late
 *    window all evaluate against the committee's committed time, so the caller
 *    reads `last_consensus_time` / `end_time` from state rather than a clock.
 * 4. **State is a document, not a feed.** `GET /api/state` answers
 *    `{ app_hash, canonical_state, state, wallet }`; the committed fields live
 *    under `state`, so `view.height` is null while `view.state.height` is right.
 */

/** The only kinds the observer transports. Anything else is stored and ignored. */
export const AUCTION_KINDS = {
	create: 28640,
	bid: 28641,
	refund: 28642,
	outcome: 28645,
} as const

export type AuctionKind = (typeof AUCTION_KINDS)[keyof typeof AUCTION_KINDS]

/** The four fields of a committee-relevant auction, as committed. */
export interface CommittedAuction {
	id: string
	seller: string
	title: string
	description?: string
	funding_mode: string
	start_time?: number
	end_time: number
	original_end_time?: number
	starting_bid: number
	min_increment: number
	/** The locktime a mint lock must carry so it outlives this auction's worst case. */
	required_locktime?: number
	late_bid_window_seconds?: number
	late_bid_extension_seconds?: number
	max_total_extension_seconds?: number
	status?: string
	/** The lot's image, committed from the create content. */
	image_url?: string
}

export interface CommittedBid {
	id: string
	auction_id: string
	bidder: string
	/** A DELTA added to the bidder's existing position, not their new total. */
	amount: number
	cashu_token_sha256?: string
}

export interface AuctionsState {
	height: number
	last_consensus_time: number
	auctions: Record<string, CommittedAuction>
	bids: Record<string, CommittedBid>
	positions?: Record<string, unknown>
}

export interface AuctionsConfig {
	chain_id: string
	committee_public_key: string
	cashu_mint_url?: string
	mint_url?: string
	funding_mode: string
	default_auction_seconds: number
	emergency_recovery_seconds: number
	max_total_extension_seconds: number
	/** `FAKE_MONEY_ONLY` — any UI built on this must say so. */
	profile?: string
}

/** One signed event, in the shape the demo relay and the HTTP endpoint accept. */
export interface SignedEvent {
	id: string
	pubkey: string
	created_at: number
	kind: number
	tags: string[][]
	content: string
	sig: string
}

/** Everything the client needs from the outside world. */
export interface AuctionsProtocolPorts {
	/** `GET /api/state` — the authoritative committed state. */
	getState(): Promise<AuctionsState>
	/** `GET /api/config` — chain id, ceilings, funding mode. */
	getConfig(): Promise<AuctionsConfig>
	/**
	 * Open the relay subscription BEFORE anything is published, and keep it open.
	 * The demo relay is in memory and the kinds are ephemeral: publishing without
	 * a live subscriber loses the event with no error anywhere.
	 */
	subscribe(onEvent: (event: SignedEvent) => void): Promise<void>
	/** Publish one signed event on the relay (preferred) or `POST /api/event`. */
	publish(event: SignedEvent): Promise<void>
	/** `POST /api/demo/<path>` — the coordinator's receipts (reservation, lock, deposit). */
	post(path: string, body: unknown): Promise<unknown>
	/** Sign an unsigned template with the caller's key. */
	sign(template: Omit<SignedEvent, 'id' | 'pubkey' | 'sig'>): Promise<SignedEvent>
}

export interface AuctionsProtocolClient {
	getState(): Promise<AuctionsState>
	getConfig(): Promise<AuctionsConfig>
	/** Create content, per §5 of the handover. All timing fields are optional. */
	createAuction(input: CreateAuctionInput): Promise<SignedEvent>
	/**
	 * The custodial reservation a `custodial_reservation_v1` auction requires.
	 * The receipt is committee-signed and describes this bidder, this auction
	 * and this amount; a bid on such an auction must carry exactly one funding
	 * path, and this is the only one that mode accepts.
	 */
	reserve(input: ReserveInput): Promise<unknown>
	/** A bid is a delta; `amount` is what the bidder ADDS to their position. */
	placeBid(input: PlaceBidInput): Promise<SignedEvent>
	/** Auctions ordered by the committed end time, soonest first. */
	listAuctions(): Promise<CommittedAuction[]>
}

/** Create content (`KindCreate`), per the handover's §5 table. */
export interface CreateAuctionInput {
	auctionId: string
	title: string
	description?: string
	imageUrl?: string
	durationSeconds: number
	startingBid: number
	minIncrement: number
	reserve?: number
	fundingMode?: string
	sellerPayoutPublicKey?: string
	/** Optional per-auction anti-snipe timing; omitted means the network's value. */
	lateBidWindowSeconds?: number
	lateBidExtensionSeconds?: number
	maxTotalExtensionSeconds?: number
	locktimeSeconds?: number
}

/** A custodial reservation request. */
export interface ReserveInput {
	auctionId: string
	bidder: string
	amount: number
	replacesReservationId?: string
}

/** Bid content (`KindBid`). */
export interface PlaceBidInput {
	auctionId: string
	/** The delta added to the bidder's position, NOT the resulting position. */
	amountDelta: number
	/** A custodial reservation, for `custodial_reservation_v1` auctions. */
	reservation?: unknown
	cashuLock?: unknown
	outcomeTemplates?: unknown
	sigallDeposit?: unknown
}

export function createAuctionsProtocolClient(ports: AuctionsProtocolPorts): AuctionsProtocolClient {
	let subscribed = false

	const ensureSubscribed = async (): Promise<void> => {
		if (subscribed) return
		await ports.subscribe(() => {})
		subscribed = true
	}

	const publishKind = async (kind: AuctionKind, content: unknown, tags: string[][] = []): Promise<SignedEvent> => {
		await ensureSubscribed()
		const now = Math.floor(Date.now() / 1000)
		const event = await ports.sign({ kind, created_at: now, tags, content: JSON.stringify(content) })
		await ports.publish(event)
		return event
	}

	return {
		getState: ports.getState,
		getConfig: ports.getConfig,

		async createAuction(input) {
			const content: Record<string, unknown> = {
				auction_id: input.auctionId,
				title: input.title,
				duration_seconds: input.durationSeconds,
				starting_bid: input.startingBid,
				min_increment: input.minIncrement,
			}
			if (input.description !== undefined) content.description = input.description
			if (input.imageUrl !== undefined) content.image_url = input.imageUrl
			if (input.reserve !== undefined) content.reserve = input.reserve
			if (input.fundingMode !== undefined) content.funding_mode = input.fundingMode
			// The seller's WALLET key is only accepted on the mint-backed and
			// threshold modes: it is the destination the settlement locks value
			// to. On `custodial_reservation_v1` the backend refuses the field
			// outright ("used outside a threshold or mint-backed auction"), so
			// sending it there fails the create with a message that does not
			// name the field. Send it only where it is allowed.
			const mintBacked =
				input.fundingMode === 'threshold_sigall_v1' ||
				input.fundingMode === 'cashu_lock_v1' ||
				input.fundingMode === 'cashu_sigall_v1'
			if (mintBacked && input.sellerPayoutPublicKey) {
				content.seller_coco_payment_public_key = input.sellerPayoutPublicKey
			}
			// Each of these is refused at create if it exceeds the network ceiling,
			// and the refusal names the ceiling.
			if (input.lateBidWindowSeconds !== undefined) content.late_bid_window_seconds = input.lateBidWindowSeconds
			if (input.lateBidExtensionSeconds !== undefined) content.late_bid_extension_seconds = input.lateBidExtensionSeconds
			if (input.maxTotalExtensionSeconds !== undefined) content.max_total_extension_seconds = input.maxTotalExtensionSeconds
			if (input.locktimeSeconds !== undefined) content.locktime_seconds = input.locktimeSeconds
			return publishKind(AUCTION_KINDS.create, content)
		},

		async reserve(input) {
			const body: Record<string, unknown> = {
				auction_id: input.auctionId,
				bidder: input.bidder,
				amount: input.amount,
			}
			if (input.replacesReservationId !== undefined) {
				body.replaces_reservation_id = input.replacesReservationId
			}
			return ports.post('/api/demo/reservation', body)
		},

		async placeBid(input) {
			const content: Record<string, unknown> = {
				auction_id: input.auctionId,
				amount: input.amountDelta,
			}
			if (input.reservation !== undefined) content.reservation = input.reservation
			if (input.cashuLock !== undefined) content.cashu_lock = input.cashuLock
			if (input.outcomeTemplates !== undefined) content.outcome_templates = input.outcomeTemplates
			if (input.sigallDeposit !== undefined) content.sigall_deposit = input.sigallDeposit
			return publishKind(AUCTION_KINDS.bid, content)
		},

		async listAuctions() {
			const state = await ports.getState()
			return Object.values(state.auctions).sort((a, b) => a.end_time - b.end_time)
		},
	}
}
