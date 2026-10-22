/**
 * auctionFunds.ts — the P2PK spend of an auction leg: receiving a locked Cashu token with the
 * key that unlocks it.
 *
 * This is the one money movement of the auction rails that coco cannot do, on the pinned
 * version or on 2.0: a NUT-11 P2PK-locked token is spent by `cashu-ts`'s `receive()` with the
 * spending `privkey` supplied by the caller (the bidder's HD child key at settlement, the
 * refund key at reclaim). coco's native reclaim is a plain receive with no spending key, so
 * this leg stays on `cashu-ts` and the key stays with the caller.
 *
 * The store reaches the wallet, the mint and the payment state through three things, and this
 * module names each as an injected port rather than importing any of them:
 *
 *   - the proof read and the payment-state write — {@link AuctionFundsWallet}, a structural
 *     contract in the same style as `WalletProofSource` (`./proofs.ts`), so a coco-backed
 *     source can satisfy it without this module importing the relay wallet;
 *   - mint/keyset access — {@link AuctionFundsMintAccess}, which answers a `cashu-ts`
 *     `CashuWallet` for a mint URL plus the keyset id a short-ID token needs to decode.
 *
 * Nothing here holds the relay wallet, the store or the signing key: the caller passes the
 * key in. The behaviour — mint resolution order, validation, error propagation and the order
 * of the receive and the state write — is identical to the store helper this replaces,
 * because it moves money.
 */
import { getDecodedToken, getEncodedToken, type CashuWallet, type MintKeyset, type Proof } from '@cashu/cashu-ts'
import { executeAuctionBidReclaimWorkflow, planAuctionBidReclaimTiming } from '@sdk/commerce/auctions'
import { getAuctionP2pkLockPubkeyFromSecret, toCompressedAuctionP2pkPubkey } from '@/lib/auctionP2pk'
import { AUCTION_MIN_BID_LEG_SATS } from '@/lib/auction/constants'
import { buildDleqProofs } from '@/lib/cashu/dleq'
import {
	findBidderRecordByRefundPubkey,
	findPreLockRecoveryRecordByRefundPubkey,
	removePreLockRecoveryRecord,
} from '@/lib/auction/bidderRecords'
import { getP2PKLocktime } from '@/lib/utils/cashu'
import { getMintHostname } from './display'
import { getProofsForMint, getSpendableProofsForMint, type WalletProofSource } from './proofs'
import type { AuctionBidPendingTokenContext, PendingToken } from './types'

/**
 * The store's mint normalization, kept byte-identical (one trailing slash, not all of them):
 * the mint URL keys the proof read and the state write, so a different trim would address a
 * different key.
 */
const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

/**
 * What the receive needs from the wallet: the proof read (`WalletProofSource`) plus the
 * payment-state write that records the freshly received proofs. Declared structurally, so a
 * coco-backed source can satisfy it later.
 */
export interface AuctionFundsWallet extends WalletProofSource {
	state: WalletProofSource['state'] & {
		/**
		 * Write freshly received/reconciled proofs. `destroy` is the lock's spent-input list
		 * (the mint already burned those proofs), so the local balance does not double-count.
		 */
		update(update: { store: Proof[]; mint: string; destroy?: Proof[] }): Promise<unknown>
	}
}

/**
 * Mint/keyset access as a port. A short keyset ID (NUT-2 v2, cashu-ts ≥2.x default) cannot be
 * expanded without the mint's keysets, so the port also answers the keyset id the receive
 * should decode against — and `undefined` when the caller should decode without one.
 */
export interface AuctionFundsMintAccess {
	cashuWalletForMint(mintUrl: string): Promise<{ cashuWallet: CashuWallet; keysetId?: string }>
}

export interface ReceiveTokenDeps {
	wallet: AuctionFundsWallet
	mint: AuctionFundsMintAccess
	token: string
	/**
	 * The spending key. Omitted or empty for an unsigned receive (a plain sendEcash token the
	 * recipient never claimed); present for a P2PK lock, where it is the leg's only authority.
	 */
	privkey?: string
	/**
	 * Caller-supplied mint URL. When provided we skip the top-level `getDecodedToken(token)`
	 * call entirely. Necessary when the token carries NUT-2 v2 short keyset IDs (cashu-ts ≥2.x
	 * default) — without a keyset map cashu-ts cannot decode and the call would throw "A short
	 * keyset ID v2 was encountered, but got no keysets to map it to." The seller settlement
	 * path knows the mint from the bid event, so it can pass it in.
	 */
	mintUrl?: string
}

/**
 * Receive a Cashu token into the wallet source, optionally unlocking it with `privkey`.
 *
 * Mint resolution, proof read, the `cashu-ts` receive and the payment-state write happen in
 * this order, and a failure at any step propagates unchanged — the caller owns retry and the
 * leg's outcome classification.
 */
export const receiveTokenIntoWallet = async (deps: ReceiveTokenDeps): Promise<{ amount: number; mintUrl: string }> => {
	// Resolve mint URL up front. Prefer the caller's explicit value to avoid the v2-short-ID
	// decode trap (see the option doc above). Fall back to decoding the token only if no
	// override was provided.
	let mintUrl: string
	if (deps.mintUrl) {
		mintUrl = normalizeMintUrl(deps.mintUrl)
	} else {
		mintUrl = normalizeMintUrl(getDecodedToken(deps.token).mint)
	}
	const proofsWeHave = getProofsForMint(deps.wallet, mintUrl)
	const { cashuWallet, keysetId } = await deps.mint.cashuWalletForMint(mintUrl)
	try {
		const receivedProofs = await cashuWallet.receive(deps.token, {
			proofsWeHave,
			...(deps.privkey ? { privkey: deps.privkey } : {}),
			...(keysetId ? { keysetId } : {}),
		})

		await deps.wallet.state.update({
			store: receivedProofs,
			mint: mintUrl,
		})

		return {
			amount: receivedProofs.reduce((sum, proof) => sum + proof.amount, 0),
			mintUrl,
		}
	} catch (error) {
		throw error
	}
}

