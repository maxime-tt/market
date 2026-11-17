import { QueryClientProvider, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { RouterContextProvider, useRouter, useRouterState, type AnyRouter } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { bootStore } from '@platform/web/boot'
import { WebUiProvider } from '@platform/web/WebUiProvider'
import { AppProviders } from '@platform/web/app/AppProviders'
import { StorefrontProvider } from '@ui/storefront/StorefrontContext'
import { isValidHexKey } from '@sdk/core/utils/utils'
import { shouldRenderStorefrontPage, storefrontAddressPageQueryOptions } from './storefront/storefrontQuery'
import { fillServedPageRegions } from './storefront/StorefrontBlockSlots'

/**
 * The served page — the client's half of the `#__AR_PAGE__` seam.
 *
 * The server resolved the path against the routing file and sent the page's
 * fragment (`platform/server/routes/pageHtml.ts`). The client does **not**
 * re-decide the route; it keeps the bytes it was sent and fills the data-bound
 * regions in the browser, which is `ARCHITECTURE.md` §5.5.2's split exactly:
 * the page's own data is rendered at ingest, live network state is filled here.
 *
 * **Why this is not inside the router.** Hydrating the served document through
 * `RouterProvider` is impossible, and it is worth recording how it fails
 * because it is the reason this module exists rather than one guard in
 * `__root.tsx`. Two mismatches, both measured in Chromium against the real
 * bundle:
 *
 *  1. the served `#root` holds the page and nothing else, while the root route
 *     renders the app chrome (header, main, footer) around its outlet — extra
 *     DOM the server never sent;
 *  2. TanStack's `Matches` renders `<Suspense fallback={null}>` on its first
 *     commit — the match tree is not there yet — so React sees the served DOM
 *     as unexpected and regenerates the whole tree client-side.
 *
 * Hydrating *outside* the router avoids both: the first commit renders one
 * `[data-ar-served-page]` element, exactly the element the server sent, and
 * adopts its children with `dangerouslySetInnerHTML` so React never reconciles
 * them. The static content a crawler reads is therefore also what a person
 * sees, from the first paint.
 *
 * A second consequence, and the reason the router is still *provided*: the
 * regions are filled with the app's own slot components, which navigate with
 * `useNavigate`/`Link`. They get the app's router through
 * `RouterContextProvider` — the context alone, no match tree — and the first
 * navigation hands the document over to the full app (`onNavigate`), because
 * from then on the URL is the app's business, not the served page's.
 */

/** The payload `pageHtml.ts` emits in `#__AR_PAGE__`. */
export interface ServedPagePayload {
	author: string
	d: string
	version: number
}

const PAYLOAD_SCRIPT_ID = '__AR_PAGE__'
const WRAPPER_SELECTOR = '[data-ar-served-page]'

let read = false
let payload: ServedPagePayload | null = null
let markup = ''
let servedPath: string | null = null

/** The server's own normalisation (`resolve.ts` `normalizePath`), so the two agree. */
const normalizePath = (pathname: string) => pathname.replace(/\/+$/, '').toLowerCase()

/**
 * The served page's payload and markup, read from the DOM the server sent.
 *
 * Read once, before React mounts: the wrapper's children are the server's own
 * bytes, and the first commit has to reproduce them, so they are captured
 * before anything can touch them. A document with no `#__AR_PAGE__` is not a
 * served page at all — `null` is what tells `frontend.tsx` to mount the app.
 */
export function readServedPage(): ServedPagePayload | null {
	if (read) return payload
	read = true

	const script = document.getElementById(PAYLOAD_SCRIPT_ID)
	if (!script?.textContent) return null

	try {
		const parsed = JSON.parse(script.textContent) as Partial<ServedPagePayload>
		if (typeof parsed.author !== 'string' || typeof parsed.d !== 'string') return null
		payload = { author: parsed.author, d: parsed.d, version: typeof parsed.version === 'number' ? parsed.version : 1 }
		markup = document.querySelector(WRAPPER_SELECTOR)?.innerHTML ?? ''
		servedPath = normalizePath(window.location.pathname)
	} catch {
		payload = null
	}

	return payload
}

/**
 * The served page, when `pathname` is the path it was served for — the root
 * route's guard, and the only place the payload is consulted after boot.
 *
 * The payload is a fact about *this document load*, not about the URL: once a
 * slot navigates, the app owns the URL and the served page is over. It comes
 * back only if the URL returns to the path the server answered for, which is
 * why the comparison is by path rather than a one-shot flag — a client-side
 * return to `/shop` must render the page the server served there, not the
 * `/$vanityName` surface, which knows nothing about the routing file.
 */
export function servedPageForPath(pathname: string): ServedPagePayload | null {
	if (!payload || servedPath === null) return null
	return normalizePath(pathname) === servedPath ? payload : null
}

/**
 * The served page's own element, and the regions inside it once they can be
 * filled.
 *
 * The first commit — the one hydration matches — is the wrapper with the
 * server's children adopted verbatim. Only after hydration does the effect run:
 * it reads the page's live document for `(author, d)` and fills the five
 * data-bound regions (`R4.3.4`: the slot map is applied after hydration, never
 * during it, or those subtrees would hydrate as mismatches).
 *
 * Filling waits for the app to be booted: every slot resolves its read through
 * the relay client `bootApp` initialises, so filling before then would only
 * paint error states over content the server already got right.
 */
export function ServedPage({ payload }: { payload: ServedPagePayload }) {
	const queryClient = useQueryClient()
	const router = useRouter()
	const bootStatus = useStore(bootStore, (state) => state.status)
	// Gated on the boot, and it is load-bearing: this is a *live* relay read, and
	// before `bootApp` finishes there is no relay client to read with. Measured
	// ungated — the query resolved `success` with no page, and React Query then
	// cached that empty answer for the query's whole stale window, so the regions
	// never filled; gated, the same read returns the page's event. Waiting costs
	// nothing: the server's own markup is already on screen.
	const q = useQuery({
		...storefrontAddressPageQueryOptions(payload.author, payload.d),
		enabled: bootStatus === 'ready' && isValidHexKey(payload.author) && payload.d.length > 0,
	})
	const page = shouldRenderStorefrontPage(q.data) ? q.data.page : null
	const container = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const element = container.current
		if (!element || !page || bootStatus !== 'ready') return
		return fillServedPageRegions(element, page, (children) => (
			<ServedRegionProviders author={payload.author} queryClient={queryClient} router={router}>
				{children}
			</ServedRegionProviders>
		))
	}, [page, bootStatus, payload.author, queryClient, router])

	return <div ref={container} data-ar-served-page="true" dangerouslySetInnerHTML={{ __html: markup }} />
}

