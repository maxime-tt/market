import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { BrowseIndexHost } from '@platform/web/browse/BrowseIndexHost'
import { StorefrontAddressPage } from '@platform/web/storefront/StorefrontAddressPage'
import { StorefrontRenderer } from '@ui/storefront'
import { storefrontBlockSlots } from '@platform/web/storefront/StorefrontBlockSlots'
import { parseStorefrontPage, STOREFRONT_PAGE_VERSION } from '@sdk/commerce/storefront'
import { BrowseNav } from '@ui/browse/browse-nav'
import { HeaderAccountControls } from '@platform/web/layout/Header'
import { IntroOverlay } from '@ui/browse/intro'
import { useInstanceName } from '@platform/web/config/instanceName'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { LEGACY_HOME_PUBKEY, useInstanceHomePage } from '@platform/web/storefront/instanceHomePage'

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
	const instanceName = useInstanceName()
	const { data: config } = useConfigQuery()
	// This instance's own `home` page (app key, owner or an admin, newest wins;
	// see instanceHomePage.ts), falling back to the upstream instance's. Read
	// first and unconditionally: the hook must run in every state of this route,
	// and the published page replaces the settled composition below without
	// changing the renderer.
	const { choice: publishedChoice, loading: homeLoading } = useInstanceHomePage()
	const publishedHome = publishedChoice?.page ?? null
	// The intro plays over the home once per mount; it is an overlay, so the hero
	// renders underneath from the first paint and nothing waits on it.
	const [introDone, setIntroDone] = useState(false)

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
		// The home composition is the CMS block set (owner ruling): a `Search`
		// block, a hand-picked `ProductRow` and the flat `Categories` list,
		// rendered inside the browse chrome. It is expressed as a page document
		// so the same renderer that draws published pages draws this one — when
		// the app key's own `home` page resolves, this constant is replaced by it
		// and nothing else changes.
		const homePage = {
			version: STOREFRONT_PAGE_VERSION,
			enabled: true,
			root: { props: { title: '', theme: 'arena' as const, palette: 'arena' } },
			content: [
				{ type: 'Search' as const, props: { id: 'home-search', placeholder: 'Search the marketplace', size: 'lg' as const } },
				{
					type: 'ProductRow' as const,
					props: { id: 'home-row', productDTags: ['orange-flock-black-orange-edition-high-top-sneakers-ma5ond'] },
				},
				{
					type: 'Categories' as const,
					props: {
						id: 'home-cats',
						title: 'Browse by category',
						categories: [
							{ label: 'Art', key: 'art' },
							{ label: 'Clothing', key: 'clothing' },
							{ label: 'Bitcoin', key: 'bitcoin' },
						],
					},
				},
			],
		}
		const page = arenaHome(publishedHome ?? (parseStorefrontPage(JSON.stringify(homePage)).page as never))
		return (
			<>
				{!introDone && <IntroOverlay onDone={() => setIntroDone(true)} />}
				<BrowseNav
					wordmarkLabel={instanceName}
					active
					onNavigateHome={() => navigate({ to: '/' })}
					onNavigateFeatured={() => navigate({ to: '/$vanityName', params: { vanityName: 'featured' } })}
					accountSlot={<HeaderAccountControls />}
				/>
				{homeLoading ? (
					// Hold the space while the published page is read: drawing the built-in
					// composition here flashed a stand-in page before the real one.
					<div data-testid="home-page-loading" aria-busy="true" className="flex min-h-[60vh] items-center justify-center">
						<span className="sr-only">Loading the home page</span>
						<span aria-hidden className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40" />
					</div>
				) : (
					<StorefrontRenderer
						page={page}
						pubkey={publishedChoice?.pubkey ?? config?.appPublicKey ?? LEGACY_HOME_PUBKEY}
						slots={storefrontBlockSlots}
					/>
				)}
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

/**
 * The home page renders in the Arena theme so it sits inside the Arena chrome
 * (dark nav, search and footer; see `usesArenaChrome`). A published page that
 * picked a theme of its own keeps it; one left on the unthemed `default` —
 * including the upstream instance's page this one falls back to — is drawn
 * in Arena instead of as a light page inside a dark frame.
 */
function arenaHome<P extends { root: { props: { theme?: string; palette?: string } } }>(page: P): P {
	const theme = page.root.props.theme
	if (theme && theme !== 'default') return page
	return { ...page, root: { ...page.root, props: { ...page.root.props, theme: 'arena', palette: 'arena' } } }
}