/**
 * The P2PK spend: receive a locked token into the wallet source with the caller-supplied
 * spending key. This is the leg the store's `receiveLockedEcash` (settlement) and `reclaimToken`
 * (timelock refund) both need, and the reason this module exists.
 */
export const receiveTokenWithPrivkey = async (
	deps: Omit<ReceiveTokenDeps, 'privkey'> & { privkey: string },
): Promise<{ amount: number; mintUrl: string }> => receiveTokenIntoWallet(deps)

/**
 * Wall-clock skew buffer added on top of a proof's embedded P2PK locktime before the client
 * attempts a refund-path reclaim. Guards against the local clock briefly racing ahead of the
 * mint's, which would produce a "Witness is missing for p2pk signature" error from the mint.
 */
export const AUCTION_RECLAIM_SKEW_BUFFER_SECONDS = 30
/**
 * Minimum wall-clock gap between auto-reclaim sweeps. Without this the sweep would fire on
 * every wallet refresh (and every bid) and hammer the mint with /swap calls per pending token,
 * causing HTTP 429s that block the bid flow.
 */
const AUCTION_AUTO_RECLAIM_MIN_INTERVAL_MS = 60_000
/** Exponential backoff (seconds) between successive reclaim retries per token. */
const AUCTION_RECLAIM_BACKOFF_SECONDS = [30, 120, 600, 1800, 7200]
/**
 * Substrings in a mint error message that indicate the refund path will never work for this
 * token — retrying burns rate-limit budget for no reason. These come from cashu-ts / mint
 * responses when the proof's lock secret can't be satisfied with any key the wallet holds.
 */
const AUCTION_RECLAIM_PERMANENT_ERROR_KEYWORDS = ['witness is missing', 'signature is not valid', 'spending conditions not met']

/**
 * Resolve the earliest-reclaim timestamp for a bid token. We prefer the authoritative locktime
 * embedded in each proof's NUT-11 P2PK secret, but fall back to the caller-supplied
 * `contextLocktime` (the value the bidder stashed when they placed the bid) when the secret
 * parse turns up no usable value — otherwise a token whose secret isn't parseable would look
 * "never ready" and produce the misleading "in a moment" error. A small buffer is always added
 * on top to ride out client/mint clock drift.
 */
export const getAuctionReclaimReadyAt = (token: string, contextLocktime?: number): number => {
	const fallback = contextLocktime && contextLocktime > 0 ? contextLocktime : 0
	let maxLocktime = fallback
	try {
		const decoded = getDecodedToken(token)
		if (decoded?.proofs?.length) {
			for (const proof of decoded.proofs) {
				try {
					const locktime = getP2PKLocktime(proof.secret)
					if (Number.isFinite(locktime) && locktime > maxLocktime) maxLocktime = locktime
				} catch {
					// Proof isn't a P2PK secret — doesn't contribute a locktime.
				}
			}
		}
	} catch {
		// Token won't decode — rely on the context fallback below.
	}
	return maxLocktime + AUCTION_RECLAIM_SKEW_BUFFER_SECONDS
}

/** Human-readable "Xs / Xm / Xh" label for a pending-reclaim wait period. */
export const formatReclaimWaitSeconds = (seconds: number): string => {
	if (!Number.isFinite(seconds) || seconds <= 0) return 'a moment'
	if (seconds < 60) return `${Math.ceil(seconds)}s`
	const minutes = Math.ceil(seconds / 60)
	if (minutes < 60) return `${minutes}m`
	const hours = Math.ceil(seconds / 3600)
	return `${hours}h`
}

/** Helper for UI: compute the ready-at across every pending leg of a bid group. */
export const getAuctionReclaimReadyAtForGroup = (tokens: { token: string; context?: { locktime?: number } }[]): number => {
	if (!tokens.length) return 0
	return tokens.reduce((max, entry) => {
		const readyAt = getAuctionReclaimReadyAt(entry.token, entry.context?.locktime)
		return readyAt > max ? readyAt : max
	}, 0)
}

const getReclaimBackoffSeconds = (previousAttempts: number): number => {
	if (previousAttempts <= 0) return 0
	const index = Math.min(previousAttempts - 1, AUCTION_RECLAIM_BACKOFF_SECONDS.length - 1)
	return AUCTION_RECLAIM_BACKOFF_SECONDS[index]
}

const isPermanentReclaimFailure = (err: unknown): boolean => {
	const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
	return AUCTION_RECLAIM_PERMANENT_ERROR_KEYWORDS.some((keyword) => message.includes(keyword))
}

const resolveAuctionBidPendingContext = (pendingToken: PendingToken): AuctionBidPendingTokenContext | null =>
	pendingToken.context?.kind === 'auction_bid' ? pendingToken.context : null

/**
 * What the reclaim pair needs from the store it came from. Every member is a read or write the
 * store already performs; none of it is the relay wallet class, so this module stays free of it.
 */
export interface AuctionReclaimHost {
	/** The wallet source the receive leg spends into, or null when there is none. */
	getWallet(): AuctionFundsWallet | null
	/** Whether the wallet is ready — the auto-sweep's precondition. */
	isWalletReady(): boolean
	/** Mint/keyset access for the receive leg. */
	mint: AuctionFundsMintAccess
	/**
	 * The wallet's own private key for a pubkey, if it holds one. The legacy refund-key
	 * fallback: the authoritative per-bid refund key lives in the bidder records, not here.
	 */
	getWalletPrivkey(pubkey: string): string | null
	/** How many private keys the wallet holds — diagnostic only (the no-refund-key warning). */
	getWalletPrivkeyCount(): number
	/** The current pending tokens. */
	getPendingTokens(): PendingToken[]
	/** Persist and publish a new pending-token list (user-scoped storage + store). */
	setPendingTokens(tokens: PendingToken[]): void
	/** Reconcile wallet state after a successful reclaim. */
	refresh(): Promise<void>
}

