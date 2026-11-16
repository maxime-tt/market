import { createFileRoute } from '@tanstack/react-router'
import { RouteAuthoringPage } from '@platform/web/routes-authoring/routeAuthoringPage'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/routes')({
	component: RouteAuthoringPage,
})