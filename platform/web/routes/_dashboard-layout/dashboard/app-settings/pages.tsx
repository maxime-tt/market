import { createFileRoute, Outlet, useMatchRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { PagesPage } from '@platform/web/routes-authoring/pageAuthoringPage'

/**
 * Browse state for the page list: `?name=` pre-fills the new-page field.
 *
 * The create-route flow's "create a new page instead" hands off to this surface
 * with the path as the suggested name, so the hand-off has to survive a
 * navigation — a search param does that, and it is deep-linkable.
 */
const pagesSearchSchema = z.object({ name: z.string().optional() })

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/pages')({
	component: PagesRoute,
	validateSearch: pagesSearchSchema,
})

function PagesRoute() {
	const { name } = Route.useSearch()
	const matchRoute = useMatchRoute()

	// The page editor lives at the child route `pages/$d`. A child renders only
	// where its parent renders an <Outlet/>, so without this guard the editor
	// navigates into view and never mounts: the URL changes and the list stays.
	const isOnChildRoute = matchRoute({
		to: '/dashboard/app-settings/pages/$d',
		fuzzy: true,
	})

	if (isOnChildRoute) return <Outlet />

	return <PagesPage suggestedName={name} />
}
