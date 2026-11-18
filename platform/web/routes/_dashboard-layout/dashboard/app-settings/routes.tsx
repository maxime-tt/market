import { createFileRoute, Outlet, useMatchRoute } from '@tanstack/react-router'
import { RouteAuthoringPage } from '@platform/web/routes-authoring/routeAuthoringPage'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/routes')({
	component: RoutesRoute,
})

function RoutesRoute() {
	const matchRoute = useMatchRoute()

	// The bind form and the edit form live at the child routes `routes/new` and
	// `routes/$path`. A child renders only where its parent renders an <Outlet/>,
	// so without this guard "New route" changes the URL and the list stays put.
	const isOnChildRoute =
		matchRoute({
			to: '/dashboard/app-settings/routes/new',
			fuzzy: true,
		}) ||
		matchRoute({
			to: '/dashboard/app-settings/routes/$path',
			fuzzy: true,
		})

	if (isOnChildRoute) return <Outlet />

	return <RouteAuthoringPage />
}
