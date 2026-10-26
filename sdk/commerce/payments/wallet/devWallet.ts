/**
 * devWallet.ts — the dev-only wallet affordances: the dev-mode predicate and the dev test mints.
 *
 * These are not wallet behaviour and not money: they gate the local-dev faucet (`mintTestEcash`),
 * the testnut keyset fallback and the dev bid helper. They live apart from the store modules so a
 * store can ask "is this a dev environment?" without carrying the dev globals, and so the retired
 * store's own name does not have to travel with them.
 *
 * `isWalletDevModeEnabled` is the M8 fix, kept verbatim: it gates ONLY on the explicit
 * `APP_NIP60_DEV_MODE` flag and local-dev host detection. It must never be enabled from `stage`
 * (a previous revision checked `stage === 'staging'`, which exposed wallet key material on
 * staging servers reachable by anyone).
 */

/**
 * Default to the public testnet mint. Set APP_DEV_TEST_MINT_URL to override
 * (e.g. http://localhost:3338 for local e2e tests with a local nutshell mint).
 * APP_DEV_TEST_MINT_URL is set on the server, but it may not reach the browser
 * bundle (bun reliably inlines NODE_ENV, not arbitrary custom vars), so the local
 * e2e mint (localhost:3338 / 127.0.0.1:3338) is also listed explicitly below so
 * mintTestEcash hits the local nutshell mint instead of external testnet mints.
 */
export const DEV_TEST_MINT_URL = process.env.APP_DEV_TEST_MINT_URL || 'https://testnut.cashu.space'

/**
 * The dev mints a faucet/fallback path may touch, upstream-preferred first. Values only; the
 * list decides *where* dev ecash comes from and never how money moves.
 */
export const WALLET_DEV_TEST_MINTS = Array.from(
	new Set(
		[
			DEV_TEST_MINT_URL,
			'http://localhost:3338',
			'http://127.0.0.1:3338',
			'https://testnut.cashu.space',
			'https://nofees.testnut.cashu.space',
		]
			.map((mint) => mint.trim().replace(/\/$/, ''))
			.filter(Boolean),
	),
)

const isLocalDevHost = (): boolean => {
	if (typeof window === 'undefined') return false
	// Total predicate: never throw when `location` is absent (some test
	// environments define a `window` global without one) — a dev-mode check
	// must not be able to take down the caller's flow.
	const host = window.location?.hostname
	if (!host) return false
	return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
}

export const isWalletDevModeEnabled = (): boolean => {
	// M8 FIX: Gate ONLY on the explicit APP_NIP60_DEV_MODE flag and local
	// dev host detection. Never enable based on stage (e.g. 'staging').
	const explicit = process.env.APP_NIP60_DEV_MODE
	if (explicit === 'true') return true
	if (explicit === 'false') return false

	// No explicit flag: fall back to local dev host detection only.
	// Never enable on staging or any non-local environment.
	return isLocalDevHost()
}
