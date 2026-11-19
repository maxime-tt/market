/**
 * `chainMint.ts` — which URL the wallet and the escrow must use for the chain's mint.
 *
 * ## Why this module exists
 *
 * The chain commits its mint in the anchored kind-1448 params: the terms carry the escrow's
 * `mint_url` and the `keyset_id` the mint must serve. Two consumers need that mint:
 *
 * 1. **The wallet's first mint.** coco starts empty and ADR-0010 dropped the kind-17375 mint
 *    list, so a fresh identity holds no mint, cannot deposit, and the deposit form has nothing
 *    to offer. The chain's mint is what seeds it.
 * 2. **The escrow lock's target.** `lockArenaEscrowWithCoco` locks the bidder's sats at a mint,
 *    and coco refuses a mint it does not trust (`UnknownMintError: Mint … is not trusted`).
 *
 * One fact makes the chain's `mint_url` unusable as-is from a browser: it can be a **loopback
 * URL**. The demo chain commits `http://127.0.0.1:3338`, which a page with a public origin may
 * not reach (Chrome's Local Network Access gate), so both consumers would fail — the wallet
 * could not register it and the escrow’s `addMint` would fail and leave the mint untrusted.
 *
 * ## The rule
 *
 * A mint URL identifies nothing; the **keyset** does. So a configured, browser-reachable origin
 * (`INSTANCE_TRUSTED_MINTS` via `/api/config`) may stand in for a chain URL a browser cannot
 * reach **only when it serves the chain's keyset**, and the chain's own URL is used directly
 * when it is reachable. Every candidate is checked, and a mismatch is refused by name — seeding
 * or locking at a mint whose keyset is not the chain's would commit the bidder's funds to an
 * escrow the chain cannot verify.
 *
 * Pure: the terms, the configured mints and the keyset reader are all injected, so the decision
 * is testable with no relay, no config and no network. The production wiring lives in
 * `platform/web/chainMint.ts`.
 */

/** The chain's two mint terms; `null` when the anchored reading did not carry them. */
export interface ChainMintTerms {
	mintUrl: string | null
	keysetId: string | null
}

/**
 * The named ways resolving the chain's mint can be refused or qualified.
 *
 * - `chain.mint.nothing-configured` — no anchored chain reading and no configured mint to fall
 *   back to, so there is nothing to resolve and no honest way to pick one.
 * - `chain.mint.params-incomplete` — the chain's terms arrived without a mint URL or a keyset
 *   id, so the mint cannot be established or verified.
 * - `chain.mint.no-reachable-origin` — the chain's own mint URL is not one a browser may reach
 *   (loopback/private) and the instance configures no reachable origin to stand in for it.
 * - `chain.mint.keyset-mismatch` — a candidate mint answered with keysets, none of which is the
 *   one the chain anchored. The candidate is *not* the chain's mint.
 * - `chain.mint.keyset-unverifiable` — no candidate could be read at all (unreachable, timeout,
 *   or no keysets), so the chain's keyset could not be confirmed anywhere.
 */
export type ChainMintRefusalName =
	| 'chain.mint.nothing-configured'
	| 'chain.mint.params-incomplete'
	| 'chain.mint.no-reachable-origin'
	| 'chain.mint.keyset-mismatch'
	| 'chain.mint.keyset-unverifiable'

/**
 * What resolving the chain's mint produced. A refusal carries a {@link ChainMintRefusalName} and
 * a message naming what was checked; a success may carry a `notice` when it landed but some
 * verification step was unavailable (never silently — the caller records the notice).
 */
export type ChainMintResolution =
	| { ok: true; mintUrl: string; keysetId: string; notice?: string }
	| { ok: false; refusal: ChainMintRefusalName; message: string }

/** Resolves the chain's mint; supplied by the host wiring, which owns the reads. */
export type ChainMintResolver = () => Promise<ChainMintResolution>

export interface ChainMintResolutionInput {
	/** The chain's escrow terms, or `null` when no anchored reading was available. */
	terms: ChainMintTerms | null
	/** The instance's configured mints — the browser-reachable origin override. */
	configuredMints: readonly string[]
	/**
	 * The page's own origin, when the host can see it. Chrome's Local Network Access gate is
	 * relative to the requesting page: a loopback/private mint URL is reachable from a page that
	 * is itself local (a dev server on `localhost` with the local mint on `:3338`) and blocked
	 * from a public-origin page. Absent means "assume the page is public".
	 */
	pageOrigin?: string | null
	/** The keyset ids a mint advertises; `[]` when it could not be read. */
	readKeysetIds: (mintUrl: string) => Promise<readonly string[]>
}

/** `http:`/`https:` only; anything else cannot be a NUT-04 mint. */
function isHttpMintUrl(value: string): boolean {
	try {
		const protocol = new URL(value).protocol
		return protocol === 'http:' || protocol === 'https:'
	} catch {
		return false
	}
}

/** Trailing-slash-normalized, deduped, http(s)-only — the URLs resolution may consider. */
function normalizeMintUrls(mints: readonly string[]): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const candidate of mints) {
		const normalized = candidate.trim().replace(/\/+$/, '')
		if (!normalized || !isHttpMintUrl(normalized) || seen.has(normalized)) continue
		seen.add(normalized)
		out.push(normalized)
	}
	return out
}

