/**
 * platform/web/layout/AccountMenu.test.tsx — the AppBar's account dropdown.
 *
 * The unit suite has no DOM renderer (see `ui/shared/use-copy-to-clipboard.test.tsx`): components are
 * rendered with `react-dom/server`. A Radix dropdown's content lives in a portal, and
 * `@radix-ui/react-portal` renders nothing on the server, so the content tree would be invisible to
 * `renderToStaticMarkup`. This file therefore replaces **only** `@ui/primitives/dropdown-menu` with a
 * pass-through that keeps the roles, the props and the class names the menu hands down — the tree asserted
 * below is the menu's own, not a copy of it.
 *
 * Everything the menu reads is real: `authStore` (the `@tanstack/store` mirror of the `sdk/core/auth`
 * machine), `uiStore`/`uiActions`, `cartStore` and the notifications binding. That is deliberate — the
 * signer-type test below proves the menu's auth read reaches the machine and is not a second store.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { createContext, createElement, Fragment, useContext, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { INITIAL_AUTH_STATE } from '@sdk/core/auth'

// ---------------------------------------------------------------------------
// The dropdown stand-in: roles and props only, no portal.
// ---------------------------------------------------------------------------

/** The last radio groups rendered, so a test can drive the value change a click would fire. */
const radioGroups: Array<{ value?: string; onValueChange?: (value: string) => void }> = []

/** The items that carry an action and a testid, in render order. */
const actionableItems: Array<{ testId: string; onSelect: () => void }> = []

const RadioGroupValue = createContext<{ value?: string }>({})

interface ItemStubProps {
	children?: ReactNode
	className?: string
	'data-testid'?: string
	onSelect?: () => void
}

function collectActionable(props: ItemStubProps): void {
	if (props['data-testid'] && props.onSelect) {
		actionableItems.push({ testId: props['data-testid'], onSelect: props.onSelect })
	}
}

mock.module('@ui/primitives/dropdown-menu', () => ({
	DropdownMenu: ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children),
	DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children),
	DropdownMenuContent: (props: ItemStubProps & { align?: string; sideOffset?: number }) =>
		createElement('div', { role: 'menu', 'data-testid': props['data-testid'], className: props.className }, props.children),
	DropdownMenuLabel: (props: ItemStubProps) =>
		createElement('div', { 'data-slot': 'dropdown-menu-label', className: props.className }, props.children),
	DropdownMenuItem: (props: ItemStubProps) => {
		collectActionable(props)
		return createElement('div', { role: 'menuitem', 'data-testid': props['data-testid'], className: props.className }, props.children)
	},
	DropdownMenuSeparator: (props: { className?: string }) =>
		createElement('hr', { 'data-slot': 'dropdown-menu-separator', className: props.className }),
	DropdownMenuSub: ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children),
	DropdownMenuSubTrigger: (props: ItemStubProps) =>
		createElement('div', { role: 'menuitem', 'data-testid': props['data-testid'], className: props.className }, props.children),
	DropdownMenuSubContent: (props: ItemStubProps) =>
		createElement('div', { role: 'menu', 'data-testid': props['data-testid'], className: props.className }, props.children),
	DropdownMenuRadioGroup: (props: { value?: string; onValueChange?: (value: string) => void; children?: ReactNode }) => {
		radioGroups.push({ value: props.value, onValueChange: props.onValueChange })
		return createElement(
			RadioGroupValue.Provider,
			{ value: { value: props.value } },
			createElement('div', { role: 'group' }, props.children),
		)
	},
	DropdownMenuRadioItem: (props: ItemStubProps & { value: string }) => {
		const selected = useContext(RadioGroupValue).value
		return createElement(
			'div',
			{
				role: 'menuitemradio',
				'data-testid': props['data-testid'],
				'aria-checked': props.value === selected ? 'true' : 'false',
				className: props.className,
			},
			props.children,
		)
	},
}))

mock.module('@platform/web/wallet/CocoWalletPanelHost', () => ({
	CocoWalletPanelHost: () => createElement('div', { 'data-testid': 'wallet-panel-stub' }),
}))

afterAll(() => {
	mock.restore()
})