export interface AuctionReclaim {
	reclaimToken(tokenId: string, options?: { manual?: boolean }): Promise<void>
	autoReclaimTimelockedBids(): Promise<void>
}

/**
 * The timelock-refund reclaim of an unclaimed bid, and the throttled sweep that runs it for
 * every ready token — the pair `nip60Actions.reclaimToken` + `nip60Actions.autoReclaimTimelockedBids`
 * moved out of the store behind {@link AuctionReclaimHost}.
 *
 * This is a money path, so the body is the store's, unchanged: the same readiness check
 * (proof-secret locktime first, cached context second, skew buffer always), the same refund-key
 * preference (bidder record → pre-lock recovery record → the wallet's key map), the same
 * `receiveTokenWithPrivkey` mint call, the same pending-token bookkeeping and the same error
 * semantics on every branch. The sweep's throttle state is per instance, so the caller must
 * hold one instance to keep the "at most one sweep per minute" rule.
 */
export const createAuctionReclaim = (host: AuctionReclaimHost): AuctionReclaim => {
	let lastSweepMs = 0

	const reclaimToken = async (tokenId: string, options?: { manual?: boolean }): Promise<void> => {
		const wallet = host.getWallet()
		if (!wallet) {
			throw new Error('Wallet not initialized')
		}

		const pendingToken = host.getPendingTokens().find((t) => t.id === tokenId)
		if (!pendingToken) {
			throw new Error('Pending token not found')
		}

		const auctionContext = resolveAuctionBidPendingContext(pendingToken)
		const now = Math.floor(Date.now() / 1000)
		const reclaimReadyAt = getAuctionReclaimReadyAt(pendingToken.token, auctionContext?.locktime)
		const reclaimPlan = planAuctionBidReclaimTiming({ tokenId, readyAt: reclaimReadyAt, now })
		if (reclaimPlan.status === 'waiting') {
			throw new Error(`Bid refund opens in ${formatReclaimWaitSeconds(reclaimPlan.waitSeconds)}`)
		}

		// Look up the refund privkey from three sources in order of preference:
		//
		//   1. The auction's BidderBidRecord (`refundPrivateKey`). This is THE authoritative
		//      store under cashu_p2pk_bidder_path_v1 — each bid leg generates a fresh refund
		//      keypair at lock time and persists the privkey there. Refund keys are
		//      intentionally NOT added to the wallet's key map because that map is for the
		//      wallet's general signing keys; mixing in per-bid throwaway keys would bloat it.
		//   2. The pre-lock recovery record (#1235 round-3 B1). A leg whose lock outcome was
		//      UNCERTAIN never got a full bidder record, but its refund privkey was durably
		//      persisted before the mint call — that record is exactly the recovery authority
		//      for the pending token the swap may have left behind.
		//   3. The wallet's key map. Legacy path; covers older bids placed before the
		//      BidderBidRecord scheme existed and provides a safety net if the local record is
		//      missing but the user happens to also hold the privkey in their wallet.
		//   4. None → stop. Without the privkey the timelock refund branch can't be signed;
		//      falling through would just spam the mint with "witness missing" 4xx responses.
		const bidderRecord = auctionContext ? findBidderRecordByRefundPubkey(auctionContext.refundPubkey) : null
		const preLockRecoveryRecord = auctionContext ? findPreLockRecoveryRecordByRefundPubkey(auctionContext.refundPubkey) : null
		const refundPrivkey =
			bidderRecord?.refundPrivateKey ??
			(auctionContext ? (preLockRecoveryRecord?.refundPrivateKey ?? host.getWalletPrivkey(auctionContext.refundPubkey)) : null)

		if (auctionContext && !refundPrivkey) {
			const walletPrivkeyCount = host.getWalletPrivkeyCount()
			console.warn(
				`[nip60] Reclaim aborted: no refund privkey found for refundPubkey ${auctionContext.refundPubkey} ` +
					`(checked BidderBidRecord + wallet.privkeys; wallet holds ${walletPrivkeyCount} privkey(s)). ` +
					`The bid was likely placed with a different browser/profile or local storage was cleared.`,
			)
			const reason =
				"This device does not hold the refund private key for this bid. The key only exists in the wallet that originally placed the bid (per-bid refund keys are stored in localStorage and aren't synced). Locked sats stay at the mint until that device reclaims them."
			const updatedTokens = host.getPendingTokens().map((t) =>
				t.id === tokenId
					? {
							...t,
							reclaimAttempts: (t.reclaimAttempts ?? 0) + 1,
							lastReclaimAttemptAt: now,
							reclaimFailureReason: reason,
							// Key mismatch is permanent — a new privkey won't appear. Mark so
							// auto-reclaim skips forever. A manual retry from the UI will clear
							// the flag in case the user imports the original wallet later.
							reclaimPermanentlyFailed: !options?.manual,
						}
					: t,
			)
			host.setPendingTokens(updatedTokens)
			throw new Error(reason)
		}

		try {
			const reclaimOutcome = await executeAuctionBidReclaimWorkflow(
				{ tokenId, readyAt: reclaimReadyAt, now },
				{
					reclaim: async () => {
						if (refundPrivkey) {
							await receiveTokenWithPrivkey({
								wallet,
								mint: host.mint,
								token: pendingToken.token,
								privkey: refundPrivkey,
								mintUrl: pendingToken.mintUrl,
							})
						} else {
							// Non-auction pending token (e.g. a regular sendEcash token the
							// recipient hasn't claimed). Best-effort unsigned receive.
							await receiveTokenIntoWallet({ wallet, mint: host.mint, token: pendingToken.token })
						}
					},
				},
			)
			if (reclaimOutcome.status === 'waiting') {
				throw new Error(`Bid refund opens in ${formatReclaimWaitSeconds(reclaimOutcome.waitSeconds)}`)
			}
			if (reclaimOutcome.status === 'failed') throw reclaimOutcome.cause

			// Mark reclaimed so auto-reclaim won't retry it.
			const pendingTokens = host.getPendingTokens().map((t) =>
				t.id === tokenId
					? {
							...t,
							status: 'reclaimed' as const,
							lastReclaimAttemptAt: now,
							reclaimFailureReason: undefined,
							reclaimPermanentlyFailed: false,
						}
					: t,
			)
			host.setPendingTokens(pendingTokens)

			// #1235 round-3 B1 — the leg is recovered: drop its pre-lock recovery record (GC).
			// The record held the refund authority while the leg was in limbo; a successful
			// reclaim makes it obsolete.
			if (preLockRecoveryRecord) {
				removePreLockRecoveryRecord(preLockRecoveryRecord.refundPubkey)
			}

			await host.refresh()
		} catch (err) {
			const attempts = (pendingToken.reclaimAttempts ?? 0) + 1
			const permanent = isPermanentReclaimFailure(err)
			const reason = err instanceof Error ? err.message : String(err)
			const pendingTokens = host.getPendingTokens().map((t) =>
				t.id === tokenId
					? {
							...t,
							reclaimAttempts: attempts,
							lastReclaimAttemptAt: now,
							reclaimFailureReason: reason,
							// Manual retry resets the "permanent" flag so the user can try again.
							reclaimPermanentlyFailed: options?.manual ? false : permanent || t.reclaimPermanentlyFailed,
						}
					: t,
			)
			host.setPendingTokens(pendingTokens)

			console.error('[nip60] Failed to reclaim token:', err)
			throw err
		}
	}

	/**
	 * Silently reclaim every pending auction bid whose P2PK timelock has expired. Throttled to
	 * at most one sweep per AUCTION_AUTO_RECLAIM_MIN_INTERVAL_MS and skips tokens that are in
	 * cooldown or marked permanently-failed, so a bad token can't loop the bid flow into 429s
	 * from the mint.
	 */
	const autoReclaimTimelockedBids = async (): Promise<void> => {
		const wallet = host.getWallet()
		if (!wallet || !host.isWalletReady()) return

		const nowMs = Date.now()
		if (nowMs - lastSweepMs < AUCTION_AUTO_RECLAIM_MIN_INTERVAL_MS) return
		lastSweepMs = nowMs

		const now = Math.floor(nowMs / 1000)
		const candidates = host.getPendingTokens().filter((token) => {
			if (token.status !== 'pending') return false
			if (token.reclaimPermanentlyFailed) return false
			const context = resolveAuctionBidPendingContext(token)
			if (!context) return false
			if (getAuctionReclaimReadyAt(token.token, context.locktime) > now) return false
			// Exponential backoff per token so a transient mint error doesn't turn into a tight
			// retry loop.
			const cooldown = getReclaimBackoffSeconds(token.reclaimAttempts ?? 0)
			const last = token.lastReclaimAttemptAt ?? 0
			return now - last >= cooldown
		})

		for (const token of candidates) {
			try {
				await reclaimToken(token.id)
			} catch (err) {
				console.warn(`[nip60] Auto-reclaim skipped for token ${token.id}:`, err instanceof Error ? err.message : err)
			}
		}
	}

	return { reclaimToken, autoReclaimTimelockedBids }
}

