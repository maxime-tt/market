import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { BrowseIndexHost } from '@platform/web/browse/BrowseIndexHost'
import { StorefrontRenderer } from '@ui/storefront'
import { storefrontBlockSlots } from '@platform/web/storefront/StorefrontBlockSlots'
import { HOME_PAGE } from '@platform/web/storefront/homePage'
import { BrowseNav } from '@ui/browse/browse-nav'
import { IntroOverlay } from '@ui/browse/intro'

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

/**
 * The instance's own key — the identity the CMS authors pages as, and the
 * author the block slots resolve their reads against. Advertised by
 * `/api/config` as `appPublicKey`; kept here because the slots need it before
 * any page document exists.
 */
const APP_PUBKEY = '8504e467c5f4b874c0de43bc3645fa868874b0d5c4c5b5230fdfc406ca91cd9c'

function BrowseIndex() {
	const { q, p } = Route.useSearch()
	const navigate = useNavigate()
	// The intro plays over the home once per mount; it is an overlay, so the hero
	// renders underneath from the first paint and nothing waits on it.
	const [introDone, setIntroDone] = useState(false)

	// The home page is CMS-produced (owner ruling): with no search state on the
	// URL, `/` renders the CMS block set inside the browse chrome. The
	// composition is a real page document (`HOME_PAGE`, authored in
	// `storefront/homePage.ts`), so the same renderer that draws published pages
	// draws the home.
	//
	// Any `?q=` or `?p=` state still belongs to the browse surface: a CMS page
	// cannot answer a search, and the panel's own deep link has to keep working,
	// so the host takes over for those states.
	if (!q.trim() && !p) {
		return (
			<>
				{!introDone && <IntroOverlay onDone={() => setIntroDone(true)} />}
				<BrowseNav
					active
					onNavigateHome={() => navigate({ to: '/' })}
					onNavigateFeatured={() => navigate({ to: '/$vanityName', params: { vanityName: 'featured' } })}
				/>
				<StorefrontRenderer page={HOME_PAGE} pubkey={APP_PUBKEY} slots={storefrontBlockSlots} />
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
