/**
 * `platform/web/auctions/relay/AuctionBidHost.tsx` — the platform binding for
 * the arena bid panel.
 *
 * It owns everything the props-only `@ui/auction/arena/bid-panel` may not:
 * the viewer identity, the ticking clock the end check needs, the typed amount,
 * and the publish. The panel receives a `check` and a `submission` state and
 * renders words; it never sees a relay, a signer or a promise
 * (`ui/AGENTS.md:118-120`).
 *
 * ## Where the relays come from
 *
 * The bid is offered to **`webRelayPolicy('query')`** — the same set
 * `useArenaSurfacesRead` subscribes to. That is deliberate: a bid published to
 * relays the read does not watch would be invisible to the very view that
 * placed it, and the "presumed → seen" upgrade would be unobtainable. In a
 * normal deployment the policy answers the same configured relays for reads and
 * writes; when it does not, the panel's "x of y relays" line is the honest
 * record of it, not a smoothed-over one.
 *
 * ## The signing seam
 *
 * Signing goes through the active signer capability
 * (`getActiveSignerCapability`, the same seam `platform/web/app-settings/*`
 * uses) on a signed bare event, and publishing through the SDK seam
 * (`createWebNostrIo().publish`, i.e. `sdk/core/nostr-io` via
 * `platform/web/sdkNostrIo.ts`, per `AGENTS.md:85-89`). Neither is the retired
 * 30408 publish binding.
 *
 * ## The escrow
 *
 * A bid on the consolidated protocol carries its money: proofs locked under a
 * 2-of-2 `[bidder, committee]` condition, plus a pre-signed settle and refund
 * template (`arenaBidFunding.ts`). This host obtains that payload before it
 * publishes anything: `assembleArenaBidFunding` (`arenaBidFund.ts`) reads the
 * committee key and mint from `GET /api/auctions/config`, takes the wallet spend
 * key from `walletOps.getAuctionBidWalletSigner()`, derives the locktime floor
 * from the lot's own `mode` / `endsAt` / `windowSec`, locks exactly the bid
 * amount through Coco (`lockArenaEscrowWithCoco`), and builds the two templates.
 * The result is passed to `publishArenaBid` as both `funding` and
 * `fundingTerms`, which re-checks it against the same terms before a signature
 * exists.
 *
 * Every way that assembly can fail — no committee key, no mint, no wallet spend
 * key, no Cashu wallet, a lot with no end or no mode or no seller wallet, a mint
 * that refuses the lock — is a **named refusal**, and the panel renders it as an
 * honest failure. Nothing is published, no key is invented, and the lock is
 * never retried: a mint that timed out may already have processed the swap, so a
 * second send would commit the bidder twice.
 *
 * ## Refencing the read after a bid
 *
 * The surfaces read is consumed to caught-up and then closed
 * (`auctionSurfacesRead.ts:256-262`). After a successful publish the host bumps
 * `refreshKey`, which tears the read down and opens it again, so "presumed"
 * becomes "seen" only when a relay really serves the bid — never because the
 * app assumed it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import type { Event } from '@sdk/core/nostr-io'
import { authStore, getActiveSignerCapability } from '@platform/web/auth/authStore'
import { createWebNostrIo, webRelayPolicy } from '@platform/web/sdkNostrIo'
import { createHttpPorts } from '@platform/web/auctions/protocol/httpPorts'
import type { ArenaBidFunding, ArenaBidFundingTerms } from '@platform/web/auctions/relay/arenaBidFunding'
import { arenaEscrowSendOverCoco } from '@platform/web/auctions/relay/arenaEscrowCocoSend'
import { ArenaBidFundError, assembleArenaBidFunding, type ArenaBidFundPorts } from '@platform/web/auctions/relay/arenaBidFund'
import { cashuStore } from '@platform/web/wallet/cashuStore'
import { walletOps } from '@platform/web/wallet/walletOps'
import { ArenaBidPanel, type ArenaBidSubmissionState } from '@ui/auction/arena/bid-panel'
import {
	arenaBidBlock,
	checkArenaBid,
	publishArenaBid,
	settleSubmissionFromRead,
	submissionFromError,
	type ArenaBidderState,
} from '@platform/web/auctions/relay/arenaBidPublish'
import type { ArenaAuctionDetailModel, ArenaSurfaceStatus } from '@ui/auction/arena/model'

/**
 * A submission that failed **after** the escrow was locked says so.
 *
 * The lock is not reversible and is not published anywhere, so the bidder's
 * funds sit at the mint until the lock's own refund path opens at `locktime`
 * (spec §4b). Presenting that as an ordinary "the bid failed" would hide the one
 * thing they need to know, and re-bidding the same amount would lock a second
 * escrow on top of the first.
 */
