/**
 * `CreateAcceptancePanel.tsx` — what the create form shows after the relays took
 * the signed create: the **chain's** answer, step by step.
 *
 * ## Why the form cannot just navigate
 *
 * A relay ACK is storage. The chain accepts a create by publishing its own
 * create-admission fact (`arena.createadmit.v1`, kind 1449), and only then does
 * the app follow the lot at all (`arenaAuctionRead.ts` `isFollowedAuction`). A
 * form that navigated on the ACK would send the seller to a lot the app does not
 * follow, or leave them believing a create the chain refused is live. So the
 * form holds what the publish reported and lets this panel keep reading.
 *
 * ## What it reads, and how often
 *
 * The lot's own read (`useArenaLotRead`: `arenaLotFilters`, lot-scoped, the same
 * shell the lot page uses), reopened while the chain has said nothing
 * ({@link CREATE_ACCEPTANCE_POLL_MS}). The transition is the pure
 * `nextCreateAcceptanceState` (`relay/arenaAuctionCreate.ts`), so "still reading"
 * is a fact about the read and never a guess: an absent fact is never rendered
 * as accepted, and never as refused.
 *
 * This file is an assembler: it owns the subscription and the button wiring, and
 * hands the `ui/` stepper plain state (`ui/AGENTS.md`).
 */

import { useEffect, useMemo, useReducer, useState } from 'react'
import { Button } from '@ui/primitives/button'
import {
	CreateAcceptanceStepper,
	createAcceptanceStepper,
	type ArenaCreateAcceptanceState,
	type ArenaCreatePublishedFacts,
} from '@ui/auction/arena/create-stepper'
import { useArenaLotRead } from '@platform/web/auctions/relay/ArenaAuctionLotHost'
import { resolveArenaLot } from '@platform/web/auctions/relay/arenaLotRead'
import { CREATE_ACCEPTANCE_POLL_MS, nextCreateAcceptanceState } from '@platform/web/auctions/relay/arenaAuctionCreate'

/** One published create, as the publish path reported it, plus the address of its lot. */
export interface PublishedAuctionCreate extends ArenaCreatePublishedFacts {
	/** The create's `d` tag — the lot's address within its seller. */
	d: string
	/** The seller (the create's signer) — the `?seller=` half of the lot address. */
	seller: string
}

export interface CreateAcceptancePanelProps {
	/** The create the relays stored, and the address to watch. */
	create: PublishedAuctionCreate
	/** The seller's "show me the lot" click, offered once the chain has accepted. */
	onOpenListing: () => void
	/** The seller's "leave this" click — always available, so a wait never traps them. */
	onBack: () => void
}

export function CreateAcceptancePanel({ create, onOpenListing, onBack }: CreateAcceptancePanelProps) {
	const [refreshKey, bumpRefresh] = useReducer((key: number) => key + 1, 0)
	// The lot's own read, the same shell the lot page uses (`/auctions/<d>?seller=`).
	const read = useArenaLotRead({ d: create.d, seller: create.seller, refreshKey })
	const [state, setState] = useState<ArenaCreateAcceptanceState>(() => ({
		phase: 'published',
		eventId: create.eventId,
		coordinate: create.coordinate,
		acceptedBy: create.acceptedBy,
		totalRelays: create.totalRelays,
	}))

	// The lot the read delivered, if any. `resolveArenaLot` is the route's own
	// resolver, so this panel cannot disagree with the lot page about which lot a
	// `d` names.
	const view = useMemo(() => {
		if (read.snapshot === null) return null
		const lookup = resolveArenaLot(read.snapshot, create.d, create.seller)
		return lookup.kind === 'found' ? lookup.view : null
	}, [read.snapshot, create.d, create.seller])

	useEffect(() => {
		setState((previous) => nextCreateAcceptanceState({ previous, view, createEventId: create.eventId }))
	}, [view, create.eventId])

	// Reopen the read while the chain has published neither fact: one read's
	// freshness decays by itself, and this panel may only say "still reading" for
	// as long as it is really reading.
	const concluded = state.phase === 'accepted' || state.phase === 'refused'
	useEffect(() => {
		if (concluded) return
		const id = setInterval(() => bumpRefresh(), CREATE_ACCEPTANCE_POLL_MS)
		return () => clearInterval(id)
	}, [concluded])

	const stepper = createAcceptanceStepper(state)

	return (
		<div className="flex flex-col gap-5" data-slot="arena-create-acceptance" data-phase={state.phase}>
			<div className="space-y-1">
				<h2 className="text-sm font-semibold text-text-high">The relays stored your listing</h2>
				<p className="text-xs text-text-mid">
					A relay accepting the signed event is storage, not a listing. This waits for the chain’s own create-admission fact
					(<span className="font-mono">arena.createadmit.v1</span>) — an auction the chain has not accepted is not listed.
				</p>
			</div>

			<CreateAcceptanceStepper stepper={stepper} />

			{state.phase === 'published' && (
				<p className="text-xs text-text-mid" data-testid="arena-create-still-reading">
					Still reading the relays for the chain’s word on this listing ({create.coordinate}). This is not an acceptance, and
					not a refusal: neither fact has arrived yet.
				</p>
			)}

			<div className="flex flex-wrap gap-2">
				{state.phase === 'accepted' && (
					<Button type="button" onClick={onOpenListing} data-testid="arena-create-open-listing">
						Open the listing
					</Button>
				)}
				<Button type="button" variant="secondary" onClick={onBack} data-testid="arena-create-back">
					Back to auctions
				</Button>
			</div>
		</div>
	)
}
