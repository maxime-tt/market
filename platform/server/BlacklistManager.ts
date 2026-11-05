/**
 * BlacklistManager — handles blacklist events and loads existing blacklist
 * from relay via the sdk PoolPort.
 *
 * This file is a BRIDGE: it owns NDK transport via ndk.ts but speaks
 * through the sdk port (PoolPort) to consumers.
 */
import type { EventSigner } from './EventSigner'
import type { NDKService } from './NDKService'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { getPoolPort } from './ndk'

export interface BlacklistManager {
	handleBlacklistEvent(event: NostrEventLike): Promise<void>
	isBlacklisted(pubkey: string): boolean
	isProductBlacklisted(productCoords: string): boolean
	isCollectionBlacklisted(collectionCoords: string): boolean
	getBlacklistedPubkeys(): string[]
	getBlacklistedProducts(): string[]
	getBlacklistedCollections(): string[]
}

export class BlacklistManagerImpl implements BlacklistManager {
	private blacklistedPubkeys: Set<string> = new Set()
	private blacklistedProducts: Set<string> = new Set()
	private blacklistedCollections: Set<string> = new Set()
	private eventSigner: EventSigner
	private ndkService: NDKService

	constructor(eventSigner: EventSigner, ndkService: NDKService) {
		this.eventSigner = eventSigner
		this.ndkService = ndkService
	}

	public async handleBlacklistEvent(event: NostrEventLike): Promise<void> {
		console.log('Processing blacklist event:', event.id)

		// Extract blacklisted items from the event tags
		const newBlacklistedPubkeys = this.extractBlacklistedPubkeys(event)
		const newBlacklistedProducts = this.extractBlacklistedProducts(event)
		const newBlacklistedCollections = this.extractBlacklistedCollections(event)
		const previouslyBlacklisted = new Set(this.blacklistedPubkeys)

		// Update the internal blacklists
		this.blacklistedPubkeys.clear()
		newBlacklistedPubkeys.forEach((pubkey) => this.blacklistedPubkeys.add(pubkey))

		this.blacklistedProducts.clear()
		newBlacklistedProducts.forEach((coords) => this.blacklistedProducts.add(coords))

		this.blacklistedCollections.clear()
		newBlacklistedCollections.forEach((coords) => this.blacklistedCollections.add(coords))

		// Log newly blacklisted pubkeys for debugging
		const newlyBlacklisted = newBlacklistedPubkeys.filter((pubkey) => !previouslyBlacklisted.has(pubkey))

		if (newlyBlacklisted.length > 0) {
			console.log('Newly blacklisted pubkeys:', newlyBlacklisted)
		}

		console.log(
			`Blacklist updated: ${this.blacklistedPubkeys.size} users, ${this.blacklistedProducts.size} products, ${this.blacklistedCollections.size} collections`,
		)
	}

	private extractBlacklistedPubkeys(event: NostrEventLike): string[] {
		// Extract pubkeys from 'p' tags as per NIP-51 mute list specification
		return event.tags
			.filter((tag) => tag[0] === 'p' && tag[1])
			.map((tag) => tag[1])
			.filter((pubkey) => /^[0-9a-f]{64}$/i.test(pubkey)) // Validate hex format
	}

	private extractBlacklistedProducts(event: NostrEventLike): string[] {
		// Extract product coordinates from 'a' tags with kind 30402
		return event.tags.filter((tag) => tag[0] === 'a' && tag[1] && tag[1].startsWith('30402:')).map((tag) => tag[1])
	}

	private extractBlacklistedCollections(event: NostrEventLike): string[] {
		// Extract collection coordinates from 'a' tags with kind 30405
		return event.tags.filter((tag) => tag[0] === 'a' && tag[1] && tag[1].startsWith('30405:')).map((tag) => tag[1])
	}

	public isBlacklisted(pubkey: string): boolean {
		return this.blacklistedPubkeys.has(pubkey)
	}

	public isProductBlacklisted(productCoords: string): boolean {
		return this.blacklistedProducts.has(productCoords)
	}

	public isCollectionBlacklisted(collectionCoords: string): boolean {
		return this.blacklistedCollections.has(collectionCoords)
	}

	public getBlacklistedPubkeys(): string[] {
		return Array.from(this.blacklistedPubkeys)
	}

	public getBlacklistedProducts(): string[] {
		return Array.from(this.blacklistedProducts)
	}

	public getBlacklistedCollections(): string[] {
		return Array.from(this.blacklistedCollections)
	}

	public async loadExistingBlacklist(appPubkey: string): Promise<void> {
		const pool = await getPoolPort()
		try {
			// Fetch the most recent blacklist event (kind 10000) from the app
			const result = await pool.query({
				kinds: [10000],
				authors: [appPubkey],
				limit: 1,
			})

			if (result.events.length > 0) {
				const latestBlacklistEvent = result.events[0]
				const blacklistedPubkeys = this.extractBlacklistedPubkeys(latestBlacklistEvent)
				const blacklistedProducts = this.extractBlacklistedProducts(latestBlacklistEvent)
				const blacklistedCollections = this.extractBlacklistedCollections(latestBlacklistEvent)

				this.blacklistedPubkeys.clear()
				blacklistedPubkeys.forEach((pubkey) => this.blacklistedPubkeys.add(pubkey))

				this.blacklistedProducts.clear()
				blacklistedProducts.forEach((coords) => this.blacklistedProducts.add(coords))

				this.blacklistedCollections.clear()
				blacklistedCollections.forEach((coords) => this.blacklistedCollections.add(coords))

				console.log(
					`Loaded ${blacklistedPubkeys.length} blacklisted pubkeys, ${blacklistedProducts.length} products, ${blacklistedCollections.length} collections from existing blacklist`,
				)
			}
		} catch (error) {
			console.error('Error loading existing blacklist:', error)
		}
	}
}
