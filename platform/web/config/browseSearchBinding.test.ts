/**
 * platform/web/config/browseSearchBinding.test.ts — the config → switch seam.
 *
 * The payload the host publishes is the ONLY input; the contract under test is
 * that a payload with no `browseSearch` block does not touch the switch at all
 * (so a host deployed before this increment keeps the client's `local` default
 * untouched), and that a published block moves both the provider and the base.
 *
 * The read seam is stubbed so this stays a binding test — the same technique
 * `browseQuery.test.ts` uses, per-file under `--isolate`.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test'

mock.module('@platform/web/readContext', () => ({
	getReadContext: () => ({
		stream: async function* () {},
		fetch: async () => [],
	}),
}))

import { DEFAULT_INSTANCE_CONFIG, type PublicAppConfig } from '@sdk/config/instance-config'
import { applyBrowseSearchConfig } from './browseSearchBinding'
import {
	configureBrowseSearch,
	getBrowseSearchBaseUrl,
	getBrowseSearchProvider,
	resetBrowseSearchConfig,
} from '@platform/web/browse/browseQuery'

const BASE_CONFIG: PublicAppConfig = {
	...DEFAULT_INSTANCE_CONFIG,
	appRelay: 'wss://relay.test',
	stage: 'development',
	nip46Relay: 'wss://relay.nsec.app',
	appSettings: null,
	appPublicKey: 'a'.repeat(64),
	needsSetup: false,
	serverReady: false,
	externalZapRelaysEnabled: false,
}

afterEach(() => {
	resetBrowseSearchConfig()
})

describe('applyBrowseSearchConfig', () => {
	test('a payload without a browseSearch block does not touch the switch', () => {
		// The switch is left wherever it was — proof it was not called at all.
		configureBrowseSearch({ provider: 'rabbithole', baseUrl: '/api/browse-search' })

		applyBrowseSearchConfig(BASE_CONFIG)

		expect(getBrowseSearchProvider()).toBe('rabbithole')
		expect(getBrowseSearchBaseUrl()).toBe('/api/browse-search')
	})

	test('a published block moves the provider and the base', () => {
		expect(getBrowseSearchProvider()).toBe('local')

		applyBrowseSearchConfig({ ...BASE_CONFIG, browseSearch: { provider: 'rabbithole', baseUrl: '/api/browse-search' } })

		expect(getBrowseSearchProvider()).toBe('rabbithole')
		expect(getBrowseSearchBaseUrl()).toBe('/api/browse-search')
	})

	test('a host that publishes the default provider keeps the switch on local', () => {
		configureBrowseSearch({ provider: 'rabbithole', baseUrl: '/api/browse-search' })

		applyBrowseSearchConfig({ ...BASE_CONFIG, browseSearch: { provider: 'local' } })

		expect(getBrowseSearchProvider()).toBe('local')
	})
})
