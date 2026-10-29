export { getEventAddress, toRawEvent } from './nostr/eventLike'
export type { NostrEventLike } from './nostr/eventLike'
export { parseNostrEventShape, verifyNostrEvent } from './nostr/eventValidation'
export type { ValidatedNostrEvent } from './nostr/eventValidation'
export type { Signer, SignedEventLike } from './ports/signer'
export type { EventPublishContext } from './ports/eventPublish'
export { addressableCoordinate, buildAddressableDeletion, deleteAddressableEvent, DELETION_KIND, signAndPublish } from './publishing'
export type { UnsignedEventData } from './publishing'
export type { EncryptingSigner, SignableRumorLike } from './ports/encryptingSigner'
export { UnsupportedSignerOperationError } from './ports/encryptingSigner'
export { asEncryptingSigner } from './ports/signerInterop'
export type { NostrFilter, NostrRelayPort, RelayPublishResult } from './ports/nostrRelay'
export { createPoolRelayPort } from './ports/poolRelayPort'
// Standalone contract modules: namespaced, because their vocabularies (Event, NostrEvent, errors) overlap.
export * as signer from './signer'
export * as nostrIo from './nostr-io'
export * as payAggregator from './wallet'
export * as fundsContract from './funds-contract'
// The payment rails: each implements funds-contract's port over one authority, and their rail vocabularies
// (leg kinds, error taxonomies, stores) do not overlap, so each is namespaced like the contract modules.
export * as cashuWrapper from './cashu-wrapper'
export * as nwcWrapper from './nwc-wrapper'
export * as bolt11Wrapper from './bolt11-wrapper'
export * as capability from './capability'
// notifications is flat, like event-store: its vocabulary (Notification, NotificationRule, the queue and the
// ledger) collides with nothing already exported here, and the app composes the mechanism directly.
export * from './notifications'
// state is flat too: it is the generic observable container the drain's stores are built on, and its one
// vocabulary (StateStore, StateStoreOptions, StateError) collides with nothing already exported here.
export * from './state'
export * from './event-store'
export * from './profile'
export * from './relays'
export * from './nip89'
export type { KeyValueStoragePort } from './ports/storage'
// read-mark is a standalone port: the read-state persistence seam of the notification cutover, the only state
// it keeps being the per-stream read marks. Its vocabulary (ReadMarkPort, ReadMarkError, the two factories)
// collides with nothing else exported here, so like the storage and wallet ports beside it it is registered
// flat rather than namespaced.
export { createMemoryReadMarkPort, createStorageReadMarkPort, ReadMarkError } from './ports/read-mark'
export type { ReadMarkPort, ReadMarkPortOptions } from './ports/read-mark'
export type { WalletPort, WalletRecoveryPort } from './ports/wallet'
export { createWorkflowError, SdkError, ValidationError, WorkflowError } from './errors'
export type { SdkErrorCode, WorkflowErrorStatus } from './errors'
export { failure, success } from './result'
export type { Result } from './result'
export { EventSchemaRegistry, validateEventWithSchema, validateWithSchema } from './validation'
export type { EventSchema, RuntimeSchema } from './validation'
export { parseMarketConfig } from './marketConfig'
export type { MarketConfig } from './marketConfig'
export { parsePublicConfigEnvelope, PUBLIC_CONFIG_SCHEMA_VERSION } from './publicConfig'
export type { PublicConfigEnvelope, PublicConfigSchemaVersion } from './publicConfig'
export * from './extensions'
export * from './geo'
export * from './nostr/nip59'
export * from './nostr/nip17'
export * from './nostr/nip17Relays'
