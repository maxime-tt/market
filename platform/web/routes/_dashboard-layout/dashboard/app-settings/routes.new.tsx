import { createFileRoute } from '@tanstack/react-router'
import { RouteCreatePage } from '@platform/web/routes-authoring/routeAuthoringPage'

/** `/dashboard/app-settings/routes/new` — bind a path to a page. */
export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/routes/new')({
	component: RouteCreatePage,
})
