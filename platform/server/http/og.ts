import { resolveServerOrigins, serveProductPageWithOg, type ServerOriginsEnv } from '@sdk/commerce/products/ogTags'
import { getProductOgMeta } from '../ogMeta'
import { PORT, RELAY_URL } from '../runtime'
import { SHELL_PATH } from '../routes/shell'
import type { BunRoutes } from './types'

/**
 * Serve the SPA shell for `/products/:productId` with og: meta tags injected
 * into the initial HTML, so crawlers and link unfurlers see the product's
 * title/description/image without executing JavaScript (issue #459).
 *
 * The shell is obtained by fetching from a SERVER-CONTROLLED origin
 * (`APP_SHELL_ORIGIN` / fixed loopback — never the request Host) at that
 * origin's shell path (`/`, or this process's `SHELL_PATH` since increment 3
 * made `/` the default binding's page), which runs it through Bun's HTML import
 * pipeline (asset rewrites, dev scripts) — so
 * the injected page stays byte-identical to the catch-all shell apart from
 * the extra `<meta>` tags. `og:url` / `og:image` use `APP_PUBLIC_ORIGIN`. On
 * any shell-fetch or lookup failure — unknown id, relay timeout, NSFW
 * product, rejected lookup, or render error — the untouched module shell is
 * served with HTTP 200: an SEO-only enrichment failure never reduces
 * product-page availability.
 *
 * `indexShell` is the same build artefact the entrypoint hands to
 * `buildServer` for the `'/*'` catch-all (Bun's `HTMLBundle`); it is the
 * fallback served whenever enrichment cannot run.
 */
export function ogRoutes(indexShell: unknown): BunRoutes {
	return {
		// Must beat the catch-all so the crawler response carries the tags.
		'/products/:productId': {
			GET: ({ params }) => productPageWithOg(params?.productId ?? '', indexShell),
		},
	}
}

function productPageWithOg(productId: string, indexShell: unknown): Promise<Response> {
	const { shellOrigin, publicOrigin } = resolveServerOrigins(
		{ APP_SHELL_ORIGIN: process.env.APP_SHELL_ORIGIN, APP_PUBLIC_ORIGIN: process.env.APP_PUBLIC_ORIGIN } satisfies ServerOriginsEnv,
		PORT,
	)
	return serveProductPageWithOg(
		productId,
		{
			shellOrigin,
			publicOrigin,
			relayUrl: RELAY_URL,
			indexShell: indexShell as object,
			getProductOgMeta,
		},
		shellFetcher,
	) as Promise<Response>
}

/**
 * The shell fetch, re-pointed at `SHELL_PATH` when the shell origin is **this**
 * process.
 *
 * `serveProductPageWithOg` asks for `/` at a server-controlled origin, which
 * was the shell until increment 3: `/` is now the default binding's page
 * (`ARCHITECTURE.md` §3.5 R4), so on this process the shell is at
 * `SHELL_PATH` (`routes/shell.ts`). A separately served shell origin
 * (`APP_SHELL_ORIGIN`) still answers `/` and is left alone. Only the *path* is
 * chosen here — the origin still comes from `resolveServerOrigins`, so a
 * hostile `Host` header cannot move the destination.
 */
const shellFetcher = (url: URL | string, init?: RequestInit): Promise<{ ok: boolean; text(): Promise<string> }> => {
	const target = new URL(String(url))
	if (target.origin === `http://localhost:${PORT}` || target.origin === `http://127.0.0.1:${PORT}`) target.pathname = SHELL_PATH
	return fetch(target, init)
}
