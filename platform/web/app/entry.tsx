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
import { loadRoutesFile } from '@platform/server/routes/routeFile'

import.meta.hot.accept()

// `serve()` requires the runtime singletons (NDK, app pubkey, app settings,
// bid-token listener) to be ready before any handler runs. We can't use
// top-level await here (tsconfig target predates ES2022) so the IIFE
// pattern is preserved from the previous shape — the server is exported
// via a deferred binding.
type ResolvedServer = ReturnType<typeof buildServer>
let resolvedServer: ResolvedServer | undefined
export const serverPromise: Promise<ResolvedServer> = (async () => {
	// The routing table is read once, here, before the server exists. An
	// unreadable or invalid table refuses boot — the site is broken, not
	// degraded (ARCHITECTURE.md §4.4). It is read before settings discovery so
	// a corrupt file fails immediately rather than after a relay timeout.
	const routing = loadRoutesFile(process.env.AR_ROUTES_FILE ?? './data/routes.json')
	for (const warning of routing.warnings) console.warn(`⚠️ ${warning.message}`)
	await initializeAppSettings()
	// Heavy relay-dependent EventHandler bootstrap runs in parallel with
	// HTTP serving — relay timeouts shouldn't block the setup form.
	void startEventHandlerInitialization()
	resolvedServer = buildServer({ indexHtml: index, routing: routing.file })
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
