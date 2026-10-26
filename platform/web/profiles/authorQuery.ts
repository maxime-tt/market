import { queryOptions } from '@tanstack/react-query'
import { createNdkReadContext } from '@platform/web/ndkReadContext'
import { isValidProfilePubkey, readAuthorWorkflow, type NostrAuthor } from '@sdk/core/profile'
import { authorKeys } from '@sdk/core/query/queryKeyFactory'

/**
 * platform/web/profiles/authorQuery.ts — the React binding for the author read
 * (store drain D1, slice 2).
 *
 * The read logic is framework-free (`readAuthorWorkflow`, `sdk/core/profile`); this file owns the
 * react-query options and resolves the port from `platform/web/ndkReadContext.ts`, so no part of
 * the read imports `@/lib/stores/ndk`. The query key is literal-identical to the pre-drain value.
 */

export type { NostrAuthor }

/** Reads the newest kind-0 metadata for `pubkey` through the app read context. */
export const fetchAuthor = async (pubkey: string): Promise<NostrAuthor> => readAuthorWorkflow(createNdkReadContext(), pubkey)

export const authorQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: authorKeys.details(pubkey),
		queryFn: () => fetchAuthor(pubkey),
		enabled: isValidProfilePubkey(pubkey),
	})
