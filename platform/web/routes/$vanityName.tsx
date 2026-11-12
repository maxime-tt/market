import { StorefrontAddressPage } from '@platform/web/storefront/StorefrontAddressPage'
import { StorefrontOrProfilePage } from '@platform/web/storefront/StorefrontOrProfilePage'
import { LoadingState } from '@ui/shared/loading-state'
import { vanityActions, vanityStore } from '@platform/web/config/vanityStore'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useStore } from '@tanstack/react-store'

export const Route = createFileRoute('/$vanityName')({
	component: VanityRouteComponent,
})

function VanityRouteComponent() {
	const { vanityName } = Route.useParams()
	const isLoaded = useStore(vanityStore, (s) => s.isLoaded)
	const lastUpdated = useStore(vanityStore, (s) => s.lastUpdated)

	// Resolve vanity URL to pubkey
	const resolvedPubkey = useMemo(() => {
		const entry = vanityActions.resolveVanity(vanityName)
		return entry?.pubkey ?? null
	}, [vanityName, isLoaded, lastUpdated])

	// Loading state while store syncs
	if (!isLoaded) {
		return <LoadingState className="min-h-screen" label="Loading…" />
	}

	// Vanity URL resolved - render the storefront page (or the standard profile fallback)
	if (resolvedPubkey) {
		return <StorefrontOrProfilePage profileId={resolvedPubkey} />
	}

	// Vanity resolution found nothing: the SAME segment is then a generic page
	// address on the app key (owner ruling, HANDOVER-CMS-INTEGRATION §6.1 — the
	// app router maps a path to a page event by address). The segment is handed
	// over verbatim as the `d` tag: `/featured` and `/featured-2026-11-03` take
	// this identical path, with no date or prefix special-casing anywhere. An
	// explicitly registered vanity name keeps precedence, which is why the
	// lookup order is vanity first, app-key page second.
	return <StorefrontAddressPage dTag={vanityName} />
}
