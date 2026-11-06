import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { BrowseIndexHost } from '@platform/web/browse/BrowseIndexHost'

/**
 * Browse URL state: ?q=&tag=&p=
 *
 * q   — search query string
 * tag — product category/hashtag filter
 * p   — the open product (the listing's kind-30402 `d` tag); the split-view
 *       panel resolves it into the right-hand pane
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
			p={p}
			onNavigate={(search) => {
				// The host states every field it owns, so the search object is written
				// back as given: `undefined` means "clear this param" (closing the
				// panel, switching the tag filter off), which a `?? <current>`
				// fallback here would silently swallow.
				navigate({
					to: '/',
					search: {
						q: search.q,
						tag: search.tag,
						p: search.p,
					},
				})
			}}
			onNavigateFeatured={() => navigate({ to: '/$vanityName', params: { vanityName: 'featured' } })}
		/>
	)
}
