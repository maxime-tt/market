/**
 * sdk/config/routeTable.ts — the typed route table: one parser, one wire format, one resolution rule.
 *
 * This module is pure data: no React, no store, no `fetch`, no `platform/`. It reads tag arrays and returns
 * plain objects, so every later consumer (the dashboard, the `/` and `/<name>` routes, the server validator)
 * shares a single interpretation instead of growing its own. It changes no behaviour by itself: nothing here
 * is wired into a reader or writer yet.
 *
 * Wire format (proposal §2.2), all three families inside the existing kind-30000 `d='vanity-urls'` event:
 *
 *   ["vanity", <name>, <pubkey>, <validUntil>]                          legacy, unchanged, profile target
 *   ["route", <name>, <type>, <target>, <authority>, <term>, <holder>]
 *   ["route-default", <name>]
 *
 * `0` as a `route` term means permanent. Legacy `vanity` tags keep absolute-expiry semantics, where `0` is
 * already in the past — that asymmetry is deliberate and is pinned by a test.
 */
import { VANITY_REGISTRY } from '../core/curation/vanityRead'

/** The registry coordinate the three tag families live in. Imported so there is exactly one definition. */
export const ROUTE_REGISTRY = VANITY_REGISTRY

export const ROUTE_TAG = 'route'
export const ROUTE_DEFAULT_TAG = 'route-default'
export const LEGACY_VANITY_TAG = 'vanity'
/** Term value meaning "no term". Only `route` tags use it; legacy `vanity` tags keep absolute-expiry semantics. */
export const PERMANENT_TERM = 0

/**
 * The 37 reserved names — mirrored from `sdk/config/vanity.ts:51-89` and `platform/server/VanityManager.ts:6-44`.
 * Neither exports its copy; test 6 asserts all three sets are equal.
 */
export const ROUTE_RESERVED_NAMES: readonly string[] = [
	'admin',
	'api',
	'dashboard',
	'products',
	'product',
	'profile',
	'checkout',
	'setup',
	'community',
	'posts',
	'post',
	'nostr',
	'search',
	'collection',
	'collections',
	'settings',
	'support',
	'help',
	'about',
	'terms',
	'privacy',
	'login',
	'logout',
	'register',
	'signup',
	'signin',
	'account',
	'user',
	'users',
	'app',
	'static',
	'assets',
	'images',
	'public',
	'favicon',
	'robots',
	'sitemap',
]

export const ROUTE_AUTHORITIES = ['admin', 'editor', 'reservation'] as const
export type RouteAuthority = (typeof ROUTE_AUTHORITIES)[number]

export type RouteTarget =
	| { type: 'profile'; pubkey: string }
	| { type: 'page'; author: string; dTag: string }
	| { type: 'listing'; pubkey: string; dTag: string }

export interface RouteEntry {
	name: string
	target: RouteTarget
	authority: RouteAuthority
	/** pubkey the authority belongs to; null for an admin route. */
	holder: string | null
	/** unix seconds; 0 = permanent. */
	term: number
	isDefault: boolean
	/** which tag family produced this entry — two families for one name is a drift site. */
	source: 'route' | 'vanity'
}

export type RouteConflictKind = 'duplicate-name' | 'duplicate-default' | 'dangling-default' | 'non-page-default' | 'legacy-shadowed'
export interface RouteConflict {
	kind: RouteConflictKind
	name: string
	detail: string
}

export type RouteDropReason = 'bad-name' | 'reserved-name' | 'unknown-type' | 'bad-target' | 'bad-authority' | 'bad-term' | 'short-tag'
export interface DroppedRoute {
	reason: RouteDropReason
	raw: string[]
}

export interface RouteTable {
	entries: RouteEntry[]
	defaultName: string | null
	conflicts: RouteConflict[]
	dropped: DroppedRoute[]
}

export class RouteTableError extends Error {}

/** Documented lowercase grammar for a route name. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/
const HEX_64 = /^[0-9a-f]{64}$/
const DIGITS = /^\d+$/
const TERM_MAX = 2 ** 40
const LISTING_KIND = '30402'
const NO_HOLDER = '-'

const nowInSeconds = () => Math.floor(Date.now() / 1000)

const reservedSet = new Set<string>(ROUTE_RESERVED_NAMES)

/** The name grammar, applied to the lowercased form of `name`. */
export function isValidRouteName(name: string): boolean {
	return typeof name === 'string' && NAME_PATTERN.test(name.toLowerCase())
}

export function isReservedRouteName(name: string): boolean {
	return reservedSet.has(name.toLowerCase())
}

export function encodeTarget(target: RouteTarget): string {
	switch (target.type) {
		case 'profile':
			return target.pubkey
		case 'page':
			return `${target.author}:${target.dTag}`
		case 'listing':
			return `${LISTING_KIND}:${target.pubkey}:${target.dTag}`
	}
}

