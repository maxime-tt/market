/**
 * sdk/core/profile/profileValidation.ts — the profile-route identifier rule
 * (store drain D1, slice 4).
 *
 * Moved from `src/lib/utils/profileValidation.ts` so the framework-free profile read can reject a
 * malformed identifier before any relay I/O without reaching into `src/`. The legacy `src/` path is an
 * `export *` shim, so every existing importer keeps working. The hex rule reuses the shared
 * `HEX_KEYS_REGEX` constant rather than `src/lib/utils`' `isValidHexKey` (they are the same regex).
 */
import { decode } from 'nostr-tools/nip19'
import { HEX_KEYS_REGEX } from '../../config/constants'

export type ProfileIdentifierType = 'nip05' | 'npub' | 'nprofile' | 'hex'

export type ProfileIdentifierValidationResult =
	| {
			isValid: true
			type: ProfileIdentifierType
	  }
	| {
			isValid: false
			error: string
	  }

const PROFILE_IDENTIFIER_ERROR = 'is not a valid profile identifier'
const NIP05_NAME_REGEX = /^[A-Za-z0-9_.+-]+$/
const DOMAIN_LABEL_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/

export function validateProfileIdentifier(identifier: string): ProfileIdentifierValidationResult {
	if (isValidNpubIdentifier(identifier)) return { isValid: true, type: 'npub' }
	if (isValidNprofileIdentifier(identifier)) return { isValid: true, type: 'nprofile' }
	if (isValidNip05Identifier(identifier)) return { isValid: true, type: 'nip05' }
	if (isValidHexKey(identifier)) return { isValid: true, type: 'hex' }

	return { isValid: false, error: `"${identifier}" ${PROFILE_IDENTIFIER_ERROR}` }
}

export function getProfileIdentifierValidationError(identifier: string): string | null {
	const validation = validateProfileIdentifier(identifier)
	return validation.isValid ? null : validation.error
}

function isValidHexKey(input: string): boolean {
	return HEX_KEYS_REGEX.test(input)
}

function isValidNpubIdentifier(identifier: string): boolean {
	if (!identifier.startsWith('npub1')) return false

	try {
		const decoded = decode(identifier)
		return decoded.type === 'npub' && typeof decoded.data === 'string' && isValidHexKey(decoded.data)
	} catch {
		return false
	}
}

function isValidNprofileIdentifier(identifier: string): boolean {
	if (!identifier.startsWith('nprofile1')) return false

	try {
		const decoded = decode(identifier)
		return decoded.type === 'nprofile' && isValidHexKey(decoded.data.pubkey)
	} catch {
		return false
	}
}

function isValidNip05Identifier(identifier: string): boolean {
	if (identifier.startsWith('npub1') || identifier.startsWith('nprofile1')) return false

	const parts = identifier.split('@')
	if (parts.length > 2) return false

	const [name, domain] = parts.length === 2 ? parts : ['_', identifier]
	if (!name || !domain || !NIP05_NAME_REGEX.test(name)) return false
	if (!domain.includes('.')) return false

	const labels = domain.split('.')
	return labels.length > 1 && labels.every((label) => DOMAIN_LABEL_REGEX.test(label))
}
