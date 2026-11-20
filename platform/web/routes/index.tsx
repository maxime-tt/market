import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { BrowseIndexHost } from '@platform/web/browse/BrowseIndexHost'
import { StorefrontAddressPage } from '@platform/web/storefront/StorefrontAddressPage'
import { StorefrontRenderer } from '@ui/storefront'
import { storefrontBlockSlots } from '@platform/web/storefront/StorefrontBlockSlots'
import { parseStorefrontPage, STOREFRONT_PAGE_VERSION } from '@sdk/commerce/storefront'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { LEGACY_HOME_PUBKEY, useInstanceHomePage } from '@platform/web/storefront/instanceHomePage'
import { ZINE_HOME_BLOCKS } from '@sdk/config/storefront/storefrontTemplates'

/**
 * The built-in home (ADR-0029): the "On the block" zine template, drawn when
 * no published `home` page resolves. Stable ids so React keeps each section
 * mounted across renders.
 */
const BUILT_IN_HOME = {
	version: STOREFRONT_PAGE_VERSION,
	enabled: true,
	root: { props: { title: '', theme: 'arena' as const, palette: 'arena' } },
	content: ZINE_HOME_BLOCKS.map((block, index) => ({ ...block, props: { ...block.props, id: `home-${block.type}-${index}` } })),
}
const builtInHomePage = parseStorefrontPage(JSON.stringify(BUILT_IN_HOME)).page

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
})

function BrowseIndex() {
	const { q, p } = Route.useSearch()
	const navigate = useNavigate()
	const { data: config } = useConfigQuery()
	// This instance's own `home` page (app key, owner or an admin, newest wins;
	// see instanceHomePage.ts), falling back to the upstream instance's. Read
	// first and unconditionally: the hook must run in every state of this route,
	// and the published page replaces the settled composition below without
	// changing the renderer.
	const { choice: publishedChoice, loading: homeLoading } = useInstanceHomePage()
	const publishedHome = publishedChoice?.page ?? null

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
		// No intro overlay and no welcome banner (ADR-0028): the page opens
		// straight onto its first block, the magazine cover by default.
		const page = arenaHome(publishedHome ?? (builtInHomePage as never))
		return (
			<>
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
			onWhyPlebeian={() => navigate({ to: '/$vanityName', params: { vanityName: 'featured' } })}
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
