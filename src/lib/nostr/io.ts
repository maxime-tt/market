/**
 * Library-agnostic Nostr I/O port — the "seam" of the NDK -> applesauce
 * strangler-fig migration (see
 * `docs/adr/ADR-0002-nostr-io-migration-ndk-to-applesauce.md`).
 *
 * Every event that flows through this port is a raw nostr-tools event
 * (applesauce has no wrapper class), so migrating a module is mostly about
 * redirecting where its subscribe/fetch/publish calls land, not about
 * changing event shapes.
 *
 * The active adapter defaults to the temporary NDK bridge (`io-ndk.ts`) and
 * is flipped to the applesauce implementation (`io-applesauce.ts`) module by
 * module, with tests gating each flip. When the last caller has flipped,
 * `io-ndk.ts` and the NDK singleton are deleted (Wave D).
 *
 * The port's *types* live in `./io-types`. This module imports both adapters
 * (to register the default and to re-export the applesauce one), so an adapter
 * importing its contract back from here would close a cycle; they import
 * `./io-types` instead, and this module re-exports the whole type surface so
 * callers still have a single import path for the port.
 */
import { ndkIo } from './io-ndk'
import type { NostrIo } from './io-types'

export { applesauceIo } from './io-applesauce'
export { ndkIo }

export type {
	EventTemplate,
	FetchOptions,
	NostrEvent,
	NostrFilter,
	NostrIo,
	NostrUser,
	PublishOptions,
	PublishResult,
	SubscribeOptions,
} from './io-types'

let active: NostrIo = ndkIo

/** Returns the currently active Nostr I/O adapter. */
export function getNostrIo(): NostrIo {
	return active
}

/** Swaps the active adapter. Used by the migration to flip modules off NDK. */
export function setNostrIo(io: NostrIo): void {
	active = io
}

export const fetchEvents: NostrIo['fetchEvents'] = (filter, opts) => active.fetchEvents(filter, opts)
export const subscribe: NostrIo['subscribe'] = (filter, onEvent, opts) => active.subscribe(filter, onEvent, opts)
export const publish: NostrIo['publish'] = (event, opts) => active.publish(event, opts)
export const sign: NostrIo['sign'] = (template) => active.sign(template)
export const getUser: NostrIo['getUser'] = () => active.getUser()
