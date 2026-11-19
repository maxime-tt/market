/**
 * platform/web/layout/AccountMenu.render.test.tsx — the wallet panel outlives the menu that opens it.
 *
 * `AccountMenu.test.tsx` replaces the dropdown and the popover with role-only stand-ins, so it can assert
 * the tree the menu draws but not what Radix does to it. This file mounts the **real** primitives in a real
 * DOM and drives the gestures a user makes, because the failure it pins is Radix's own. The account menu is
 * modal: as it closes, its focus trap first pulls focus back into its own content and its close restore then
 * returns focus to the trigger. The wallet panel is a popover, and a popover reads focus arriving outside
 * itself as "the user went elsewhere" and unmounts. So the menu unmounted the panel it had just opened —
 * on the instance it is gone in 150–350 ms, with no click, no Escape and nothing else from the user.
 *
 * Three gestures are pinned, in the terms the panel promises: opening the wallet from the menu leaves the
 * panel mounted; Escape closes it and gives focus back to the trigger; a press outside closes it and leaves
 * focus where the user put it.
 *
 * Two seams are stubbed, both because they are I/O and neither is what is under test: `CocoWalletPanelHost`
 * (the cashu engine and the relays) and the avatar host (the profile read). Everything else is real — the
 * primitives, the auth store, the router.
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { createElement } from 'react'
import type { Root } from 'react-dom/client'
import { INITIAL_AUTH_STATE } from '@sdk/core/auth'

// ---------------------------------------------------------------------------
// A DOM for this file — installed before any DOM-touching module is imported
// ---------------------------------------------------------------------------

/**
 * The slice of happy-dom's `Window` this file uses. Named structurally rather than imported from the
 * package: happy-dom's own declarations add errors to `tsc`'s program that the repository's baseline does
 * not carry, and this is a test-only renderer.
 */
interface HappyWindow {
	Event: typeof globalThis.Event
	CustomEvent: typeof globalThis.CustomEvent
	MouseEvent: typeof globalThis.MouseEvent
	PointerEvent: typeof globalThis.PointerEvent
	KeyboardEvent: typeof globalThis.KeyboardEvent
}

/** happy-dom is in the lockfile as the `@tiptap/html` peer; it is not a direct dependency. */
const HAPPY_DOM = 'happy-dom'

const { Window } = (await import(HAPPY_DOM)) as { Window: new (options: { url: string }) => HappyWindow }

/**
 * The event constructors Bun also provides. They must be happy-dom's: a `CustomEvent` from Bun's realm is
 * rejected by happy-dom's `EventTarget.dispatchEvent`, and Radix dispatches custom events (the dismissable
 * layer's `focusOutside`) on the document. Everything else that Bun already has is left alone.
 */
const HAPPY_DOM_EVENTS = [
	'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'InputEvent',
	'UIEvent', 'AnimationEvent', 'TransitionEvent', 'SubmitEvent', 'WheelEvent', 'ClipboardEvent',
	'CompositionEvent', 'DragEvent', 'TouchEvent', 'MessageEvent', 'ErrorEvent', 'ProgressEvent',
	'HashChangeEvent', 'PopStateEvent', 'PageTransitionEvent', 'StorageEvent',
]

const win = new Window({ url: 'http://localhost/' })
const globals = globalThis as Record<string, unknown>
const installedGlobals: string[] = []

globals.IS_REACT_ACT_ENVIRONMENT = true

for (const key of [...Object.getOwnPropertyNames(win), ...HAPPY_DOM_EVENTS]) {
	if (key in globalThis && !HAPPY_DOM_EVENTS.includes(key)) continue
	try {
		Object.defineProperty(globalThis, key, {
			value: Reflect.get(win, key),
			configurable: true,
			writable: true,
		})
		installedGlobals.push(key)
	} catch {
		// A window property Bun already owns (timers, fetch, …) stays Bun's.
	}
}

const doc = globals.document as Document

// ---------------------------------------------------------------------------
// The seams that talk to the network
// ---------------------------------------------------------------------------

mock.module('@platform/web/wallet/CocoWalletPanelHost', () => ({
	CocoWalletPanelHost: () => createElement('div', { 'data-testid': 'wallet-panel-stub' }, 'Deposit'),
}))

mock.module('@platform/web/profiles/userCardHosts', () => ({
	AvatarHost: () => createElement('div', { 'data-testid': 'avatar-stub' }),
}))

