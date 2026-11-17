import { createFileRoute } from '@tanstack/react-router'
import { RouteEditPage } from '@platform/web/routes-authoring/routeAuthoringPage'

/**
 * `/dashboard/app-settings/routes/$path` — change which page a path serves.
 *
 * The path is immutable here: a path's identity is the key the whole table is
 * keyed on, so "move it" means "remove it and bind the new one". The page is
 * what this form changes.
 */
export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/routes/$path')({
	component: RouteEditRoute,
})

function RouteEditRoute() {
	const { path } = Route.useParams()
	return <RouteEditPage path={path} />
}
