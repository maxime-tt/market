/**
 * `platform/web/auctions/relay/arenaBidEscrow.ts` — the one money movement a
 * consolidated-protocol bid needs: a Cashu send locked under the 2-of-2 escrow.
 *
 * ## What it does, and what it refuses to do
 *
 * The lock is built by `cashu-ts` through Coco's `p2pk` send method, from
 * {@link buildArenaEscrowLockOptions}. It moves **only** the bid amount the
 * bidder named, into outputs locked to `[bidder, committee]` with `n_sigs = 2`,
 * `SIG_ALL`, and the bidder's own refund branch after the lot's locktime. There
 * is no other output and no other destination.
 *
 * It does **not** sign the bid (that is the Nostr identity's job), does not
 * build outcome templates (that is `arenaBidFunding`'s job, and it signs with
 * the wallet key), and does not settle or refund anything. Refunds are
 * automatic off the bid's committed template.
 *
 * ## Why it is a separate module
 *
 * The `Manager` is injected as a structural port, so the shape can be tested
 * without a browser or a mint, and so this module never reaches into the store.
 * The app's assembly passes `cashuStore.state.manager`; a test passes a double.
 */
import type { Proof } from '@cashu/cashu-ts'
import type { ArenaEscrowProof } from './arenaBidFunding'
import { buildArenaEscrowLockOptions } from './arenaBidFunding'

/**
 * The Coco send surface this module needs. Declared structurally so the SDK
 * `Manager` satisfies it without this module importing the wallet store.
 */
export interface ArenaEscrowSendManager {
	mint: {
		addMint(mintUrl: string, options?: { trusted?: boolean }): Promise<unknown>
	}
	ops: {
		send: {
			init(
				mintUrl: string,
				amount: number,
				options: { method: 'p2pk'; methodData: { options: ReturnType<typeof buildArenaEscrowLockOptions> } },
			): Promise<{ id: string }>
			prepare(operation: { id: string }): Promise<{ id: string }>
			execute(prepared: { id: string }): Promise<{ token: { proofs: Proof[] } }>
		}
	}
}

export interface LockArenaEscrowInput {
	mintUrl: string
	/** The bid amount in sats. Must be a positive safe integer; nothing is rounded. */
	amount: number
	bidderWallet: string
	committeeKey: string
	locktime: number
}

const amountOf = (proof: Proof): number => {
	const value = proof.amount as unknown
	if (typeof value === 'number') return value
	if (typeof value === 'object' && value !== null && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
		return (value as { toNumber(): number }).toNumber()
	}
	return Number(value)
}

/**
 * Lock `amount` into the escrow and return the locked proofs.
 *
 * Throws when the mint does not support NUT-11, does not have the funds, or
 * refuses the swap. There is deliberately no retry and no fallback lock here:
 * the caller owns the funding lifecycle (which bids are in flight, which
 * failures are reclaimable), and a silent second lock would double-commit the
 * bidder's money.
 */
export async function lockArenaEscrowWithCoco(
	manager: ArenaEscrowSendManager,
	input: LockArenaEscrowInput,
): Promise<ArenaEscrowProof[]> {
	if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
		throw new Error('escrow amount must be a positive integer number of sats')
	}
	const options = buildArenaEscrowLockOptions({
		bidderWallet: input.bidderWallet,
		committeeKey: input.committeeKey,
		locktime: input.locktime,
	})
	try {
		await manager.mint.addMint(input.mintUrl, { trusted: true })
	} catch {
		// Already known; the send's own trusted-mint check is the authority.
	}
	const operation = await manager.ops.send.init(input.mintUrl, input.amount, {
		method: 'p2pk',
		methodData: { options },
	})
	const prepared = await manager.ops.send.prepare(operation)
	const { token } = await manager.ops.send.execute(prepared)
	return token.proofs.map((proof) => ({
		id: proof.id,
		amount: amountOf(proof),
		secret: proof.secret,
		C: proof.C,
	}))
}