// ============================================================================
// The P2PK lock — locking a bid's funds to the auction's path-oracle pubkey
// ============================================================================

/**
 * The auction P2PK key scheme. Kept as a named alias because the value keys the bidder
 * record and the lock result; the lock only ever uses `hd_p2pk`.
 */
export type AuctionP2pkKeyScheme = 'hd_p2pk'

export interface LockAuctionBidFundsParams {
	amount: number
	/**
	 * Single mint URL — kept for backwards compatibility with non-auction
	 * callers (e.g. legacy lock flows). If both `mint` and
	 * `preferredMints` are provided, `mint` wins (interpreted as an
	 * explicit override). Most call sites should pass `preferredMints`.
	 */
	mint?: string
	/**
	 * Ordered list of trusted mints (seller-declared). Walked in order;
	 * the first mint where the bidder's wallet has at least `amount`
	 * sats is used. When omitted, falls back to the wallet's default
	 * mint or any mint with sufficient balance.
	 */
	preferredMints?: string[]
	locktime: number
	refundPubkey: string
	/**
	 * Child pubkey (compressed secp256k1 hex) issued by the auction's path
	 * oracle. This is the 1-of-1 P2PK spend key on the resulting locked
	 * Cashu proofs. The bidder MUST have already verified (via
	 * verifyAuctionPathGrant) that this pubkey was derived from the
	 * auction's p2pk_xpub before calling lockAuctionBidFunds.
	 */
	lockPubkey: string
	auctionEventId?: string
	auctionCoordinates?: string
	sellerPubkey?: string
	pathIssuerPubkey?: string
	derivationPath?: string
	childPubkey?: string
	grantId?: string
}

export interface LockAuctionBidFundsResult {
	tokenId: string
	token: string
	/**
	 * The locked Cashu proofs themselves — same set the encoded `token`
	 * holds, exposed as the structured proof array so callers don't have
	 * to re-decode (which fails on v2 short keyset IDs without a mint
	 * keyset map). Callers that need the proof's `secret` / `Y` lookup
	 * should read these directly.
	 */
	proofs: Proof[]
	amount: number
	mintUrl: string
	lockPubkey: string
	locktime: number
	refundPubkey: string
	commitment: string
	keyScheme: AuctionP2pkKeyScheme
	derivationPath?: string
	childPubkey?: string
	grantId?: string
}

/**
 * The wallet the lock spends from: the receive source plus the wallet-event publish the lock
 * performs after the swap (best-effort, exactly as the store did).
 */
