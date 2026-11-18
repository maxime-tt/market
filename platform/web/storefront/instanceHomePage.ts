import { useQueries } from '@tanstack/react-query'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { useAdminSettings } from '@platform/web/app-settings/appSettingsQuery'
import { shouldRenderStorefrontPage, storefrontAddressPageQueryOptions, type StorefrontPageResult } from './storefrontQuery'
import type { StorefrontPage } from '@sdk/commerce/storefront/storefrontPage'

/**
 * platform/web/storefront/instanceHomePage.ts — which `home` page `/` renders.
 *
 * Why: the home route used to read the `home` page of one hardcoded key, the
 * upstream instance's (`LEGACY_HOME_PUBKEY`). A self-hosted instance therefore
 * could never show a home page its own operators wrote. The page editor
 * publishes as the signed-in admin (`PageEditorPage` hands `currentUserPubkey`
 * to the builder), so "this instance's home page" is the newest `home` page by
 * any of: the instance's app key, its owner, or its admins.
 *
 * The legacy key stays as a fallback, so an instance whose relays carry the
 * upstream home page still shows it until one of its own authors publishes.
 * Own authors always win over the fallback, whatever the timestamps.
 */
export const LEGACY_HOME_PUBKEY = '8504e467c5f4b874c0de43bc3645fa868874b0d5c4c5b5230fdfc406ca91cd9c'

export const HOME_PAGE_D_TAG = 'home'

export interface HomePageChoice {
	page: StorefrontPage
	pubkey: string
}

/** The ordered, de-duplicated list of keys whose `home` page counts as this instance's. */
export function instanceHomeAuthors(appPublicKey: string | undefined, owner: string | undefined, admins: readonly string[] | undefined): string[] {
	const out: string[] = []
	for (const key of [appPublicKey, owner, ...(admins ?? [])]) {
		if (key && !out.includes(key) && key !== LEGACY_HOME_PUBKEY) out.push(key)
	}
	return out
}

/**
 * Picks the page to render: the newest publishable page among the instance's
 * own authors, else the legacy author's, else null (the route's built-in home).
 */
export function chooseHomePage(
	own: ReadonlyArray<StorefrontPageResult | undefined>,
	legacy: StorefrontPageResult | undefined,
): HomePageChoice | null {
	let best: (StorefrontPageResult & { page: StorefrontPage }) | null = null
	for (const result of own) {
		if (!shouldRenderStorefrontPage(result)) continue
		if (!best || (result.event?.created_at ?? 0) > (best.event?.created_at ?? 0)) best = result
	}
	if (best) return { page: best.page, pubkey: best.pubkey ?? '' }
	if (shouldRenderStorefrontPage(legacy)) return { page: legacy.page, pubkey: legacy.pubkey ?? LEGACY_HOME_PUBKEY }
	return null
}

/** The instance's home page, read from every eligible author at once. */
export function useInstanceHomePage(): HomePageChoice | null {
	const { data: config } = useConfigQuery()
	const { data: adminSettings } = useAdminSettings(config?.appPublicKey)
	const authors = instanceHomeAuthors(config?.appPublicKey, adminSettings?.owner ?? config?.ownerPk, adminSettings?.admins)
	const results = useQueries({
		queries: [...authors, LEGACY_HOME_PUBKEY].map((pubkey) => storefrontAddressPageQueryOptions(pubkey, HOME_PAGE_D_TAG)),
	})
	const data = results.map((r) => r.data)
	return chooseHomePage(data.slice(0, authors.length), data[authors.length])
}
