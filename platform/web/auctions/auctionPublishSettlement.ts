/**
 * platform/web/auctions/auctionPublishSettlement.ts — the seller's kind-1024 settlement submit path.
 *
 * The seller derives the canonical winner from validator-quorum + mint evidence rather than trusting the
 * caller, walks the winner's rebid chain, verifies every kind-1025 path release against the bid's
 * committed child key, binds each release token's secrets and proof-Ys to the bid's committed multisets
 * (M7), pre-checks every leg's NUT-7 proof state so a retry resumes instead of aborting (M6), and only
 * then redeems and publishes the terminal kind-1024.
 *
 * Carried verbatim out of `src/publish/auctions.tsx`: the reserve_not_met guard (ADR-0011 R3 override
 * included), the DLEQ evidence requirement, the fraud gates and their exact error text are all
 * load-bearing. Do not reorder or relax a check.
 */
import { isStructurallyValidSettledSettlement } from '@sdk/commerce/auctions/events'
import { evaluateReserveNotMetGuard, resolveReserveNotMetPublish } from '@sdk/commerce/auctions/reserveGuard'
import { preflightAuctionSettlementP2pkChain } from '@sdk/commerce/auctions/auctionSettlementP2pk'
import { hashToCurveHexFromString } from '@sdk/commerce/payments/cashu/hashToCurve'
import { fetchDleqKeysetsForBidsDetailed } from '@sdk/commerce/payments/cashu/dleq'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '@sdk/commerce/auctions/auctionP2pk'
import type { Nut7ProofState } from '@sdk/commerce/auctions/constants'
import { getBidAmount } from '@platform/web/auctions/auctionsQuery'
import { toRawEvent, type NostrEventLike } from '@sdk/core/nostr/eventLike'
import { getUser, signNostrEvent } from '@platform/web/ndkPublishContext'
import { walletOps } from '@platform/web/wallet/walletOps'
import { runAuctionSettlementAppAdapter } from '@platform/web/auctions/auctionWorkflowAdapters'
import { getDecodedToken, type MintKeyset } from '@cashu/cashu-ts'
import { auctionKeys } from '@sdk/core/query/queryKeyFactory'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { toast } from 'sonner'
import { publishRequired, tagBidError } from './auctionPublishIo'
import { getFirstTagValue } from './auctionPublishBid'

export interface AuctionSettlementFormData {
	auctionEventId: string
	auctionCoordinates?: string
	/**
	 * Optional expected outcome. When omitted the backend computes it from the
	 * bids + reserve and the client publishes whatever it resolves to. Provide
	 * this only if the caller wants a safety assertion that their expectation
	 * matches reality — mismatch causes the backend to reject.
	 */
	status?: 'settled' | 'reserve_not_met'
	winningBidEventId?: string
	reason?: string
	/**
	 * ADR-0011 review R3 — seller escape hatch. When `reserve_not_met` is
	 * blocked ONLY because a reserve-meeting bid's DLEQ keyset evidence is
	 * unavailable (a transient mint outage, or a crafted bid naming a keyset the
	 * mint does not advertise), the seller may set this to publish the terminal
	 * state anyway. The unavailability is recorded in the settlement's `reason`
	 * tag so the override is auditable on the relay. It never overrides the
	 * `blocked` case (a validated reserve-meeting winner already exists).
	 */
	dleqEvidenceOverride?: boolean
}

// ============================================================================
// Phase 6 — Seller kind-1024 settlement (AUCTIONS.md §4.3.2 / §8.1)
// ============================================================================
//
// Flow (happy path):
//   1. Fetch the auction event (need p2pk_xpub, max_end_at, settlement_grace,
//      coordinate, root event id).
//   2. Fetch the bids on the auction; pick the winning bid (highest amount
//      in the valid window).
//   3. Fetch the kind-1025 path release for that winning bid. Refuse to
//      settle without one.
//   4. Verify derive(p2pk_xpub, release.derivation_path) === bid.child_pubkey;
//      mismatch means the bid was fraudulent (lock pubkey not actually a
//      child of the seller's xpub) — caller falls back to the next bid.
//   5. Derive seller_child_privkey via the wallet's HD account.
//   6. Decode the cashu_token from the path release; redeem at the mint
//      (NIP-60 wallet's receiveLockedEcash handles the swap into the
//      seller's wallet state).
//   7. Publish the kind-1024 settlement event with payout + path_release
//      refs.
//
// Non-happy paths the form can also drive (status override):
//   - 'reserve_not_met' — no redemption; just publish a kind-1024 noting
//     status and let losers self-refund at locktime.
//
// Fallback chains, cancellations, multi-validator quorum — all out of
// scope for the MVP. The UI's only settle button this milestone is "I
// won, here's the path / I have a path, redeem".

