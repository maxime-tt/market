/**
 * platform/web/auctions/auctionPublishRelease.ts — the bidder's kind-1025 path release.
 *
 * This is the leg that hands the seller the bidder's locked ecash: `publishBidderPathRelease` walks the
 * rebid chain, re-derives every leg's child key from the local record before emitting anything, re-resolves
 * the canonical winner and the `won_pending_settlement` auditor quorum from the relays, and only then
 * publishes one kind-1025 per leg carrying that leg's derivation path and encoded Cashu token. A wrong
 * release is irreversible (the seller can derive the child key and redeem), so every gate below is
 * load-bearing: they are carried verbatim from `src/publish/auctions.tsx`, including the fail-closed
 * quorum wrapper that closes the gate on ANY inability to positively establish authorization.
 *
 * `settleAuctionAsWinner` is the settlement-side entry point the auction routes and modals call; it only
 * forwards to the publisher, which is why it lives here rather than in the wallet store.
 */
import { getCurrentPubkey } from '@platform/web/readContext'
import { signNostrEvent } from '@platform/web/ndkPublishContext'
import { AUCTION_PATH_RELEASE_KIND, type PathReleaseReason } from '@sdk/commerce/auctions/constants'
import { buildPathReleaseTags } from '@sdk/commerce/auctions/tagBuilders'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '@sdk/commerce/auctions/auctionP2pk'
import { updateBidderRecordStatus, walkBidderRecordChain } from '@sdk/commerce/auctions/bidderRecords'
import { fetchDleqKeysetsForBidsDetailed } from '@sdk/commerce/payments/cashu/dleq'
import { toRawEvent } from '@sdk/core/nostr/eventLike'
import { getEncodedToken } from '@cashu/cashu-ts'
import { runAuctionPathReleaseAppAdapter } from '@platform/web/auctions/auctionWorkflowAdapters'
import { publishRequired } from './auctionPublishIo'

/** Lowercase hex of a byte array — shared with the bid module, which derives the refund pubkey. */
export const bytesToLowerHex = (bytes: Uint8Array): string => {
	let out = ''
	for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
	return out
}

// ============================================================================
// Phase 5 — Bidder kind-1025 path release (AUCTIONS.md §4.3.1)
// ============================================================================

export interface PublishBidderPathReleaseInput {
	/** kind-1023 bid event id this release applies to. */
	bidEventId: string
	/** Why we're releasing. Default 'settlement' (we won). */
	releaseReason?: PathReleaseReason
	/** Optional validator verdict event ids the bidder is responding to. */
	auditorRefs?: string[]
	/** Optional kind-1026 fallback offer this release accepts. */
	fallbackOfferId?: string
	/** Free-form human note for the event content. */
	note?: string
}

export interface PublishBidderPathReleaseResult {
	/**
	 * kind-1025 event id from the LATEST leg in the chain — the one the
	 * seller's kind-1024 will reference via `path_release`. For
	 * single-leg bids there's exactly one. For rebid chains the older
	 * legs' kind-1025s are also published but not returned here; query
	 * the relay to retrieve them.
	 */
	pathReleaseEventId: string
	/** Released path for the latest leg (diagnostics; do not display in UI). */
	derivationPath: string
	/** Number of kind-1025 events published in this call (= legs in chain). */
	legsReleased: number
	/** Cumulative bid value the chain represents. Sum of every leg's lock. */
	cumulativeBidAmount: number
}

/**
 * Bidder-side "settle" action — AUCTIONS.md §4.3.1.
 *
 * Publishes a kind-1025 path release for one of our own bids. The
 * seller can then derive `seller_child_privkey = derive(seller_xpriv,
 * path)` and redeem the locked proofs at the mint. After we publish:
 *   - validators observe the kind-1025, verify
 *     `derive(p2pk_xpub, path) == child_pubkey`, and flip the bid's
 *     verdict to `settled_promptly` (or `fraudulent_bid` if the
 *     derivation doesn't match, which would only happen if our local
 *     record is corrupted).
 *   - the seller's settlement client picks up the release and runs
 *     redemption.
 *
 * Pre-publish we verify the local record's `derive(p2pk_xpub, path) ==
 * child_pubkey` ourselves: if it doesn't match, the path or the
 * child_pubkey in storage is corrupted and publishing a kind-1025 would
 * only produce a `fraudulent_bid` on our own reputation. Failing fast
 * locally is the right call.
 *
 * Idempotency: if the record is already `settled`, returns the existing
 * kind-1025 isn't tracked — caller can re-publish if they want a fresh
 * event, but the typical path returns early without re-emitting.
 */
