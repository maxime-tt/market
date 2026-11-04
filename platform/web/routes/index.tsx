import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { BrowseIndexHost } from '@platform/web/browse/BrowseIndexHost'

/**
 * Browse URL state: ?q=&tag=&p=
 *
 * q   — search query string
 * tag — product category/hashtag filter
 * p   — open product event id; the split-view panel that consumes it is Phase 2
 */
const browseSearchSchema = z.object({
	q: z.string().default(''),
	tag: z.string().optional(),
	p: z.string().optional(),
})

export const Route = createFileRoute('/')({
	component: BrowseIndex,
	validateSearch: browseSearchSchema,
})

function BrowseIndex() {
	const { q, tag, p } = Route.useSearch()
	const navigate = useNavigate()

	return (
		<BrowseIndexHost
			q={q}
			tag={tag}
			onNavigate={(search) => {
				navigate({
					to: '/',
					search: {
						q: search.q ?? q,
						tag: search.tag ?? tag,
						p: search.p ?? p,
					},
				})
			}}
			onNavigateFeatured={() => navigate({ to: '/$vanityName', params: { vanityName: 'featured' } })}
		/>
	)
}
