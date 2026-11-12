/**
 * The NIP-89 app-settings event contract, shared by the server-side fetcher
 * (`platform/server/appSettings.ts`), the client-side submitter
 * (`platform/web/app-settings/appSettingsSubmit.ts`) and the instance-config
 * default. NDK-free and framework-free: these are protocol-level nouns, not
 * transport types (b3-relocate, 2026-10-30).
 */

/** Kind for NIP-89 handler information / app-config events. */
export const APP_SETTINGS_KIND = 31990

/** Exact d tag that identifies the Plebeian Market app-settings event. */
export const APP_SETTINGS_D_TAG = 'plebeian-market-handler'

/**
 * Structural shape needed to verify app-settings publisher authority. Kept
 * minimal (and independent of the NDKEvent class) so it is easy to construct
 * in tests.
 */
export interface AppSettingsEventLike {
	kind?: number
	pubkey: string
	tags: Array<string[]>
	created_at?: number
	content: string
}
