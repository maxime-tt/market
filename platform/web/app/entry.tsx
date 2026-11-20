/**
 * Bun server entrypoint. The actual server composition lives in
 * `platform/server/` — this file just wires the SPA shell, kicks off
 * initialisation, and exports the resulting Bun server instance.
 *
 * Anything bigger than a few lines belongs in a domain module under
 * `platform/server/` so this file stays a glance-able overview.
 */

import index from './index.html'
import { buildServer, initializeAppSettings, startEventHandlerInitialization } from '@platform/server'
import { loadRouteTable } from '@platform/server/routes/routeTable'
import { prepareWebBundle } from '@platform/server/http/prebuilt'

import.meta.hot.accept()

// `serve()` requires the runtime singletons (NDK, app pubkey, app settings,
// bid-token listener) to be ready before any handler runs. We can't use
// top-level await here (tsconfig target predates ES2022) so the IIFE
// pattern is preserved from the previous shape — the server is exported
// via a deferred binding.
type ResolvedServer = ReturnType<typeof buildServer>
let resolvedServer: ResolvedServer | undefined
export const serverPromise: Promise<ResolvedServer> = (async () => {
	// The routing table is read once, here, before the server exists. A missing
	// file is the empty table — a fresh checkout and a fresh deployment must
	// boot, and the first write creates it. An unreadable or invalid table
	// refuses boot — the site is broken, not degraded (ARCHITECTURE.md §4.4).
	// It is read before settings discovery so a corrupt file fails immediately
	// rather than after a relay timeout.
	// The table stays live after boot: route intents authored through the
	// ingest mutate this same object, and every request re-resolves against it.
	const routing = loadRouteTable(process.env.AR_ROUTES_FILE ?? './data/routes.json')
	for (const warning of routing.warnings()) console.warn(`⚠️ ${warning.message}`)
	// Production builds the code-split bundle (ADR-0027) while settings load; if
	// that fails, or in development, Bun bundles `index.html` at runtime.
	const prebuiltReady = process.env.NODE_ENV === 'production' ? prepareWebBundle() : Promise.resolve(null)
	await initializeAppSettings()
	// Heavy relay-dependent EventHandler bootstrap runs in parallel with
	// HTTP serving — relay timeouts shouldn't block the setup form.
	void startEventHandlerInitialization()
	const prebuilt = await prebuiltReady
	console.log(prebuilt ? '📦 Serving the prebuilt bundle (dist/web)' : '📦 Bundling index.html at runtime')
	resolvedServer = buildServer({ indexHtml: prebuilt?.indexHtml ?? index, routing, extraRoutes: prebuilt?.routes })
	console.log(`🚀 Server running at ${resolvedServer.url}`)
	return resolvedServer
})()

/**
 * Synchronous accessor for code that only runs after init resolves
 * (e.g. tests, hot-reload helpers). Throws if the server hasn't been
 * built yet.
 */
export const getServer = (): ResolvedServer => {
	if (!resolvedServer) throw new Error('Server is not ready yet — await serverPromise first')
	return resolvedServer
}

export type NostrMessage = ['EVENT', import('nostr-tools/pure').Event]
