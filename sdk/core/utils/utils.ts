import { HEX_KEYS_REGEX, EMAIL_REGEX } from '@sdk/config/constants'
import { decode, npubEncode } from 'nostr-tools/nip19'

export function isValidHexKey(input: string): boolean {
	return HEX_KEYS_REGEX.test(input)
}

export function isValidNip05(input: string): boolean {
	return EMAIL_REGEX.test(input)
}

/**
 * Encodes a hex pubkey to npub, returning null if the input is not a valid
 * 64-char hex key. Prevents nip19.npubEncode from throwing during render.
 */
export function safeNpubEncode(pubkey: string): string | null {
	return isValidHexKey(pubkey) ? npubEncode(pubkey) : null
}

export function isValidNpub(input: string): boolean {
	try {
		const { type, data } = decode(input)
		return type === 'npub' && typeof data === 'string' && isValidHexKey(data)
	} catch {
		return false
	}
}