afterAll(() => {
	mock.restore()
	for (const key of installedGlobals) {
		try {
			delete globals[key]
		} catch {
			// A property Bun defined non-configurably stays; the file is over either way.
		}
	}
	delete globals.IS_REACT_ACT_ENVIRONMENT
})

// Dynamic on purpose: the DOM globals must exist before `react-dom` is evaluated, and the
// `mock.module` registrations above must be in place before `./AccountMenu` resolves its imports.
// Static imports are hoisted above both (the repository's established pattern).
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { AccountMenu } = await import('./AccountMenu')
const { authStore } = await import('@platform/web/auth/authStore')

const USER_PUBKEY = 'a'.repeat(64)

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let container: HTMLDivElement
let root: Root

/** The menu links to routes, so it is mounted inside a real memory router (as `AppBar.test.tsx` does). */
async function renderMenu(): Promise<void> {
	const rootRoute = createRootRoute({ component: () => createElement(AccountMenu) })
	rootRoute.addChildren([
		createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null }),
		createRoute({ getParentRoute: () => rootRoute, path: '/dashboard', component: () => null }),
		createRoute({ getParentRoute: () => rootRoute, path: '/profile/$profileId', component: () => null }),
	])
	const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })
	await router.load()

	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	container = doc.createElement('div')
	doc.body.appendChild(container)
	root = createRoot(container)
	await act(async () => {
		root.render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router })))
	})
}

/** Let React commit whatever the last interaction scheduled, and the layer's own timers run. */
async function flush(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

/** The gesture Radix reads as a press: the pointer pair, then the click a real mouse also sends. */
function press(target: Element): void {
	target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }))
	target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }))
	target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}

function element(testId: string): Element | null {
	return doc.querySelector(`[data-testid="${testId}"]`)
}

function required(testId: string): Element {
	const found = element(testId)
	if (!found) throw new Error(`nothing rendered with data-testid="${testId}"`)
	return found
}

/** Open the account menu, pick Wallet, and let the menu finish closing. */
async function openWalletFromMenu(): Promise<void> {
	await renderMenu()
	await act(async () => {
		press(required('account-menu-trigger'))
	})
	await flush()
	await act(async () => {
		press(required('wallet-button'))
	})
	await flush()
	await flush()
}

beforeEach(() => {
	authStore.setState(() => ({
		...INITIAL_AUTH_STATE,
		user: { pubkey: USER_PUBKEY },
		isAuthenticated: true,
		signerType: 'extension',
	}))
})

afterEach(async () => {
	await act(async () => {
		root.unmount()
	})
	container.remove()
	authStore.setState(() => INITIAL_AUTH_STATE)
})

// ---------------------------------------------------------------------------
// The panel the menu opens
// ---------------------------------------------------------------------------

describe('AccountMenu — the wallet panel the menu opens', () => {
	test('survives the menu that opened it, instead of being dismissed by the menu closing', async () => {
		await openWalletFromMenu()

		// The menu is gone and its close restore has already run: that focus move is what used to unmount
		// the panel. It is still here, with its content.
		expect(element('account-menu-content')).toBeNull()
		expect(element('wallet-panel')).not.toBeNull()
		expect(element('wallet-panel-stub')).not.toBeNull()

		// And it stays: nothing about the menu's teardown arrives late.
		await flush()
		expect(element('wallet-panel')).not.toBeNull()
	})

	test('hands focus to the panel, not back to the trigger', async () => {
		await openWalletFromMenu()

		expect(element('wallet-panel')?.contains(doc.activeElement)).toBe(true)
	})

	test('Escape closes the panel and gives focus back to the trigger', async () => {
		await openWalletFromMenu()
		expect(element('wallet-panel')).not.toBeNull()

		await act(async () => {
			doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
		})
		await flush()

		expect(element('wallet-panel')).toBeNull()
		expect(doc.activeElement).toBe(required('account-menu-trigger'))
	})

	test('a press outside closes the panel, and leaves focus where the press put it', async () => {
		await openWalletFromMenu()
		expect(element('wallet-panel')).not.toBeNull()

		await act(async () => {
			doc.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }))
		})
		await flush()

		expect(element('wallet-panel')).toBeNull()
		expect(doc.activeElement).not.toBe(required('account-menu-trigger'))
	})

	test('opening the account menu again closes the panel, so the two surfaces never co-render', async () => {
		await openWalletFromMenu()
		expect(element('wallet-panel')).not.toBeNull()

		await act(async () => {
			press(required('account-menu-trigger'))
		})
		await flush()

		expect(element('account-menu-content')).not.toBeNull()
		expect(element('wallet-panel')).toBeNull()
	})
})
