/**
 * platform/web/auctions/auctionPublishBid.ts — the bidder's kind-1023 bid publish path.
 *
 * This is the money path: it derives a fresh bidder-local path, locks the bid leg at the mint (1-of-1
 * P2PK to the seller's derived child key with a refund timelock), builds and signs the kind-1023, and
 * persists the recovery record + rebroadcast cache entry around it. It is a verbatim move out of
 * `src/publish/auctions.tsx`: the pre-lock / post-lock / uncertain-lock error classification, the
 * double-lock protections (#1235), the event-identity re-check before and after signing, and the
 * idempotent rebroadcast cache all keep their exact semantics here.
 *
 * Nothing in this module may be "simplified": every guard below prevents a lost or double-locked leg.
 */
import { AUCTION_BID_KIND, getAuctionTagValue } from '@sdk/commerce/auctions/settlement'
import { getBidAmount, getBidStatus, fetchAuction } from '@platform/web/auctions/auctionsQuery'
import {
	createAuctionBidTemplate,
	executeFundedAuctionBidWorkflow,
	planAuctionBid,
	retryAuctionBidPublishFromStorage,
} from '@sdk/commerce/auctions'
import { parseAuctionEvent } from '@sdk/commerce/auctions/schemas/auctionEvent'
import { toRawEvent, type NostrEventLike } from '@sdk/core/nostr/eventLike'
import { generateAuctionDerivationPath } from '@sdk/commerce/auctions/pathOracle'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '@sdk/commerce/auctions/auctionP2pk'
import { hashToCurveHexFromString } from '@sdk/commerce/payments/cashu/hashToCurve'
import { buildDleqProofs } from '@sdk/commerce/payments/cashu/dleq'
import { AUCTION_MIN_BID_SATS } from '@sdk/commerce/auctions/constants'
import {
	findLatestBidderRecordForAuction,
	upsertBidderRecord,
	persistPreLockRecoveryRecord,
	removePreLockRecoveryRecord,
	type AuctionBidPreLockRecoveryRecord,
} from '@sdk/commerce/auctions/bidderRecords'
import { loadUserData, saveUserData } from '@sdk/commerce/payments/wallet/storage'
import {
	AuctionBidLockMutationPossibleError,
	createUserScopedKeyValueStoragePort,
	getUser,
	signNostrEvent,
	walletOps,
	type NostrEvent,
} from '@platform/web/ndkPublishContext'
import { getCurrentPubkey } from '@platform/web/readContext'
import { auctionKeys } from '@sdk/core/query/queryKeyFactory'
import type { KeyValueStoragePort } from '@sdk/core'
import { getPublicKey } from '@noble/secp256k1'
import type { Proof } from '@cashu/cashu-ts'
import { getEventHash } from 'nostr-tools'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import { publishRequired } from './auctionPublishIo'
import { bytesToLowerHex } from './auctionPublishRelease'

export interface AuctionBidFormData {
	auctionEventId: string
	auctionCoordinates: string
	amount: number
	/**
	 * Auction `start_at` (unix seconds). Required so the publish path can
	 * refuse bids placed before the auction has officially opened. Without
	 * this gate, bids land on the relay with `created_at < start_at` and are
	 * silently rejected by the settlement filter — the seller and bidder both
	 * see "0 bids / starting price" while the events sit on the relay.
	 */
	auctionStartAt: number
	auctionEffectiveEndAt: number
	auctionLocktimeAt: number
	/**
	 * Per-auction settlement grace in seconds (the gap between max_end_at and
	 * the Cashu locktime). Read from the auction event's `settlement_grace`
	 * tag — see AUCTIONS.md §4.1. Authoritative at bid time; the locktime
	 * stamped into the proof is `auctionLocktimeAt + settlementGraceSeconds`.
	 */
	settlementGraceSeconds: number
	sellerPubkey: string
	p2pkXpub: string
	/**
	 * Ordered list of the auction's trusted mints (`mint` tags on
	 * kind 30408). The lock flow walks this list and picks the first
	 * one where the bidder's NIP-60 wallet has enough balance for the
	 * delta amount. Falls back to `DEFAULT_BID_MINT` only when the list
	 * is empty (legacy bid forms that didn't pass mints).
	 *
	 * Replaces the older `mint?: string` field which always picked
	 * the seller's first declared mint regardless of whether the
	 * bidder actually had any sats there.
	 */
	mintCandidates: string[]
}

// `AuctionPathGrantResponse`, `openAuctionPathOracleClient`,
// `requestAuctionPathGrant` — all removed. They belonged to the v1
// path-oracle scheme where a coordinator handed out paths over CVM.
// Under `cashu_p2pk_bidder_path_v1` the bidder generates the path
// locally; there's nothing to "request" from anyone. Phase 3 wires the
// new bid-creation flow into `publishAuctionBid` below.

const DEFAULT_BID_MINT = 'https://nofees.testnut.cashu.space'

