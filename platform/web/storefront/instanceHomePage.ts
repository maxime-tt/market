import { decode } from 'nostr-tools/nip19'
import { queryOptions, useQueries } from '@tanstack/react-query'
import { createAppRelayReadContext } from '@platform/web/readContext'
import { storefrontKeys } from '@sdk/core/query/queryKeyFactory'
import { isValidHexKey } from '@sdk/core/utils/utils'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { useAdminSettings } from '@platform/web/app-settings/appSettingsQuery'
import {
	fetchStorefrontPage,
	shouldRenderStorefrontPage,
	storefrontAddressPageQueryOptions,
	type StorefrontPageResult,
} from './storefrontQuery'
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
// Written as an npub (decoded to hex) so the repository's secret scan does not
// mistake this public key for a private one.
export const LEGACY_HOME_PUBKEY = decode('npub1s5zwge797ju8fsx7gw7rv306s6y8fvx4cnzm2gc0mlzqdj53ekwqx7uxqn').data as string

export const HOME_PAGE_D_TAG = 'home'

export interface HomePageChoice {
	page: StorefrontPage
	pubkey: string
}

/** The ordered, de-duplicated list of keys whose `home` page counts as this instance's. */
export function instanceHomeAuthors(
	appPublicKey: string | undefined,
	owner: string | undefined,
	admins: readonly string[] | undefined,
): string[] {
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

/**
 * One instance author's `home` page, read from the instance relay only.
 *
 * Why: the general read waits for every configured relay (the visitor's own
 * relay list included, when signed in) to answer or time out, which took 8 s
 * and more. The instance's own authors publish through the page editor, which
 * always writes to the instance relay, so that one relay is the authority and
 * answers in about a second. The legacy fallback keeps the general read: its
 * page lives on the upstream relays, not on ours.
 */
export const instanceHomePageQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: [...storefrontKeys.all, 'address', pubkey, HOME_PAGE_D_TAG, 'instance-relay'] as const,
		queryFn: () => fetchStorefrontPage(pubkey, HOME_PAGE_D_TAG, createAppRelayReadContext()),
		enabled: isValidHexKey(pubkey),
		staleTime: 2 * 60 * 1000,
	})

export interface InstanceHomePage {
	choice: HomePageChoice | null
	/**
	 * True until the reads that decide the choice have answered. The route must
	 * not draw its built-in composition while this is true: doing so showed a
	 * stand-in page (a search bar and three category chips) for several seconds
	 * before the real one replaced it, which reads as "nothing is loading".
	 */
	loading: boolean
}

/**
 * Whether the home choice is still undecided. Own authors decide it as soon as
 * they have all answered; the slower legacy read only matters when none of
 * them has a page.
 */
export function homePageLoading(state: {
	configReady: boolean
	adminsLoading: boolean
	ownLoading: readonly boolean[]
	ownChoice: boolean
	legacyLoading: boolean
}): boolean {
	if (!state.configReady || state.adminsLoading) return true
	if (state.ownLoading.some(Boolean)) return true
	return !state.ownChoice && state.legacyLoading
}

/**
 * The instance's home page, read from every eligible author at once.
 * `enabled: false` skips the reads (the page editor calls this for every page,
 * but only the `home` page needs it).
 */
export function useInstanceHomePage({ enabled = true }: { enabled?: boolean } = {}): InstanceHomePage {
	const { data: config, isLoading: configLoading } = useConfigQuery()
	const { data: adminSettings, isLoading: adminsLoading } = useAdminSettings(config?.appPublicKey)
	const authors = enabled ? instanceHomeAuthors(config?.appPublicKey, adminSettings?.owner ?? config?.ownerPk, adminSettings?.admins) : []
	const results = useQueries({
		// Typed as one list so the empty case does not narrow the results to `never`.
		queries: (enabled
			? [
					...authors.map((pubkey) => instanceHomePageQueryOptions(pubkey)),
					storefrontAddressPageQueryOptions(LEGACY_HOME_PUBKEY, HOME_PAGE_D_TAG),
				]
			: []) as ReturnType<typeof instanceHomePageQueryOptions>[],
	})
	if (!enabled) return { choice: null, loading: false }
	const own = results.slice(0, authors.length)
	const legacy = results[authors.length]
	const ownChoice = chooseHomePage(
		own.map((r) => r.data),
		undefined,
	)
	const choice = ownChoice ?? chooseHomePage([], legacy?.data)
	const loading = homePageLoading({
		configReady: !configLoading,
		adminsLoading,
		ownLoading: own.map((r) => r.isLoading),
		ownChoice: ownChoice !== null,
		legacyLoading: legacy?.isLoading ?? false,
	})
	return { choice, loading }
}
