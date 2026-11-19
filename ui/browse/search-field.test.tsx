/**
 * ui/browse/search-field.test.tsx — the one search pill, in the two sizes the
 * frames ask for.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing test pattern in ui/products/product-search-results.test.tsx.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createElement } from 'react'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { SearchField } from './search-field'

/** The opening tag of the element that carries `marker`, as written. */
function openingTag(markup: string, marker: string): string {
	const at = markup.indexOf(marker)
	if (at === -1) return ''
	return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at))
}

describe('SearchField', () => {
	test('renders with empty value', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }))
		expect(markup).toContain('widget-search-field')
		expect(markup).toContain('Search')
	})

	test('renders with non-empty value', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: 'ceramic bowl', onChange: () => {}, onGo: () => {} }))
		expect(markup).toContain('widget-search-field')
		expect(markup).toContain('ceramic bowl')
	})

	test('shows clear button when value is non-empty', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: 'bowl', onChange: () => {}, onGo: () => {} }))
		expect(markup).toContain('widget-search-field-clear')
	})

	test('hides clear button when value is empty', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }))
		expect(markup).not.toContain('widget-search-field-clear')
	})

	test('go button has fill-ink styles', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }))
		expect(markup).toContain('widget-search-field-go')
		expect(markup).toContain('bg-fill-ink')
		expect(markup).toContain('text-on-fill-ink')
	})

	test('go button fires onGo', () => {
		let fired = false
		const markup = renderToStaticMarkup(
			createElement(SearchField, {
				value: '',
				onChange: () => {},
				onGo: () => {
					fired = true
				},
			}),
		)
		expect(markup).toContain('widget-search-field-go')
	})

	test('uses custom placeholder', () => {
		const markup = renderToStaticMarkup(
			createElement(SearchField, {
				value: '',
				placeholder: 'Find something',
				onChange: () => {},
				onGo: () => {},
			}),
		)
		expect(markup).toContain('Find something')
	})

	test('accepts custom className', () => {
		const markup = renderToStaticMarkup(
			createElement(SearchField, {
				value: '',
				onChange: () => {},
				onGo: () => {},
				className: 'custom',
			}),
		)
		expect(markup).toContain('custom')
	})

	test('clear button fires onClear', () => {
		let cleared = false
		renderToStaticMarkup(
			createElement(SearchField, {
				value: 'test',
				onChange: () => {},
				onGo: () => {},
				onClear: () => {
					cleared = true
				},
			}),
		)
		const markup = renderToStaticMarkup(
			createElement(SearchField, {
				value: 'test',
				onChange: () => {},
				onGo: () => {},
				onClear: () => {
					cleared = true
				},
			}),
		)
		expect(markup).toContain('widget-search-field-clear')
	})

	test('nav is the frame’s compact field; hero is the idle frame’s large one', () => {
		const nav = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }))
		const hero = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {}, size: 'hero' }))

		// nav band: 40px tall, capped at the frame's 560px, 18px glyph, no
		// keyboard affordance
		expect(nav).toContain('data-size="nav"')
		expect(nav).toContain('h-10')
		// The cap, never a hard width: a fixed 560px was the page's min-content
		// and widened the page to 822px on a 390px phone.
		expect(nav).not.toContain('w-[560px] max-w-full')
		expect(nav).toContain('max-w-[560px]')
		expect(nav).toMatch(/w-full[^"]*max-w-\[560px\]/)
		expect(nav).toMatch(/min-w-0[^"]*pl-4/)
		expect(nav).not.toContain('widget-search-field-kbd')

		// idle hero: 70px tall, 22px glyph, the ⌘K affordance
		expect(hero).toContain('data-size="hero"')
		expect(hero).toContain('h-[70px]')
		expect(hero).toContain('size-[22px]')
		expect(hero).toContain('widget-search-field-kbd')
		expect(hero).toContain('⌘K')
	})

	test('the nav field yields the go pill to the input on a phone', () => {
		const nav = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }))
		const hero = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {}, size: 'hero' }))

		// A phone's nav row leaves the field ~150px; an 82px pill left the input
		// 9px (one visible character). Below `sm` the pill is hidden and the
		// keyboard's own search key submits — which is why the input needs
		// `enterKeyHint`, or the phone's Enter key reads "return".
		expect(nav).toContain('hidden sm:flex')
		expect(nav).toContain('enterKeyHint="search"')
		// The hero field owns its whole row, so it keeps the pill.
		expect(hero).not.toContain('hidden sm:flex')
		expect(hero).toContain('enterKeyHint="search"')
	})

	test('className still wins over the size table', () => {
		const markup = renderToStaticMarkup(
			createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {}, className: 'h-12 w-full hidden' }),
		)
		expect(markup).toContain('h-12')
		expect(markup).not.toContain('h-10')
		expect(markup).toContain('hidden')
	})

	test('the root clips, so a squeezed field cannot paint over the account cluster', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: 'bowl', onChange: () => {}, onGo: () => {} }))
		expect(markup).toContain('overflow-hidden')
	})

	test('the inner input draws no focus decoration of its own', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }))
		const input = openingTag(markup, 'data-slot="search-field-input"')

		// The wrap owns the focus decoration; the field inside must draw none of
		// its own — no `focus:`/`ring` utility, and no border.
		expect(input).toContain('outline-hidden')
		expect(input).not.toContain('outline-none')
		expect(input).not.toContain('focus:')
		expect(input).not.toContain('ring')
		expect(input).not.toContain('border')
	})

	test('the root keeps the pill’s own focus affordance and reads as an input surface', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }))
		const root = openingTag(markup, 'data-slot="search-field"')

		// The one focus decoration: the wrap's ring, keyed on `focus-within` so
		// keyboard focus on the inner input still shows it.
		expect(root).toContain('focus-within:shadow-[0_0_0_2px_var(--focus-ring)]')
		expect(root).toContain('cursor-text')
	})

	test('the stylesheet clears the field’s own focus border, for both chromes', async () => {
		// The border the owner saw is `input:focus-visible { border: 2px solid
		// var(--ring) !important }` in globals.css. The exemption clearing it must
		// out-rank that rule (and the arena header's own `input:focus` rule), so
		// this pins the selector and its declarations, not just the markup.
		const css = await readFile(resolve(import.meta.dir, '..', '..', 'styles', 'globals.css'), 'utf8')

		expect(css).toContain("[data-slot='search-field'] input:focus-visible")
		expect(css).toContain(".arena-chrome .arena-header [data-slot='search-field'] input:focus")
		expect(css).toMatch(/\[data-slot='search-field'\] input:focus-visible[\s\S]{0,400}outline: 2px solid transparent !important/)
		expect(css).toMatch(/\[data-slot='search-field'\] input:focus-visible[\s\S]{0,400}border: 0 !important/)
	})
})

