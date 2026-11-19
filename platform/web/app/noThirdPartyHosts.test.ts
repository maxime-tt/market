import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'

/**
 * Privacy guard. The app and the widget book must never make a page load from
 * Google (fonts, analytics, tag manager, ads, video) or from any tracking or
 * analytics service: a request to one of those hosts tells a third party who
 * read the page. Fonts are bundled (styles/fonts.css) instead.
 *
 * Fonts are stricter still: no font may come from any host other than this
 * app. Every @font-face and every stylesheet @import must be a relative URL.
 *
 * This scans every shipped html, css and ts/tsx source for those hosts, and
 * every stylesheet the sources import from a package (Puck's default
 * stylesheet, for one, @imports Inter from its author's host), so a re-added external
 * font fails here rather than reaching a reader.
 */
const BANNED = [
	/google(apis|usercontent|tagmanager|-analytics|syndication|adservices)?\.com/i,
	/gstatic\.com/i,
	/doubleclick\.net/i,
	/youtube(-nocookie)?\.com\/(embed|iframe_api)/i,
	/\bgtag\(/,
	/sentry\.io|sentry-cdn\.com/i,
	/posthog\.com|mixpanel\.com|segment\.(io|com)|hotjar\.com|amplitude\.com/i,
	/plausible\.io|clarity\.ms|cloudflareinsights\.com|connect\.facebook\.net/i,
	/rsms\.me|use\.typekit\.net|fonts\.bunny\.net|fontawesome\.com|fonts\.cdnfonts\.com/i,
]

/** Any absolute (http, https or protocol-relative) URL in a CSS @import or url(). */
const EXTERNAL_CSS_LOAD = /@import\s+(url\()?\s*["']?(https?:)?\/\/|url\(\s*["']?(https?:)?\/\/(?!www\.w3\.org)/i

/** Absolute URL inside an html `<link ... href=...>` for a stylesheet, preload or preconnect. */
const EXTERNAL_LINK = /<link[^>]+href=["'](https?:)?\/\//i

const ROOTS = ['platform', 'ui', 'sdk', 'styles', 'widget-book']
const SELF = 'platform/web/app/noThirdPartyHosts.test.ts'

describe('no Google or tracker hosts in shipped sources', () => {
	test('no file references a banned host', async () => {
		const hits: string[] = []
		for (const root of ROOTS) {
			for await (const path of new Glob(`${root}/**/*.{html,css,ts,tsx}`).scan('.')) {
				if (path === SELF || path.includes('node_modules')) continue
				const text = await Bun.file(path).text()
				for (const re of BANNED) {
					const m = text.match(re)
					if (m) hits.push(`${path}: ${m[0]}`)
				}
			}
		}
		expect(hits).toEqual([])
	})

	test('no stylesheet or html page loads anything from another host', async () => {
		const hits: string[] = []
		for (const root of ROOTS) {
			for await (const path of new Glob(`${root}/**/*.{html,css}`).scan('.')) {
				if (path.includes('node_modules')) continue
				const text = await Bun.file(path).text()
				const m = text.match(path.endsWith('.css') ? EXTERNAL_CSS_LOAD : EXTERNAL_LINK)
				if (m) hits.push(`${path}: ${m[0]}`)
			}
		}
		expect(hits).toEqual([])
	})

	test('no stylesheet imported from a package loads anything from another host', async () => {
		const hits: string[] = []
		for (const root of ROOTS) {
			for await (const path of new Glob(`${root}/**/*.{ts,tsx,css}`).scan('.')) {
				if (path.includes('node_modules')) continue
				const text = await Bun.file(path).text()
				for (const m of text.matchAll(/(?:import|@import)\s+["']([^."'/][^"']*\.css)["']/g)) {
					const resolved = Bun.resolveSync(m[1], `${process.cwd()}/${path}`)
					const css = await Bun.file(resolved).text()
					const bad = css.match(EXTERNAL_CSS_LOAD)
					if (bad) hits.push(`${path} imports ${m[1]}: ${bad[0]}`)
				}
			}
		}
		expect(hits).toEqual([])
	})

	test('the patched Puck build injects no external stylesheet at runtime', async () => {
		// Puck's JS also carries its stylesheet as a string and injects it when
		// it does not detect the static CSS. patches/@puckeditor%2Fcore@*.patch
		// strips the external @import from both; this proves the patch applied.
		const hits: string[] = []
		for await (const path of new Glob('node_modules/@puckeditor/core/dist/*.{js,mjs,css}').scan('.')) {
			const m = (await Bun.file(path).text()).match(EXTERNAL_CSS_LOAD)
			if (m) hits.push(`${path}: ${m[0]}`)
		}
		expect(hits).toEqual([])
	})
})