/** Strip the brackets `new URL` keeps on an IPv6 literal's `.hostname`. */
function hostOf(url: URL): string {
	return url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
}

/** Whether a host resolves only inside the requester's own machine or network. */
function isLocalNetworkHost(host: string): boolean {
	if (!host) return true
	if (host === 'localhost' || host.endsWith('.local')) return true
	if (host === '::1' || host === '0.0.0.0') return true
	if (host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) return true
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
	// A single-label host resolves inside the local network, not the public one.
	if (!host.includes('.') && !host.includes(':')) return true
	return false
}

/**
 * Whether the page may reach this mint at all.
 *
 * A public mint is reachable from anywhere. A loopback/private mint is reachable only from a page
 * that is itself local: Chrome's Local Network Access gate blocks a public-origin page from
 * requesting loopback and private-network hosts (measured on the deployed instance: the same
 * `fetch` to the local mint fails from the public-origin page and answers 200 from a
 * loopback-origin page). A configured origin is only a *substitute* for such a URL, so the
 * chain's own URL is skipped rather than attempted when it is not reachable; when it is, it is
 * the first candidate, because a same-keyset configured URL is a substitution and the chain's own
 * URL is not.
 */
export function isBrowserReachableMintUrl(mintUrl: string, pageOrigin?: string | null): boolean {
	let url: URL
	try {
		url = new URL(mintUrl.trim().replace(/\/+$/, ''))
	} catch {
		return false
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
	if (!isLocalNetworkHost(hostOf(url))) return true
	if (!pageOrigin) return false
	try {
		return isLocalNetworkHost(hostOf(new URL(pageOrigin)))
	} catch {
		return false
	}
}

/**
 * Resolve the chain's mint: the chain's URL when a browser may reach it, otherwise the
 * configured origin that serves the chain's keyset, verified every time.
 *
 * Refusals are returned, never thrown, and each names what was checked — see
 * {@link ChainMintRefusalName}. With no anchored reading at all there is nothing to verify
 * against, so the first configured mint that answers with keysets is used and the notice names
 * the missing verification. The alternative — refusing — would leave the wallet mintless exactly
 * when the relay is slow, and the notice keeps the qualification visible instead of silent.
 */
export async function resolveChainMintFrom(input: ChainMintResolutionInput): Promise<ChainMintResolution> {
	const configured = normalizeMintUrls(input.configuredMints)
	const terms = input.terms

	if (!terms) {
		if (configured.length === 0) {
			return {
				ok: false,
				refusal: 'chain.mint.nothing-configured',
				message: 'No anchored chain terms are available and the instance configures no mint to resolve against.',
			}
		}
		for (const mintUrl of configured) {
			const keysetIds = await input.readKeysetIds(mintUrl)
			if (keysetIds.length === 0) continue
			return {
				ok: true,
				mintUrl,
				keysetId: keysetIds[0],
				notice:
					'chain.mint.params-unavailable: no anchored chain terms were readable, so the configured mint was used without ' +
					'checking it against the chain’s keyset.',
			}
		}
		return {
			ok: false,
			refusal: 'chain.mint.keyset-unverifiable',
			message: `No configured mint could be read (${configured.join(', ')}).`,
		}
	}

	const chainMintUrl = terms.mintUrl ? terms.mintUrl.trim().replace(/\/+$/, '') : ''
	const chainKeysetId = terms.keysetId?.trim() ?? ''
	if (!chainMintUrl || !chainKeysetId) {
		return {
			ok: false,
			refusal: 'chain.mint.params-incomplete',
			message: `The chain terms name ${chainMintUrl ? 'a mint' : 'no mint'} and ${chainKeysetId ? 'a keyset' : 'no keyset id'}; both are required to establish and verify the mint.`,
		}
	}

	const chainMintReachable = isBrowserReachableMintUrl(chainMintUrl, input.pageOrigin)
	const candidates = [...(chainMintReachable ? [chainMintUrl] : []), ...configured.filter((mint) => mint !== chainMintUrl)]

	if (candidates.length === 0) {
		return {
			ok: false,
			refusal: 'chain.mint.no-reachable-origin',
			message:
				`The chain's mint ${chainMintUrl} (keyset ${chainKeysetId}) is not one a browser may reach, and the instance configures ` +
				'no browser-reachable origin to stand in for it.',
		}
	}

	const checked: Array<{ mintUrl: string; keysetIds: readonly string[] }> = []
	for (const mintUrl of candidates) {
		const keysetIds = await input.readKeysetIds(mintUrl)
		checked.push({ mintUrl, keysetIds })
		if (keysetIds.includes(chainKeysetId)) return { ok: true, mintUrl, keysetId: chainKeysetId }
	}

	const answered = checked.filter((entry) => entry.keysetIds.length > 0)
	if (answered.length > 0) {
		return {
			ok: false,
			refusal: 'chain.mint.keyset-mismatch',
			message:
				`The chain's keyset ${chainKeysetId} is not served by any candidate: ` +
				`${answered.map((entry) => `${entry.mintUrl} serves [${entry.keysetIds.join(', ')}]`).join('; ')}.`,
		}
	}

	return {
		ok: false,
		refusal: 'chain.mint.keyset-unverifiable',
		message:
			`None of the candidate mints could be read, so the chain's keyset ${chainKeysetId} could not be confirmed: ` +
			`${checked.map((entry) => entry.mintUrl).join(', ')}.`,
	}
}