/** Decodes `<type>:<raw>`; `null` when the target does not satisfy its own shape. Never throws. */
export function decodeTarget(type: string, raw: string): RouteTarget | null {
	if (typeof raw !== 'string') return null
	if (type === 'profile') {
		return HEX_64.test(raw) ? { type: 'profile', pubkey: raw } : null
	}
	if (type === 'page') {
		const author = raw.slice(0, 64)
		const separator = raw.slice(64, 65)
		const dTag = raw.slice(65)
		if (separator !== ':' || !HEX_64.test(author)) return null
		if (dTag.length < 1 || dTag.length > 64) return null
		return { type: 'page', author, dTag }
	}
	if (type === 'listing') {
		const prefix = `${LISTING_KIND}:`
		if (!raw.startsWith(prefix)) return null
		const rest = raw.slice(prefix.length)
		const pubkey = rest.slice(0, 64)
		const separator = rest.slice(64, 65)
		const dTag = rest.slice(65)
		if (separator !== ':' || !HEX_64.test(pubkey)) return null
		if (dTag.length < 1 || dTag.length > 64) return null
		return { type: 'listing', pubkey, dTag }
	}
	return null
}

const drop = (dropped: DroppedRoute[], reason: RouteDropReason, raw: string[]) => dropped.push({ reason, raw })

function readTerm(raw: string | undefined): number | null {
	if (raw === undefined || !DIGITS.test(raw)) return null
	const term = Number.parseInt(raw, 10)
	if (!Number.isFinite(term) || term > TERM_MAX) return null
	return term
}

function readHolder(raw: string | undefined): { ok: true; holder: string | null } | { ok: false } {
	if (raw === undefined || raw === '' || raw === NO_HOLDER) return { ok: true, holder: null }
	if (!HEX_64.test(raw)) return { ok: false }
	return { ok: true, holder: raw }
}

/**
 * Parses a tag array into a table, in document order. A malformed tag is dropped and recorded; it is never
 * fatal, so one bad row cannot make the whole table unreadable.
 */
export function parseRouteTable(tags: string[][], now: number = nowInSeconds()): RouteTable {
	const entries: RouteEntry[] = []
	const byName = new Map<string, RouteEntry>()
	const conflicts: RouteConflict[] = []
	const dropped: DroppedRoute[] = []
	let defaultName: string | null = null

	const remember = (entry: RouteEntry, raw: string[]) => {
		const existing = byName.get(entry.name)
		if (!existing) {
			byName.set(entry.name, entry)
			entries.push(entry)
			return
		}
		if (existing.source === 'route' && entry.source === 'vanity') {
			conflicts.push({
				kind: 'legacy-shadowed',
				name: entry.name,
				detail: 'a route tag already owns this name; the legacy vanity tag is kept only as a mirror',
			})
			return
		}
		if (existing.source === 'vanity' && entry.source === 'route') {
			// The route tag wins wherever it appears relative to the legacy tag it replaces.
			const index = entries.indexOf(existing)
			entries[index] = entry
			byName.set(entry.name, entry)
			conflicts.push({
				kind: 'legacy-shadowed',
				name: entry.name,
				detail: 'a route tag replaces the legacy vanity tag for this name',
			})
			return
		}
		conflicts.push({ kind: 'duplicate-name', name: entry.name, detail: `the first ${raw[0]} tag for this name wins` })
	}

	for (const tag of Array.isArray(tags) ? tags : []) {
		if (!Array.isArray(tag) || tag.length === 0) continue
		const family = tag[0]
		if (family === ROUTE_DEFAULT_TAG) {
			const name = (tag[1] ?? '').toLowerCase()
			if (defaultName === null) defaultName = name
			else conflicts.push({ kind: 'duplicate-default', name, detail: `only the first default is honoured; it is '${defaultName}'` })
			continue
		}
		if (family === LEGACY_VANITY_TAG) {
			if (tag.length < 4) {
				drop(dropped, 'short-tag', tag)
				continue
			}
			const name = tag[1].toLowerCase()
			if (!isValidRouteName(name)) {
				drop(dropped, 'bad-name', tag)
				continue
			}
			if (isReservedRouteName(name)) {
				drop(dropped, 'reserved-name', tag)
				continue
			}
			if (!HEX_64.test(tag[2])) {
				drop(dropped, 'bad-target', tag)
				continue
			}
			const term = readTerm(tag[3])
			if (term === null) {
				drop(dropped, 'bad-term', tag)
				continue
			}
			remember(
				{
					name,
					target: { type: 'profile', pubkey: tag[2] },
					authority: 'reservation',
					holder: tag[2],
					term,
					isDefault: false,
					source: 'vanity',
				},
				tag,
			)
			continue
		}
		if (family !== ROUTE_TAG) continue

		if (tag.length < 7) {
			drop(dropped, 'short-tag', tag)
			continue
		}
		const name = tag[1].toLowerCase()
		if (!isValidRouteName(name)) {
			drop(dropped, 'bad-name', tag)
			continue
		}
		if (isReservedRouteName(name)) {
			drop(dropped, 'reserved-name', tag)
			continue
		}
		const type = tag[2]
		if (type !== 'profile' && type !== 'page' && type !== 'listing') {
			drop(dropped, 'unknown-type', tag)
			continue
		}
		const target = decodeTarget(type, tag[3])
		if (!target) {
			drop(dropped, 'bad-target', tag)
			continue
		}
		const authority = ROUTE_AUTHORITIES.find((candidate) => candidate === tag[4])
		if (!authority) {
			drop(dropped, 'bad-authority', tag)
			continue
		}
		const term = readTerm(tag[5])
		if (term === null) {
			drop(dropped, 'bad-term', tag)
			continue
		}
		const holder = readHolder(tag[6])
		if (!holder.ok) {
			drop(dropped, 'bad-target', tag)
			continue
		}
		remember({ name, target, authority, holder: holder.holder, term, isDefault: false, source: 'route' }, tag)
	}

	for (const entry of entries) entry.isDefault = entry.name === defaultName

	if (defaultName !== null) {
		const entry = byName.get(defaultName)
		if (!entry) {
			conflicts.push({ kind: 'dangling-default', name: defaultName, detail: 'the default name is not in the table' })
		} else if (entry.target.type !== 'page') {
			conflicts.push({
				kind: 'non-page-default',
				name: defaultName,
				detail: `/ must render a page; this default points at a ${entry.target.type} target`,
			})
		}
	}

	void now // parsing is clock-independent; the parameter exists so the signature is uniform across callers
	return { entries, defaultName, conflicts, dropped }
}

