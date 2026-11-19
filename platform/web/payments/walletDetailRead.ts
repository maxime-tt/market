/**
 * platform/web/payments/walletDetailRead.ts — the relay filters and local binding for an
 * app-signed kind-30078 `wallet_detail` record.
 *
 * The record names its payment detail through an `a` tag, `30078:<user pubkey>:<payment detail
 * d tag>` (SPEC.md, "Wallet Details"). A payment detail's `d` is a UUID, so that value is 107
 * characters. The relay's store indexes a tag only when its name is one character and its value
 * is at most 100 (`fiatjaf.com/nostr/eventstore/boltdb/helpers.go`), and the query planner trusts
 * that index, so a `#a` filter on the coordinate is answered with a confident zero.
 *
 * The read therefore keeps the `#a` clause for relays that do index long values and adds the
 * `l` label — `wallet_detail`, 13 characters, always indexed — then binds each returned event
 * locally by the `a` tag it carries. No author restriction is added: whichever key the writer
 * signs with, the identity that must match is the user pubkey inside `a`.
 */
export const WALLET_DETAIL_KIND = 30078
export const WALLET_DETAIL_LABEL = 'wallet_detail'

/** What a wallet detail is read for: one payment detail (`d` tag) of one user. */
export interface WalletDetailTarget {
	/** The payment detail's author — the pubkey the coordinate is scoped to. */
	userPubkey: string
	/** The payment detail's `d` tag, never its event id. */
	paymentDetailDTag: string
}

/** A relay filter for the wallet detail read; a type alias so it stays assignable to `#${string}`. */
export type WalletDetailReadFilter = {
	kinds: number[]
	'#l'?: string[]
	'#a'?: string[]
}

const coordinateFor = (target: WalletDetailTarget): string => `${WALLET_DETAIL_KIND}:${target.userPubkey}:${target.paymentDetailDTag}`

/** `#a` (for relays that index it) plus the indexed `l` label the record always carries. */
export function walletDetailReadFilters(target: WalletDetailTarget): WalletDetailReadFilter[] {
	if (!target.userPubkey || !target.paymentDetailDTag) return []

	return [
		{ kinds: [WALLET_DETAIL_KIND], '#l': [WALLET_DETAIL_LABEL] },
		{ kinds: [WALLET_DETAIL_KIND], '#a': [coordinateFor(target)] },
	]
}

/** The events that actually name this payment detail — the `#l` read is broader than one record. */
export function walletDetailEventsFor<E extends { tags: string[][] }>(events: Iterable<E>, target: WalletDetailTarget): E[] {
	const coordinate = coordinateFor(target)
	return Array.from(events).filter((event) => event.tags.some((tag) => tag[0] === 'a' && tag[1] === coordinate))
}