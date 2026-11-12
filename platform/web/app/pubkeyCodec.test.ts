import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { formatPubkeyForDisplay, hexToNpub, npubToHex } from './pubkeyCodec'

const HEX = 'ab'.repeat(32) // lowercase, 64 chars
const NPUB = nip19.npubEncode(HEX)

/**
 * These rules were previously exported from `platform/web/routes/setup.tsx` and imported
 * back out of the route tree by three app-settings routes. They are asserted here so the
 * identifier contract survives the move to `platform/web/app/` unchanged: the setup form's
 * field validation depends on the THROW, so a codec that started returning `null` would
 * silently widen what onboarding accepts.
 */
describe('pubkeyCodec', () => {
	describe('npubToHex', () => {
		test('decodes an npub to its hex form', () => {
			expect(npubToHex(NPUB)).toBe(HEX)
		})

		test('passes a 64-char hex key through, lowercased', () => {
			expect(npubToHex('AB'.repeat(32))).toBe(HEX)
		})

		test('throws on a non-npub bech32 identifier (an nsec is not a public key)', () => {
			expect(() => npubToHex(nip19.nsecEncode(new Uint8Array(32).fill(1)))).toThrow('Invalid public key')
		})

		test('throws on a truncated hex key', () => {
			expect(() => npubToHex('ab'.repeat(31))).toThrow('Invalid public key')
		})

		test('throws on an unparseable npub-like string', () => {
			expect(() => npubToHex('npub1notarealnpub')).toThrow()
		})
	})

	describe('hexToNpub', () => {
		test('encodes a hex pubkey', () => {
			expect(hexToNpub(HEX)).toBe(NPUB)
		})

		test('passes an npub through unchanged', () => {
			expect(hexToNpub(NPUB)).toBe(NPUB)
		})

		test('throws on an invalid identifier', () => {
			expect(() => hexToNpub('not-a-key')).toThrow('Invalid public key: must be npub or 64 hex chars')
		})
	})

	describe('formatPubkeyForDisplay', () => {
		test('renders a hex pubkey as its npub', () => {
			expect(formatPubkeyForDisplay(HEX)).toBe(NPUB)
		})

		test('returns an npub unchanged', () => {
			expect(formatPubkeyForDisplay(NPUB)).toBe(NPUB)
		})

		test('returns unusable input as-is instead of throwing during render', () => {
			expect(formatPubkeyForDisplay('not-a-key')).toBe('not-a-key')
		})
	})
})