const ACTIVE_BID_STATUSES = new Set(['locked', 'accepted', 'active', 'unknown'])

export const getFirstTagValue = getAuctionTagValue

const isSpentTokenError = (error: unknown): boolean => {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
	return message.includes('already spent') || message.includes('token spent') || message.includes('proof not found')
}

const resolveLatestActiveBidByBidder = (bids: NostrEventLike[], bidderPubkey: string): NostrEventLike | null => {
	const bidderBids = bids.filter((bid) => bid.pubkey === bidderPubkey && ACTIVE_BID_STATUSES.has(getBidStatus(bid)))
	if (!bidderBids.length) return null

	return bidderBids.sort((a, b) => {
		const amountDelta = getBidAmount(b) - getBidAmount(a)
		if (amountDelta !== 0) return amountDelta
		const createdAtDelta = (b.created_at || 0) - (a.created_at || 0)
		if (createdAtDelta !== 0) return createdAtDelta
		return b.id.localeCompare(a.id)
	})[0]
}

/**
 * Publish a bidder-held-path bid (kind 1023) — AUCTIONS.md §4.2.
 *
 * Flow:
 *   1. Sanity-check the form + window (the bidder shouldn't sign a bid
 *      outside the auction window even though the validator would catch it).
 *   2. Generate a fresh high-entropy derivation path locally (§5.5).
 *   3. Compute `seller_child = derive(p2pk_xpub, path)`.
 *   4. Generate a fresh refund keypair (per-bid for privacy + isolation).
 *   5. Lock the Cashu bid via the NIP-60 wallet (1-of-1 P2PK to seller_child
 *      with refund timelock).
 *   6. Decode the locked token to extract each proof's `secret` (= lock_secret
 *      for the bid event) and compute `proof_y = hash_to_curve(secret)`.
 *   7. Publish kind-1023 with all (lock_secret, proof_y) pairs embedded.
 *   8. Persist a {path, refundPrivKey, fullProofs} record locally so we can
 *      (a) release the path at settlement, (b) refund via timelock if we
 *      grief or the seller never settles.
 *
 * Returns the published bid event id.
 */
