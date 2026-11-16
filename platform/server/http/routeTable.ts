import type { RouteTable } from '../routes/routeTable'
import type { BunRoutes } from './types'

/**
 * `GET /api/routes` — the read surface for the routing table.
 *
 * The table is instance state, not relay state: there is no event to subscribe
 * to for "what does this instance serve right now", so the admin authoring
 * surface asks the process that serves it. The response is the validated table
 * plus the warnings its own validator produced (today: `compiled-in-path`), so
 * the UI can show exactly what the server would act on instead of guessing.
 *
 * Read-only and unauthenticated on purpose: every path here is already public —
 * each one is a URL the instance serves — and the write path is the signed
 * ingest, not this endpoint. Nothing about a binding is secret; who may change
 * one is decided at `POST /api/app-events`.
 */
export function buildRouteTableRoutes({ table }: { table: RouteTable }): BunRoutes {
	return {
		'/api/routes': {
			GET: () =>
				new Response(
					JSON.stringify({
						version: table.current().version,
						seq: table.current().seq,
						default: table.current().default,
						bindings: table.current().bindings,
						warnings: table.warnings(),
					}),
					{
						headers: {
							'content-type': 'application/json; charset=utf-8',
							// The whole point of the read is that it reflects the process now.
							'cache-control': 'no-store',
						},
					},
				),
		},
	}
}