export const publishAuctionSettlement = async (formData: AuctionSettlementFormData): Promise<string> => {
	if (!formData.auctionEventId) throw new Error('Auction event id is required')

	// Lazy imports to avoid pulling settlement-only deps into the bid
	// path's bundle.
	const [
		{ fetchAuction, fetchAuctionBids, fetchAuctionPathReleases, fetchAuctionSettlements, fetchAuctionVerdicts, getBidAmount },
		auctionSettlementMod,
		settlementEventsMod,
		constantsMod,
		auctionEventMod,
		bidEventMod,
		validatorEventsMod,
		bidValidationMod,
		nut7Mod,
	] = await Promise.all([
		import('@platform/web/auctions/auctionsQuery'),
		import('@sdk/commerce/auctions/settlement'),
		import('@platform/web/auctions/auctionsQuery'),
		import('@sdk/commerce/auctions/constants'),
		import('@sdk/commerce/auctions/schemas/auctionEvent'),
		import('@sdk/commerce/auctions/schemas/bidEvent'),
		import('@sdk/commerce/auctions/schemas/validatorEvents'),
		import('@sdk/commerce/auctions/bidValidation'),
		import('@sdk/commerce/payments/cashu/nut7'),
	])
	const { getAuctionTagValue: getTag } = auctionSettlementMod
	const { parsePathReleaseEvent, parseSettlementEvent } = settlementEventsMod
	const { AUCTION_SETTLEMENT_POLICY: policyV1 } = constantsMod
	const { parseAuctionEvent } = auctionEventMod
	const { parseBidEvent } = bidEventMod
	const { parseValidatorVerdictEvent } = validatorEventsMod
	const { computeValidatedBids, validateBidChainNut7PrePublish } = bidValidationMod
	const { checkProofStateBatch, aggregateBidNut7State } = nut7Mod

	// 1. Auction event.
	const auctionEvent = await fetchAuction(formData.auctionEventId, true)
	if (!auctionEvent) throw new Error(`Auction ${formData.auctionEventId} not found on relay`)
	const sellerPubkey = auctionEvent.pubkey
	const activeUser = await getUser()
	if (activeUser?.pubkey !== sellerPubkey) {
		throw new Error('Only the auction seller can publish a kind-1024 settlement event')
	}
	const auctionDTag = getTag(auctionEvent, 'd')?.trim()
	const auctionCoordinate = formData.auctionCoordinates?.trim() || (auctionDTag ? `${30408}:${sellerPubkey}:${auctionDTag}` : '')
	if (!auctionCoordinate) {
		throw new Error('Auction coordinate is required to query kind-1025 path releases')
	}
	const auctionRootEventId = getTag(auctionEvent, 'auction_root_event_id') ?? auctionEvent.id
	const p2pkXpub = getTag(auctionEvent, 'p2pk_xpub') ?? ''
	const declaredPolicy = getTag(auctionEvent, 'settlement_policy')
	if (declaredPolicy && declaredPolicy !== policyV1) {
		throw new Error(`Auction settlement_policy is ${declaredPolicy}; this client only handles ${policyV1}`)
	}

	// 1b. Parse the auction event for structured access to maxEndAt, reserve, etc.
	const parsedAuctionResult = parseAuctionEvent(toRawEvent(auctionEvent))
	if (!parsedAuctionResult.ok) {
		throw new Error(`Auction event is malformed: ${'error' in parsedAuctionResult ? parsedAuctionResult.error.message : 'unknown'}`)
	}
	const parsedAuction = parsedAuctionResult.value

	// 1c. Verify the auction has ended. Settlement before max_end_at is invalid.
	const now = Math.floor(Date.now() / 1000)
	if (now < parsedAuction.maxEndAt) {
		throw new Error(`Auction has not ended yet (max_end_at=${parsedAuction.maxEndAt}, now=${now}). Cannot settle before auction close.`)
	}

	const closeAt = now

	// Winner derivation must be based on mint-reported proof states, never on
	// defaulted or fabricated ones: an unconfirmed NUT-7 state stays unconfirmed
	// (`bid_pending_review`), and only the mint's response converts it.
	// Query each allowlisted mint for every parsed bid's proof_y set and
	// aggregate per bid (any spent → spent, all unspent → unspent, else
	// pending). Bids on non-allowlisted mints are never polled: they cannot
	// win (validateBid rejects them via the mint-allowlist check), and polling
	// attacker-supplied mint URLs from raw bids would turn the client into a
	// beacon. Unreachable mints leave their bids 'unknown' → pending.
	type ParsedBidEventT = import('@sdk/commerce/auctions/events').ParsedBidEvent
	type Nut7ProofStateT = import('@sdk/commerce/auctions/constants').Nut7ProofState
	const fetchNut7StatesForBids = async (bidList: ParsedBidEventT[]): Promise<Map<string, Nut7ProofStateT>> => {
		const states = new Map<string, Nut7ProofStateT>()
		const byMint = new Map<string, ParsedBidEventT[]>()
		for (const b of bidList) {
			if (!parsedAuction.mints.includes(b.mint)) continue
			const arr = byMint.get(b.mint) ?? []
			arr.push(b)
			byMint.set(b.mint, arr)
		}
		for (const [mint, mintBids] of byMint) {
			const perProof = await checkProofStateBatch(
				mint,
				mintBids.flatMap((b: ParsedBidEventT) => b.proofYs),
			)
			for (const b of mintBids) {
				states.set(b.id, aggregateBidNut7State(perProof, b.proofYs) ?? 'unknown')
			}
		}
		return states
	}

	// 2. Resolve `reserve_not_met` shortcut. Redemption work happens only on
	// the settled path — losers self-refund at locktime via their refund
	// branch. Mint I/O here is limited to NUT-7 evidence for the reserve
	// decision above.
	if (formData.status === 'reserve_not_met') {
		// B3: Before publishing reserve_not_met, verify no reserve-meeting
		// canonical winner exists. A seller who has already redeemed a
		// winning bid must not be able to displace it with reserve_not_met.
		const [rnmBids, rnmVerdicts] = await Promise.all([
			fetchAuctionBids(formData.auctionEventId, null, auctionCoordinate, true),
			fetchAuctionVerdicts(formData.auctionEventId, null, auctionCoordinate, undefined, undefined, true),
		])
		const rnmParsedBids = rnmBids
			.map((b) => parseBidEvent(toRawEvent(b)))
			.filter((r): r is { ok: true; value: import('@sdk/commerce/auctions/events').ParsedBidEvent } => r.ok)
			.map((r) => r.value)
		const rnmParsedVerdicts = rnmVerdicts
			.map((v) => parseValidatorVerdictEvent(toRawEvent(v)))
			.filter((r): r is { ok: true; value: import('@sdk/commerce/auctions/events').ParsedValidatorVerdictEvent } => r.ok)
			.map((r) => r.value)

		const rnmNut7States = await fetchNut7StatesForBids(rnmParsedBids)
		// ADR-0011: DLEQ is unconditional, so the reserve_not_met path always
		// gathers keyset evidence — otherwise every bid stays pending.
		const rnmAcq = await fetchDleqKeysetsForBidsDetailed(rnmParsedBids, parsedAuction.mints)
		const rnmValidated = computeValidatedBids({
			auction: parsedAuction,
			bids: rnmParsedBids,
			verdicts: rnmParsedVerdicts,
			nut7States: rnmNut7States,
			postSettlement: false,
			dleqKeysets: rnmAcq.keysets,
			dleqUnknownKeysets: rnmAcq.unknownKeysets,
		})

		// ADR-0011 review A2 (PR #1280 discussion_r3999446834): the guard must
		// consider bids whose DLEQ evidence is UNRESOLVED, not only the canonical
		// winner. A quorum-confirmed, structurally valid reserve-meeting bid is
		// demoted to `pending` when its mint keyset fetch fails, so it does NOT
		// appear in `canonicalWinner`; a winner-only check therefore reads the
		// auction as reserve-unmet and lets the seller publish a terminal state
		// that contradicts a bid which may still become valid. Evidence
		// unavailability is a RETRY signal, never a licence to publish.
		const rnmGuard = evaluateReserveNotMetGuard(rnmValidated, parsedAuction.reserve)
		// ADR-0011 review R3: a permanently-`pending` reserve-meeting bid (mint
		// outage, or a crafted bid naming an unadvertised keyset) must not hold
		// the seller hostage forever. The seller can opt into publishing the
		// terminal state; the reason is recorded on the event so the override is
		// auditable. This never bypasses the `blocked` case (a validated
		// reserve-meeting winner), only `evidence-unavailable`. The decision is a
		// pure helper (`resolveReserveNotMetPublish`) so it is unit-tested.
		const rnmDecision = resolveReserveNotMetPublish(rnmGuard, formData.dleqEvidenceOverride === true)
		if (rnmDecision.action === 'throw') throw new Error(rnmDecision.message)
		const rnmOverrideReason = rnmDecision.overrideReason

		// Terminal-event consistency: refuse reserve_not_met when a
		// structurally-valid `settled` settlement already exists for this
		// auction — the seller cannot displace a completed settlement with a
		// later terminal event. (Structural check only: seller + auction
		// refs; deeper completeness validation happens on the read path.)
		const existingSettlements = await fetchAuctionSettlements(formData.auctionEventId, null, auctionCoordinate, undefined, true)
		const hasSettledSettlement = existingSettlements.some((s) => {
			const parsed = parseSettlementEvent(toRawEvent(s))
			if (!parsed.ok) return false
			return isStructurallyValidSettledSettlement(parsed.value, parsedAuction)
		})
		if (hasSettledSettlement) {
			throw new Error('Cannot publish reserve_not_met: a settled settlement already exists for this auction.')
		}

		const outcome = await runAuctionSettlementAppAdapter({
			plan: {
				status: 'reserve_not_met',
				auction: parsedAuction,
				closeAt,
				createdAt: Math.floor(Date.now() / 1000),
				reason: formData.reason ?? rnmOverrideReason ?? 'reserve_not_met',
			},
			ports: {
				preflightAll: async () => {},
				inspectLeg: async () => 'unknown',
				redeemLeg: async () => {},
				assertReserveNotMet: async () => {},
				publish: async (template) => {
					const event = await signNostrEvent(template)
					await publishRequired(event)
					return { eventId: event.id }
				},
			},
		})
		if (outcome.status === 'published') return outcome.eventId
		throw new Error(`Reserve-not-met settlement ${outcome.status}: ${outcome.error}`)
	}

	// 3. Bids → winning bid. Fetch bids + verdicts, parse, and call
	// computeValidatedBids to get the canonical winner. The publisher
	// does not trust the caller's assertion of who won — it derives the
	// winner independently from validator quorum evidence.
	const [bids, verdictEvents] = await Promise.all([
		fetchAuctionBids(formData.auctionEventId, null, auctionCoordinate, true),
		fetchAuctionVerdicts(formData.auctionEventId, null, auctionCoordinate, undefined, undefined, true),
	])
	if (!bids.length) {
		throw new Error('No bids on this auction — nothing to settle. Use reserve_not_met to close it.')
	}

	const parsedBids = bids
		.map((b) => parseBidEvent(toRawEvent(b)))
		.filter((r): r is { ok: true; value: import('@sdk/commerce/auctions/events').ParsedBidEvent } => r.ok)
		.map((r) => r.value)
	const parsedVerdicts = verdictEvents
		.map((v) => parseValidatorVerdictEvent(toRawEvent(v)))
		.filter((r): r is { ok: true; value: import('@sdk/commerce/auctions/events').ParsedValidatorVerdictEvent } => r.ok)
		.map((r) => r.value)

	const nut7States = await fetchNut7StatesForBids(parsedBids)
	// ADR-0011: the settlement path always gathers the DLEQ keysets — without
	// the evidence, `computeValidatedBids` treats every bid as pending and the
	// seller cannot settle (fail-safe, not fail-open).
	const settlementAcq = await fetchDleqKeysetsForBidsDetailed(parsedBids, parsedAuction.mints)
	const validatedBids = computeValidatedBids({
		auction: parsedAuction,
		bids: parsedBids,
		verdicts: parsedVerdicts,
		nut7States,
		postSettlement: false,
		dleqKeysets: settlementAcq.keysets,
		dleqUnknownKeysets: settlementAcq.unknownKeysets,
	})

	if (!validatedBids.canonicalWinner) {
		if (validatedBids.validBids.length === 0 && parsedAuction.reserve > 0) {
			throw new Error('No validated winner. If the reserve was not met, use status=reserve_not_met to close the auction.')
		}
		throw new Error('No validated winner — all bids are pending or invalid. Cannot settle.')
	}

	// Cross-check: if the caller specified a winningBidEventId, verify it
	// matches the canonical winner derived from validator quorum.
	if (formData.winningBidEventId && formData.winningBidEventId !== validatedBids.canonicalWinner.id) {
		throw new Error(
			`Winning bid mismatch: caller expected ${formData.winningBidEventId}, ` +
				`but validator quorum identifies ${validatedBids.canonicalWinner.id} as the canonical winner.`,
		)
	}

	// Verify reserve price is met.
	if (parsedAuction.reserve > 0 && validatedBids.canonicalWinner.amount < parsedAuction.reserve) {
		throw new Error(
			`Winning bid (${validatedBids.canonicalWinner.amount} sats) is below reserve (${parsedAuction.reserve} sats). Use status=reserve_not_met to close the auction.`,
		)
	}

	// Map canonical winner back to its raw event for chain walking.
	const winningBid = bids.find((b) => b.id === validatedBids.canonicalWinner!.id)!
	const winningBidId = winningBid.id
	const winnerPubkey = winningBid.pubkey
	const winningAmount = validatedBids.canonicalWinner.amount
	const childPubkeyFromBid = (getTag(winningBid, 'child_pubkey') ?? '').toLowerCase()
	const mintUrl = getTag(winningBid, 'mint') ?? ''
	if (!mintUrl) throw new Error('Winning bid is missing its `mint` tag — cannot redeem')

	// 4. Walk the rebid chain. The winning bid may be a rebid; if so it
	// has a `prev_bid` tag pointing at the previous leg, which in turn
	// may chain back further. Each leg is locked at its OWN
	// derivation_path with its OWN delta amount. To redeem the full
	// cumulative bid the seller must redeem every leg in the chain.
	//
	// AUCTIONS.md §8.1 line 1014: "derive every child privkey in the
	// winner's chain, swap each leg at the mint".
	const bidsById = new Map(bids.map((b) => [b.id, b]))
	const chainBids: NostrEventLike[] = []
	const seenIds = new Set<string>()
	let cursor: string | undefined = winningBidId
	while (cursor) {
		if (seenIds.has(cursor)) throw new Error(`prev_bid cycle detected at ${cursor.slice(0, 8)}…`)
		seenIds.add(cursor)
		const leg = bidsById.get(cursor)
		if (!leg) throw new Error(`Chain leg ${cursor.slice(0, 8)}… not found in fetched bids; relay set incomplete?`)
		chainBids.unshift(leg) // oldest → newest
		cursor = getTag(leg, 'prev_bid') || undefined
	}
	if (chainBids.length === 0) throw new Error('Empty chain — should be impossible')

	// 4b. Pre-publish NUT-7 gate: before committing to an irreversible
	// settlement, verify every leg in the winning bid chain has confirmed
	// unspent proofs. A `spent` state = pre-settlement double-spend fraud.
	// Missing/unknown = the mint hasn't confirmed — the seller should retry.
	// This gate is stricter than the read/display path (computeValidatedBids
	// with skipNut7Check) because publishing a settlement is irreversible.
	const parsedChainBids = chainBids
		.map((b) => parseBidEvent(b))
		.filter((r): r is { ok: true; value: import('@sdk/commerce/auctions/events').ParsedBidEvent } => r.ok)
		.map((r) => r.value)
	if (parsedChainBids.length !== chainBids.length) {
		throw new Error(
			`Chain leg parse mismatch: ${chainBids.length} raw legs but only ${parsedChainBids.length} parsed. ` +
				`Cannot safely settle — a leg may have a malformed structure that bypasses the NUT-7 fraud check.`,
		)
	}
	const nut7Error = validateBidChainNut7PrePublish(parsedChainBids, nut7States, now)
	if (nut7Error) throw new Error(nut7Error)

	// 5. Path releases — collect a kind-1025 for every leg. The bidder
	// publishes one per leg as part of `publishBidderPathRelease`.
	// Refuse to settle if any leg is missing its release: a partial
	// chain can't be redeemed and the seller would only end up with
	// some of the bid value.
	const allReleases = await fetchAuctionPathReleases(formData.auctionEventId, 500, auctionCoordinate)
	const releasesByBidId = new Map<string, NostrEventLike[]>()
	for (const ev of allReleases) {
		const e = getTag(ev, 'e') ?? ''
		if (!e) continue
		const arr = releasesByBidId.get(e) ?? []
		arr.push(ev)
		releasesByBidId.set(e, arr)
	}

	interface ResolvedLeg {
		bid: NostrEventLike
		releaseEventId: string
		derivationPath: string
		bidChildPubkey: string
		releaseChildPubkey: string
		childPubkey: string
		mintUrl: string
		cashuToken: string
		legAmount: number // sats this leg specifically contributes (delta)
	}

	const resolvedLegs: ResolvedLeg[] = []
	let runningCumulative = 0
	for (const legBid of chainBids) {
		const legReleases = releasesByBidId.get(legBid.id) ?? []
		if (!legReleases.length) {
			throw new Error(
				`Chain leg ${legBid.id.slice(0, 8)}… (amount ${getBidAmount(legBid)} sats) has no kind-1025 path release. The bidder must publish a release for every leg in the chain.`,
			)
		}
		const latestRelease = legReleases.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
		const parsed = parsePathReleaseEvent(latestRelease)
		if (!parsed.ok) {
			throw new Error(`Path release for leg ${legBid.id.slice(0, 8)}… is malformed`)
		}
		const release = parsed.value
		if (release.bidderPubkey !== legBid.pubkey) {
			throw new Error(`Leg ${legBid.id.slice(0, 8)}… release was signed by a different pubkey than the bid`)
		}
		if (!release.cashuToken) {
			throw new Error(`Leg ${legBid.id.slice(0, 8)}… release carries no cashu_token — cannot redeem. Bidder must republish with proofs.`)
		}
		const legChildFromBid = (getTag(legBid, 'child_pubkey') ?? '').toLowerCase()
		const derivedChild = deriveAuctionChildP2pkPubkeyFromXpub(p2pkXpub, release.derivationPath).toLowerCase()
		const releaseChildPubkey = release.childPubkey.toLowerCase()
		if (derivedChild !== legChildFromBid) {
			throw new Error(
				`Leg ${legBid.id.slice(0, 8)}… release derives to ${derivedChild} but the bid was locked to ${legChildFromBid}. Fraudulent bid leg.`,
			)
		}
		if (derivedChild !== releaseChildPubkey) {
			throw new Error(`Leg ${legBid.id.slice(0, 8)}… release child_pubkey tag does not match locally-derived child pubkey`)
		}

		const legCumulative = getBidAmount(legBid)
		const legAmount = legCumulative - runningCumulative
		if (legAmount <= 0) {
			throw new Error(`Leg ${legBid.id.slice(0, 8)}… has non-positive delta (${legAmount}) — chain invariant broken`)
		}
		runningCumulative = legCumulative

		const legMint = getTag(legBid, 'mint') ?? ''
		if (!legMint) throw new Error(`Leg ${legBid.id.slice(0, 8)}… is missing its mint tag`)

		resolvedLegs.push({
			bid: legBid,
			releaseEventId: release.id,
			derivationPath: release.derivationPath,
			bidChildPubkey: legChildFromBid,
			releaseChildPubkey,
			childPubkey: derivedChild,
			mintUrl: legMint,
			cashuToken: release.cashuToken,
			legAmount,
		})
	}

	if (runningCumulative !== winningAmount) {
		throw new Error(
			`Chain sum (${runningCumulative} sats) does not equal winning bid amount (${winningAmount} sats). Chain integrity broken.`,
		)
	}

	// M7 FIX: Bind release token secrets/proof-Ys to bid commitments.
	// The seller's settlement path previously validated derivation paths
	// and child pubkeys but did NOT verify that the cashu token's proofs
	// match the bid's committed lock_secret/proof_y multisets. An attacker
	// could publish a path release with a token containing different proofs
	// (e.g. lower-value proofs) while the bid event committed to different
	// lock_secrets/proof_Ys. The seller would then redeem the wrong proofs.
	//
	// Validate that each leg's token proofs' secrets and proof-Ys match the
	// bid's committed multisets (same approach as validatePathRelease in
	// validation.ts, but applied in the publish path where the seller holds
	// both the bid event and the release token).
	const mintKeysetsByMint = new Map<string, MintKeyset[]>()
	for (const legMintUrl of Array.from(new Set(resolvedLegs.map((leg) => leg.mintUrl)))) {
		mintKeysetsByMint.set(legMintUrl, await walletOps.loadAuctionMintKeysets(legMintUrl))
	}

	for (const leg of resolvedLegs) {
		const legBidParsed = parsedBids.find((b) => b.id === leg.bid.id)
		if (!legBidParsed) {
			throw new Error(`M7: Cannot find parsed bid for leg ${leg.bid.id.slice(0, 8)}… to validate token bindings`)
		}
		let decodedToken
		try {
			// cashu-ts v5 `getDecodedToken` maps short keyset ids to keysets, so it takes the
			// keyset *ids* for the mint, not the keyset objects.
			decodedToken = getDecodedToken(
				leg.cashuToken,
				(mintKeysetsByMint.get(leg.mintUrl) ?? []).map((keyset) => keyset.id),
			)
		} catch (err) {
			throw new Error(
				`M7: Failed to decode cashu token for leg ${leg.bid.id.slice(0, 8)}…: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
		if (decodedToken.proofs.length !== legBidParsed.lockSecrets.length) {
			throw new Error(
				`M7: Leg ${leg.bid.id.slice(0, 8)}… token has ${decodedToken.proofs.length} proofs but bid committed ${legBidParsed.lockSecrets.length} lock_secrets`,
			)
		}
		const expectedSecrets = new Map<string, number>()
		for (const s of legBidParsed.lockSecrets) expectedSecrets.set(s, (expectedSecrets.get(s) ?? 0) + 1)
		const expectedProofYs = new Map<string, number>()
		for (const y of legBidParsed.proofYs) expectedProofYs.set(y.toLowerCase(), (expectedProofYs.get(y.toLowerCase()) ?? 0) + 1)
		for (let i = 0; i < decodedToken.proofs.length; i++) {
			const proof = decodedToken.proofs[i]
			// Check secret multiset
			const secretCount = expectedSecrets.get(proof.secret) ?? 0
			if (secretCount <= 0) {
				throw new Error(`M7: Leg ${leg.bid.id.slice(0, 8)}… token proof ${i + 1} secret was not committed in the bid's lock_secret tags`)
			}
			if (secretCount === 1) expectedSecrets.delete(proof.secret)
			else expectedSecrets.set(proof.secret, secretCount - 1)
			// Check proof_y multiset
			const proofY = hashToCurveHexFromString(proof.secret).toLowerCase()
			const proofYCount = expectedProofYs.get(proofY) ?? 0
			if (proofYCount <= 0) {
				throw new Error(
					`M7: Leg ${leg.bid.id.slice(0, 8)}… token proof ${i + 1} hash_to_curve(secret) does not match the bid's proof_y set`,
				)
			}
			if (proofYCount === 1) expectedProofYs.delete(proofY)
			else expectedProofYs.set(proofY, proofYCount - 1)
		}
		if (expectedSecrets.size > 0) {
			throw new Error(`M7: Leg ${leg.bid.id.slice(0, 8)}… token is missing one or more secrets committed in the bid`)
		}
		if (expectedProofYs.size > 0) {
			throw new Error(`M7: Leg ${leg.bid.id.slice(0, 8)}… token is missing one or more proof_Ys committed in the bid`)
		}
	}

	// 5b. M6 FIX: Per-leg NUT-7 state check for resumable redemption.
	// The original code did an all-or-nothing pre-check: if ANY proof was
	// spent, it aborted. This made settlement non-resumable — if a
	// previous attempt redeemed leg 1 but crashed before leg 2, retrying
	// would abort because leg 1's proofs are now spent.
	//
	// New approach: check each leg individually.
	//   - ALL proofs spent → leg was already redeemed by this seller in a
	//     previous attempt → skip (resumable).
	//   - SOME proofs spent (not all) → early-exit fraud or partial spend
	//     → abort.
	//   - ALL proofs unspent → redeem normally.
	//
	// This makes settlement resumable: the seller can retry and already-
	// spent legs are detected and skipped automatically.
	const legProofStates = new Map<string, Map<string, Nut7ProofState>>()
	for (const leg of resolvedLegs) {
		const legBid = parsedBids.find((b) => b.id === leg.bid.id)
		if (!legBid) continue
		const states = await checkProofStateBatch(leg.mintUrl, legBid.proofYs)
		legProofStates.set(leg.bid.id, states)
	}

	// Classify each leg as 'already-redeemed', 'fraud', or 'pending'.
	const alreadyRedeemedLegs = new Set<string>()
	for (const leg of resolvedLegs) {
		const legBid = parsedBids.find((b) => b.id === leg.bid.id)
		if (!legBid) continue
		const states = legProofStates.get(leg.bid.id)
		if (!states) continue
		let spentCount = 0
		let totalProofs = legBid.proofYs.length
		for (const proofY of legBid.proofYs) {
			if (states.get(proofY.toLowerCase()) === 'spent') spentCount++
		}
		if (spentCount === totalProofs) {
			// All proofs spent — but bare SPENT proves consumption, not WHO
			// consumed them. Pre-locktime only the seller's lock key (child
			// privkey from the auction xpriv + this leg's path) can spend, so
			// all-spent pre-locktime IS seller-bound redemption evidence
			// ('already redeemed', e.g. a previous settlement attempt that
			// crashed after this leg). Post-locktime the bidder's refund path
			// is also open — then all-spent stays ambiguous and the leg must
			// be redeemed (the mint answers 'already spent' only if the
			// bidder refunded; see recovery in the receive loop below).
			if (now < legBid.locktime) {
				alreadyRedeemedLegs.add(leg.bid.id)
			}
		} else if (spentCount > 0) {
			// Some but not all proofs spent — early-exit fraud or partial
			// spend. Abort the entire settlement.
			throw new Error(
				`NUT-7 check failed: leg ${leg.bid.id.slice(0, 8)}… has ${spentCount}/${totalProofs} proofs spent (partial spend detected). ` +
					`This may indicate early-exit fraud by the bidder. Aborting settlement.`,
			)
		}
		// spentCount === 0 → all unspent, will redeem below
	}

	const latestLeg = resolvedLegs[resolvedLegs.length - 1]
	const settlementOutcome = await runAuctionSettlementAppAdapter({
		plan: {
			status: 'settled',
			auction: parsedAuction,
			closeAt,
			createdAt: Math.floor(Date.now() / 1000),
			winningBidId,
			winnerPubkey,
			finalAmount: winningAmount,
			pathReleaseEventId: latestLeg.releaseEventId,
			legs: resolvedLegs.map((leg) => ({
				bidEventId: leg.bid.id,
				amount: leg.legAmount,
				locktime: getFirstTagValue(leg.bid, 'locktime') ? Number(getFirstTagValue(leg.bid, 'locktime')) : 0,
				redemptionData: leg,
			})),
		},
		ports: {
			preflightAll: async (legs) => {
				preflightAuctionSettlementP2pkChain({
					auctionP2pkXpub: p2pkXpub,
					legs: legs.map((entry) => ({
						bidEventId: entry.bidEventId,
						mintUrl: entry.redemptionData.mintUrl,
						token: entry.redemptionData.cashuToken,
						derivationPath: entry.redemptionData.derivationPath,
						bidChildPubkey: entry.redemptionData.bidChildPubkey,
						releaseChildPubkey: entry.redemptionData.releaseChildPubkey,
						expectedAmount: entry.amount,
						mintKeysets: mintKeysetsByMint.get(entry.redemptionData.mintUrl),
					})),
				})
			},
			inspectLeg: async (leg) => (alreadyRedeemedLegs.has(leg.bidEventId) ? 'redeemed_by_seller' : 'unspent'),
			redeemLeg: async (leg) => {
				const data = leg.redemptionData
				const childPrivkey = await walletOps.getAuctionHdChildPrivkey({
					derivationPath: data.derivationPath,
					expectedPubkey: data.childPubkey,
				})
				try {
					const redeemed = await walletOps.receiveLockedEcash(data.cashuToken, childPrivkey, data.mintUrl)
					if (!redeemed) throw new Error(`Cashu redemption did not complete for leg ${leg.bidEventId.slice(0, 8)}…`)
				} catch (error) {
					throw tagBidError(`settlement-receive-leg-${leg.bidEventId.slice(0, 8)}`, error)
				}
			},
			assertReserveNotMet: async () => {},
			publish: async (template) => {
				const event = await signNostrEvent(template)
				await publishRequired(event)
				return { eventId: event.id }
			},
		},
	})
	if (settlementOutcome.status !== 'published') {
		const phase = settlementOutcome.status === 'publish_uncertain' ? 'publish' : settlementOutcome.phase
		throw new Error(
			`Settlement ${settlementOutcome.status} during ${phase}; redeemed chain legs: ${settlementOutcome.redeemedBidIds.join(', ') || 'none'}. ` +
				settlementOutcome.error,
		)
	}
	return settlementOutcome.eventId
}

