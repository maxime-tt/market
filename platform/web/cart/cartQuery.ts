/**
 * platform/web/cart/cartQuery.ts — the React binding for the cart-snapshot read
 * (store drain D1, slice 5).
 *
 * The framework-free read (`readLatestCartSnapshotWorkflow`, the newest valid kind-30078 snapshot)
 * lives in `@sdk/commerce/cart/cartRead`; the snapshot selection moved there from
 * `src/lib/cart-persistence.ts`, which now re-exports it. This file keeps the react-query options and
 * resolves its relay port from `@platform/web/readContext.ts` (the file that owns the
 * `@/lib/stores/ndk` edge) instead of `@/lib/stores/ndk`, so it adds no counted `platform -> src`
 * import. `cartKeys.byPubkey` is literal-identical to the pre-drain key, so the store's
 * `fetchLatestCartSnapshot` consumer and any invalidator keep the same target. The vacated
 * `src/queries/cart.tsx` path is an `export *` shim over this file until E1.
 */
import type { PersistedCartContent } from '@sdk/commerce/cart/cartIntent'
import { readLatestCartSnapshotWorkflow, type CartSnapshotFilter, type CartSnapshotReadPort } from '@sdk/commerce/cart/cartRead'
import { cartKeys } from '@sdk/core/query/queryKeyFactory'
import { queryOptions } from '@tanstack/react-query'
import { createNdkReadContext } from '@platform/web/readContext'
import { getAppNdk } from '@platform/web/ndkPublishContext'

export { cartKeys }

/**
 * Build the relay port. The pre-drain read checked the NDK client before the pubkey, so this throws
 * `NDK not initialized` first; the read itself answers null for an empty pubkey.
 */
function createCartSnapshotPort(): CartSnapshotReadPort {
	if (!getAppNdk()) throw new Error('NDK not initialized')
	const context = createNdkReadContext()
	return {
		fetchEvents: (filter: CartSnapshotFilter) => context.fetch([filter]),
	}
}

export async function fetchLatestCartSnapshot(userPubkey: string): Promise<PersistedCartContent | null> {
	return await readLatestCartSnapshotWorkflow(createCartSnapshotPort(), userPubkey)
}

export const cartSnapshotQueryOptions = (userPubkey: string) =>
	queryOptions({
		queryKey: cartKeys.byPubkey(userPubkey),
		queryFn: () => fetchLatestCartSnapshot(userPubkey),
		enabled: !!userPubkey,
		staleTime: 60 * 1000,
		gcTime: 5 * 60 * 1000,
	})
