// Types
export type { ProofInfo, PendingToken, PendingTokenContext, AuctionBidPendingTokenContext, ProofEntry } from './types'

// Proof utilities
export { extractProofsByMint, getProofsForMint, getSpendableProofsForMint } from './proofs'

// Storage utilities
export { loadUserData, saveUserData, removeUserData } from './storage'

// Display utilities
export { getMintHostname, formatSats, normalizeMintUrl } from './display'

// Wallet key material: the P2PK pair the auction HD root derives from, behind an injected store
export {
	InMemoryWalletKeyStore,
	WalletKeyMaterialError,
	deriveAuctionChildPrivkey,
	deriveAuctionHdXpub,
	loadWalletKeyMaterial,
	normalizeWalletKeyMaterial,
	type WalletKeyMaterial,
	type WalletKeyReason,
	type WalletKeyStore,
} from './walletKeys'
