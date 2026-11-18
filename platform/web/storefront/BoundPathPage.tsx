import { StorefrontAddressPage } from './StorefrontAddressPage'

/**
 * A page the server bound to this path, rendered inside the app's own chrome.
 *
 * The thin half of the `#__AR_ROUTE__` seam: `routes/__root.tsx` owns the guard
 * (which path, and the precedence over `<Outlet/>`) and this component owns the
 * wiring from the payload to the one existing page host. No renderer, no block
 * slots, no data fetch — `StorefrontAddressPage` already reads the page from
 * relays by `(author, d)`.
 *
 * `variant="embedded"` because the page is inside `<Header/>` + `<main>` +
 * footer here: its loading and empty states must not claim a full viewport.
 */
export function BoundPathPage({ payload }: { payload: { author: string; d: string } }) {
	return <StorefrontAddressPage dTag={payload.d} author={payload.author} variant="embedded" />
}