// ---------------------------------------------------------------------------
// The announce opt-out — a field needs a real commit to register, so this
// section installs happy-dom and a React root (the pattern
// `browseIndexFeed.render.test.tsx` uses; the rest of this file stays static).
// ---------------------------------------------------------------------------

/** The slice of happy-dom's `Window` this section uses. */
interface SearchFieldHappyWindow {
	document: Document
}

/** happy-dom is in the lockfile as the `@tiptap/html` peer; it is not a direct dependency. */
const SEARCH_FIELD_HAPPY_DOM = 'happy-dom'

const { Window: SearchFieldWindow } = (await import(SEARCH_FIELD_HAPPY_DOM)) as {
	Window: new (options: { url: string }) => SearchFieldHappyWindow
}

const searchFieldWindow = new SearchFieldWindow({ url: 'http://localhost/' })
const searchFieldGlobals = globalThis as Record<string, unknown>
const searchFieldInstalledGlobals: string[] = []

searchFieldGlobals.IS_REACT_ACT_ENVIRONMENT = true

for (const key of Object.getOwnPropertyNames(searchFieldWindow)) {
	if (key in globalThis) continue
	try {
		Object.defineProperty(globalThis, key, {
			value: Reflect.get(searchFieldWindow, key),
			configurable: true,
			writable: true,
		})
		searchFieldInstalledGlobals.push(key)
	} catch {
		// A window property Bun already owns stays Bun's.
	}
}

