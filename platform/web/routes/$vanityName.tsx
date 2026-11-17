import { EmptyState } from '@ui/shared/empty-state'
import { createFileRoute, Link } from '@tanstack/react-router'

/**
 * `/` + one segment that the **server** did not resolve. It is a 404 surface,
 * and nothing more.
 *
 * `ruling-simple-routing-file.md:20-35` puts resolution on the server: rung 1 is
 * an exact binding, rung 1b is a compiled-in page, and rung 3 is 404. A segment
 * that reaches this component matched none of them — the server answered 404
 * for it (rung 3), and this component is what a client-side navigation to such
 * a segment renders, because the SPA cannot ask the routing file anything.
 *
 * What it deliberately does **not** do, and why:
 *
 *   - **no `resolveVanity` read.** The segment used to fall through to
 *     `resolveVanity(segment)` and then to `StorefrontAddressPage dTag={segment}`
 *     — i.e. *any* segment rendered the app key's page at that `d`. That is the
 *     pre-routing behaviour the ladder replaces: `/x` consults the routing file,
 *     a binding answers, and **no binding is 404** — never "an app-key page at
 *     `d=x`". The registry itself is untouched and still read by the
 *     dashboard/account surface; deleting it is increment 8.
 *   - **no `vanityStore` gate.** The old component returned `LoadingState` until
 *     the registry finished syncing from the relay, so a cold cache showed
 *     "Loading…" forever on a path that was never going to resolve. A 404 needs
 *     no registry, so this component reads no store at all: the answer is
 *     immediate and it cannot be gated by a relay.
 */
export const Route = createFileRoute('/$vanityName')({
	component: UnmatchedPathPage,
})

function UnmatchedPathPage() {
	return (
		<EmptyState
			className="min-h-screen"
			data-testid="route-not-found"
			title="Page not found"
			description="No page is published at this address."
			action={
				<Link to="/" className="text-sm underline underline-offset-4">
					Go to the home page
				</Link>
			}
		/>
	)
}
