// Types
export type { ProofInfo, PendingToken, PendingTokenContext, AuctionBidPendingTokenContext, ProofEntry } from './types'

// Proof utilities
export { extractProofsByMint, getProofsForMint, getSpendableProofsForMint } from './proofs'

// The wallet keypair's local home (sealed at rest)
export { SealedWalletKeyStore, WalletKeySealerUnavailableError, WalletKeyStoreError, createSignerWalletKeySealer } from './walletKeyStore'
export type { WalletKeySealer, WalletKeySigner, WalletKeyStorage, WalletKeyStoreReason } from './walletKeyStore'
export { createAppWalletKeyStorage, createAppWalletKeyStore } from './walletKeyStorage'
export { migrateWalletKeyMaterial } from './walletKeyMigration'
export type { WalletKeyMigrationOutcome, WalletKeyMigrationResult, WalletKeyMigrationSource } from './walletKeyMigration'
export { Nip60WalletEventError, parseNip60WalletEventContent, selectWalletKeyPair } from './nip60WalletEvent'
export type { Nip60WalletEventContent, Nip60WalletEventReason, WalletKeyPairCandidate } from './nip60WalletEvent'
export { WalletEventUnreadableError, createRelayWalletKeyMigrationSource } from './nip60WalletEventSource'
export type { WalletEventReader } from './nip60WalletEventSource'
export { createWalletEventReader, latestByCreatedAt } from './walletEventReader'
export type { WalletEventOpener, WalletEventRelay } from './walletEventReader'

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
