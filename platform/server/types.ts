import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import type { UnsignedEvent } from 'nostr-tools/pure'

export interface EventHandlerConfig {
	appPrivateKey: string
	adminPubkeys: string[]
	hasExistingSetup: boolean
	allowPublicBootstrap: boolean
	relayUrl?: string
}

export interface EventValidationResult {
	isValid: boolean
	reason?: string
}

export interface ProcessedEvent {
	originalEvent: NostrEventLike
	signedEvent: NostrEventLike | null
	validationResult: EventValidationResult
}

export interface AdminManager {
	addAdmin(pubkey: string): void
	isAdmin(pubkey: string): boolean
	getAdmins(): Set<string>
	updateFromEvent(event: NostrEventLike): void
}

export interface EditorManager {
	addEditor(pubkey: string): void
	isEditor(pubkey: string): boolean
	getEditors(): Set<string>
	updateFromEvent(event: NostrEventLike): void
}

export interface BootstrapManager {
	isBootstrapMode(): boolean
	exitBootstrapMode(): void
	handleSetupEvent(event: NostrEventLike): void
	hasSetup(): boolean
}

export interface BlacklistManager {
	handleBlacklistEvent(event: NostrEventLike): Promise<void>
	isBlacklisted(pubkey: string): boolean
	getBlacklistedPubkeys(): string[]
	loadExistingBlacklist(appPubkey: string): Promise<void>
}
