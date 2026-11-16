import { describe, expect, test } from 'bun:test'
import { createShellResponder } from './shell'

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