export const publishAuctionBid = async (formData: AuctionBidFormData): Promise<string> => {
	if (!formData.auctionEventId) throw new Error('Auction event id is required')
	if (!formData.auctionCoordinates) throw new Error('Auction coordinates are required')
	if (!formData.sellerPubkey) throw new Error('Seller pubkey is required')
	if (!formData.p2pkXpub) throw new Error('Auction p2pk_xpub is required for path derivation')
	if (!Number.isSafeInteger(formData.amount) || formData.amount < AUCTION_MIN_BID_SATS) {
		throw new Error(`Bid amount must be an integer of at least ${AUCTION_MIN_BID_SATS} sats`)
	}
	if (!Number.isFinite(formData.auctionStartAt) || formData.auctionStartAt <= 0) {
		throw new Error('Auction start time is required for bidding')
	}
	if (!Number.isFinite(formData.auctionEffectiveEndAt) || formData.auctionEffectiveEndAt <= 0) {
		throw new Error('Auction effective end time is required for bidding')
	}
	if (!Number.isFinite(formData.auctionLocktimeAt) || formData.auctionLocktimeAt <= 0) {
		throw new Error('Auction locktime base is required')
	}
	if (!Number.isFinite(formData.settlementGraceSeconds) || formData.settlementGraceSeconds <= 0) {
		throw new Error('Auction is missing settlement_grace — refusing to lock without an authoritative grace period')
	}

	const now = Math.floor(Date.now() / 1000)
	if (now < formData.auctionStartAt) throw new Error('Auction has not started yet')
	if (now >= formData.auctionEffectiveEndAt) throw new Error('Auction already ended')
	if (now >= formData.auctionLocktimeAt) throw new Error('Auction has reached its hard bidding cutoff')

	const bidderUser = await getUser()
	if (!bidderUser?.pubkey) throw new Error('No active user')
	const bidderPubkey = bidderUser.pubkey
	const auctionEvent = await fetchAuction(formData.auctionEventId, true)
	if (!auctionEvent) throw new Error('Auction no longer exists')
	const auctionResult = parseAuctionEvent(toRawEvent(auctionEvent))
	if (!auctionResult.ok) throw new Error('Auction is malformed; refusing to lock bid funds')
	const parsedAuction = auctionResult.value
	if (
		parsedAuction.rootEventId !== formData.auctionEventId ||
		parsedAuction.coordinate !== formData.auctionCoordinates ||
		parsedAuction.sellerPubkey !== formData.sellerPubkey ||
		parsedAuction.p2pkXpub !== formData.p2pkXpub
	) {
		throw new Error('Auction identity or P2PK terms changed; refresh the auction before bidding')
	}
	if (
		parsedAuction.startAt !== formData.auctionStartAt ||
		parsedAuction.maxEndAt !== formData.auctionEffectiveEndAt ||
		parsedAuction.maxEndAt !== formData.auctionLocktimeAt ||
		parsedAuction.settlementGrace !== formData.settlementGraceSeconds
	) {
		throw new Error('Auction timing terms changed; refresh the auction before bidding')
	}

	// Step 1.5 — rebid detection. If this bidder already has a leg on
	// this auction, the new bid is a chain rebid: we lock ONLY the
	// delta `formData.amount - prev_leg.amount`, point at the prev leg
	// via `prev_bid`, and the seller will walk the chain on settle.
	// This keeps the bidder's total collateral equal to their latest
	// committed bid amount rather than the sum-of-all-rebids.
	//
	// AUCTIONS.md §4.2 — `prev_bid: previous bid event id from same
	// bidder (replacement chain)`. AUCTIONS.md §8 — seller "derives
	// every child privkey in the winner's chain, swaps each leg at the
	// mint" with a uniform locktime across legs.
	const prevLeg = findLatestBidderRecordForAuction(formData.auctionEventId, getCurrentPubkey())
	const bidPlan = planAuctionBid({
		auction: parsedAuction,
		bidderPubkey,
		amount: formData.amount,
		topBid: 0,
		now,
		previousLeg: prevLeg
			? {
					id: prevLeg.bidEventId,
					bidderPubkey,
					auctionRootEventId: prevLeg.auctionRootEventId,
					auctionCoordinate: prevLeg.auctionCoordinate,
					amount: prevLeg.amount,
					locktime: prevLeg.locktime,
				}
			: undefined,
	})
	const legLockAmount = bidPlan.legAmount

	// Step 2/3 — bidder-local path/key material is created by the host; the SDK
	// coordinates persistence, funding, event construction, and publication.
	const derivationPath = generateAuctionDerivationPath()
	const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(formData.p2pkXpub, derivationPath)
	const refundPrivateKeyBytes = crypto.getRandomValues(new Uint8Array(32))
	const refundPubkey = bytesToLowerHex(getPublicKey(refundPrivateKeyBytes, true))
	const refundPrivateKey = bytesToLowerHex(refundPrivateKeyBytes)
	const locktime = bidPlan.locktime
	const mintCandidates = formData.mintCandidates?.length ? formData.mintCandidates : []
	const preLockRecoveryRecordId = uuidv4()
	const preLockRecoveryRecord: AuctionBidPreLockRecoveryRecord = {
		id: preLockRecoveryRecordId,
		createdAt: Date.now(),
		auctionEventId: formData.auctionEventId,
		auctionCoordinates: formData.auctionCoordinates,
		sellerPubkey: formData.sellerPubkey,
		p2pkXpub: formData.p2pkXpub,
		derivationPath,
		childPubkey,
		refundPubkey,
		refundPrivateKey,
		mintUrl: mintCandidates[0] ?? '',
		legLockAmount,
		cumulativeAmount: formData.amount,
		locktime,
		prevBidEventId: prevLeg?.bidEventId ?? null,
	}
	type BidLockResult = Awaited<ReturnType<typeof walletOps.lockAuctionBidFunds>>
	const lockIntent = { derivationPath, childPubkey, refundPubkey, refundPrivateKey, createdAt: now }
	let lockResult: BidLockResult | undefined
	let finalizedBidEventId: string | null = null

	const outcome = await executeFundedAuctionBidWorkflow(bidPlan, {
		prepareLock: async () => ({ intent: lockIntent, preLockRecovery: preLockRecoveryRecord }),
		persistPreLockRecovery: async (record) => {
			try {
				persistPreLockRecoveryRecord(record, getCurrentPubkey())
			} catch (error) {
				throw new AuctionBidPreLockRecordWriteFailedError(refundPubkey, error)
			}
		},
		lockFunds: async (intent, plan) => {
			try {
				lockResult = await walletOps.lockAuctionBidFunds({
					amount: plan.legAmount,
					preferredMints: mintCandidates,
					locktime: plan.locktime,
					refundPubkey: intent.refundPubkey,
					lockPubkey: intent.childPubkey,
					auctionEventId: plan.auctionRootEventId,
					auctionCoordinates: plan.auctionCoordinate,
					sellerPubkey: plan.sellerPubkey,
					derivationPath: intent.derivationPath,
					childPubkey: intent.childPubkey,
				})
				return { status: 'locked' as const, funding: lockResult }
			} catch (error) {
				if (error instanceof AuctionBidLockMutationPossibleError) {
					throw new AuctionBidLockOutcomeUncertainError({
						recoveryRecordId: preLockRecoveryRecordId,
						mintUrl: error.mintUrl,
						legAmount: error.amount,
						refundPubkey: intent.refundPubkey,
						cause: error,
						pendingTokenPersisted: error.pendingTokenPersisted,
					})
				}
				return { status: 'not_locked' as const, error: error instanceof Error ? error.message : String(error), cause: error }
			}
		},
		removePreLockRecovery: (record) => removePreLockRecoveryRecord(record.refundPubkey, getCurrentPubkey()),
		createPublication: async ({ plan, intent, funding }) => {
			const proofs = funding.proofs
			if (!proofs.length) throw new Error('Lock result contained no proofs')
			const lockSecrets = proofs.map((proof: Proof) => proof.secret)
			const proofYs = proofs.map((proof: Proof) => hashToCurveHexFromString(proof.secret))
			const publishedAt = Math.floor(Date.now() / 1000)
			const dleqProofs = buildDleqProofs(proofs)
			const bidNonce = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`).toString()
			const bidTemplate = createAuctionBidTemplate(plan, {
				mint: funding.mintUrl,
				refundPubkey: intent.refundPubkey,
				childPubkey: intent.childPubkey,
				lockSecrets,
				proofYs,
				dleqProofs,
				createdAt: publishedAt,
				bidNonce,
			})
			const unsignedEvent: NostrEvent = {
				...bidTemplate,
				pubkey: bidderPubkey,
				created_at: bidTemplate.created_at ?? publishedAt,
				id: '',
				sig: '',
			}
			unsignedEvent.id = getEventHash(unsignedEvent)
			finalizedBidEventId = unsignedEvent.id
			return {
				event: unsignedEvent,
				recovery: { intent, funding, proofs, lockSecrets, proofYs },
			}
		},
		persistFundedPublication: async ({ event, recovery }) => {
			const { intent, funding, proofs, lockSecrets, proofYs } = recovery
			upsertBidderRecord(
				{
					bidEventId: event.id,
					auctionRootEventId: formData.auctionEventId,
					auctionCoordinate: formData.auctionCoordinates,
					sellerPubkey: formData.sellerPubkey,
					p2pkXpub: formData.p2pkXpub,
					derivationPath: intent.derivationPath,
					childPubkey: intent.childPubkey,
					refundPubkey: intent.refundPubkey,
					refundPrivateKey: intent.refundPrivateKey,
					mintUrl: funding.mintUrl,
					amount: bidPlan.amount,
					legLockedAmount: funding.amount,
					prevBidEventId: bidPlan.previousBidId ?? null,
					locktime: bidPlan.locktime,
					proofs,
					lockSecrets,
					proofYs,
					createdAt: intent.createdAt,
					status: 'live',
				},
				getCurrentPubkey(),
			)
			const updatedPendingToken = walletOps.updatePendingTokenContext(funding.tokenId, {
				kind: 'auction_bid',
				auctionEventId: formData.auctionEventId,
				auctionCoordinates: formData.auctionCoordinates,
				bidEventId: event.id,
				sellerPubkey: formData.sellerPubkey,
				pathIssuerPubkey: '',
				lockPubkey: funding.lockPubkey,
				refundPubkey: funding.refundPubkey,
				locktime: funding.locktime,
				derivationPath: funding.derivationPath,
				childPubkey: funding.childPubkey,
				grantId: funding.grantId,
			})
			if (!updatedPendingToken) {
				console.warn('[auctions] Locked auction bid but could not attach bid event id to the local pending lock record before publishing')
			}
			await cacheAuctionBidEventForRepublish(event)
		},
		sign: async (event) => {
			const signedEvent = await signNostrEvent(event)
			if (signedEvent.id !== finalizedBidEventId || getEventHash(signedEvent) !== finalizedBidEventId) {
				throw new Error(
					`Refusing to publish auction bid: signing changed the event identity (expected ${finalizedBidEventId}, got ${signedEvent.id}). Nothing was published.`,
				)
			}
			return signedEvent
		},
		persistSignedEvent: async (event) => cacheAuctionBidEventForRepublish(event),
		publish: publishRequired,
	})

	if (outcome.status === 'published') {
		await discardAuctionBidEventRepublishCacheEntry(outcome.eventId)
		return outcome.eventId
	}
	if (outcome.status === 'failed_before_lock') {
		throw outcome.cause ?? new Error(outcome.error)
	}
	if (outcome.status === 'lock_outcome_uncertain') {
		if (outcome.cause instanceof AuctionBidLockOutcomeUncertainError) throw outcome.cause
		throw new AuctionBidLockOutcomeUncertainError({
			recoveryRecordId: preLockRecoveryRecordId,
			mintUrl: mintCandidates[0] ?? '',
			legAmount: bidPlan.legAmount,
			refundPubkey,
			cause: outcome.cause ?? new Error(outcome.error),
			pendingTokenPersisted: false,
		})
	}
	if (outcome.status === 'locked_recovery_only') {
		if (!lockResult) throw new Error(outcome.error)
		throw new AuctionBidLockedButUnpublishedError(lockResult.tokenId, outcome.cause ?? new Error(outcome.error), finalizedBidEventId)
	}
	throw new AuctionBidPublishFailedError(finalizedBidEventId ?? '', outcome.cause ?? new Error(outcome.error))
}

/**
 * #1235 Blocking 1: thrown by `publishAuctionBid` when the bid's funds were
 * locked, the durable recovery record was written, and the kind-1023 event was
 * built — but signing or the relay broadcast failed.
 *
 * Carries the bid event id so the funding lifecycle (`useAuctionBidFunding`)
 * can offer an idempotent retry (`republishAuctionBid`) that rebroadcasts the
 * exact persisted signed event instead of re-deriving a fresh path, generating
 * a fresh refund keypair, and re-locking funds at the mint (double-lock).
 */
export class AuctionBidPublishFailedError extends Error {
	/** The kind-1023 event id that failed to broadcast (already persisted and recoverable). */
	public readonly bidEventId: string
	/** The underlying sign/publish failure. */
	public override readonly cause: unknown

	constructor(bidEventId: string, cause: unknown) {
		const causeMessage = cause instanceof Error ? cause.message : String(cause)
		super(`Auction bid ${bidEventId} was funded and signed but could not be published: ${causeMessage}`)
		this.name = 'AuctionBidPublishFailedError'
		this.bidEventId = bidEventId
		this.cause = cause
	}
}

/**
 * #1235 follow-up (post-lock error model): thrown by `publishAuctionBid`
 * when the bid's funds were LOCKED at the mint but the leg never became
 * safely publishable — the kind-1023 event could not be finalized
 * (`toNostrEvent`), the STRICT durable recovery-record write failed
 * (quota / disabled storage / no user scope), or any other post-lock
 * pre-publish step threw before the signed event + recovery record +
 * rebroadcast cache were all in place.
 *
 * Distinct from `AuctionBidPublishFailedError`, whose legs ARE safely
 * retryable by rebroadcast (recovery record + cached signed event already
 * persisted, event id known). A leg carrying THIS error must NEVER fall
 * back to the full re-submit pipeline (`submitPreparedBid` →
 * `publishAuctionBid`) — that would re-derive a fresh path and RE-LOCK the
 * already-locked delta (double-lock). Recovery is RECLAIM-ONLY: the locked
 * proofs live on as a pending token in the NIP-60 wallet (its id is
 * `lockTokenId`), reclaimable via `reclaimToken` after the refund timelock
 * opens.
 *
 * `bidEventId` is set when the event id was finalized before the failure —
 * diagnostics only. It does NOT make the leg rebroadcast-safe: e.g. when
 * the recovery-record write failed, the refund private key is lost and
 * broadcasting the bid would strand the locked leg with no usable refund
 * branch.
 */
export class AuctionBidLockedButUnpublishedError extends Error {
	/** Id of the wallet's pending-token record holding the locked proofs. */
	public readonly lockTokenId: string
	/** Finalized kind-1023 event id when known (diagnostics only; may be null). */
	public readonly bidEventId: string | null
	/** The underlying post-lock failure. */
	public override readonly cause: unknown

	constructor(lockTokenId: string, cause: unknown, bidEventId?: string | null) {
		const causeMessage = cause instanceof Error ? cause.message : String(cause)
		super(
			`Auction bid funds were locked (pending token ${lockTokenId}) but could not be prepared for publishing: ${causeMessage}` +
				(bidEventId ? ` — bid event ${bidEventId}` : '') +
				' — do NOT re-submit this bid; reclaim the locked funds after the refund timelock opens.',
		)
		this.name = 'AuctionBidLockedButUnpublishedError'
		this.lockTokenId = lockTokenId
		this.bidEventId = bidEventId ?? null
		this.cause = cause
	}
}

/**
 * #1235 round-3 B1 — thrown by `publishAuctionBid` when the pre-lock recovery
 * record could not be durably confirmed BEFORE the mint lock call.
 *
 * Provably pre-mint: no swap/lock request was sent, nothing at the mint was
 * mutated. The funding lifecycle's existing bare-error path handles it — a
 * full re-submit is safe once the storage problem is fixed (quota, disabled
 * storage, or no signed-in user scope).
 */
export class AuctionBidPreLockRecordWriteFailedError extends Error {
	/** Refund pubkey of the leg whose recovery record failed to persist. */
	public readonly refundPubkey: string
	/** The underlying persistence failure. */
	public override readonly cause: unknown

	constructor(refundPubkey: string, cause: unknown) {
		const causeMessage = cause instanceof Error ? cause.message : String(cause)
		super(
			`Failed to durably persist the pre-lock recovery record for the auction bid leg (refund pubkey ${refundPubkey}): ${causeMessage}. ` +
				'The mint lock was NOT attempted — no funds were touched. Fix local storage (quota / disabled storage / signed-in state) and place the bid again.',
		)
		this.name = 'AuctionBidPreLockRecordWriteFailedError'
		this.refundPubkey = refundPubkey
		this.cause = cause
	}
}

/**
 * #1235 round-3 B1 — thrown by `publishAuctionBid` when the mint lock's
 * outcome is UNCERTAIN: the NIP-60 store reported
 * `AuctionBidLockMutationPossibleError`, i.e. a swap/lock request may
 * already have been sent to the mint.
 *
 * Sibling (NOT a subclass) of `AuctionBidPublishFailedError` and
 * `AuctionBidLockedButUnpublishedError`: the leg is neither provably
 * pre-mint (so a full re-submit could double-consume inputs) nor provably
 * locked-and-persisted (so there may be nothing to rebroadcast or reclaim).
 * The funding lifecycle must REFUSE the in-session retry and surface the
 * reclaim path: the pre-lock recovery record named by `recoveryRecordId`
 * durably holds the leg's refund private key, and the wallet's pending-token
 * record — when the swap response was processed — makes the leg reclaimable
 * after the refund timelock opens.
 *
 * #1235 round-3 fix 5 (felixfelix #11): the reclaim promise is gated on
 * `pendingTokenPersisted` — the wallet's STRICT pending-token save
 * succeeded. When false the leg is record-only (no durable observation of
 * the mint-issued proofs), so the message must NOT promise a wallet
 * reclaim the app cannot perform; it says the proofs could not be observed
 * and may not be recoverable in-app, and that the recovery record holds the
 * refund key. Honest default: false.
 */
export class AuctionBidLockOutcomeUncertainError extends Error {
	/** Id of the persisted pre-lock recovery record holding the refund authority. */
	public readonly recoveryRecordId: string
	/** Mint the lock request may have been sent to. */
	public readonly mintUrl: string
	/** Amount (sats) the leg attempted to lock. */
	public readonly legAmount: number
	/** Refund pubkey of the uncertain leg. */
	public readonly refundPubkey: string
	/** Whether the wallet durably observed the proofs (STRICT pending-token save succeeded). */
	public readonly pendingTokenPersisted: boolean
	/** The underlying mutation-possible failure. */
	public override readonly cause: unknown

	constructor(params: {
		recoveryRecordId: string
		mintUrl: string
		legAmount: number
		refundPubkey: string
		cause: unknown
		pendingTokenPersisted?: boolean
	}) {
		const causeMessage = params.cause instanceof Error ? params.cause.message : String(params.cause)
		const pendingTokenPersisted = params.pendingTokenPersisted ?? false
		super(
			`The outcome of the auction bid lock is uncertain — a lock request may already have been sent to ${params.mintUrl} ` +
				`for ${params.legAmount} sats (${causeMessage}). No second lock was attempted. A recovery record with the refund key ` +
				`was saved (${params.recoveryRecordId}); ` +
				(pendingTokenPersisted
					? 'the leg may be reclaimable from the wallet once the refund timelock opens.'
					: 'the mint-issued proofs could not be observed by the wallet and may not be recoverable in-app; a recovery record with your refund key was saved.'),
		)
		this.name = 'AuctionBidLockOutcomeUncertainError'
		this.recoveryRecordId = params.recoveryRecordId
		this.mintUrl = params.mintUrl
		this.legAmount = params.legAmount
		this.refundPubkey = params.refundPubkey
		this.pendingTokenPersisted = pendingTokenPersisted
		this.cause = params.cause
	}
}

// ============================================================================
// Idempotent bid-publish retry cache (#1235 Blocking 1)
// ============================================================================
//
// `retryBidPublish` must rebroadcast the EXACT persisted signed kind-1023:
// re-running `publishAuctionBid` would re-derive a fresh path, generate a FRESH
// refund keypair, and re-lock via `lockAuctionBidFunds` (a fresh swap at the
// mint — new proofs, new event id; N retries = N locked legs). Instead,
// `publishAuctionBid` caches the built event here (in-memory + user-scoped
// localStorage) immediately before the first publish attempt, and
// `republishAuctionBid` reads it back and only re-broadcasts:
//
//   - same event id, same tags, same content (integrity-checked by
//     recomputing the event hash);
//   - ZERO additional Cashu swap/lock — no mint interaction at all;
//   - re-signs only when the cached entry predates signing (a sign failure),
//     which does not change the event id and does not touch the mint.
//
// Entries are removed once the event is confirmed published, so the cache
// only ever holds legs whose broadcast is genuinely pending/retryable.

const AUCTION_BID_REPUBLISH_CACHE_KEY = 'auction_bid_republish_events_v1'
const AUCTION_BID_REPUBLISH_CACHE_MAX_ENTRIES = 25
const AUCTION_BID_REPUBLISH_STORAGE_KEY_PREFIX = 'auction-bid-republish-v1:'
const userScopedSdkStorage = createUserScopedKeyValueStoragePort(getCurrentPubkey)

/** Serialized kind-1023 payload persisted for idempotent retry. */
type SerializedAuctionBidEventPayload = NostrEvent

interface CachedAuctionBidEvent {
	bidEventId: string
	payload: SerializedAuctionBidEventPayload
	savedAt: number
}

/** Cache of built-but-not-confirmed-published bid events, keyed by event id. */
type AuctionBidRepublishCache = Record<string, CachedAuctionBidEvent>

// Same-session fallback for when user-scoped localStorage is unavailable
// (e.g. not signed in / storage disabled): an in-session retry must still
// be able to rebroadcast without re-locking.
const auctionBidRepublishMemoryCache: AuctionBidRepublishCache = {}

const auctionBidRetryStoragePort: KeyValueStoragePort = {
	get: async (key) => {
		const stored = await userScopedSdkStorage.get(key)
		if (stored !== null) return stored
		const bidEventId = key.slice(AUCTION_BID_REPUBLISH_STORAGE_KEY_PREFIX.length)
		const legacyEntry = loadAuctionBidRepublishCache()[bidEventId]
		return legacyEntry ? JSON.stringify(legacyEntry) : null
	},
	set: async (key, value) => {
		const bidEventId = key.slice(AUCTION_BID_REPUBLISH_STORAGE_KEY_PREFIX.length)
		let entry: CachedAuctionBidEvent
		try {
			entry = JSON.parse(value) as CachedAuctionBidEvent
		} catch {
			throw new Error('Auction bid retry cache record is malformed')
		}
		if (entry.bidEventId !== bidEventId || !entry.payload) throw new Error('Auction bid retry cache identity mismatch')
		const cache = loadAuctionBidRepublishCache()
		cache[bidEventId] = entry
		persistAuctionBidRepublishCache(cache)
		try {
			await userScopedSdkStorage.set(key, value)
		} catch {
			// The legacy user-scoped cache and in-session map remain available for retry.
		}
	},
	remove: async (key) => {
		const bidEventId = key.slice(AUCTION_BID_REPUBLISH_STORAGE_KEY_PREFIX.length)
		delete auctionBidRepublishMemoryCache[bidEventId]
		const cache = loadAuctionBidRepublishCache()
		delete cache[bidEventId]
		persistAuctionBidRepublishCache(cache)
		await userScopedSdkStorage.remove(key)
	},
}

const loadAuctionBidRepublishCache = (): AuctionBidRepublishCache => {
	const persisted = loadUserData<AuctionBidRepublishCache>(AUCTION_BID_REPUBLISH_CACHE_KEY, {}, getCurrentPubkey())
	const cache: AuctionBidRepublishCache = {}
	for (const [bidEventId, entry] of Object.entries(persisted ?? {})) {
		if (entry?.bidEventId === bidEventId && entry.payload) cache[bidEventId] = entry
	}
	for (const [bidEventId, entry] of Object.entries(auctionBidRepublishMemoryCache)) {
		if (!cache[bidEventId]) cache[bidEventId] = entry
	}
	return cache
}

const persistAuctionBidRepublishCache = (cache: AuctionBidRepublishCache): void => {
	// Keep the cache bounded — drop the oldest entries first. Retry entries
	// are short-lived (discarded on publish success), so 25 legs is far more
	// than any realistic pending-retry backlog.
	const idsBySavedAt = Object.entries(cache)
		.sort(([, a], [, b]) => a.savedAt - b.savedAt)
		.map(([bidEventId]) => bidEventId)
	while (idsBySavedAt.length > AUCTION_BID_REPUBLISH_CACHE_MAX_ENTRIES) {
		const oldestId = idsBySavedAt.shift()
		if (oldestId === undefined) break
		delete cache[oldestId]
	}
	for (const key of Object.keys(auctionBidRepublishMemoryCache)) delete auctionBidRepublishMemoryCache[key]
	Object.assign(auctionBidRepublishMemoryCache, cache)
	saveUserData(AUCTION_BID_REPUBLISH_CACHE_KEY, cache, getCurrentPubkey())
}

const cacheAuctionBidEventForRepublish = async (bidEvent: NostrEvent): Promise<void> => {
	if (!bidEvent.id) return
	const entry = { bidEventId: bidEvent.id, payload: bidEvent, savedAt: Date.now() }
	await auctionBidRetryStoragePort.set(`${AUCTION_BID_REPUBLISH_STORAGE_KEY_PREFIX}${bidEvent.id}`, JSON.stringify(entry))
}

const discardAuctionBidEventRepublishCacheEntry = async (bidEventId: string): Promise<void> => {
	await auctionBidRetryStoragePort.remove(`${AUCTION_BID_REPUBLISH_STORAGE_KEY_PREFIX}${bidEventId}`)
}

/**
 * #1235 Blocking 1: rebroadcast an already-built kind-1023 auction bid event
 * by id — WITHOUT re-deriving the lock path, generating a fresh refund
 * keypair, or touching the mint in any way.
 *
 * Used by the `retryBidPublish` idempotent-retry path in `useAuctionBidFunding`:
 * when a bid was funded (funds locked, recovery record persisted, event built
 * and cached) but the relay broadcast failed, retrying must NOT re-run
 * `publishAuctionBid` — that would lock the delta AGAIN at the mint
 * (double-lock). Instead we re-publish the cached event verbatim: same id,
 * same tags, same content, same signature. Relays that already have it
 * deduplicate; relays that missed it ingest it. No swap, no lock, no signer
 * interaction unless the cached entry predates signing (in which case the
 * event is re-signed locally — the id is unaffected by the signature).
 *
 * @param bidEventId id of the previously-built kind-1023 bid event
 * @returns the rebroadcast bid event id
 * @throws when nothing is cached for the id, the cached payload is not a
 *         kind-1023 bid, the payload does not hash to the requested id
 *         (corrupted/tampered cache), or the rebroadcast fails
 */
export const republishAuctionBid = async (bidEventId: string): Promise<string> => {
	if (!bidEventId) throw new Error('Cannot rebroadcast auction bid: bidEventId is empty')
	const cached = loadAuctionBidRepublishCache()[bidEventId]
	if (!cached) {
		throw new Error(
			`No cached bid event for ${bidEventId} — cannot rebroadcast. Do not retry the full publish pipeline: the funds for this leg are already locked.`,
		)
	}

	const bidEvent = cached.payload
	if (bidEvent.kind !== AUCTION_BID_KIND) {
		throw new Error(`Refusing to rebroadcast ${bidEventId}: expected kind ${AUCTION_BID_KIND}, got kind ${bidEvent.kind}`)
	}
	// Integrity: the cached payload must still hash to the requested id —
	// guards against a corrupted or tampered cache entry.
	if (getEventHash(bidEvent) !== bidEventId || bidEvent.id !== bidEventId) {
		throw new Error(`Refusing to rebroadcast ${bidEventId}: cached payload does not hash to the requested event id`)
	}

	const outcome = await retryAuctionBidPublishFromStorage({
		storage: auctionBidRetryStoragePort,
		key: `${AUCTION_BID_REPUBLISH_STORAGE_KEY_PREFIX}${bidEventId}`,
		decode: (serialized) => JSON.parse(serialized) as CachedAuctionBidEvent,
		encode: (entry) => JSON.stringify(entry),
		selectRetryRecord: (entry) =>
			entry.bidEventId === bidEventId
				? {
						event: entry.payload,
						...(entry.payload.sig ? { signedEvent: entry.payload } : {}),
						recovery: { bidEventId },
					}
				: undefined,
		updateSignedEvent: (entry, event) => ({ ...entry, payload: event, savedAt: Date.now() }),
		sign: async (event) => {
			// A cached unsigned bid is bound to its original author. Refuse before
			// signing when the active identity differs, then re-check the hash to
			// catch signer identity drift before any relay publication.
			const activeUser = await getUser()
			if (activeUser?.pubkey !== event.pubkey) {
				throw new Error(
					`Refusing to republish auction bid ${bidEventId}: cached bid was created by ${event.pubkey} ` +
						`but the active signer is ${activeUser?.pubkey ?? ''}. Switch back to the original bidder account and retry. ` +
						`No signing, no publishing, and no mint interaction was performed; the cached event is preserved.`,
				)
			}
			const signed = await signNostrEvent(event)
			if (getEventHash(signed) !== bidEventId || signed.id !== bidEventId) {
				throw new Error(
					`Refusing to republish auction bid ${bidEventId}: re-signing produced a different event id (${signed.id}). Nothing was published; the cached entry is preserved.`,
				)
			}
			return signed
		},
		publish: publishRequired,
	})
	if (outcome.status === 'retryable') {
		throw new AuctionBidPublishFailedError(bidEventId, outcome.cause ?? new Error(outcome.error))
	}
	// Published — the rebroadcast cache entry is no longer needed.
	await discardAuctionBidEventRepublishCacheEntry(bidEventId)
	return outcome.eventId
}

export const usePublishAuctionBidMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async (formData: AuctionBidFormData) => publishAuctionBid(formData),
		onSuccess: async (_eventId, variables) => {
			await queryClient.invalidateQueries({ queryKey: auctionKeys.bids(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.details(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
		},
		onError: (error) => {
			console.error('Failed to publish auction bid:', error)
			toast.error(`Failed to submit bid: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation wrapper for `republishAuctionBid` — the idempotent retry path for a
 * bid whose funds are already locked and whose kind-1023 event was built and
 * cached but whose relay broadcast failed (#1235 Blocking 1). Unlike
 * `usePublishAuctionBidMutation`, this NEVER re-locks funds: it only
 * rebroadcasts the exact persisted signed event by id.
 */
export const useRepublishAuctionBidMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async (bidEventId: string) => republishAuctionBid(bidEventId),
		onSuccess: async (bidEventId) => {
			// The rebroadcast leg's bid may now be visible to bidders queries.
			// Cache invalidation is a UI-refresh aid, not proof of relay
			// acceptance (src/publish/AGENTS.md).
			void bidEventId
			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
		},
		onError: (error) => {
			// Toasting happens in the funding lifecycle's retry handler so the
			// user gets exactly one message per retry attempt.
			console.error('Failed to republish auction bid:', error)
		},
	})
}