export interface AuctionLockWallet extends AuctionFundsWallet {
	publish(): Promise<unknown>
}

/**
 * What the lock needs from the store it came from. Every member is a read or write the store
 * already performs; none of it is the relay wallet class.
 *
 * Pending tokens stay an injected port (`setPendingTokens`) rather than moving to a wallet-local
 * store: it is the smallest diff, and the store still owns the read side and the
 * `nip60_pending_tokens` key (`platform/` reads auction pending tokens through the store seam).
 * The `strict` flag carries the lock's fail-closed write across the seam.
 */
export interface AuctionLockHost {
	/** The wallet to lock from, or null when there is none. */
	getWallet(): AuctionLockWallet | null
	/** Whether the wallet is ready — the lock's precondition. */
	isWalletReady(): boolean
	/** Mint/keyset access for the swap. */
	mint: AuctionFundsMintAccess
	/** Wallet balances for mint selection (the store's `getBalancesFromState`). */
	getBalances(): { totalBalance: number; mintBalances: Record<string, number> }
	/** The wallet's default mint, or null. */
	getDefaultMint(): string | null
	/** The current pending tokens. */
	getPendingTokens(): PendingToken[]
	/**
	 * Persist and publish a new pending-token list. `strict` fail-closes on a storage error —
	 * the lock's post-swap durable-observation write depends on it (see the lock body).
	 */
	setPendingTokens(tokens: PendingToken[], options?: { strict?: boolean }): void
	/** Update the store's balance/mints view after the swap reconcile. */
	setWalletBalances(update: { balance: number; mintBalances: Record<string, number> }): void
}

export interface AuctionLock {
	lockAuctionBidFunds(params: LockAuctionBidFundsParams): Promise<LockAuctionBidFundsResult>
}

// ---------- module-local helpers (byte-identical to the store's) ----------
//
// The store keeps its own copies for its other actions (sendEcash, refresh). Duplicating the
// few pure helpers here keeps this module free of the store, in the same spirit as the
// `normalizeMintUrl` copy above.

/** Store `generateId`: time + 7 base-36 chars. */
const generateId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

/** Store `toHex`. */
const toHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')

/** Store `sha256Hex` — the pending-token commitment; empty when SubtleCrypto is absent. */
const sha256Hex = async (value: string): Promise<string> => {
	if (!globalThis.crypto?.subtle) {
		return ''
	}
	const encoded = new TextEncoder().encode(value)
	const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded)
	return toHex(new Uint8Array(digest))
}

/**
 * Store `selectProofs` — smallest-first selection. Byte-identical: the lock's mint selection
 * and error messages depend on which proofs it picks.
 */
const selectProofs = (proofs: Proof[], amount: number): { selected: Proof[]; total: number } => {
	const sorted = [...proofs].sort((a, b) => a.amount - b.amount)
	const selected: Proof[] = []
	let total = 0

	for (const proof of sorted) {
		if (total >= amount) break
		selected.push(proof)
		total += proof.amount
	}

	return { selected, total }
}

/** Store `getProofsTotal`. */
const getProofsTotal = (proofs: Proof[]): number => proofs.reduce((sum, proof) => sum + proof.amount, 0)

/**
 * Store `lockAuctionBidProofs` — the swap that mints fresh NUT-11 P2PK outputs. The P2PK
 * secret construction (lock pubkey, locktime, refund key) is exactly the store's.
 */
const lockAuctionBidProofs = async (
	cashuWallet: CashuWallet,
	amount: number,
	proofs: Proof[],
	params: {
		lockPubkey: string
		locktime: number
		refundPubkey: string
	},
) => {
	// No input-side DLEQ filtering. The mint consumes whatever inputs are
	// selected and issues freshly locked P2PK proofs.
	if (getProofsTotal(proofs) < amount) {
		throw new Error('Not enough funds available to send')
	}

	// cashu-ts 2.9 `send()` ignores `p2pk` when existing proofs exactly
	// satisfy the amount. Use `swap()` so every auction bid always receives
	// freshly minted NUT-11 P2PK proofs.
	return cashuWallet.swap(amount, proofs, {
		p2pk: {
			pubkey: params.lockPubkey,
			locktime: params.locktime,
			refundKeys: [params.refundPubkey],
		},
	})
}

/**
 * Store `assertAuctionBidProofsLockedToP2pk` — the post-swap check that the mint returned
 * proofs locked to the requested pubkey. The error strings are the store's, unchanged.
 */
const assertAuctionBidProofsLockedToP2pk = (proofs: Proof[], expectedLockPubkey: string): void => {
	for (const proof of proofs) {
		let proofLockPubkey: string
		try {
			proofLockPubkey = toCompressedAuctionP2pkPubkey(getAuctionP2pkLockPubkeyFromSecret(proof.secret))
		} catch (error) {
			throw new Error(`Mint returned an unlocked auction bid proof: ${error instanceof Error ? error.message : String(error)}`)
		}
		if (proofLockPubkey !== expectedLockPubkey) {
			throw new Error('Mint returned an auction bid proof locked to the wrong P2PK pubkey')
		}
	}
}

/**
 * #1235 round-3 B1 — the mint boundary is irreversible.
 *
 * Thrown by `lockAuctionBidFunds` for any failure that occurs once the lock
 * flow may have sent a swap/lock request to the mint: the mint may have
 * consumed the bidder's input proofs and/or issued P2PK-locked proofs. The
 * outcome is UNCERTAIN — callers must NOT retry the lock in-session (a retry
 * could double-consume inputs) and must NOT claim the leg is either locked
 * or untouched. Recovery material (the pre-lock recovery record holding the
 * refund private key) is persisted by the publish layer BEFORE the call that
 * can throw this class; the wallet's pending-token record, when the swap
 * response was processed, makes the leg reclaimable after the refund
 * timelock opens.
 *
 * Conservative by design: errors from wallet creation or DLEQ-filter
 * insufficiency INSIDE the swap phase are also classified mutation-possible
 * (fail closed — a classification refinement inside the lock is deliberately
 * not taken; see the round-3 plan's risk notes). Pre-lock validation errors
 * (amount / wallet readiness / balance / proof selection) are thrown raw
 * BEFORE any request could have been sent and are provably pre-mint.
 */
