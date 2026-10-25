/**
 * src/lib/stores/config.ts — the shim: `src/`'s view of the SDK app-config module, plus a temporary adapter.
 *
 * The public app-config state and actions moved to `@sdk/config/app-config` (rebuilt on `sdk/core/state`).
 * Every existing call site keeps importing `@/lib/stores/config` unchanged:
 *
 *   - `configActions.*` — plain functions. The `export *` below re-exports them from the SDK module.
 *   - `useConfig` — the non-reactive accessor; re-exported from the SDK module.
 *   - `configStore` — a `@tanstack/store` `Store`. The `export *` would re-export the SDK's PRIMITIVE
 *     `configStore` (`StateStore<ConfigState>`), so this file shadows that name with the adapter below — an
 *     explicit local export takes precedence over a `export *` of the same name (verified: `tsc` accepts it
 *     and the local binding wins at runtime).
 *
 * This adapter IS needed, and it is bidirectional. Consumers force the legacy `@tanstack/store` shape in both
 * directions:
 *   - `useStore(configStore, (s) => s.config)` — read reactively (`platform/web/app/useRootRedirects.ts:21`,
 *     `platform/web/app/useDocumentIdentity.ts:10`,
 *     `src/components/sheet-contents/auctions/AuctionFormContent.tsx:208`); and `configStore.state.config.*`
 *     is read imperatively (`src/lib/stores/ndk.ts:144`, `src/queries/external.tsx:44`, …). The primitive
 *     exposes `get`/`subscribe`, not `state`.
 *   - `configStore.setState(...)` — several consumers WRITE the store directly
 *     (`src/lib/__tests__/instance-config.test.ts:249`, `src/queries/__tests__/liveChat.test.ts:135,139,147`).
 *     A one-way mirror (the blacklist pattern) would drop those writes, so a direct `setState` routes into the
 *     SDK store, which then mirrors back — the SDK `configStore` stays the single source of truth for both the
 *     tanstack store and `configActions`.
 *
 * This adapter is TEMPORARY: it is deleted when these consumers are rewired to the reactive binding
 * (`platform/web/config/appConfigBinding.ts`, `useAppConfigState`); consumers migrate to it lazily. It may
 * become a `platform/web/config/appConfigBinding.ts` if a cross-tree reactive surface is wanted — and it is:
 * the config is nostr-derived (the instance's kind-31990 app-settings resolved via `/api/config`), so per the
 * owner's ruling it gets that binding.
 */
export * from '@sdk/config/app-config'

import { Store } from '@tanstack/store'
import { configStore as configSource } from '@sdk/config/app-config'
import type { ConfigState } from '@sdk/config/app-config'

/**
 * The `@tanstack/store` view of the SDK app-config state. It starts at the current state and the SDK store
 * pushes every change into it, so `useStore(configStore, selector)` and `configStore.state` render the live
 * value.
 */
export const configStore = new Store<ConfigState>(configSource.get())

/** The raw prototype updater, captured before the write-through override below installs on the instance. */
const setLocal = configStore.setState.bind(configStore)

// SDK -> tanstack: mirror every SDK change into the reactive store.
configSource.subscribe((next) => setLocal(() => next))

/**
 * tanstack -> SDK: a consumer that calls `configStore.setState` writes through to the single source of truth.
 * The SDK store then mirrors the new value back via the subscription above (or, for a referentially-equal
 * result, is left as-is and the local store is pinned to it explicitly).
 */
configStore.setState = ((updater: (prev: ConfigState) => ConfigState) => {
	const prev = configSource.get()
	const next = updater(prev)
	configSource.set(next)
	if (Object.is(next, prev)) setLocal(() => next)
}) as typeof configStore.setState
