import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { BrowseIndexHost } from '@platform/web/browse/BrowseIndexHost'
import { StorefrontAddressPage } from '@platform/web/storefront/StorefrontAddressPage'
import { BrowseNav } from '@ui/browse/browse-nav'

/**
 * Browse URL state: ?q=&p=
 *
 * q — the search term, and the ONLY way to browse. A category row's `See all →`
 *     and a facet pill both write their value here, so a tag is browsed as a
 *     keyword and relevance ranking orders the results. There is deliberately no
 *     tag parameter: an index filter could only narrow what the ranking already
 *     orders, and an empty term was never a browse state.
 * p — the open product (the listing's kind-30402 `d` tag); the split-view
 *     panel resolves it into the right-hand pane
 */
const browseSearchSchema = z.object({
	q: z.string().default(''),
	p: z.string().optional(),
})

export const Route = createFileRoute('/')({
	component: BrowseIndex,
	validateSearch: browseSearchSchema,
	/**
	 * The Browse surface draws its own nav (`BrowseNav`, rendered by
	 * `BrowseIndexHost` in every state — idle, results, split view), so the root
	 * layout must not stack the legacy app header above it. Declared here, on the
	 * route, because it is a property of this surface: every search state
	 * (`?q=`, `?p=`) inherits it. See `platform/web/layout/appChrome.ts`.
	 */
	staticData: { hidesAppHeader: true },
})

function BrowseIndex() {
	const { q, p } = Route.useSearch()
	const navigate = useNavigate()

	// The home page is CMS-produced (owner ruling): with no search state on the
	// URL, `/` renders the app key's `home` page inside the browse chrome. The
	// page supplies the content — a `Search` block, `ProductRow`s and
	// `Categories` — so the composition is authored in the builder rather than
	// hardcoded here.
	//
	// Any `?q=` or `?p=` state still belongs to the browse surface: a CMS page
	// cannot answer a search, and the panel's own deep link has to keep working,
	// so the host takes over for those states. An unpublished home page renders
	// the CMS empty state, which is honest — not the browse fallback, which would
	// hide the fact that nothing has been authored.
	if (!q.trim() && !p) {
		return (
			<>
				<BrowseNav
					active
					onNavigateHome={() => navigate({ to: '/' })}
					onNavigateFeatured={() => navigate({ to: '/$vanityName', params: { vanityName: 'featured' } })}
				/>
				<StorefrontAddressPage dTag="home" />
			</>
		)
	}

	return (
		<BrowseIndexHost
			q={q}
			p={p}
			onNavigate={(search) => {
				// The host states every field it owns, so the search object is written
				// back as given: `undefined` means "clear this param" (closing the
				// panel), which a `?? <current>` fallback here would silently swallow.
				navigate({
					to: '/',
					search: {
						q: search.q,
						p: search.p,
					},
				})
			}}
			onNavigateFeatured={() => navigate({ to: '/$vanityName', params: { vanityName: 'featured' } })}
		/>
	)
}
