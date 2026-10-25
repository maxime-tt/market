/**
 * sdk/config/app-config.ts — the resolved public app-config state and the actions over it, on the generic
 * state primitive.
 *
 * The state moved here from `src/lib/stores/config.ts` and is one `createStateStore` instance; every action
 * reads or replaces it through `get`/`set`. The public surface the app already imports is unchanged —
 * `ConfigState`, `configStore`, `configActions` (every method) and `useConfig` keep the same semantics — so a
 * consumer sees no difference; only the mechanism underneath is now the shared primitive rather than a
 * hand-rolled `@tanstack/store` `Store`.
 *
 * This module holds no React and no `@tanstack/*`. Unlike the state modules rebuilt before it, `config` has
 * consumers that need a `@tanstack/store`-shaped object — several components read it with
 * `useStore(configStore, selector)` and several call `configStore.setState(...)` / read `configStore.state`
 * directly — so the `Store`-shaped adapter lives in `src/lib/stores/config.ts`, not here.
 *
 * This IS nostr-derived state: the config is the instance's nostr-published app-settings (kind 31990),
 * resolved server-side and fetched from `/api/config`, and consumers require cross-tree reactivity (the setup
 * redirect must react to a config change while the user stays on the route). Per the owner's ruling it
 * therefore gets a reactive binding, `platform/web/config/appConfigBinding.ts`.
 */
import { createStateStore } from '../core/state'
import type { StateStore } from '../core/state'
import type { PublicAppConfig } from './instance-config'
import type { Stage } from './constants'

export interface ConfigState {
	config: Partial<PublicAppConfig>
	isLoaded: boolean
}

const initialState: ConfigState = {
	config: {},
	isLoaded: false,
}

/**
 * The resolved app-config state, on the generic primitive. Exposed so a host can bridge it to its own
 * reactivity (`platform/web/config/appConfigBinding.ts`) or seed it; `src/lib/stores/config.ts` keeps the
 * `@tanstack/store`-shaped adapter consumers read with `useStore`. This module holds no React and no
 * `@tanstack/*`.
 */
export const configStore: StateStore<ConfigState> = createStateStore<ConfigState>({ initial: initialState })

export const configActions = {
	setConfig: (config: PublicAppConfig) => {
		configStore.set((state) => ({
			...state,
			config,
			isLoaded: true,
		}))
		return config
	},

	getAppRelay: () => {
		return configStore.get().config.appRelay
	},

	getStage: (): Stage => {
		return configStore.get().config.stage || 'development'
	},

	getAppPublicKey: () => {
		return configStore.get().config.appPublicKey
	},

	getAppSettings: () => {
		return configStore.get().config.appSettings
	},

	needsSetup: () => {
		return configStore.get().config.needsSetup
	},

	isConfigLoaded: () => {
		return configStore.get().isLoaded
	},
}

/**
 * Non-reactive accessor: the current app-config state merged with the actions. Kept for parity with the source
 * module; a component that must re-render on a config change uses the reactive binding in the platform layer
 * (`useAppConfigState`) instead.
 */
export const useConfig = () => {
	return {
		...configStore.get(),
		...configActions,
	}
}
