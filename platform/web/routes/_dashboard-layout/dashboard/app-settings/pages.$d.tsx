import { createFileRoute } from '@tanstack/react-router'
import { PageEditorPage } from '@platform/web/routes-authoring/pageAuthoringPage'

/**
 * `/dashboard/app-settings/pages/$d` — the page editor at one address.
 *
 * `d` is the page's name and its `d` tag: there is no other identifier, and no
 * lookup happens here. The editor reads, drafts and publishes at exactly this
 * address, so a hand-typed URL is the same thing as a row click.
 */
export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/pages/$d')({
	component: PageEditorRoute,
})

function PageEditorRoute() {
	const { d } = Route.useParams()
	return <PageEditorPage d={d} />
}
