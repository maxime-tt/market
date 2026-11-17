import { createFileRoute } from '@tanstack/react-router'
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
	return <PagesPage suggestedName={name} />
}
