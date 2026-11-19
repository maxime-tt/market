import { useStore } from '@tanstack/react-store'
import { configStore } from '@platform/web/config/appConfigStore'

/**
 * platform/web/config/instanceName.ts — the name this instance calls itself.
 *
 * Why this exists: the brand in the page chrome (the nav wordmark, the product
 * page title, `og:site_name`) must be the one the operator typed into the setup
 * form, not a literal in the code. A self-hosted instance that still says
 * "Plebeian Market" presents itself as somebody else's marketplace.
 *
 * The precedence mirrors `useDocumentIdentity`: displayName, then name, then the
 * fallback. The fallback covers the moments before `/api/config` resolves and an
 * instance that has not been set up yet.
 */
export const DEFAULT_INSTANCE_NAME = 'Plebeian Market'

type NamedConfig = { displayName?: string | null; name?: string | null } | null | undefined

export function resolveInstanceName(config: NamedConfig): string {
	return config?.displayName?.trim() || config?.name?.trim() || DEFAULT_INSTANCE_NAME
}

/** Reactive read of {@link resolveInstanceName} over the public app config. */
export function useInstanceName(): string {
	const config = useStore(configStore, (s) => s.config)
	return resolveInstanceName(config)
}