function withEscrowLockedNote(state: ArenaBidSubmissionState): ArenaBidSubmissionState {
	if (state.phase !== 'failed' && state.phase !== 'unpublished') return state
	return {
		...state,
		reason: `${state.reason} This bid's escrow is locked at the mint but the bid was not published, so those funds come back only through the lock's refund path after its locktime — do not bid the same amount again from this wallet.`,
	}
}

/**
 * The escrow ports, built from the app's own seams.
 *
 * The config read is per call, not cached: the committee key and the mint are
 * published by the auction backend and can change between bids, and a stale
 * committee key would lock the bidder's money to a key no validator holds.
 * `readWalletSigner` answers `null` until the one-time wallet-key migration has
 * produced the spend key, and `readEscrowManager` answers `null` until Coco is
 * ready — both are refusals, never substitutes.
 */
const arenaBidFundPorts: ArenaBidFundPorts = {
	readConfig: () => createHttpPorts({ apiBase: '/api/auctions' }).getConfig(),
	readWalletSigner: () => walletOps.getAuctionBidWalletSigner(),
	// The money moves through the one wallet the app already holds: Coco's own
	// `Manager`, bound to the escrow send port by `arenaEscrowSendOverCoco` (Coco
	// has no `init`, and its `prepare` takes the P2PK target — the adapter is that
	// mapping and nothing else).
	readEscrowManager: () => {
		const manager = cashuStore.state.manager
		return manager === null ? null : arenaEscrowSendOverCoco(manager)
	},
}

export interface AuctionBidHostProps {
	/** The auction as the read delivered it, or `null` when it has not been read. */
	model: ArenaAuctionDetailModel | null
	/** The read state that produced `model`. A partial read disables bidding. */
	readStatus: ArenaSurfaceStatus
	/** Unix seconds. The route already ticks a clock for the surfaces; pass the same one. */
	now: number
	/** Bumped by the route when it wants the panel to forget its last submission. */
	resetKey?: string | number
	className?: string
	/** Called after a bid reached at least one relay, so the route can re-read. */
	onPublished?: (eventId: string) => void
}

/** The viewer, from the auth session: identity and wallet readiness are separate facts. */
function useArenaBidder(): ArenaBidderState {
	const { isAuthenticated, user } = useStore(authStore)
	const pubkey = isAuthenticated ? (user?.pubkey ?? null) : null
	// `ready` means "a signer is available", not "funds are locked": the escrow
	// payload is assembled at submit time (`arenaBidFund.ts`) from this signer's
	// wallet, the wallet store's spend key and the committee's terms. A bidder
	// whose wallet has no spendable balance gets past this gate and is then
	// refused honestly by the lock (`fund.lock-failed`), because only the mint
	// knows what the wallet can actually cover.
	const wallet: ArenaBidderState['wallet'] = pubkey === null ? 'missing' : getActiveSignerCapability() !== null ? 'ready' : 'unavailable'
	return useMemo(() => ({ pubkey, wallet }), [pubkey, wallet])
}

