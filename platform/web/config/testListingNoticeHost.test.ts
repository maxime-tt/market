import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { shortenLabelerNpub } from './testListingNoticeHost'

const HEX_PUBKEY = 'a'.repeat(64)
const OTHER_HEX_PUBKEY = 'b'.repeat(64)

/**
 * The ONE question this helper answers: does it shorten a labeler pubkey to the same
 * window the retiring `src/components/TestListingNotice.tsx` rendered (`head: 14`,
 * `tail: 6`, `'…'`)? The `null` branch exists only for an encode that throws, exactly
 * as the legacy's try/catch did — nip19.npubEncode is permissive about non-hex input,
 * so that branch is not reachable from a plain string and is not asserted here.
 */
describe('shortenLabelerNpub', () => {
	test('shortens a pubkey to the legacy 14/6 window with an ellipsis separator', () => {
		const shortened = shortenLabelerNpub(HEX_PUBKEY)
		const npub = nip19.npubEncode(HEX_PUBKEY)

		expect(shortened).not.toBeNull()
		expect(shortened?.startsWith('npub1')).toBe(true)
		expect(shortened).toBe(`${npub.slice(0, 14)}…${npub.slice(-6)}`)
	})

	test('different pubkeys shorten to different strings', () => {
		expect(shortenLabelerNpub(HEX_PUBKEY)).not.toBe(shortenLabelerNpub(OTHER_HEX_PUBKEY))
	})
})
