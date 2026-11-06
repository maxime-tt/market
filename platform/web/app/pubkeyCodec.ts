/**
 * `platform/web/app/pubkeyCodec.ts` — the app's pubkey identifier codec.
 *
 * WHY IT LIVES HERE (and not in the setup route):
 *   `npubToHex` / `hexToNpub` / `formatPubkeyForDisplay` were defined and re-exported from
 *   `platform/web/routes/setup.tsx`, and three app-settings routes imported them back out of
 *   the route tree (`routes/_dashboard-layout/dashboard/app-settings/{blacklists,featured-items,team}.tsx`).
 *   A route module is composition only; the identifier rule is shared behaviour, so it belongs
 *   in `platform/web/app/` (the ledger row `d7-s2-debt-route-loc`).
 *
 * The rules are moved VERBATIM from the setup route: an npub decodes, a 64-char hex key passes
 * through (lowercased), anything else throws — the setup form's field validation depends on the
 * throw, so widening it to `null` would silently change what the onboarding screen accepts.
 */
import { nip19 } from 'nostr-tools'

/** Accepts an `npub1…` or a 64-char hex pubkey and returns the hex form; throws on anything else. */
export function npubToHex(pk: string): string {
	if (pk.startsWith('npub1')) {
		const { type, data } = nip19.decode(pk)
		if (type === 'npub') return data as string
		throw new Error('Invalid npub')
	} else if (/^[0-9a-f]{64}$/i.test(pk)) {
		return pk.toLowerCase()
	}
	throw new Error('Invalid public key: must be npub or 64 hex chars')
}

/** Accepts an `npub1…` or 64-char hex pubkey and returns the npub form; throws on anything else. */
export function hexToNpub(pk: string): string {
	if (pk.startsWith('npub1')) {
		return pk
	} else if (/^[0-9a-f]{64}$/i.test(pk)) {
		return nip19.npubEncode(pk)
	}
	throw new Error('Invalid public key: must be npub or 64 hex chars')
}

/** Display form of a pubkey: npub when the input is valid, the raw input otherwise. */
export function formatPubkeyForDisplay(pk: string): string {
	try {
		return hexToNpub(pk)
	} catch {
		return pk // Return as-is if invalid
	}
}