export class AuctionBidLockMutationPossibleError extends Error {
	/** Mint the swap/lock request may have been sent to. */
	public readonly mintUrl: string
	/** Amount (sats) the leg attempted to lock. */
	public readonly amount: number
	/** P2PK pubkey the proofs were to be locked to. */
	public readonly lockPubkey: string
	/** Refund pubkey for the lock's refund branch. */
	public readonly refundPubkey: string
	/** Cashu locktime (unix seconds) the leg attempted. */
	public readonly locktime: number
	/**
	 * #1235 round-3 fix 5 (felixfelix #11) — whether the wallet's STRICT
	 * pending-token save had already succeeded when the failure escaped.
	 * When false the leg is record-only: the wallet holds no durable
	 * observation of the mint-issued proofs, so an in-app reclaim is NOT
	 * promised. Honest default: false.
	 */
	public readonly pendingTokenPersisted: boolean
	/** The underlying failure. */
	public override readonly cause: unknown

	constructor(params: {
		mintUrl: string
		amount: number
		lockPubkey: string
		refundPubkey: string
		locktime: number
		cause: unknown
		pendingTokenPersisted?: boolean
	}) {
		const causeMessage = params.cause instanceof Error ? params.cause.message : String(params.cause)
		super(
			`Auction bid lock outcome is uncertain: a swap/lock request may already have been sent to ${params.mintUrl} ` +
				`for ${params.amount} sats (${causeMessage}). The mint may or may not have issued locked proofs — do NOT retry the lock; ` +
				'reclaim may be possible after the refund timelock opens.',
		)
		this.name = 'AuctionBidLockMutationPossibleError'
		this.mintUrl = params.mintUrl
		this.amount = params.amount
		this.lockPubkey = params.lockPubkey
		this.refundPubkey = params.refundPubkey
		this.locktime = params.locktime
		this.pendingTokenPersisted = params.pendingTokenPersisted ?? false
		this.cause = params.cause
	}
}

/**
 * The P2PK lock — `nip60Actions.lockAuctionBidFunds` moved out of the store behind
 * {@link AuctionLockHost}.
 *
 * This is money handling, so the body is the store's, unchanged: the same amount / wallet /
 * locktime / pubkey validation, the same four-step mint-resolution order, the same
 * `lockAuctionBidProofs` swap (1-of-1 P2PK with locktime and refund key), the same STRICT
 * pending-token persist BEFORE the post-swap P2PK assert and DLEQ check, the same synchronous
 * wallet-state reconcile with `destroy:` of the spent inputs, and the same error semantics
 * (pre-mint validation raw; anything after the swap wrapped in
 * {@link AuctionBidLockMutationPossibleError} with the durable-observation flag).
 */