export const usePublishAuctionSettlementMutation = () => {
	const queryClient = useQueryClient()

	// ADR-0011 review R3: capture the mutate fn so the error toast's
	// "Publish anyway" action can re-run the SAME settlement with the seller
	// override (`dleqEvidenceOverride`), which records the unresolved DLEQ
	// evidence on the terminal event instead of leaving the seller stuck.
	const overrideRef = useRef<((variables: AuctionSettlementFormData) => void) | null>(null)

	const mutation = useMutation({
		mutationFn: async (formData: AuctionSettlementFormData) => publishAuctionSettlement(formData),
		onSuccess: async (_eventId, variables) => {
			await queryClient.invalidateQueries({ queryKey: auctionKeys.details(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.bids(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.settlements(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
			toast.success('Auction settlement published')
		},
		onError: (error, variables) => {
			console.error('Failed to publish auction settlement:', error)
			const message = error instanceof Error ? error.message : String(error)
			if (message.includes('DLEQ evidence is unavailable')) {
				toast.error(`Failed to publish settlement: ${message}`, {
					action: {
						label: 'Publish anyway',
						onClick: () => overrideRef.current?.({ ...variables, dleqEvidenceOverride: true }),
					},
				})
				return
			}
			toast.error(`Failed to publish settlement: ${message}`)
		},
	})
	overrideRef.current = mutation.mutate
	return mutation
}
