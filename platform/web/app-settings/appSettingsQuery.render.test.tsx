/**
 * platform/web/app-settings/appSettingsQuery.render.test.tsx — the role hooks must take the signed-in
 * identity from the SDK auth machine, not from the NDK instance.
 *
 * Regression pinned here: `useAmIAdmin` / `useUserRole` read `ndk.activeUser?.pubkey`. Nothing in this
 * tree ever assigns `activeUser` (the signer is the SDK signer capability since A3.5), so the pubkey was
 * permanently `undefined`, `isAdmin(settings, '')` short-circuited to `false`, and the app owner plus
 * every admin lost the whole admin surface. With the identity read swapped to `useStore(authStore)` the
 * checks follow whatever user the auth machine holds.
 *
 * The hooks themselves are exercised, not a copy of their logic: they are rendered with
 * `react-dom/server` (the repo has no DOM/renderHook harness — see `platform/web/products/
 * ProductCardHost.render.test.tsx` and `platform/web/layout/appChrome.test.tsx` for the same pattern)
 * against a real `@tanstack/store` standing in for the auth store, and against a react-query cache
 * pre-seeded with the admin/editor settings so the role checks see published lists without a relay.
 */
import { describe, expect, mock, test } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Store } from '@tanstack/store'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { configKeys } from '@sdk/core/query/queryKeyFactory'

const APP_PUBKEY = 'app'.padEnd(64, '0')
const OWNER_PUBKEY = 'owner'.padEnd(64, '1')
const ADMIN_PUBKEY = 'admin'.padEnd(64, '2')
const EDITOR_PUBKEY = 'editor'.padEnd(64, '3')
const OUTSIDER_PUBKEY = 'outsider'.padEnd(64, '4')

interface AuthState {
	user: { pubkey: string } | null
}

/** The auth machine's reactive store, as `readContext` re-exports it. */
const authState = new Store<AuthState>({ user: null })

// Registered before the module under test is imported, so the hooks pull in this store rather than
// the host's composition root (which would drag in the real NDK/applesauce wiring).
mock.module('@platform/web/readContext', () => ({
	authStore: authState,
	createAppRelayReadContext: () => {
		throw new Error('the read context is not used: the query cache is pre-seeded')
	},
	getAppRelayUrl: () => 'wss://relay.example',
}))

mock.module('@platform/web/ndkPublishContext', () => ({
	getAppNdk: () => ({
		subscribe: () => ({ on: () => {}, stop: () => {} }),
	}),
}))

const { useAmIAdmin, useUserRole } = await import('@platform/web/app-settings/appSettingsQuery')

const adminSettings = { owner: OWNER_PUBKEY, admins: [OWNER_PUBKEY, ADMIN_PUBKEY] }
const editorSettings = { editors: [EDITOR_PUBKEY] }

function makeClient(): QueryClient {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	client.setQueryData(configKeys.admins(APP_PUBKEY), adminSettings)
	client.setQueryData(configKeys.editors(APP_PUBKEY), editorSettings)
	return client
}

/** Render with the auth machine holding `user` (a fresh cache per render keeps each case independent). */
function renderWithUser(user: AuthState['user'], element: ReactElement): string {
	authState.setState(() => ({ user }))
	return renderToStaticMarkup(createElement(QueryClientProvider, { client: makeClient() }, element))
}

function AmIAdminProbe(): ReactElement {
	const { amIAdmin, amIOwner, currentUserPubkey } = useAmIAdmin(APP_PUBKEY)
	return createElement('span', {
		'data-am-i-admin': String(amIAdmin),
		'data-am-i-owner': String(amIOwner),
		'data-pubkey': currentUserPubkey ?? '',
	})
}

function UserRoleProbe(): ReactElement {
	const { amIAdmin, amIOwner, amIEditor, userRole, currentUserPubkey } = useUserRole(APP_PUBKEY)
	return createElement('span', {
		'data-am-i-admin': String(amIAdmin),
		'data-am-i-owner': String(amIOwner),
		'data-am-i-editor': String(amIEditor),
		'data-role': userRole,
		'data-pubkey': currentUserPubkey ?? '',
	})
}

describe('useAmIAdmin identity', () => {
	test('the app owner signed in is both admin and owner', () => {
		const markup = renderWithUser({ pubkey: OWNER_PUBKEY }, createElement(AmIAdminProbe))
		expect(markup).toContain('data-am-i-admin="true"')
		expect(markup).toContain('data-am-i-owner="true"')
		expect(markup).toContain(`data-pubkey="${OWNER_PUBKEY}"`)
	})

	test('a listed admin is an admin but not the owner', () => {
		const markup = renderWithUser({ pubkey: ADMIN_PUBKEY }, createElement(AmIAdminProbe))
		expect(markup).toContain('data-am-i-admin="true"')
		expect(markup).toContain('data-am-i-owner="false"')
	})

	test('a signed-in non-admin is neither, and still reports its own pubkey', () => {
		const markup = renderWithUser({ pubkey: OUTSIDER_PUBKEY }, createElement(AmIAdminProbe))
		expect(markup).toContain('data-am-i-admin="false"')
		expect(markup).toContain('data-am-i-owner="false"')
		expect(markup).toContain(`data-pubkey="${OUTSIDER_PUBKEY}"`)
	})

	test('signed out: no pubkey and no roles', () => {
		const markup = renderWithUser(null, createElement(AmIAdminProbe))
		expect(markup).toContain('data-am-i-admin="false"')
		expect(markup).toContain('data-pubkey=""')
	})

	test('a login between renders flips the check (identity is read per render from the store)', () => {
		const signedOut = renderWithUser(null, createElement(AmIAdminProbe))
		const signedIn = renderWithUser({ pubkey: ADMIN_PUBKEY }, createElement(AmIAdminProbe))
		expect(signedOut).toContain('data-am-i-admin="false"')
		expect(signedIn).toContain('data-am-i-admin="true"')
	})
})

describe('useUserRole identity', () => {
	test('a listed editor resolves to the editor role', () => {
		const markup = renderWithUser({ pubkey: EDITOR_PUBKEY }, createElement(UserRoleProbe))
		expect(markup).toContain('data-am-i-editor="true"')
		expect(markup).toContain('data-role="editor"')
	})

	test('a listed admin resolves to the admin role', () => {
		const markup = renderWithUser({ pubkey: ADMIN_PUBKEY }, createElement(UserRoleProbe))
		expect(markup).toContain('data-am-i-admin="true"')
		expect(markup).toContain('data-role="admin"')
	})

	test('the owner resolves to the owner role', () => {
		const markup = renderWithUser({ pubkey: OWNER_PUBKEY }, createElement(UserRoleProbe))
		expect(markup).toContain('data-role="owner"')
	})

	test('a signed-in non-member resolves to plain user and reports its pubkey', () => {
		const markup = renderWithUser({ pubkey: OUTSIDER_PUBKEY }, createElement(UserRoleProbe))
		expect(markup).toContain('data-role="user"')
		expect(markup).toContain(`data-pubkey="${OUTSIDER_PUBKEY}"`)
	})

	test('signed out: plain user with no pubkey', () => {
		const markup = renderWithUser(null, createElement(UserRoleProbe))
		expect(markup).toContain('data-role="user"')
		expect(markup).toContain('data-pubkey=""')
	})
})