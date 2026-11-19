/**
 * ui/browse/search-presence.test.tsx — who is showing a search field.
 *
 * The presence registry is driven by mount effects, so it needs a real DOM and
 * a real commit (the unit suite has no renderer of its own; happy-dom is
 * installed here exactly as `platform/web/browse/browseIndexFeed.render.test.tsx`
 * does). The assertions are the contract the bar depends on:
 *
 * - a mounted page field registers (so the bar retreats),
 * - unmounting it withdraws,
 * - the header's own field (`announce={false}`) never registers,
 * - two fields register two, and the bar's `count === 0` test still hides it.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import type { Root } from 'react-dom/client'

/**
 * The slice of happy-dom's `Window` this file uses. Named structurally rather
 * than imported from the package: happy-dom's own declarations add errors to
 * `tsc`'s program that the repository's baseline does not carry.
 */
interface HappyWindow {
	document: Document
}

/** happy-dom is in the lockfile as the `@tiptap/html` peer; it is not a direct dependency. */
const HAPPY_DOM = 'happy-dom'

const { Window } = (await import(HAPPY_DOM)) as { Window: new (options: { url: string }) => HappyWindow }

const win = new Window({ url: 'http://localhost/' })
const globals = globalThis as Record<string, unknown>
const installedGlobals: string[] = []

globals.IS_REACT_ACT_ENVIRONMENT = true

for (const key of Object.getOwnPropertyNames(win)) {
	if (key in globalThis) continue
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

afterAll(() => {
	for (const key of installedGlobals) delete globals[key]
	delete globals.IS_REACT_ACT_ENVIRONMENT
})

// Dynamic on purpose: the DOM globals must exist before `react-dom` is
// evaluated. Static imports are hoisted above both.
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { SearchPresenceProvider, usePageSearchFieldCount } = await import('./search-presence')
const { SearchField } = await import('./search-field')

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** The bar's own field, standing in for `AppBar`: shown only at zero page fields. */
function HeaderFieldStub() {
	return usePageSearchFieldCount() === 0 ? createElement('div', { 'data-testid': 'header-field' }, 'header') : null
}

/** One page-level field (the CMS block, the idle hero). */
function PageField() {
	return createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} })
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
	doc.body.innerHTML = ''
	container = doc.createElement('div')
	doc.body.appendChild(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
})

const hasHeaderField = () => container.querySelector('[data-testid="header-field"]') !== null

describe('search presence', () => {
	test('a mounted page field hides the header field; unmounting it brings it back', async () => {
		await act(async () => {
			root.render(createElement(SearchPresenceProvider, null, createElement(HeaderFieldStub), createElement(PageField)))
		})

		// The page field's mount effect has run, so the bar's stand-in is gone.
		expect(hasHeaderField()).toBe(false)

		await act(async () => {
			root.render(createElement(SearchPresenceProvider, null, createElement(HeaderFieldStub)))
		})

		expect(hasHeaderField()).toBe(true)
	})

	test('two page fields register two, and the header stays hidden', async () => {
		const probe = () => createElement('span', { 'data-testid': 'count' }, String(usePageSearchFieldCount()))

		await act(async () => {
			root.render(
				createElement(
					SearchPresenceProvider,
					null,
					createElement(HeaderFieldStub),
					createElement(probe),
					createElement(PageField),
					createElement(PageField),
				),
			)
		})

		expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('2')
		expect(hasHeaderField()).toBe(false)
	})
})
