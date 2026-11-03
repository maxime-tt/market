import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { EmptyState } from '@ui/shared/empty-state'
import { ErrorState } from '@ui/shared/error-state'
import { LoadingState } from '@ui/shared/loading-state'
import { StorefrontRenderer } from '@ui/storefront'
import { isValidHexKey } from '@sdk/core/utils/utils'
import { shouldRenderStorefrontPage, useStorefrontAddressPage } from './storefrontQuery'
import { storefrontBlockSlots } from './StorefrontBlockSlots'

/**
 * The generic kind-30024 address page (owner ruling, HANDOVER §6.1): the app
 * router maps a path segment to a page event by address, and this host is the
 * one resolver + renderer for every such path.
 *
 * The caller hands over the path segment as the `d` tag — verbatim. There is
 * deliberately no date parsing and no `featured-` prefix handling anywhere in
 * the path: `/featured` resolves to `(app key, 'featured')` and
 * `/featured-2026-11-03` to `(app key, 'featured-2026-11-03')` through this
 * identical code path, so a page deployed under any other `d` needs zero new
 * machinery.
 *
 * The app key comes from the public app config (`useConfigQuery`); it is never
 * hard-coded here and adds no settings field. This lane adds no app-key
 * publishing surface, so the coordinate is usually absent: that renders a
 * deliberate empty state, not an error. A page that fails to parse degrades to
 * the same empty state (relay content is untrusted until the parser accepts
 * it); a relay/transport failure surfaces as an error state with a retry.
 */
export function StorefrontAddressPage({ dTag }: { dTag: string }) {
	const { data: config, isLoading: isLoadingConfig } = useConfigQuery()
	const author = config?.appPublicKey ?? ''
	const hasAddress = isValidHexKey(author) && dTag.length > 0
	const { data: page, isLoading: isLoadingPage, isError, refetch } = useStorefrontAddressPage(hasAddress ? author : undefined, dTag)

	// The config read gates the page read (the query stays disabled without a
	// valid author), so the two loads are strictly sequential: wait for the
	// config first, then for the page.
	if (isLoadingConfig || (hasAddress && isLoadingPage)) {
		return <LoadingState className="min-h-screen" label="Loading…" />
	}

	if (isError) {
		return (
			<ErrorState
				className="min-h-screen"
				title="This page could not be loaded"
				message="The relay holding this page did not respond. Trying again may help."
				onRetry={() => void refetch()}
				retryTestId="storefront-address-retry"
			/>
		)
	}

	if (shouldRenderStorefrontPage(page) && page.pubkey) {
		return <StorefrontRenderer page={page.page} pubkey={page.pubkey} slots={storefrontBlockSlots} />
	}

	// Absent, disabled, zero-block and unparseable pages all land here: a
	// deliberate, token-clean empty state, never a blank page or an error.
	return (
		<EmptyState
			className="min-h-screen"
			data-testid="storefront-address-empty"
			title="Nothing published yet"
			description="No page has been published at this address."
		/>
	)
}
