/**
 * platform/server/http/config.test.ts — the browse-search block of `/api/config`.
 *
 * The settings must come from the SERVER's environment (the client cannot see
 * the server's loopback), and an unset environment must leave the payload on
 * `local` — the exact behaviour the instance had before the switch.
 *
 * The server runtime and the event handler are stubbed so this stays a route
 * test: bun's `mock.module` registry is consulted at import time and intercepts
 * `config.ts`'s relative imports (the same technique `browseQuery.test.ts` uses).
 * Per-file under `--isolate`.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test'

mock.module('@platform/server/runtime', () => ({
	determineStage: () => 'development',
	getAppPublicKeyOrThrow: () => 'a'.repeat(64),
	getAppSettings: () => null,
	getInstanceConfig: () => ({
		name: 'Test Market',
		displayName: 'Test Market',
		picture: 'https://test/picture.svg',
		banner: 'https://test/banner.png',
		allowRegister: true,
		defaultCurrency: 'USD',
		showNostrLink: false,
		handlerId: 'test-handler',
		siteUrl: 'https://test',
		publicRelays: ['wss://relay.test'],
		trustedMints: [],
		bugRelay: 'wss://bug.test',
		socialLinks: {},
	}),
	resolveCvmServerPubkey: () => undefined,
	isEventHandlerReady: () => false,
	NIP46_RELAY_URL: 'wss://relay.nsec.app',
	RELAY_URL: 'wss://relay.test',
	setAppSettings: () => {},
}))

mock.module('@platform/server/EventHandler', () => ({
	getEventHandler: () => {
		throw new Error('the config route test does not exercise bootstrap')
	},
}))

import { configRoutes } from './config'

const ORIGINAL_PROVIDER = process.env.BROWSE_SEARCH_PROVIDER
const ORIGINAL_UPSTREAM = process.env.BROWSE_SEARCH_UPSTREAM_URL

afterEach(() => {
	restoreEnv('BROWSE_SEARCH_PROVIDER', ORIGINAL_PROVIDER)
	restoreEnv('BROWSE_SEARCH_UPSTREAM_URL', ORIGINAL_UPSTREAM)
})

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name]
	else process.env[name] = value
}

/** The `/api/config` GET handler, narrowed from the route record's value union. */
function getConfig(): () => Response {
	return (configRoutes['/api/config'] as unknown as { GET: () => Response }).GET
}

/** Read the payload's `browseSearch` block, narrowed (no unchecked shape assumption). */
async function readBrowseSearch(): Promise<unknown> {
	const payload: unknown = await getConfig()().json()
	if (typeof payload !== 'object' || payload === null || !('browseSearch' in payload)) {
		throw new Error('the /api/config payload carries no browseSearch block')
	}
	return payload.browseSearch
}

describe('/api/config — the browse-search block', () => {
	test('unset means local — nothing changes by default', async () => {
		delete process.env.BROWSE_SEARCH_PROVIDER
		delete process.env.BROWSE_SEARCH_UPSTREAM_URL

		expect(await readBrowseSearch()).toEqual({ provider: 'local' })
	})

	test('a selected provider and upstream are published from the environment', async () => {
		process.env.BROWSE_SEARCH_PROVIDER = 'rabbithole'
		process.env.BROWSE_SEARCH_UPSTREAM_URL = 'http://127.0.0.1:9001'

		expect(await readBrowseSearch()).toEqual({
			provider: 'rabbithole',
			// The browser is told the same-origin proxy path, never the loopback address.
			baseUrl: '/api/browse-search',
			upstream: 'http://127.0.0.1:9001',
		})
	})

	test('the rest of the payload is untouched by the extension', async () => {
		delete process.env.BROWSE_SEARCH_PROVIDER

		const payload: unknown = await getConfig()().json()
		if (typeof payload !== 'object' || payload === null || !('appRelay' in payload) || !('stage' in payload)) {
			throw new Error('expected the standard public-config envelope')
		}
		expect(payload.appRelay).toBe('wss://relay.test')
		expect(payload.stage).toBe('development')
	})
})