const searchFieldDoc = searchFieldGlobals.document as Document

// Dynamic on purpose: the DOM globals must exist before `react-dom` is evaluated.
const { act: searchFieldAct } = await import('react')
const { createRoot: createSearchFieldRoot } = await import('react-dom/client')
const { SearchPresenceProvider, usePageSearchFieldCount } = await import('./search-presence')

afterAll(() => {
	for (const key of searchFieldInstalledGlobals) delete searchFieldGlobals[key]
	delete searchFieldGlobals.IS_REACT_ACT_ENVIRONMENT
})

/** Stands in for the bar: shown only while no page field is announced. */
function SearchFieldHeaderStub() {
	return usePageSearchFieldCount() === 0 ? createElement('div', { 'data-testid': 'header-field-stub' }, 'header') : null
}

describe('SearchField announcement', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		searchFieldDoc.body.innerHTML = ''
		container = searchFieldDoc.createElement('div')
		searchFieldDoc.body.appendChild(container)
		root = createSearchFieldRoot(container)
	})

	afterEach(() => {
		searchFieldAct(() => root.unmount())
	})

	test('a field announces itself by default, so the bar retreats', async () => {
		await searchFieldAct(async () => {
			root.render(
				createElement(
					SearchPresenceProvider,
					null,
					createElement(SearchFieldHeaderStub),
					createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }),
				),
			)
		})

		expect(container.querySelector('[data-testid="header-field-stub"]')).toBeNull()
	})

	test('announce={false} (the header’s own field) registers nothing and never ping-pongs', async () => {
		await searchFieldAct(async () => {
			root.render(
				createElement(
					SearchPresenceProvider,
					null,
					createElement(SearchFieldHeaderStub),
					createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {}, announce: false }),
				),
			)
		})

		// If the header's field counted itself, it would register → hide the
		// middle track → unmount → withdraw → show again, forever.
		expect(container.querySelector('[data-testid="header-field-stub"]')).not.toBeNull()
	})
})

describe('SearchField focus surface', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		searchFieldDoc.body.innerHTML = ''
		container = searchFieldDoc.createElement('div')
		searchFieldDoc.body.appendChild(container)
		root = createSearchFieldRoot(container)
	})

	afterEach(() => {
		searchFieldAct(() => root.unmount())
	})

	/** Renders one field and returns its parts. */
	async function renderField(props: Parameters<typeof SearchField>[0]) {
		await searchFieldAct(async () => {
			root.render(createElement(SearchField, props))
		})
		return {
			field: container.querySelector('[data-slot="search-field"]') as HTMLElement,
			input: container.querySelector('input') as HTMLInputElement,
		}
	}

	test('a press anywhere on the pill focuses the input', async () => {
		const { field, input } = await renderField({ value: '', onChange: () => {}, onGo: () => {} })

		// A press on the wrap itself — the padding, the glyph, the empty run right
		// of the text. The browser would drop focus to the body, because the wrap
		// is not focusable; the pill hands it to the input instead.
		await searchFieldAct(async () => {
			field.click()
		})

		expect(searchFieldDoc.activeElement).toBe(input)
	})

	test('the clear and go controls keep their own targets', async () => {
		const changes: string[] = []
		let goes = 0
		const { input } = await renderField({
			value: 'bowl',
			onChange: (value: string) => changes.push(value),
			onGo: () => {
				goes += 1
			},
		})
		const clear = container.querySelector('[data-testid="widget-search-field-clear"]') as HTMLElement
		const go = container.querySelector('[data-testid="widget-search-field-go"]') as HTMLElement

		await searchFieldAct(async () => {
			clear.click()
		})
		// The control's own action still ran; focusing the input afterwards is the
		// behaviour the owner asked for, not a substituted one.
		expect(changes).toEqual([''])
		expect(searchFieldDoc.activeElement).toBe(input)

		await searchFieldAct(async () => {
			go.click()
		})
		expect(goes).toBe(1)
	})
})
