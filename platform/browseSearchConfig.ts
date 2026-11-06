/**
 * platform/browseSearchConfig.ts — the browse-search settings the host publishes
 * to the browser, shared by the server route that emits them and the web host
 * that applies them.
 *
 * It sits at the platform root because BOTH trees need the shape: the server
 * (`platform/server/http/**`) reads it from the environment and puts it into the
 * `/api/config` payload; the web host (`platform/web/**`) reads it back at boot
 * and switches the search provider. Neither may import the other — server code
 * must not pull `@platform/web` into itself and web code must not pull
 * `@platform/server` into the browser bundle (`platform/boundary.test.ts`) — so
 * the shared shape lives here, where both can name it.
 *
 * Why the browser gets a `baseUrl` at all: the search client runs in the
 * browser, and the RabbitHole service binds loopback on the SERVER's box — for a
 * visitor, `http://127.0.0.1:7711` is their own machine. The host therefore
 * publishes the same-origin proxy path the browser posts to, never the loopback
 * address.
 *
 * Default-off: an unset environment resolves to `local`, the search path is
 * unchanged, and no proxy is mounted.
 */

import type { PublicAppConfig } from '@sdk/config/instance-config'

/** Which browse search provider the instance runs. */
export type BrowseSearchProvider = 'local' | 'rabbithole'

/**
 * The browse-search block of the public config.
 *
 * `provider` is always present. Both URLs are present only for `rabbithole`:
 *
 *   - `baseUrl` is what the BROWSER posts to — the app's own origin, because the
 *     service is reached through the same-origin proxy (`/api/browse-search`).
 *   - `upstream` is the server-side base the proxy forwards to, published so a
 *     deployment's placement is self-describing. No client code reads it.
 */
export interface BrowseSearchPublicConfig {
	provider: BrowseSearchProvider
	baseUrl?: string
	upstream?: string
}

/** The `/api/config` payload as this increment extends it. */
export type PublicAppConfigWithBrowseSearch = PublicAppConfig & { browseSearch?: BrowseSearchPublicConfig }
