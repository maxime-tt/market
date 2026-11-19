/**
 * `platform/web/chainMint.ts` — the host wiring for the chain's mint.
 *
 * `@sdk/commerce/payments/chainMint` holds the decision (pure, injected); this module supplies
 * the three reads it needs and is the single place both consumers go through:
 *
 * - **the wallet's first mint** — {@link resolveChainMint}, passed to `createCashuStore` as
 *   `resolveMintSeed` (`platform/web/wallet/cashuStore.ts`);
 * - **the escrow lock's target** — {@link resolveEscrowMintUrl}, called with the terms the bid
 *   funding path already read (`platform/web/auctions/relay/AuctionBidHost.tsx`).
 *
 * Both resolve to the same URL for the same terms, so the mint a bidder deposits into is the
 * mint the escrow locks at, and both are verified against the chain's anchored keyset.
 *
 * The reads:
 *
 * - the chain's terms — the anchored kind-1448 params, over the SDK read seam
 *   (`arenaParamsRead.ts`), exactly as the bid funding path reads them;
 * - the configured origin — `/api/config`'s `trustedMints` (`INSTANCE_TRUSTED_MINTS`),
 *   which is the browser-reachable origin of the same mint when the chain committed a loopback
 *   URL;
 * - each candidate's keysets — the mint's own `/v1/keysets`, through the auction layer's bounded
 *   `fetchMintKeysets` (2s timeout, short negative cache), because a mint URL proves nothing on
 *   its own.
 */
import type { EventStorePort } from '@sdk/core/event-store'
import type { Event } from '@sdk/core/nostr-io'
import { configStore } from '@sdk/config/app-config'
import { fetchMintKeysets } from '@sdk/commerce/auctions/validation'
import type { ChainMintResolution, ChainMintTerms } from '@sdk/commerce/payments/chainMint'
import { resolveChainMintFrom } from '@sdk/commerce/payments/chainMint'
import { createWebArenaParamsRead } from '@platform/web/auctions/relay/arenaParamsRead'
import { getAppRelayUrl, getReadContext } from '@platform/web/readContext'
import { arenaParamsRelays } from '@platform/web/auctions/relay/arenaParamsRelays'
import { webRelayPolicy } from '@platform/web/sdkNostrIo'

/**
 * The one bound on the params read.
 *
 * `arenaParamsRead`'s default is 8s, which is the right bound when a user is waiting to place a
 * bid. The wallet's seed happens on login, so a shorter bound keeps a silent relay from holding
 * the wallet's first mint hostage; a read that arrives after it is not needed — the next
 * initialize re-reads the terms.
 */
const MINT_PARAMS_DEADLINE_MS = 4000

/**
 * How long the resolver waits for the instance config before deciding there is no configured
 * origin.
 *
 * The configured origin is the only browser-reachable substitute for a loopback chain mint, and
 * `/api/config` is fetched by the app shell in parallel with the login that starts the wallet.
 * Without this wait the resolver can run first, see no configured mint, refuse, and leave the
 * wallet mintless for the whole session (the wallet's initialize does not re-run once ready).
 */
const CONFIG_WAIT_MS = 2000

/** The page's own origin, when there is a page: Local Network Access is relative to it. */
function pageOrigin(): string | null {
	return typeof window === 'undefined' ? null : window.location.origin
}

/** Read the mint's keyset ids; `[]` when the mint could not be read (timeout or failure). */
async function readKeysetIds(mintUrl: string): Promise<readonly string[]> {
	return (await fetchMintKeysets(mintUrl)).map((keyset) => keyset.id)
}

/**
 * The configured mints, waiting briefly for `/api/config` when the app shell has not delivered
 * it yet — see {@link CONFIG_WAIT_MS}. Returns `[]` when the wait elapses; the resolver then
 * refuses by name instead of guessing an origin.
 */
async function readConfiguredMints(): Promise<readonly string[]> {
	if (configStore.get().isLoaded) return configStore.get().config.trustedMints ?? []

	const { promise, resolve } = Promise.withResolvers<void>()
	const unsubscribe = configStore.subscribe(() => {
		if (configStore.get().isLoaded) resolve()
	})
	const timer = setTimeout(resolve, CONFIG_WAIT_MS)
	await promise
	unsubscribe()
	clearTimeout(timer)
	return configStore.get().config.trustedMints ?? []
}

/**
 * The relays the chain-terms read uses.
 *
 * The app's own query set is what every other params read uses (`AuctionBidHost`), but it is
 * populated with the session's relay list, which can arrive after the login that starts the
 * wallet. The chain publishes its params on the instance's own relay, so that relay is the
 * fallback when the query set is not configured yet — otherwise the first login of a fresh
 * identity reads nothing and the mint is resolved without chain verification.
 */
function chainRelays(): string[] {
	// The instance relay first, alone: the committee publishes its terms there,
	// and public relays carry other committees' terms (whose mint may be a
	// loopback address on their own host) — see `arenaParamsRelays`.
	const appRelay = getAppRelayUrl() ?? configStore.get().config.appRelay
	return arenaParamsRelays(appRelay, webRelayPolicy('query'))
}

/** The production read of the chain's terms; `null` when no anchored reading arrived. */
async function readChainMintTerms(): Promise<ChainMintTerms | null> {
	try {
		const read = createWebArenaParamsRead({
			relays: chainRelays(),
			store: getReadContext().store as unknown as EventStorePort<Event>,
			deadlineMs: MINT_PARAMS_DEADLINE_MS,
		})
		const { params } = await read()
		return params === null ? null : { mintUrl: params.terms.mint_url, keysetId: params.terms.keyset_id }
	} catch (err) {
		// A relay that cannot be read is health, not a throw: the resolver's no-terms path is the
		// honest answer, and it says so in the notice it returns.
		console.warn('[chain-mint] Failed to read the chain terms:', err)
		return null
	}
}

/**
 * Resolve the chain's mint from terms already in hand — the escrow path.
 *
 * A refusal must reach the caller, never a fallback to the terms' own URL: locking at a mint
 * whose keyset is not the chain's would commit the bidder's funds to an escrow the chain cannot
 * verify. Callers refuse the bid by the returned name instead.
 */
export async function resolveEscrowMintUrl(terms: ChainMintTerms): Promise<ChainMintResolution> {
	return resolveChainMintFrom({ terms, configuredMints: await readConfiguredMints(), pageOrigin: pageOrigin(), readKeysetIds })
}

/** Resolve the chain's mint for the wallet's first mint: read the terms, then resolve them. */
export async function resolveChainMint(): Promise<ChainMintResolution> {
	// Config first: it carries both the configured origin and (when the session's relay set is not
	// configured yet) the instance's own relay, which is where the chain publishes its terms.
	const configuredMints = await readConfiguredMints()
	const terms = await readChainMintTerms()
	return resolveChainMintFrom({ terms, configuredMints, pageOrigin: pageOrigin(), readKeysetIds })
}
