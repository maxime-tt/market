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
 * 30408 publish binding: that path funds a Cashu lock, and this one does not.
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
	// The arena bid this slice publishes carries no funding payload; the wallet
	// is required because a bid is a signed event and the signer lives with the
	// session (`getActiveSignerCapability`). `ready` therefore means "a signer is
	// available", not "funds are locked" — the panel's advisory says no funds move.
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
		try {
			const capability = getActiveSignerCapability()
			const pubkey = bidder.pubkey
			if (capability === null || pubkey === null) {
				setSubmission({ phase: 'failed', amount: check?.amount ?? 0, reason: 'No signer is available.' })
				return
			}
			const relays = [...webRelayPolicy('query')]
			const io = createWebNostrIo()
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
					now: Math.floor(Date.now() / 1000),
				},
			)
			setSubmission(result.state)
			onPublished?.(result.eventId)
		} catch (error) {
			setSubmission(submissionFromError(error, check?.amount ?? 0))
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
