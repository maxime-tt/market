/**
 * auctionHost.ts — the two auction-rail facts that are *not* money movement, moved out of the
 * relay-backed store and behind injected ports: the auction HD xpub an auction publishes as its
 * `p2pk_xpub` tag, and the pending-token context attach that binds a freshly-locked bid leg to
 * the bid event that locked it.
 *
 * Neither of these moves money, and neither needs the relay wallet. The xpub is a pure function
 * of the wallet's P2PK keypair once that pair lives locally (`./walletKeys.ts`), and the context
 * attach is a read-modify-write over the pending-token list. Both used to read the store's live
 * `wallet` and `pendingTokens`; they reach them through {@link AuctionHost} instead, in the same
 * injected-port style as `AuctionLockHost` / `AuctionReclaimHost` (`./auctionFunds.ts`), so a
 * coco-backed host can satisfy them once the relay wallet is gone.
 *
 * The refusal semantics are kept deliberately: `getAuctionP2pkXpub` still refuses a wallet that
 * is not ready with the store's own message, and `updatePendingTokenContext` still returns
 * `null` (and writes nothing) when the token id is unknown — a caller that attaches a context to
 * the wrong id must not silently persist a list it did not build.
 */
import { getAuctionHdAccountFromWalletKeys } from '@/lib/auctionHd'
import type { PendingToken, PendingTokenContext } from './types'
import type { WalletKeyMaterial } from './walletKeys'

/**
 * What the host needs from the store it came from. Every member is a read or write the store
 * already performs; none of it is the relay wallet class.
 */
export interface AuctionHost {
	/** Whether the wallet is ready — the precondition the store's actions enforced. */
	isWalletReady(): boolean
	/** The wallet key material the auction HD root derives from (`./walletKeys.ts`). */
	resolveKeyMaterial(): Promise<WalletKeyMaterial>
	/** The current pending tokens. */
	getPendingTokens(): PendingToken[]
	/** Persist and publish a new pending-token list (user-scoped storage + store). */
	setPendingTokens(tokens: PendingToken[]): void
}

export interface AuctionHostActions {
	/** The auction HD account's xpub — the value an auction publishes as `p2pk_xpub`. */
	getAuctionP2pkXpub(): Promise<string>
	/** Attach a context to one pending token. Returns the updated token, or null when unknown. */
	updatePendingTokenContext(tokenId: string, context: PendingTokenContext): PendingToken | null
}

/**
 * The host's two actions, bound to {@link AuctionHost}. `getAuctionP2pkXpub` derives the account
 * from the key material exactly as the store's `getAuctionHdAccountFromWallet` did (same
 * `getAuctionHdAccountFromWalletKeys` call, same empty-xpub refusal), and
 * `updatePendingTokenContext` performs the store's `updatePendingTokenRecord` read-modify-write:
 * map over the live list, replace the matching token's context, persist, and return it — or
 * return null and write nothing when no token matched.
 */
export const createAuctionHost = (host: AuctionHost): AuctionHostActions => ({
	getAuctionP2pkXpub: async (): Promise<string> => {
		if (!host.isWalletReady()) {
			throw new Error('NIP-60 wallet not ready')
		}

		const material = await host.resolveKeyMaterial()
		const account = await getAuctionHdAccountFromWalletKeys(material.walletP2pk, material.walletPrivkey)
		const xpub = account.publicExtendedKey
		if (!xpub) {
			throw new Error('Failed to derive auction hd xpub')
		}
		return xpub
	},

	updatePendingTokenContext: (tokenId: string, context: PendingTokenContext): PendingToken | null => {
		let updatedToken: PendingToken | null = null
		const pendingTokens = host.getPendingTokens().map((token) => {
			if (token.id !== tokenId) return token
			updatedToken = { ...token, context }
			return updatedToken
		})

		if (!updatedToken) return null

		host.setPendingTokens(pendingTokens)
		return updatedToken
	},
})
