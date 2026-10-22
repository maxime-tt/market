// Types
export type { ProofInfo, PendingToken, PendingTokenContext, AuctionBidPendingTokenContext, ProofEntry } from './types'

// Proof utilities
export { extractProofsByMint, getProofsForMint, getSpendableProofsForMint } from './proofs'

// The auction P2PK spend (the leg coco cannot do), behind injected ports
export { receiveTokenIntoWallet, receiveTokenWithPrivkey } from './auctionFunds'
export type { AuctionFundsMintAccess, AuctionFundsWallet, ReceiveTokenDeps } from './auctionFunds'
// The auction reclaim pair (timelock refund + throttled sweep), behind injected ports
export {
	AUCTION_RECLAIM_SKEW_BUFFER_SECONDS,
	createAuctionReclaim,
	formatReclaimWaitSeconds,
	getAuctionReclaimReadyAt,
	getAuctionReclaimReadyAtForGroup,
} from './auctionFunds'
export type { AuctionReclaim, AuctionReclaimHost } from './auctionFunds'
// The auction P2PK lock (1-of-1 locktime + refund key) and the settlement receipt/keyset
// helpers, behind injected ports
export { AuctionBidLockMutationPossibleError, createAuctionLock, createAuctionReceipt, loadAuctionMintKeysets } from './auctionFunds'
export type {
	AuctionLock,
	AuctionLockHost,
	AuctionLockWallet,
	AuctionP2pkKeyScheme,
	AuctionReceipt,
	AuctionReceiveHost,
	LockAuctionBidFundsParams,
	LockAuctionBidFundsResult,
} from './auctionFunds'

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
