import { describe, expect, test } from 'bun:test'
import { isValidRouteName } from '@sdk/config/routeNames'
import { createShellResponder, readShellAssets, SHELL_PATH } from './shell'

describe('readShellAssets — the bundle URLs, read from the shell bytes', () => {
	test('reads the module script and every stylesheet, in document order', () => {
		const assets = readShellAssets(
			'<!doctype html><html><head>' +
				'<link rel="preconnect" href="https://fonts.gstatic.com">' +
				'<link href="https://fonts.googleapis.com/css2?family=DM+Sans&display=swap" rel="stylesheet">' +
				'<link rel="stylesheet" crossorigin href="/chunk-a.css">' +
				'</head><body><script type="module" crossorigin src="/chunk-a.js" data-bun-dev-server-script></script>' +
				'<script>var beacon = 1</script></body></html>',
		)
		expect(assets.bootstrapSrc).toBe('/chunk-a.js')
		expect(assets.stylesheetHrefs).toEqual(['https://fonts.googleapis.com/css2?family=DM+Sans&display=swap', '/chunk-a.css'])
	})

	test('a shell with no bundle reports absence rather than a guessed path', () => {
		expect(readShellAssets('<!doctype html><html><head><title>x</title></head><body></body></html>')).toEqual({
			bootstrapSrc: null,
			stylesheetHrefs: [],
		})
	})

	test('only the first module script is taken — the dev beacon is not a second entry', () => {
		const assets = readShellAssets('<script type="module" src="/a.js"></script><script type="module" src="/b.js"></script>')
		expect(assets.bootstrapSrc).toBe('/a.js')
	})

	test('SHELL_PATH is two segments and outside the route-name grammar, so no binding can claim it', () => {
		expect(SHELL_PATH.split('/').filter(Boolean)).toHaveLength(2)
		expect(isValidRouteName(SHELL_PATH.split('/')[1])).toBe(false)
	})
})

describe('the SPA shell responder', () => {
	test('a Response shell is cloned per request, so a consumed body stays servable', async () => {
		const shell = createShellResponder({ indexHtml: new Response('SHELL', { headers: { 'content-type': 'text/html' } }) })
		expect(await (await shell()).text()).toBe('SHELL')
		expect(await (await shell()).text()).toBe('SHELL')
	})

	test('an HTML bundle is fetched once and re-served with its content type', async () => {
		let calls = 0
		const shell = createShellResponder({
			indexHtml: { index: 'platform/web/app/index.html' },
			fetchShell: async () => {
				calls += 1
				return new Response('<!doctype html><html>dev shell</html>', {
					headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-cache' },
				})
			},
		})

		const first = await shell()
		const second = await shell()
		expect(await first.text()).toContain('dev shell')
		expect(await second.text()).toContain('dev shell')
		expect(second.headers.get('content-type')).toBe('text/html;charset=utf-8')
		expect(second.headers.get('cache-control')).toBe('no-cache')
		expect(calls).toBe(1)
	})

	test('a failed shell fetch is a named error, not a silent empty page', async () => {
		const shell = createShellResponder({
			indexHtml: { index: 'x.html' },
			fetchShell: async () => new Response('nope', { status: 502 }),
		})
		await expect(shell()).rejects.toThrow('spa-shell-unavailable: the shell request answered 502')
	})

	test('no fetch configured for a bundle is a named error too', async () => {
		const shell = createShellResponder({ indexHtml: { index: 'x.html' } })
		await expect(shell()).rejects.toThrow('no shell fetch configured')
	})
})