// Dynamic on purpose: the `mock.module` registrations must be in place before `./AccountMenu` resolves its
// imports, and static imports are hoisted above them (the repository's established pattern).
const { AccountMenu } = await import('./AccountMenu')
const { authActions, authStore } = await import('@platform/web/auth/authStore')
const { authBinding } = await import('@platform/web/auth/authBinding')
const { uiActions, uiStore } = await import('@platform/web/app/uiStore')

const USER_PUBKEY = 'a'.repeat(64)

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** The menu links to routes, so it is mounted inside a real memory router (as `AppBar.test.tsx` does). */
async function renderMenu(): Promise<string> {
	const rootRoute = createRootRoute({ component: () => createElement(AccountMenu) })
	rootRoute.addChildren([
		createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null }),
		createRoute({ getParentRoute: () => rootRoute, path: '/dashboard', component: () => null }),
		createRoute({ getParentRoute: () => rootRoute, path: '/profile/$profileId', component: () => null }),
	])
	const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })
	await router.load()

	// The identity header renders the real `AvatarHost`, which reads the profile query. No fetch runs during
	// the server render; the avatar simply renders its loading state.
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router })))
}

function signIn(signerType: (typeof INITIAL_AUTH_STATE)['signerType'] = 'extension'): void {
	authStore.setState(() => ({
		...INITIAL_AUTH_STATE,
		user: { pubkey: USER_PUBKEY },
		isAuthenticated: true,
		signerType,
	}))
}

function actionable(testId: string): { testId: string; onSelect: () => void } {
	const item = actionableItems.find((candidate) => candidate.testId === testId)
	if (!item) throw new Error(`the menu rendered no actionable item "${testId}"`)
	return item
}

beforeEach(() => {
	radioGroups.length = 0
	actionableItems.length = 0
	authStore.setState(() => INITIAL_AUTH_STATE)
	uiActions.setCurrency('USD')
})

// ---------------------------------------------------------------------------
// Signed out
// ---------------------------------------------------------------------------

describe('AccountMenu — signed out', () => {
	test('shows the sign-in action and none of the signed-in items', async () => {
		const markup = await renderMenu()

		expect(markup).toContain('Sign in')
		expect(markup).toContain('data-testid="login-button"')
		expect(markup).not.toContain('Dashboard')
		expect(markup).not.toContain('Sign out')
		expect(markup).not.toContain('data-testid="wallet-button"')
		expect(markup).not.toContain('data-testid="cart-button"')
		expect(markup).not.toContain('Currency')
		expect(markup).not.toContain('data-testid="profile-button"')
	})

	test('mounts exactly one trigger, with an accessible name', async () => {
		const markup = await renderMenu()

		expect(markup.split('data-testid="account-menu-trigger"').length - 1).toBe(1)
		expect(markup).toContain('aria-label="Account menu"')
	})

	test('the sign-in item opens the login dialog', async () => {
		await renderMenu()

		const calls: string[] = []
		const original = uiActions.openDialog
		Object.assign(uiActions, { openDialog: (dialog: string) => calls.push(dialog) })
		try {
			actionable('login-button').onSelect()
		} finally {
			Object.assign(uiActions, { openDialog: original })
		}

		expect(calls).toEqual(['login'])
	})

	test('shows a busy trigger instead of the menu while a sign-in is running', async () => {
		authStore.setState((state) => ({ ...state, isAuthenticating: true }))

		const markup = await renderMenu()

		expect(markup).toContain('data-testid="auth-loading"')
		expect(markup).not.toContain('data-testid="account-menu-trigger"')
	})
})

// ---------------------------------------------------------------------------
// Signed in
// ---------------------------------------------------------------------------