export const createAuctionLock = (host: AuctionLockHost): AuctionLock => ({
	lockAuctionBidFunds: async (params: LockAuctionBidFundsParams): Promise<LockAuctionBidFundsResult> => {
		const amount = Math.floor(params.amount)
		if (!Number.isFinite(amount) || amount < AUCTION_MIN_BID_LEG_SATS) {
			throw new Error(`Bid lock amount must be at least ${AUCTION_MIN_BID_LEG_SATS} sats`)
		}

		const wallet = host.getWallet()
		if (!wallet || !host.isWalletReady()) {
			throw new Error('NIP-60 wallet not ready')
		}

		const keyScheme: AuctionP2pkKeyScheme = 'hd_p2pk'
		const locktime = Math.floor(params.locktime)
		if (!Number.isFinite(locktime) || locktime <= 0) {
			throw new Error('Invalid bid locktime')
		}

		const rawRefundPubkey = params.refundPubkey?.trim()
		if (!rawRefundPubkey) {
			throw new Error('Refund pubkey is required')
		}
		let refundPubkey: string
		try {
			refundPubkey = toCompressedAuctionP2pkPubkey(rawRefundPubkey)
		} catch (error) {
			throw new Error(`Refund pubkey is invalid: ${error instanceof Error ? error.message : String(error)}`)
		}

		const rawLockPubkey = params.lockPubkey?.trim()
		if (!rawLockPubkey) {
			throw new Error('Lock pubkey is required — the bidder must obtain a path grant before locking')
		}
		let lockPubkey: string
		try {
			lockPubkey = toCompressedAuctionP2pkPubkey(rawLockPubkey)
		} catch (error) {
			throw new Error(`Lock pubkey is invalid: ${error instanceof Error ? error.message : String(error)}`)
		}

		// Mint selection order (AUCTIONS.md §4.1 + bid flow):
		//   1. `params.mint` explicit override — legacy callers only.
		//   2. `params.preferredMints` in order — auction's trusted mints
		//      walked seller-declared first; pick the first one where the
		//      bidder has enough balance for `amount` (delta).
		//   3. wallet's `defaultMint` — only when no preferred list given.
		//   4. any mint in the wallet with enough balance — last resort.
		// Falling through all four with no match yields a clear error
		// listing per-trusted-mint balances so the bidder knows where
		// to top up.
		const { totalBalance, mintBalances } = host.getBalances()
		const defaultMint = host.getDefaultMint()
		let targetMint: string | undefined
		if (params.mint) {
			targetMint = params.mint
		} else if (params.preferredMints && params.preferredMints.length > 0) {
			targetMint = params.preferredMints.find((mint) => (mintBalances[mint] ?? 0) >= amount)
			if (!targetMint) {
				const breakdown = params.preferredMints.map((mint) => `${getMintHostname(mint)}: ${mintBalances[mint] ?? 0} sats`).join(', ')
				throw new Error(
					`No trusted mint has ${amount} sats. ${breakdown}. Deposit to one of the auction's trusted mints (or move existing funds there) and try again.`,
				)
			}
		} else if (defaultMint && (mintBalances[defaultMint] ?? 0) >= amount) {
			targetMint = defaultMint
		} else {
			targetMint = Object.keys(mintBalances).find((mint) => mintBalances[mint] >= amount)
		}
		if (!targetMint) {
			throw new Error(`No mint with sufficient balance. Available: ${totalBalance} sats`)
		}

		const mintBalance = mintBalances[targetMint] ?? 0
		if (mintBalance < amount) {
			throw new Error(`Insufficient balance at ${getMintHostname(targetMint)}. Available: ${mintBalance} sats`)
		}

		const mintProofs = getSpendableProofsForMint(wallet, targetMint)
		if (mintProofs.length === 0) {
			throw new Error(`No proofs available at ${getMintHostname(targetMint)}. Try refreshing your wallet.`)
		}

		const { selected: selectedProofs, total: selectedTotal } = selectProofs(mintProofs, amount)
		if (selectedTotal < amount) {
			throw new Error(`Could not select enough proofs. Need ${amount}, have ${selectedTotal}`)
		}

		// #1235 round-3 fix 5 (felixfelix #11) — whether the wallet durably
		// observed the mint-issued proofs (the STRICT pending-token save below
		// succeeded) before any later failure escaped. Read by the catch below
		// and threaded onto AuctionBidLockMutationPossibleError: without the
		// pending token the leg is record-only and an in-app reclaim must not
		// be promised.
		let pendingTokenPersisted = false

		try {
			const { cashuWallet } = await host.mint.cashuWalletForMint(targetMint)

			let lockedProofs: Proof[] = []
			let changeProofs: Proof[] = []

			// 1-of-1 P2PK lock. The seller alone cannot spend pre-locktime because
			// the derivation path that produced `lockPubkey` is held secret by the
			// auction's path oracle — see AUCTIONS.md §5.2.
			// ADR-0011 Blocker 2: the DLEQ security property lives on the NEWLY
			// ISSUED P2PK swap outputs, not on the input proofs. `lockAuctionBidProofs`
			// swaps ALL eligible inputs (no input DLEQ filter) and we validate the
			// output proofs' DLEQ below. `requireDleqOnOutput` is unconditional:
			// DLEQ is required for every auction bid.
			const result = await lockAuctionBidProofs(cashuWallet, amount, selectedProofs, {
				lockPubkey,
				locktime,
				refundPubkey,
			})
			lockedProofs = result.send
			changeProofs = result.keep

			if (!lockedProofs.length) {
				throw new Error('Mint returned no locked proofs for bid')
			}

			// ADR-0011 Blocker 2: validate the freshly issued outputs' security
			// properties — P2PK lock pubkey (already done by
			// assertAuctionBidProofsLockedToP2pk below) AND, for DLEQ-required
			// auctions, a DLEQ proof on each output. Validation stays AFTER the
			// swap so a bad output is still reclaim-eligible (the pending-token
			// record, persisted below, is the wallet's durable observation).
			// When the auction requires DLEQ, every locked output proof MUST carry
			// a NUT-12 DLEQ proof — the publisher cannot build verifiable
			// `dleq_proof` tags otherwise. Fail closed (buildDleqProofs throws on
			// a missing DLEQ proof), but do this AFTER the strict pending-token
			// persist so a check failure leaves a reclaim-eligible leg.
			const requireDleqOnOutput = true

			const token = getEncodedToken({
				mint: targetMint,
				proofs: lockedProofs,
			})
			const tokenAmount = lockedProofs.reduce((sum, proof) => sum + proof.amount, 0)
			const tokenId = generateId()
			const pendingContext: AuctionBidPendingTokenContext | undefined =
				params.auctionEventId && params.sellerPubkey
					? {
							kind: 'auction_bid',
							auctionEventId: params.auctionEventId,
							auctionCoordinates: params.auctionCoordinates,
							sellerPubkey: params.sellerPubkey,
							pathIssuerPubkey: params.pathIssuerPubkey || '',
							lockPubkey,
							refundPubkey,
							locktime,
							derivationPath: params.derivationPath,
							childPubkey: params.childPubkey,
							grantId: params.grantId,
						}
					: undefined

			const pendingToken: PendingToken = {
				id: tokenId,
				token,
				amount: tokenAmount,
				mintUrl: targetMint,
				createdAt: Date.now(),
				status: 'pending',
				...(pendingContext ? { context: pendingContext } : {}),
			}
			const pendingTokens = [...host.getPendingTokens(), pendingToken]
			// #1235 round-3 B1 — STRICT + BEFORE the post-lock assert: the swap
			// above already ran, so the mint may have issued locked proofs. The
			// pending-token record is the wallet's durable observation of those
			// proofs — it must be durably persisted (fail-closed: a storage
			// failure here surfaces as mutation-possible) BEFORE the first
			// fallible post-swap check (the P2PK-lock assert below) can throw.
			// With the record on disk, a leg whose proofs turn out to be locked
			// to the wrong key is still reclaim-eligible after the refund
			// timelock instead of silently stranded.
			host.setPendingTokens(pendingTokens, { strict: true })
			// #1235 round-3 fix 5: the STRICT save succeeded — from here on, any
			// escaping failure leaves a leg the wallet CAN observe (and reclaim
			// after the refund timelock).
			pendingTokenPersisted = true

			assertAuctionBidProofsLockedToP2pk(lockedProofs, lockPubkey)

			// ADR-0011 Blocker 2 — validate the freshly issued P2PK swap outputs'
			// DLEQ property when the auction requires it. Fail-closed and AFTER
			// the durable pending-token persist, so a leg whose outputs fail the
			// P2PK or DLEQ check is still reclaim-eligible (the pending token is
			// the wallet's durable observation).
			if (requireDleqOnOutput) {
				// A DLEQ-required lock must emit NUT-12 DLEQ proofs on its
				// freshly issued P2PK outputs — the bid publisher cannot build
				// verifiable `dleq_proof` tags otherwise. Fail closed via
				// buildDleqProofs (which throws on any proof lacking a DLEQ
				// proof), inside the post-swap durable path.
				buildDleqProofs(lockedProofs)
			}

			// Apply the wallet-state delta SYNCHRONOUSLY before returning so
			// the balance UI doesn't briefly double-count the consumed
			// inputs. The mint already burned `selectedProofs` during the
			// swap, so we MUST pass them as `destroy:` — otherwise local
			// state retains them alongside the new `changeProofs` and the
			// displayed balance over-reports by `selectedTotal - amount`.
			// (The previous version offloaded this to a void-async block
			// + NUT-7 consolidation, which races the UI: refresh before
			// consolidation lands and you see the inflated number.)
			try {
				await wallet.state.update({
					mint: targetMint,
					store: changeProofs,
					destroy: selectedProofs,
				})
				// Persist the wallet event to Nostr so the token event
				// references are current. Without this, a page refresh
				// reloads the stale wallet event whose e-tags still
				// point at old token events containing spent proofs.
				try {
					await wallet.publish()
				} catch (publishErr) {
					console.error('[nip60] Failed to publish wallet after bid lock (non-fatal):', publishErr)
				}
				// Synchronously re-read balance from wallet.state into the
				// store so the UI updates immediately (avoids a stale
				// inflated display until the async consolidation lands).
				const { totalBalance, mintBalances } = host.getBalances()
				host.setWalletBalances({ balance: totalBalance, mintBalances })
			} catch (stateErr) {
				console.error('[nip60] Failed to reconcile wallet state after bid lock (non-fatal):', stateErr)
			}

			// Note: we used to also kick off `consolidateProofs()` here
			// in a void async block. That's no longer needed — `destroy:
			// selectedProofs` above already removes the spent proofs
			// locally, so we don't have to NUT-7-check them to discover
			// they're spent. Removing the consolidate eliminates a per-
			// bid mint round-trip (and the CORS / 429 noise it produced
			// against testnut).

			const commitment = await sha256Hex(token)

			return {
				tokenId,
				token,
				proofs: lockedProofs,
				amount: tokenAmount,
				mintUrl: targetMint,
				lockPubkey,
				locktime,
				refundPubkey,
				commitment,
				keyScheme,
				derivationPath: params.derivationPath,
				childPubkey: params.childPubkey || lockPubkey,
				grantId: params.grantId,
			}
		} catch (err) {
			console.error('[nip60] Failed to lock auction bid funds:', err)
			// #1235 round-3 B1 — conservative mutation-possible wrap. Everything
			// this catch can see escaped from the post-selection try above:
			// wallet creation, the swap attempts, or the post-swap local work. A
			// swap request may already have been sent — fail closed and classify
			// the outcome as mutation-possible unless it already is. Pre-try
			// validation errors (amount / wallet readiness / balance / proof
			// selection) never reach this catch and stay raw (provably pre-mint).
			if (err instanceof AuctionBidLockMutationPossibleError) throw err
			throw new AuctionBidLockMutationPossibleError({
				mintUrl: targetMint,
				amount,
				lockPubkey,
				refundPubkey,
				locktime,
				cause: err,
				// #1235 round-3 fix 5 (felixfelix #11): thread the durable-observation
				// flag through — the post-lock copy above decides between honest
				// reclaim guidance (persisted) and honest record-only guidance
				// (never persisted). Honest default false (never claims a reclaim
				// the wallet cannot perform).
				pendingTokenPersisted,
			})
		}
	},
})

