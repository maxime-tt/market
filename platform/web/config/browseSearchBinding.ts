/**
 * platform/web/config/browseSearchBinding.ts — apply the host's published
 * browse-search settings to the client switch.
 *
 * This is the one place the `/api/config` payload meets
 * {@link configureBrowseSearch}: both config consumers call it — `boot.ts`,
 * which is how the SPA loads its config, and `publicConfigQuery.ts`, which
 * serves the query-side read of the same payload.
 *
 * When the payload carries no `browseSearch` block (a host deployed before this
 * increment), the switch is NOT touched at all: the client keeps its `local`
 * default, and the RabbitHole client keeps its own loopback base. That is the
 * default-off guarantee — an old host and a new one behave identically.
 */

import type { PublicAppConfigWithBrowseSearch } from '@platform/browseSearchConfig'
import { configureBrowseSearch } from '@platform/web/browse/browseQuery'

/** Point the browse search client at the provider and base this host publishes, if it publishes any. */
export function applyBrowseSearchConfig(config: PublicAppConfigWithBrowseSearch): void {
	const browseSearch = config.browseSearch
	if (!browseSearch) return
	configureBrowseSearch({ provider: browseSearch.provider, baseUrl: browseSearch.baseUrl })
}
