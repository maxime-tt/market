import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { encodeIdentifierToNpub } from './userCardHosts'

const HEX_PUBKEY = 'a'.repeat(64)

describe('encodeIdentifierToNpub', () => {
	test('passes an npub through unchanged', () => {
		const npub = nip19.npubEncode(HEX_PUBKEY)
		expect(encodeIdentifierToNpub(npub)).toBe(npub)
	})

	test('encodes a 64-hex pubkey to a matching npub', () => {
		const npub = encodeIdentifierToNpub(HEX_PUBKEY)
		expect(npub).not.toBeNull()
		expect(npub?.startsWith('npub1')).toBe(true)

		const decoded = nip19.decode(npub as string)
		expect(decoded.type).toBe('npub')
		expect(decoded.data).toBe(HEX_PUBKEY)
	})

	test('returns null for undefined, blank, and malformed identifiers', () => {
		expect(encodeIdentifierToNpub(undefined)).toBeNull()
		expect(encodeIdentifierToNpub('')).toBeNull()
		expect(encodeIdentifierToNpub('   ')).toBeNull()
		expect(encodeIdentifierToNpub('not-a-key')).toBeNull()
	})
})