describe('AccountMenu — signed in', () => {
	test('shows profile, wallet, dashboard, cart, currency and sign-out', async () => {
		signIn()
		const markup = await renderMenu()

		expect(markup).toContain('data-testid="profile-button"')
		expect(markup).toContain('data-testid="wallet-button"')
		expect(markup).toContain('data-testid="dashboard-button"')
		expect(markup).toContain('data-testid="cart-button"')
		expect(markup).toContain('Currency')
		expect(markup).toContain('data-testid="logout-button"')
		expect(markup).not.toContain('Sign in')
	})

	test('links profile to the signed-in pubkey and dashboard to /dashboard', async () => {
		signIn()
		const markup = await renderMenu()

		expect(markup).toContain(`href="/profile/${USER_PUBKEY}"`)
		expect(markup).toContain('href="/dashboard"')
	})

	test('names how the session is signed in, from the machine lane', async () => {
		signIn('bunker')
		const markup = await renderMenu()

		expect(markup).toContain('Remote signer')
		expect(markup).not.toContain('Browser extension')
	})

	test('claims no lane when the machine reports none', async () => {
		signIn(null)
		const markup = await renderMenu()

		expect(markup).toContain('Signed in')
		expect(markup).not.toContain('Browser extension')
		expect(markup).not.toContain('Private key')
		expect(markup).not.toContain('Remote signer')
	})

	test('styles the surface with the widget tokens, not the primitive defaults', async () => {
		signIn()
		const markup = await renderMenu()

		expect(markup).toContain('bg-surface-raised')
		expect(markup).toContain('border-border-default')
		expect(markup).toContain('text-text-high')
		// The item highlight is the ink fill, merged over the primitive's `focus:bg-accent`.
		expect(markup).toContain('focus:bg-fill-ink')
	})

	test('the cart and sign-out items fire their actions', async () => {
		signIn()
		await renderMenu()

		const drawn: string[] = []
		const originalOpenDrawer = uiActions.openDrawer
		const logouts: string[] = []
		const originalLogout = authActions.logout
		try {
			Object.assign(uiActions, { openDrawer: (drawer: string) => drawn.push(drawer) })
			Object.assign(authActions, { logout: () => logouts.push('logout') })

			actionable('cart-button').onSelect()
			actionable('logout-button').onSelect()
		} finally {
			Object.assign(uiActions, { openDrawer: originalOpenDrawer })
			Object.assign(authActions, { logout: originalLogout })
		}

		expect(drawn).toEqual(['cart'])
		expect(logouts).toEqual(['logout'])
	})

	test('the wallet item opens the wallet panel (the Coco host), not a dashboard link', async () => {
		signIn()
		const markup = await renderMenu()

		expect(actionable('wallet-button')).toBeDefined()
		// The menu item is the only entry point: it is not an anchor to a dashboard page.
		expect(markup).toContain('<span>Wallet</span>')
	})
})

// ---------------------------------------------------------------------------
// Currency submenu
// ---------------------------------------------------------------------------

describe('AccountMenu — the currency submenu', () => {
	test('marks the current currency and only it', async () => {
		signIn()
		uiActions.setCurrency('EUR')

		const markup = await renderMenu()

		expect(radioGroups).toHaveLength(1)
		expect(radioGroups[0]?.value).toBe('EUR')
		expect(markup).toContain('data-testid="currency-option-EUR" aria-checked="true"')
		expect(markup.split('aria-checked="true"').length - 1).toBe(1)
		expect(markup).toContain('data-testid="currency-option-USD" aria-checked="false"')
	})

	test('selecting a currency runs the existing setter, and the menu re-reads it', async () => {
		signIn()
		await renderMenu()

		radioGroups.at(-1)?.onValueChange?.('BTC')
		expect(uiStore.state.selectedCurrency).toBe('BTC')

		radioGroups.length = 0
		const markup = await renderMenu()
		expect(markup).toContain('data-testid="currency-option-BTC" aria-checked="true"')
	})
})

// ---------------------------------------------------------------------------
// The auth read
// ---------------------------------------------------------------------------

describe('AccountMenu — the auth read is the machine', () => {
	test('the identity comes from the machine state the store mirrors, not a second store', async () => {
		signIn('ncryptsec')

		// `authStore` is the machine's mirror; a write through it is a write to the machine.
		expect(authStore.state).toBe(authBinding.getState())
		expect(authBinding.getState().signerType).toBe('ncryptsec')
		expect(authBinding.getSignerType()).toBe('ncryptsec')

		const markup = await renderMenu()
		expect(markup).toContain('Encrypted private key')
	})

	test('a machine transition to signed-out flips the menu back to sign-in', async () => {
		signIn()
		await renderMenu()

		authStore.setState(() => INITIAL_AUTH_STATE)

		expect(authBinding.getState().signerType).toBeNull()
		expect(authBinding.getCurrentPubkey()).toBeNull()
		const markup = await renderMenu()
		expect(markup).toContain('data-testid="login-button"')
		expect(markup).not.toContain('data-testid="dashboard-button"')
	})
})
