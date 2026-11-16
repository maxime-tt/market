/**
 * platform/web/permissions/useEntityPermissions.render.test.tsx — ownership must come from the auth
 * machine's identity, not from the NDK instance.
 *
 * Regression pinned here: `useEntityPermissions` destructured a correct `currentUserPubkey` from
 * `useUserRole` and then shadowed it with `ndk.activeUser?.pubkey`. Nothing in this tree ever assigns
 * `ndk.activeUser`, so `isEntityOwner` was permanently `false`: nobody could edit or delete their own
 * products, collections or profile, and every owner was offered "add to cart" on their own listings.
 *
 * Two guards beyond the behaviour assertions:
 *  - `@platform/web/ndk/ndkStore` is mocked so that `getNDK()` THROWS. If anyone reintroduces an NDK
 *    identity read here, this suite fails by name instead of silently regressing.
 *  - `useUserRole` (the real source) is mocked to a settled state so the case does not depend on the
 *    admin-settings query, and so the assertion pins "identity comes from `useUserRole`".
 *
 * Rendered with `react-dom/server` — the repo has no DOM/renderHook harness (same pattern as
 * `platform/web/app-settings/appSettingsQuery.render.test.tsx`).
 */
import { describe, expect, mock, test } from 'bun:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const OWNER_PUBKEY = 'a1'.repeat(32)
const STRANGER_PUBKEY = 'b2'.repeat(32)

interface RoleState {
	userRole: 'owner' | 'admin' | 'editor' | 'user'
	isLoading: boolean
	currentUserPubkey: string | undefined
}

let roleState: RoleState = { userRole: 'user', isLoading: false, currentUserPubkey: undefined }

mock.module('@platform/web/app-settings/appSettingsQuery', () => ({
	useUserRole: () => roleState,
}))

mock.module('@platform/web/config/publicConfigQuery', () => ({
	useConfigQuery: () => ({ data: { appPublicKey: 'app'.padEnd(64, '0') } }),
}))

// The test itself: an identity read through NDK must not exist.
mock.module('@platform/web/ndk/ndkStore', () => ({
	ndkActions: {
		getNDK: () => {
			throw new Error('identity must not be read from NDK')
		},
	},
}))

const { useEntityPermissions } = await import('@platform/web/permissions/useEntityPermissions')

function Probe({ entityPubkey }: { entityPubkey: string | undefined }): ReactElement {
	const permissions = useEntityPermissions(entityPubkey)
	return createElement('span', {
		'data-can-edit': String(permissions.canEdit),
		'data-can-delete': String(permissions.canDelete),
		'data-is-owner': String(permissions.isEntityOwner),
		'data-can-add-to-cart': String(permissions.canAddToCart),
		'data-pubkey': permissions.currentUserPubkey ?? '',
	})
}

function render(entityPubkey: string | undefined): string {
	return renderToStaticMarkup(createElement(Probe, { entityPubkey }))
}

describe('useEntityPermissions — identity comes from the auth machine', () => {
	test('the entity owner can edit and delete, and is not offered their own item in the cart', () => {
		roleState = { userRole: 'user', isLoading: false, currentUserPubkey: OWNER_PUBKEY }

		const markup = render(OWNER_PUBKEY)

		expect(markup).toContain('data-is-owner="true"')
		expect(markup).toContain('data-can-edit="true"')
		expect(markup).toContain('data-can-delete="true"')
		expect(markup).toContain('data-can-add-to-cart="false"')
		expect(markup).toContain(`data-pubkey="${OWNER_PUBKEY}"`)
	})

	test('a stranger gets no ownership rights and may add the item to the cart', () => {
		roleState = { userRole: 'user', isLoading: false, currentUserPubkey: STRANGER_PUBKEY }

		const markup = render(OWNER_PUBKEY)

		expect(markup).toContain('data-is-owner="false"')
		expect(markup).toContain('data-can-edit="false"')
		expect(markup).toContain('data-can-delete="false"')
		expect(markup).toContain('data-can-add-to-cart="true"')
		expect(markup).toContain(`data-pubkey="${STRANGER_PUBKEY}"`)
	})

	test('signed out: nobody owns the entity', () => {
		roleState = { userRole: 'user', isLoading: false, currentUserPubkey: undefined }

		const markup = render(OWNER_PUBKEY)

		expect(markup).toContain('data-is-owner="false"')
		expect(markup).toContain('data-can-edit="false"')
		expect(markup).toContain('data-can-add-to-cart="true"')
		expect(markup).toContain('data-pubkey=""')
	})

	test('ownership follows a login between renders (the value is the reactive one from useUserRole)', () => {
		roleState = { userRole: 'user', isLoading: false, currentUserPubkey: undefined }
		const signedOut = render(OWNER_PUBKEY)

		roleState = { userRole: 'user', isLoading: false, currentUserPubkey: OWNER_PUBKEY }
		const signedIn = render(OWNER_PUBKEY)

		expect(signedOut).toContain('data-can-edit="false"')
		expect(signedIn).toContain('data-can-edit="true"')
	})

	test('role flags are unaffected: an admin still cannot edit an entity they do not own', () => {
		roleState = { userRole: 'admin', isLoading: false, currentUserPubkey: STRANGER_PUBKEY }

		const markup = render(OWNER_PUBKEY)

		expect(markup).toContain('data-is-owner="false"')
		expect(markup).toContain('data-can-edit="false"')
	})
})