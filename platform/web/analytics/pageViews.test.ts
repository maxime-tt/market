import { describe, expect, test } from 'bun:test'
import { buildPageViewPayload, createPageViewReporter, toPageViewPath } from './pageViews'

const ON = { enabled: true, src: 'https://analytics.example.org/', websiteId: 'site-1' }

describe('page views', () => {
	test('a search term and a listing id never leave the app', () => {
		expect(toPageViewPath('/?q=art')).toBe('/')
		expect(toPageViewPath('/?p=orange-flock-123')).toBe('/')
		expect(toPageViewPath('/products/some-listing?ref=nostr#top')).toBe('/products/some-listing')
	})

	test('the payload carries the website and a bare path, nothing else', () => {
		const body = buildPageViewPayload(ON, '/?q=pottery&p=abc')
		expect(body).toEqual({ type: 'pageview', payload: { website: 'site-1', url: '/' } })
		expect(Object.keys(body!.payload).sort()).toEqual(['url', 'website'])
	})

	test('unconfigured means silent — no fallback id and no fabricated figure', () => {
		expect(buildPageViewPayload({ enabled: false }, '/')).toBeNull()
		expect(buildPageViewPayload({ enabled: true, src: 'https://a.example' }, '/')).toBeNull()
	})

	test('the reporter sends nothing when disabled', async () => {
		const calls: unknown[] = []
		const fakeFetch = (async (...args: unknown[]) => {
			calls.push(args)
			return new Response('{}')
		}) as unknown as typeof fetch
		await createPageViewReporter({ enabled: false }, fakeFetch).record('/x?q=secret')
		expect(calls.length).toBe(0)
	})

	test('the reporter posts one pageview with no query string', async () => {
		const calls: Array<{ url: string; body: unknown }> = []
		const fakeFetch = (async (url: string, init: RequestInit) => {
			calls.push({ url, body: JSON.parse(String(init.body)) })
			return new Response('{}')
		}) as unknown as typeof fetch
		await createPageViewReporter(ON, fakeFetch).record('/auctions?q=watch')
		expect(calls).toEqual([
			{ url: 'https://analytics.example.org/api/send', body: { type: 'pageview', payload: { website: 'site-1', url: '/auctions' } } },
		])
	})
})