// ============================================================================
// The settlement receipt and the keyset/transfer helpers
// ============================================================================

/**
 * What the P2PK settlement receipt needs: the wallet to swap into, the mint access for the
 * receive, and the post-receive refresh.
 */
export interface AuctionReceiveHost {
	getWallet(): AuctionFundsWallet | null
	mint: AuctionFundsMintAccess
	refresh(): Promise<void>
}

export interface AuctionReceipt {
	receiveLockedEcash(token: string, privkey: string, mintUrl?: string): Promise<boolean>
}

/**
 * `nip60Actions.receiveLockedEcash` moved out of the store. Thin orchestration over the
 * already-extracted {@link receiveTokenWithPrivkey}: warn + false when there is no wallet,
 * receive with the caller's key, refresh, and rethrow on failure.
 */
export const createAuctionReceipt = (host: AuctionReceiveHost): AuctionReceipt => ({
	receiveLockedEcash: async (token: string, privkey: string, mintUrl?: string): Promise<boolean> => {
		const wallet = host.getWallet()
		if (!wallet) {
			console.warn('[nip60] Cannot receive locked ecash without wallet')
			return false
		}

		try {
			await receiveTokenWithPrivkey({ wallet, mint: host.mint, token, privkey, mintUrl })
			await host.refresh()
			return true
		} catch (err) {
			console.error('[nip60] Failed to receive locked ecash:', err)
			throw err
		}
	},
})

/**
 * `nip60Actions.loadAuctionMintKeysets` moved out of the store. Returns an empty array on
 * failure — callers treat that as "decode without keysets".
 */
export const loadAuctionMintKeysets = async (mint: AuctionFundsMintAccess, mintUrl: string): Promise<MintKeyset[]> => {
	try {
		const { cashuWallet } = await mint.cashuWalletForMint(mintUrl)
		return cashuWallet.keysets
	} catch (err) {
		console.warn(`[nip60] loadAuctionMintKeysets failed for ${getMintHostname(mintUrl)}:`, err)
		return []
	}
}
