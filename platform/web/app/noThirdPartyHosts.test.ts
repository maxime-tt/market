import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'

/**
 * Privacy guard. The app and the widget book must never make a page load from
 * Google (fonts, analytics, tag manager, ads, video) or from any tracking or
 * analytics service: a request to one of those hosts tells a third party who
 * read the page. Fonts are bundled (styles/fonts.css) instead.
 *
 * This scans every shipped html, css and ts/tsx source for those hosts, so a
 * re-added `<link href="https://fonts.googleapis.com/...">` fails here rather
 * than reaching a reader.
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
]

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
})
