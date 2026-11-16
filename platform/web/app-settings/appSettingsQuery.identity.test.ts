/**
 * platform/web/app-settings/appSettingsQuery.identity.test.ts — the pure identity seam of the
 * admin/editor role hooks.
 *
 * `resolveUserPubkey` is the one place the hooks turn the SDK auth machine's `AuthState.user`
 * (`AuthUser = { pubkey }`) into the string the curation checks take. Pinned here so the mapping cannot
 * drift back to a relay-client identity (the retired `ndk.activeUser?.pubkey`, which is never assigned).
 * The hook-level behaviour is covered in `appSettingsQuery.render.test.tsx`.
 */
import { describe, expect, test } from 'bun:test'
import { resolveUserPubkey } from '@platform/web/app-settings/appSettingsQuery'

describe('resolveUserPubkey', () => {
	test('maps a signed-in AuthUser to its pubkey', () => {
		expect(resolveUserPubkey({ pubkey: 'a'.repeat(64) })).toBe('a'.repeat(64))
	})

	test('maps a signed-out user (null) to undefined, which the checks fail closed on', () => {
		expect(resolveUserPubkey(null)).toBeUndefined()
	})

	test('maps a missing user to undefined', () => {
		expect(resolveUserPubkey(undefined)).toBeUndefined()
	})

	test('does not invent an identity for an empty pubkey', () => {
		expect(resolveUserPubkey({ pubkey: '' })).toBe('')
	})
})