/**
 * The document's React root when the server sent a page: the providers a slot
 * needs, and nothing that renders DOM of its own.
 *
 * `ThemeMigrationWrapper` and `AppOverlays` are deliberately absent — both
 * render elements (a themed wrapper, the toaster), and the served document's
 * first commit must be the served page alone. The page's theme arrives as the
 * inline custom properties the server put on its own wrapper, which the
 * fragment keeps.
 */
export function ServedPageRoot({
	payload,
	queryClient,
	router,
	app,
}: {
	payload: ServedPagePayload
	queryClient: QueryClient
	router: AnyRouter
	/** The full app, rendered once the served document has been navigated away from. */
	app: ReactNode
}) {
	const [handedOff, setHandedOff] = useState(false)

	// Once the URL leaves the served path the served document is over: the app
	// takes the URL back. Until then the page is the page.
	if (handedOff) return <>{app}</>

	return (
		<QueryClientProvider client={queryClient}>
			<WebUiProvider>
				<RouterContextProvider router={router}>
					<AppProviders>
						<ServedPageHandoff onNavigate={() => setHandedOff(true)} />
						<ServedPage payload={payload} />
					</AppProviders>
				</RouterContextProvider>
			</WebUiProvider>
		</QueryClientProvider>
	)
}

/**
 * The handoff: a slot navigated, so the served document is finished.
 *
 * The served page has no match tree, so nothing renders a new route until the
 * app mounts. This watches the router's own location — every slot navigates
 * through the router it is given — and asks the entrypoint to swap in the app.
 */
function ServedPageHandoff({ onNavigate }: { onNavigate: () => void }) {
	const href = useRouterState({ select: (state) => state.location.href })
	const servedHref = useRef(href)

	useEffect(() => {
		if (href !== servedHref.current) onNavigate()
	}, [href, onNavigate])

	return null
}

/** The providers a filled region needs, so a slot resolves like it does in the app. */
export function ServedRegionProviders({
	author,
	queryClient,
	router,
	children,
}: {
	author: string
	queryClient: QueryClient
	router: AnyRouter
	children: ReactNode
}) {
	return (
		<QueryClientProvider client={queryClient}>
			<WebUiProvider>
				<RouterContextProvider router={router}>
					<AppProviders>
						<StorefrontProvider value={{ pubkey: author, isEditing: false }}>{children}</StorefrontProvider>
					</AppProviders>
				</RouterContextProvider>
			</WebUiProvider>
		</QueryClientProvider>
	)
}
