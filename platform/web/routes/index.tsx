import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { BrowseIndexHost } from '@platform/web/browse/BrowseIndexHost'

/**
 * URL state: ?q=&tag=&p=
 *
 * q — search query string
 * tag — product category/hashtag filter
 * p — open product event id (resolves into right-hand panel in Phase 2)
 */
export const browseSearchSchema = z.object({
	q: z.string().default(''),
	tag: z.string().optional(),
	p: z.string().optional(),
})

export type BrowseSearchState = z.infer<typeof browseSearchSchema>

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
			p={p}
			onNavigate={(search: Partial<BrowseSearchState>) => {
				navigate({
					search: {
						q: search.q ?? q,
						tag: search.tag ?? tag,
						p: search.p ?? p,
					},
				})
			}}
		/>
	)
}