export const publishBidderPathRelease = async (input: PublishBidderPathReleaseInput): Promise<PublishBidderPathReleaseResult> => {
	if (!input.bidEventId) throw new Error('bidEventId is required')

	// Walk the rebid chain. For a single-leg bid this returns one
	// record. For a rebid chain, oldest→newest, every leg the bidder
	// locked. Each leg has its own derivation_path + cashu_token; the
	// seller redeems them all on settle.
	const chain = walkBidderRecordChain(input.bidEventId, getCurrentPubkey())
	if (chain.length === 0) {
		throw new Error(
			`No local bidder record for bid ${input.bidEventId}. The bidder client must hold the derivation path to settle; lost record = unsettleable.`,
		)
	}
	const latestLeg = chain[chain.length - 1]

	// Pre-publish sanity for every leg. If any leg's derivation is
	// corrupted, refuse the whole release — the seller would fail on
	// that leg and validators would mark the bid `fraudulent_bid`.
	// Better to surface the local-storage corruption than burn
	// reputation.
	for (const leg of chain) {
		const derivedChild = deriveAuctionChildP2pkPubkeyFromXpub(leg.p2pkXpub, leg.derivationPath)
		if (derivedChild.toLowerCase() !== leg.childPubkey.toLowerCase()) {
			throw new Error(
				`Refusing to publish chain release: leg ${leg.bidEventId.slice(0, 8)}… derive(p2pk_xpub, path) = ${derivedChild} does not match stored child_pubkey ${leg.childPubkey}. Local bidder record is corrupted.`,
			)
		}
	}

	// Re-resolve the canonical winner immediately before publishing the path.
	// Render-time checks and caller assertions can be stale: a newer bid,
	// terminal settlement, or the locktime may have changed since the UI read.
	try {
		const [
			{ fetchAuction, fetchAuctionBids, fetchAuctionSettlements, fetchAuctionVerdicts },
			{ parseAuctionEvent },
			{ parseBidEvent },
			{ parseSettlementEvent },
			{ parseValidatorVerdictEvent },
			{ computeValidatedBids },
		] = await Promise.all([
			import('@platform/web/auctions/auctionsQuery'),
			import('@sdk/commerce/auctions/schemas/auctionEvent'),
			import('@sdk/commerce/auctions/schemas/bidEvent'),
			import('@platform/web/auctions/auctionsQuery'),
			import('@sdk/commerce/auctions/schemas/validatorEvents'),
			import('@sdk/commerce/auctions/bidValidation'),
		])
		const auctionEvent = await fetchAuction(latestLeg.auctionRootEventId, true)
		if (!auctionEvent) throw new Error('Auction no longer exists')
		const parsedAuctionResult = parseAuctionEvent(toRawEvent(auctionEvent))
		if (!parsedAuctionResult.ok) throw new Error('Auction is malformed')
		const parsedAuction = parsedAuctionResult.value
		const now = Math.floor(Date.now() / 1000)
		const settlementDeadline = parsedAuction.maxEndAt + parsedAuction.settlementGrace
		if (now >= settlementDeadline) throw new Error('Settlement window has expired')

		const [bidEvents, verdictEvents, settlementEvents] = await Promise.all([
			fetchAuctionBids(latestLeg.auctionRootEventId, null, parsedAuction.coordinate, true),
			fetchAuctionVerdicts(latestLeg.auctionRootEventId, null, parsedAuction.coordinate, parsedAuction.auditors, undefined),
			fetchAuctionSettlements(latestLeg.auctionRootEventId, null, parsedAuction.coordinate, undefined, true),
		])
		const parsedBids = bidEvents
			.map((event) => parseBidEvent(toRawEvent(event)))
			.filter((result): result is { ok: true; value: import('@sdk/commerce/auctions/events').ParsedBidEvent } => result.ok)
			.map((result) => result.value)
		const parsedVerdicts = verdictEvents
			.map((event) => parseValidatorVerdictEvent(toRawEvent(event)))
			.filter((result): result is { ok: true; value: import('@sdk/commerce/auctions/events').ParsedValidatorVerdictEvent } => result.ok)
			.map((result) => result.value)
		// ADR-0011 review R2: thread the DLEQ keysets here too. DLEQ is
		// unconditional, so without evidence `computeValidatedBids` classifies
		// every published bid as pending, `canonicalWinner` is null, and this
		// guard throws "Auction winner changed" for every DLEQ-bearing bid —
		// making the bidder's half of settlement (the path release the seller
		// needs to derive `seller_child_privkey`) impossible. The settlement and
		// reserve_not_met siblings already gather the same map.
		const releaseAcq = await fetchDleqKeysetsForBidsDetailed(parsedBids, parsedAuction.mints)
		const validated = computeValidatedBids({
			auction: parsedAuction,
			bids: parsedBids,
			verdicts: parsedVerdicts,
			postSettlement: false,
			dleqKeysets: releaseAcq.keysets,
			dleqUnknownKeysets: releaseAcq.unknownKeysets,
		})
		if (!validated.canonicalWinner || validated.canonicalWinner.id !== input.bidEventId) {
			throw new Error('Auction winner changed. Refresh and try again.')
		}
		const hasAuctionSettlement = settlementEvents.some((event) => {
			const parsedSettlementResult = parseSettlementEvent(toRawEvent(event))
			if (!parsedSettlementResult.ok) return false
			const settlement = parsedSettlementResult.value
			return (
				settlement.sellerPubkey.toLowerCase() === parsedAuction.sellerPubkey.toLowerCase() &&
				settlement.auctionRootEventId === parsedAuction.rootEventId &&
				settlement.auctionCoordinate === parsedAuction.coordinate
			)
		})
		if (hasAuctionSettlement) {
			throw new Error('Auction already has a settlement. Refresh and try again.')
		}
	} catch (err) {
		throw new Error(`Cannot release path: ${err instanceof Error ? err.message : String(err)}`)
	}

	// Verify won_pending_settlement quorum before releasing the path.
	// The bidder should not release their locked ecash unless a quorum
	// of auditors has confirmed that this bid is the canonical winner
	// and the auction is ready for settlement. This prevents premature
	// release based on stale or incomplete information.
	try {
		const [{ fetchAuctionVerdicts, fetchAuction }, { parseValidatorVerdictEvent }, { parseAuctionEvent }] = await Promise.all([
			import('@platform/web/auctions/auctionsQuery'),
			import('@sdk/commerce/auctions/schemas/validatorEvents'),
			import('@sdk/commerce/auctions/schemas/auctionEvent'),
		])
		const auctionEvent = await fetchAuction(latestLeg.auctionRootEventId, true)
		if (!auctionEvent) throw new Error('Auction no longer exists')
		const parsedAuctionResult = parseAuctionEvent(toRawEvent(auctionEvent))
		if (!parsedAuctionResult.ok) throw new Error('Auction is malformed')
		const quorumAuction = parsedAuctionResult.value
		const verdictEvents = await fetchAuctionVerdicts(
			latestLeg.auctionRootEventId,
			null,
			latestLeg.auctionCoordinate,
			quorumAuction.auditors,
			undefined,
		)
		const parsedVerdicts = verdictEvents
			.map((v) => parseValidatorVerdictEvent(toRawEvent(v)))
			.filter((r): r is { ok: true; value: import('@sdk/commerce/auctions/events').ParsedValidatorVerdictEvent } => r.ok)
			.map((r) => r.value)
			.filter((v) => v.bidEventId === input.bidEventId && v.claim === 'won_pending_settlement')

		const confirmingAuditors = new Set(parsedVerdicts.map((v) => v.validatorPubkey))
		const auditorCount = quorumAuction.auditors.filter((a) => confirmingAuditors.has(a)).length
		if (auditorCount < quorumAuction.auditorQuorum) {
			throw new Error(
				`Cannot release path: only ${auditorCount}/${quorumAuction.auditors.length} auditors confirmed ` +
					`won_pending_settlement (quorum requires ${quorumAuction.auditorQuorum}). Wait for more validators.`,
			)
		}
	} catch (err) {
		// Quorum verification is a hard gate for path release (M2): the
		// release exposes the bidder's derivation path + locked Cashu token,
		// and once published the seller can derive the child key and redeem
		// the proofs directly at the mint — bypassing every downstream
		// canonical-winner check in the settlement publisher. Authorization
		// unavailable ≠ authorization granted: ANY failure to positively
		// establish the canonical auction + won_pending_settlement quorum
		// (network error, parse error, auction lookup failure) keeps the
		// gate CLOSED. There is no post-close exception — a winner whose
		// relays are unreachable waits and retries, and retains the
		// locktime refund branch as the safe fallback.
		if (err instanceof Error && err.message.includes('quorum requires')) throw err

		throw new Error(
			'Cannot release path: quorum verification failed due to a network or parse error. ' +
				'The quorum gate must succeed before releasing locked proofs. ' +
				'Please retry when relays are available.',
		)
	}

	const releaseReason: PathReleaseReason = input.releaseReason ?? 'settlement'

	const releaseLegs = chain.map((leg) => {
		// Encode this leg's locked Cashu token so the seller can decode
		// + redeem. Proofs are P2PK-locked to derive(p2pk_xpub, path) —
		// only the seller (who holds `seller_xpriv`) can spend, so
		// publishing publicly is safe.
		let cashuToken: string
		try {
			if (!leg.proofs || leg.proofs.length === 0) {
				throw new Error(`leg ${leg.bidEventId.slice(0, 8)}… has no proofs in local record`)
			}
			cashuToken = getEncodedToken({ mint: leg.mintUrl, proofs: leg.proofs })
		} catch (err) {
			throw new Error(
				`Failed to encode Cashu token for leg ${leg.bidEventId.slice(0, 8)}…: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		return {
			bidEventId: leg.bidEventId,
			amount: leg.legLockedAmount,
			template: {
				kind: AUCTION_PATH_RELEASE_KIND as unknown as number,
				content: input.note ?? '',
				tags: buildPathReleaseTags({
					bidEventId: leg.bidEventId,
					auctionCoordinate: leg.auctionCoordinate,
					sellerPubkey: leg.sellerPubkey,
					derivationPath: leg.derivationPath,
					childPubkey: leg.childPubkey,
					releaseReason,
					// Only the latest leg carries auditorRefs / fallbackOfferId —
					// those reference verdicts/offers about the chain's current
					// state, not its history.
					auditorRefs: leg.bidEventId === input.bidEventId ? input.auditorRefs : undefined,
					fallbackOfferId: leg.bidEventId === input.bidEventId ? input.fallbackOfferId : undefined,
					cashuToken,
				}),
				created_at: Math.floor(Date.now() / 1000),
			},
		}
	})
	const releaseOutcome = await runAuctionPathReleaseAppAdapter({
		legs: releaseLegs,
		ports: {
			sign: signNostrEvent,
			publish: publishRequired,
			markReleased: (bidEventId) => {
				if (!updateBidderRecordStatus(bidEventId, 'settled', getCurrentPubkey())) {
					throw new Error(`Published path release for bid ${bidEventId}, but its local bidder record was not found`)
				}
			},
		},
	})
	if (releaseOutcome.status !== 'published') {
		const phase = releaseOutcome.status === 'publish_uncertain' ? 'publish' : releaseOutcome.failedPhase
		throw new Error(
			`Path release ${releaseOutcome.status} during ${phase} for bid ${releaseOutcome.failedBidEventId}. ` +
				`${releaseOutcome.legsReleased} chain leg(s) were acknowledged; confirmed release event: ${releaseOutcome.pathReleaseEventId ?? 'none'}. ` +
				releaseOutcome.error,
		)
	}

	return {
		pathReleaseEventId: releaseOutcome.pathReleaseEventId,
		derivationPath: chain[chain.length - 1].derivationPath,
		legsReleased: releaseOutcome.legsReleased,
		cumulativeBidAmount: releaseOutcome.cumulativeBidAmount,
	}
}

/**
 * Release a winning bidder's Cashu path so the seller can redeem — the settlement leg the bidder
 * publishes. This is a **publish** concern and lives here rather than in the wallet store: it
 * only signs and publishes the kind-1025 `publishBidderPathRelease` builds. It reads no wallet
 * state and moves no money, which is why the wallet store was the wrong home for it (the store's
 * own copy dynamically imported this module to reach the same function).
 *
 * The four settlement consumers (the two `platform/` auction routes, `AuctionSettlement` and
 * `AuctionWonModal`) reach it through this module — a `@/publish/auctions` import they already
 * hold — so no `platform/` route needs a `src/` import of its own for it.
 */
export const settleAuctionAsWinner = async (params: {
	bidEventId: string
	releaseReason?: 'settlement' | 'fallback_settlement' | 'voluntary_late'
	note?: string
}): Promise<{ pathReleaseEventId: string }> => {
	const result = await publishBidderPathRelease({
		bidEventId: params.bidEventId,
		releaseReason: params.releaseReason,
		note: params.note,
	})
	return { pathReleaseEventId: result.pathReleaseEventId }
}
