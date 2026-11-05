/**
 * NDKService — manages long-lived subscriptions for admin/editor list
 * updates using the sdk PoolPort.
 *
 * This file is a BRIDGE: it imports NDK only through ndk.ts (getPoolPort)
 * and never names `@nostr-dev-kit` directly.
 */
import { naddrFromAddress } from '@sdk/core/nostr/naddr'
import { map as rxMap } from 'rxjs'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { getPoolPort } from './ndk'
import type { Subscription, PoolPort } from '@sdk/core/nostr-io/ts/types'
import { RelaySeamError } from '@sdk/core/nostr-io/ts/errors'
import type { AdminManager, EditorManager, BootstrapManager } from './types'

export class NDKService {
	private pool: PoolPort | null = null
	private appPubkey: string
	private adminManager: AdminManager
	private editorManager: EditorManager
	private bootstrapManager: BootstrapManager
	private adminSubscription: Subscription | null = null
	private editorSubscription: Subscription | null = null
	private latestAdminEventTime = 0
	private latestEditorEventTime = 0

	constructor(appPubkey: string, adminManager: AdminManager, editorManager: EditorManager, bootstrapManager: BootstrapManager) {
		this.appPubkey = appPubkey
		this.adminManager = adminManager
		this.editorManager = editorManager
		this.bootstrapManager = bootstrapManager
	}

	public async initialize(relayUrl?: string): Promise<void> {
		if (!relayUrl) return
		try {
			// getPoolPort() uses the global singleton connected to RELAY_URL.
			// For per-init relay, ndk.ts would need a createPoolPort(url) overload.
			// For now we accept the shared singleton — callers that need per-url
			// isolation should create their own PoolPort.
			this.pool = await getPoolPort()
			console.log('NDK service connected to relay')
		} catch (e) {
			console.error('Failed to connect to relay for initialization', e)
		}
	}

	public async loadExistingData(): Promise<void> {
		if (!this.pool) return
		await Promise.all([this.checkExistingSetupEvent(), this.loadExistingAdminList(), this.loadExistingEditorList()])
	}

	private async checkExistingSetupEvent(): Promise<void> {
		if (!this.pool) return
		try {
			const result = await this.pool.query({ kinds: [31990], authors: [this.appPubkey], limit: 1 })
			const firstEvent = result.events[0]
			if (firstEvent) {
				console.log('Found existing setup event')
				try {
					const settings = JSON.parse(firstEvent.content)
					if (settings.ownerPk) {
						this.adminManager.addAdmin(settings.ownerPk)
					}
				} catch (e) {
					console.error('Failed to parse existing setup event', e)
				}
			}
		} catch (e) {
			console.error('Failed to check for existing setup event', e)
		}
	}

	private async loadExistingAdminList(): Promise<void> {
		if (!this.pool) return
		try {
			const naddr = naddrFromAddress(30000, this.appPubkey, 'admins')
			const result = await this.pool.query({ kinds: [30000], authors: [this.appPubkey], '#d': ['admins'], limit: 1 })
			const latestAdminEvent = result.events[0]
			if (latestAdminEvent) {
				console.log('Found existing admin list, updating internal list')
				this.adminManager.updateFromEvent(latestAdminEvent as NostrEventLike)
				this.latestAdminEventTime = latestAdminEvent.created_at ?? 0
			}
		} catch (e) {
			console.error('Failed to load existing admin list', e)
		}
	}

	private async loadExistingEditorList(): Promise<void> {
		if (!this.pool) return
		try {
			const naddr = naddrFromAddress(30000, this.appPubkey, 'editors')
			const result = await this.pool.query({ kinds: [30000], authors: [this.appPubkey], '#d': ['editors'], limit: 1 })
			const latestEditorEvent = result.events[0]
			if (latestEditorEvent) {
				console.log('Found existing editor list, updating internal list')
				this.editorManager.updateFromEvent(latestEditorEvent as NostrEventLike)
				this.latestEditorEventTime = latestEditorEvent.created_at ?? 0
			}
		} catch (e) {
			console.error('Failed to load existing editor list', e)
		}
	}

	/**
	 * Open long-lived subscriptions on the app relay for admin and editor
	 * list updates. Without this, the in-memory admin/editor caches only
	 * refresh when the bun proxy itself processes a publish for these kinds
	 * — direct relay publishes (via nak or other clients) wouldn't
	 * propagate, and the authorization gate stays stale.
	 */
	public startSubscriptions(): void {
		if (!this.pool) return
		// Derive relays from pool status - adapter stores known relay set
		const relays = this.pool.status([]).map((s) => s.url).filter(Boolean) as string[]
		const adminSub = this.pool.subscribe(relays, [{ kinds: [30000], authors: [this.appPubkey], '#d': ['admins'] }] as import('@sdk/core/nostr-io/ts/types').FilterIn[])
		adminSub.events.subscribe((event) => {
			const ts = event.created_at ?? 0
			if (ts <= this.latestAdminEventTime) return
			this.latestAdminEventTime = ts
			console.log(`Live admin list update received (created_at=${ts})`)
			this.adminManager.updateFromEvent(event as NostrEventLike)
		})
		this.adminSubscription = { events: adminSub.events, errors: adminSub.failures.pipe(rxMap((f) => new RelaySeamError(f.reason, f.message ?? ''))), unsubscribe: () => adminSub.unsubscribe() }
		const editorSub = this.pool.subscribe(relays, [{ kinds: [30000], authors: [this.appPubkey], '#d': ['editors'] }] as import('@sdk/core/nostr-io/ts/types').FilterIn[])
		this.editorSubscription = { events: editorSub.events, errors: editorSub.failures.pipe(rxMap((f) => new RelaySeamError(f.reason, f.message ?? ''))), unsubscribe: () => editorSub.unsubscribe() }
		this.editorSubscription.events.subscribe((event) => {
			const ts = event.created_at ?? 0
			if (ts <= this.latestEditorEventTime) return
			this.latestEditorEventTime = ts
			console.log(`Live editor list update received (created_at=${ts})`)
			this.editorManager.updateFromEvent(event as NostrEventLike)
		})
	}

	public shutdown(): void {
		this.adminSubscription?.unsubscribe()
		this.editorSubscription?.unsubscribe()
		this.adminSubscription = null
		this.editorSubscription = null
		this.pool = null
	}
}
