/**
 * `sdkNostrIo.test.ts` — the web host's read seam
 * (`platform/web/sdkNostrIo.ts`), over a relay pool the test drives itself.
 *
 * No socket, no relay (ADR-0005): the seam's one call on a pool is `req`, and
 * that call is injectable (`RelayRequestGroup`), so the case that matters —
 * **when a bounded read is allowed to end** — is deterministic.
 *
 * The measured defect this pins (2026-11-19, live): two of the seven configured
 * relays fail in milliseconds (`sendit.nosflare.com` NOTICE-denied,
 * `relay.damus.io` 503), and the SDK `query` path resolved the whole read as soon
 * as the first of them refused — ~15 ms in, with zero events, so
 * `selectNewestArenaParams` answered `params: null` and the bid was refused
 * "no anchored arena.params.v1 reading". A read over several relays must not end
 * because one of them settled.
 *
 * Timing is promise-driven, never a wall clock: the test tells the fake pool when
 * each relay speaks, and asserts the read's state between those answers.
 */
import { describe, expect, test } from 'bun:test'
import type { GroupReqMessage } from 'applesauce-relay'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import { Observable } from 'rxjs'
import type { EventStorePort } from '@sdk/core/event-store'
import type { Event } from '@sdk/core/nostr-io'
import type { RelayRequestGroup } from '@platform/web/applesauceIo'
import { readArenaParams } from '@platform/web/auctions/relay/arenaParamsRead'
import { createWebRelayReadContext } from '@platform/web/sdkNostrIo'

// ---------------------------------------------------------------------------
// The relay pool: `req` only, driven message by message.
// ---------------------------------------------------------------------------

/** The wire messages the seam reads: `type`, `from`, and (for EVENT) `event`. */
type WireMessage = { type: 'EVENT' | 'EOSE' | 'CLOSED' | 'ERROR' | 'OPEN'; from: string; event?: unknown; reason?: string; error?: unknown }

/** Built by this test; the seam only ever reads `type`/`from`/`event`/`reason`/`error`. */
const asGroupMessage = (message: WireMessage): GroupReqMessage => message as unknown as GroupReqMessage

/** A pool whose `req` hands the test a `speak` callback and subscribes on demand. */
function fakeGroup(): { group: RelayRequestGroup; speak: (message: WireMessage) => void } {
	const subscribers: Array<(message: GroupReqMessage) => void> = []
	return {
		group: {
			req: () =>
				new Observable<GroupReqMessage>((subscriber) => {
					subscribers.push((message) => subscriber.next(message))
					return () => {}
				}),
		},
		speak: (message) => {
			for (const subscriber of subscribers) subscriber(asGroupMessage(message))
		},
	}
}

// ---------------------------------------------------------------------------
// The store: in-memory, the port's whole surface, with an admission signal.
// ---------------------------------------------------------------------------

function memoryStore(admitted: (event: Event) => void): EventStorePort<Event> {
	const held = new Map<string, Event>()
	return {
		async add(event) {
			admitted(event)
			if (held.has(event.id)) return { status: 'duplicate' }
			held.set(event.id, event)
			return { status: 'added' }
		},
		async get(id) {
			return held.get(id)
		},
		async getReplaceable() {
			return undefined
		},
		async query() {
			return []
		},
		subscribe() {
			return () => {}
		},
		isDeleted() {
			return false
		},
	}
}

// ---------------------------------------------------------------------------
// The reading: one signed, anchored, on-roster kind-1448 event.
// ---------------------------------------------------------------------------

const SIGNER_SK = new Uint8Array(32).fill(23)
const SIGNER = getPublicKey(SIGNER_SK)

const PARAMS_EVENT = finalizeEvent(
	{
		kind: 1448,
		created_at: 1_795_091_000,
		tags: [
			['height', '3000'],
			['hash', 'b14bcdd68be8a35f9f5135ce37faceb7b8fc0601b9d984e0ce013324fd11dad7'],
			['p', SIGNER],
		],
		content: JSON.stringify({
			schema: 'arena.params.v1',
			height: 3000,
			app_hash: 'b14bcdd68be8a35f9f5135ce37faceb7b8fc0601b9d984e0ce013324fd11dad7',
			params_version: 'pv-3000',
			group_key: '03be47f12cc26f63cedb617ecc5dae10485aab91a63bd7ba808ae7c4f23e853da4',
			mint_url: 'http://127.0.0.1:3338',
			keyset_id: '0102b930f4dc2d6a8cb29b56e30d3e16436337859f54b77849ad1a1297be2880a1',
			validators: [{ pubkey: SIGNER, name: 'Validator 1', index: 1 }],
		}),
	},
	SIGNER_SK,
) as unknown as Event

const FOREIGN = 'wss://sendit.nosflare.com'
const CARRIER = 'wss://relay.playday.it'

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

describe('createWebRelayReadContext — a bounded read waits for every named relay', () => {
	test('a foreign relay settling early does not end the params read', async () => {
		const { group, speak } = fakeGroup()
		const context = createWebRelayReadContext(memoryStore(() => {}), [FOREIGN, CARRIER], { deadlineMs: 2000, group })

		// The foreign relay refuses the subscription; the relay that carries the
		// chain answers after it. Both are the same read.
		const read = readArenaParams({ context, deadlineMs: 2000 })
		speak({ type: 'ERROR', from: FOREIGN, error: new Error('restricted: not a public relay') })
		speak({ type: 'EVENT', from: CARRIER, event: PARAMS_EVENT })
		speak({ type: 'EOSE', from: CARRIER })

		const selection = await read
		expect(selection.params?.height).toBe(3000)
		expect(selection.params?.terms.mint_url).toBe('http://127.0.0.1:3338')
		expect(selection.refusals).toEqual([])
	})

	test('the read is still open after the foreign relay’s settle alone', async () => {
		const { group, speak } = fakeGroup()
		const admission = Promise.withResolvers<void>()
		const context = createWebRelayReadContext(memoryStore(() => admission.resolve()), [FOREIGN, CARRIER], { deadlineMs: 5000, group })

		let finished = false
		const read = readArenaParams({ context, deadlineMs: 5000 }).then((selection) => {
			finished = true
			return selection
		})

		// The foreign relay settles first: that is not an answer, so the read must
		// not end. The carrier then delivers, and the read is still open to take it.
		speak({ type: 'ERROR', from: FOREIGN, error: new Error('restricted: not a public relay') })
		speak({ type: 'EVENT', from: CARRIER, event: PARAMS_EVENT })
		const first = await Promise.race([admission.promise.then(() => 'admitted' as const), read.then(() => 'finished' as const)])
		expect(first).toBe('admitted')
		expect(finished).toBe(false)

		speak({ type: 'EOSE', from: CARRIER })
		expect((await read).params?.height).toBe(3000)
	})
})
