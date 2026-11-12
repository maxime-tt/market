/**
 * platform/web/config/appConfigStore.ts — the platform home of the temporary bidirectional
 * `@tanstack/store` `configStore` adapter over `@sdk/config/app-config`.
 *
 * The public app-config state and actions live in `@sdk/config/app-config` (rebuilt on
 * `sdk/core/state`). The adapter IS needed, and it IS bidirectional. Consumers force the legacy
 * `@tanstack/store` shape in both directions:
 *   - `useStore(configStore, (s) => s.config)` — read reactively
 *     (`platform/web/app/useRootRedirects.ts`, `platform/web/app/useDocumentIdentity.ts`,
 *     `src/components/sheet-contents/auctions/AuctionFormContent.tsx`); and `configStore.state.config.*`
 *     is read imperatively (`src/lib/stores/ndk.ts`, `src/queries/external.tsx`). The primitive exposes
 *     `get`/`subscribe`, not `state`.
 *   - `configStore.setState(...)` — several tests WRITE the store directly
 *     (`src/lib/__tests__/instance-config.test.ts`, `src/queries/__tests__/liveChat.test.ts`). A one-way
 *     mirror (the blacklist pattern) would drop those writes, so a direct `setState` routes into the SDK
 *     store, which then mirrors back — the SDK `configStore` stays the single source of truth for both
 *     the tanstack store and `configActions`.
 *
 * Moved out of `src/lib/stores/config.ts` in Wave E adapter drain W-E3.6; that file is now the src/ shim.
 * The adapter is TEMPORARY: it is deleted when these consumers are rewired to the reactive binding
 * (`platform/web/config/appConfigBinding.ts`, `useAppConfigState`).
 *
 * Deliberate non-reuse decision: `platform/web/config/appConfigBinding.ts` already mirrors the SDK state
 * into ITS OWN `Store`, but that store has no write-through and is a different object; re-pointing the
 * `configStore.setState` writers at it would change behaviour, so this slice creates a dedicated store
 * (least behavioural change) and records the duplication as debt.
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