export function AuctionBidHost({ model, readStatus, now, resetKey, className, onPublished }: AuctionBidHostProps) {
	const bidder = useArenaBidder()
	const [amountInput, setAmountInput] = useState('')
	const [pending, setPending] = useState(false)
	const [submission, setSubmission] = useState<ArenaBidSubmissionState>({ phase: 'idle' })

	useEffect(() => {
		setSubmission({ phase: 'idle' })
		setAmountInput('')
	}, [resetKey, model?.coordinate])

	// Pre-fill with the floor, the retired panel's behaviour: a bidder who types
	// is editing the minimum, not starting from a blank box.
	const blockedReason = arenaBidBlock(model, readStatus, now, bidder)
	const prefill = useMemo(() => {
		if (model === null) return ''
		const check = checkArenaBid({ model, status: readStatus, now, bidder, raw: '1' })
		return check.minimum !== null ? String(check.minimum) : ''
	}, [model, readStatus, now, bidder])

	const check = model !== null ? checkArenaBid({ model, status: readStatus, now, bidder, raw: amountInput === '' ? prefill : amountInput }) : null

	// A bid acknowledged by a relay becomes "seen" only when the read serves it.
	useEffect(() => {
		setSubmission((previous) => settleSubmissionFromRead(previous, model))
	}, [model])

	const onSubmit = useCallback(async () => {
		if (pending) return
		const raw = amountInput === '' ? prefill : amountInput
		setPending(true)
		setSubmission({ phase: 'publishing', amount: check?.amount ?? 0 })
		// Non-null once the escrow was actually locked: a failure after that point
		// means the bidder's money is committed at the mint, and the panel has to
		// say so (see `withEscrowLockedNote`).
		let funding: ArenaBidFunding | null = null
		let fundingTerms: ArenaBidFundingTerms | null = null
		try {
			const capability = getActiveSignerCapability()
			const pubkey = bidder.pubkey
			if (capability === null || pubkey === null) {
				setSubmission({ phase: 'failed', amount: check?.amount ?? 0, reason: 'No signer is available.' })
				return
			}
			const relays = [...webRelayPolicy('query')]
			const io = createWebNostrIo()
			// ONE clock reading for the locktime floor and for the event's
			// `created_at`, so the escrow is written against the same instant the
			// bid is published at. A second reading would let the two disagree.
			const nowSec = Math.floor(Date.now() / 1000)
			// The escrow first, and only for a bid the check has already allowed:
			// money is never locked for a bid that is about to be refused, and a
			// bid is never published without its escrow. `check.amount` is the same
			// parse `publishArenaBid` performs on `raw`, so the amount locked is
			// the amount the event names. When the check is not allowed — or names
			// no amount — the publish path's own refusal is the honest answer and
			// no lock is attempted.
			if (model !== null && check !== null && check.allowed && check.amount !== null) {
				const assembled = await assembleArenaBidFunding({ model, amount: check.amount, now: nowSec }, arenaBidFundPorts)
				funding = assembled.funding
				fundingTerms = assembled.fundingTerms
			}
			const result = await publishArenaBid(
				{ model, status: readStatus, bidder, raw },
				{
					signer: {
						pubkey,
						sign: async (template) => {
							const signature = await capability.signEvent({ ...template, pubkey })
							return signature as unknown as Event
						},
					},
					// `NostrIo` is never closed: it shares the app's pool (`sdkNostrIo.ts:18`).
					publisher: { publish: (event) => io.publish(event) },
					relays,
					now: nowSec,
					// The locked escrow and its two pre-signed templates, plus the
					// terms they were built against. `publishArenaBid` re-verifies
					// the payload against those terms before a signature exists.
					funding,
					fundingTerms,
				},
			)
			setSubmission(result.state)
			onPublished?.(result.eventId)
		} catch (error) {
			const failed = submissionFromError(error, check?.amount ?? 0)
			// An assembly refusal is thrown before any money moves; anything after
			// the lock is a different fact for the bidder, and it is said plainly.
			setSubmission(funding !== null && !(error instanceof ArenaBidFundError) ? withEscrowLockedNote(failed) : failed)
		} finally {
			setPending(false)
		}
	}, [amountInput, prefill, pending, check, model, readStatus, bidder, onPublished])

	return (
		<ArenaBidPanel
			model={model}
			readStatus={readStatus}
			check={check}
			blockedReason={blockedReason}
			amountInput={amountInput === '' ? prefill : amountInput}
			onAmountChange={setAmountInput}
			pending={pending}
			submission={submission}
			onSubmit={() => void onSubmit()}
			className={className}
		/>
	)
}
