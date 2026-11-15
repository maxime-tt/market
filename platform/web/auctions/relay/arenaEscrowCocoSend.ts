/**
 * `platform/web/auctions/relay/arenaEscrowCocoSend.ts` — Coco's send API,
 * adapted to the escrow send port `arenaBidEscrow` declares.
 *
 * ## Why this exists
 *
 * `arenaBidEscrow.ArenaEscrowSendManager` is a three-phase port
 * (`init` → `prepare` → `execute`) whose `init` takes the P2PK options
 * separately. The installed Coco (`@cashu/coco-core`) does not have that shape:
 * its `ops.send.prepare({ mintUrl, amount, target })` creates the operation
 * **and** reserves the inputs in one call, and the lock is expressed as the
 * send target `{ type: 'p2pk', options }`. Handing a `Manager` straight to
 * `lockArenaEscrowWithCoco` therefore type-checks only behind a cast and then
 * fails at runtime on `manager.ops.send.init` — there is no such method.
 *
 * This module is the honest mapping between the two, and nothing else:
 *
 * | port            | Coco                                                |
 * | --------------- | --------------------------------------------------- |
 * | `mint.addMint`  | `mint.addMint(mintUrl, options)`                     |
 * | `send.init`     | `ops.send.prepare({ mintUrl, amount, target })`      |
 * | `send.prepare`  | identity — Coco already reserved the inputs          |
 * | `send.execute`  | `ops.send.execute(preparedId)` → `{ token }`         |
 *
 * The P2PK conditions travel untouched: `buildArenaEscrowLockOptions` output is
 * exactly the `options` Coco's `p2pk` send method accepts, so the lock the mint
 * writes is the one `arenaBidFunding` parses (five tags, canonical order,
 * `n_sigs = 2`, `SIG_ALL`).
 *
 * It performs no I/O of its own, owns no state, and adds no retry: it is a
 * shape adapter over the one wallet the app already holds.
 */
import type { Manager } from '@cashu/coco-core'
import type { ArenaEscrowSendManager } from '@platform/web/auctions/relay/arenaBidEscrow'

/**
 * Bind the escrow send port to a live Coco `Manager`.
 *
 * The returned object must only be used for a single bid's lock: `send.prepare`
 * is the identity here, so the three-phase order is preserved by the caller
 * (`lockArenaEscrowWithCoco`), not by this adapter.
 */
export function arenaEscrowSendOverCoco(manager: Manager): ArenaEscrowSendManager {
	return {
		mint: {
			addMint: (mintUrl, options) => manager.mint.addMint(mintUrl, options),
		},
		ops: {
			send: {
				// Coco has no separate "init, then prepare" pair: `prepare` selects
				// and reserves the proofs and computes the P2PK outputs. That IS the
				// instruction to the mint, so it is what the port's `init` maps to.
				init: async (mintUrl, amount, request) => {
					// cashu-ts types `kind` as `'P2PK' | 'HTLC'`; Coco's p2pk target
					// accepts only `'P2PK'`. Narrowing (never casting) keeps an HTLC
					// condition from being sent as an escrow lock.
					const { options } = request.methodData
					if (options.kind !== 'P2PK') throw new Error('the escrow lock must be a P2PK condition')
					const prepared = await manager.ops.send.prepare({
						mintUrl,
						amount,
						target: { type: 'p2pk', options: { ...options, kind: 'P2PK' } },
					})
					return { id: prepared.id }
				},
				prepare: async (operation) => operation,
				execute: async (prepared) => {
					const { token } = await manager.ops.send.execute(prepared.id)
					return { token: { proofs: token.proofs } }
				},
			},
		},
	}
}