function assertSerializable(entries: readonly RouteEntry[], defaultName: string | null) {
	const seen = new Set<string>()
	for (const entry of entries) {
		if (!isValidRouteName(entry.name)) throw new RouteTableError(`invalid route name: ${entry.name}`)
		if (isReservedRouteName(entry.name)) throw new RouteTableError(`reserved route name: ${entry.name}`)
		if (seen.has(entry.name)) throw new RouteTableError(`duplicate route name: ${entry.name}`)
		seen.add(entry.name)
	}
	if (defaultName === null) return
	const defaultEntry = entries.find((entry) => entry.name === defaultName)
	if (!defaultEntry) throw new RouteTableError(`the default names a route that is not in the table: ${defaultName}`)
	if (defaultEntry.target.type !== 'page') {
		throw new RouteTableError(`the default must be a page target; '${defaultName}' is a ${defaultEntry.target.type}`)
	}
}

/**
 * Emits `route` tags sorted by name, then the legacy `vanity` mirrors, then at most one `route-default`.
 * The ordering is part of the contract: byte-stable output is what lets a management surface ask "did the
 * table change under me?".
 */
export function serializeRouteTable(entries: readonly RouteEntry[], defaultName: string | null): string[][] {
	assertSerializable(entries, defaultName)
	const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
	const tags: string[][] = sorted.map((entry) => [
		ROUTE_TAG,
		entry.name,
		entry.target.type,
		encodeTarget(entry.target),
		entry.authority,
		String(entry.term),
		entry.holder ?? NO_HOLDER,
	])
	for (const entry of sorted) {
		// A mirror is only honest when the legacy encoding means exactly the same thing.
		if (entry.target.type !== 'profile') continue
		if (entry.authority !== 'reservation') continue
		if (entry.term <= PERMANENT_TERM) continue
		tags.push([LEGACY_VANITY_TAG, entry.name, entry.target.pubkey, String(entry.term)])
	}
	if (defaultName !== null) tags.push([ROUTE_DEFAULT_TAG, defaultName])
	return tags
}

/**
 * Whether an entry has expired. `route` terms are absolute expiry with `0` meaning permanent; legacy `vanity`
 * terms are absolute expiry where `0` is already in the past. That asymmetry is deliberate.
 */
export function routeIsLapsed(entry: RouteEntry, now: number = nowInSeconds()): boolean {
	if (entry.source === 'vanity') return entry.term < now
	return entry.term !== PERMANENT_TERM && entry.term < now
}

/** Exact match on the lowercased name — no prefix, no fuzzy, no fallback. The fallback chain is the route component's. */
export function resolveRoute(table: RouteTable, name: string, now: number = nowInSeconds()): RouteEntry | null {
	const entry = table.entries.find((candidate) => candidate.name === name.toLowerCase())
	if (!entry || routeIsLapsed(entry, now)) return null
	return entry
}

/** The one route `/` renders, or `null`. Never throws and never returns a partially valid route. */
export function resolveDefaultRoute(table: RouteTable, now: number = nowInSeconds()): RouteEntry | null {
	if (table.defaultName === null) return null
	const entry = table.entries.find((candidate) => candidate.name === table.defaultName)
	if (!entry) return null
	if (entry.target.type !== 'page') return null
	if (routeIsLapsed(entry, now)) return null
	return entry
}
