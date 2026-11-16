import type { RouteIntent } from '@sdk/commerce/storefront/routeIntent'
import {
	RoutesFileError,
	ROUTES_FILE_VERSION,
	loadRoutesFile,
	serializeRoutesFile,
	validateRoutesFile,
	writeAtomic,
	type Binding,
	type RouteWarning,
	type RoutesFile,
} from './routeFile'

/**
 * The live routing table — the derived state a running instance serves.
 *
 * `ARCHITECTURE.md` §4: the file on disk is the table, loaded once at boot. This
 * module adds the one writer the admin authoring surface needs, and keeps the
 * three properties that made the read-only version safe:
 *
 *  1. **Validate the whole table, not the change.** A binding is applied to a
 *     candidate file and the candidate goes through `validateRoutesFile`; if any
 *     pointer in the result is a violation, nothing is written and nothing in
 *     memory changes.
 *  2. **Atomic persistence.** `writeAtomic` (tmp → fsync → .bak → rename) means
 *     a failed write leaves the served bytes intact.
 *  3. **Attribution comes from the signed event.** `updatedAt` is the event's
 *     `created_at` and `updatedBy` its pubkey — never a request body field, the
 *     same rule the page ingest applies to `d`.
 *
 * The table object is mutable on purpose: `buildContentRoutes` resolves against
 * `current()` on every request, so an intent authored over HTTP is served by
 * the next request without a restart.
 */

export interface RouteTableApplyMeta {
	/** Unix seconds from the signed event. */
	createdAt: number
	/** The signing pubkey. */
	pubkey: string
}

export type RouteTableApplyResult =
	/** `changed: false` means the intent was already satisfied and nothing was written. */
	| { ok: true; changed: boolean; warnings: RouteWarning[] }
	/** Nothing was written; these are the violations the resulting table carried. */
	| { ok: false; violations: string[] }

export interface RouteTable {
	/** The file this table is persisted to. */
	readonly path: string
	current(): RoutesFile
	warnings(): RouteWarning[]
	apply(intent: RouteIntent, meta: RouteTableApplyMeta): RouteTableApplyResult
}

export interface CreateRouteTableOptions {
	file: RoutesFile
	path: string
	warnings?: RouteWarning[]
}

/** The candidate file a set of bindings would produce, before validation. */
function candidateFile(current: RoutesFile, bindings: Binding[], seq: number): unknown {
	return {
		version: ROUTES_FILE_VERSION,
		instance: { pubkey: current.instance.pubkey },
		seq,
		default: current.default,
		bindings,
		prefixes: current.prefixes,
	}
}

/**
 * Applies an intent to a table in memory and on disk.
 *
 * Ordering: an intent older than the binding it would replace is refused rather
 * than applied. Two admins (or one admin and a replayed event) can race, and
 * "last signed wins" is the only rule that does not let a delayed event undo a
 * newer decision. Removal is held to the same rule.
 */
export function createRouteTable({ file, path, warnings = [] }: CreateRouteTableOptions): RouteTable {
	let table = file
	let currentWarnings = warnings

	const commit = (bindings: Binding[], seq: number, nextWarnings: RouteWarning[]): void => {
		const saved: RoutesFile = { ...table, seq, bindings }
		writeAtomic(path, serializeRoutesFile(saved))
		table = saved
		currentWarnings = nextWarnings
	}

	return {
		path,

		current: () => table,

		warnings: () => currentWarnings,

		apply(intent: RouteIntent, meta: RouteTableApplyMeta): RouteTableApplyResult {
			const existing = table.bindings.find((binding) => binding.path === intent.path)

			if (existing && meta.createdAt < existing.updatedAt) {
				return {
					ok: false,
					violations: [
						`/updatedAt: refusing an intent signed at ${meta.createdAt} for ${intent.path}, which was already updated at ${existing.updatedAt}`,
					],
				}
			}

			if (intent.action === 'remove') {
				if (!existing) return { ok: true, changed: false, warnings: currentWarnings }
				const bindings = table.bindings.filter((binding) => binding.path !== intent.path)
				return commitChecked(bindings, table.seq + 1)
			}

			const target = intent.target
			if (!target) return { ok: false, violations: ['/target: a set intent must name a page target'] }

			if (
				existing &&
				existing.target.type === 'page' &&
				existing.target.author === target.author &&
				existing.target.d === target.d
			) {
				return { ok: true, changed: false, warnings: currentWarnings }
			}

			const binding: Binding = {
				kind: 'admin',
				path: intent.path,
				target: { type: 'page', author: target.author, d: target.d },
				updatedAt: meta.createdAt,
				updatedBy: meta.pubkey,
			}
			const bindings = [...table.bindings.filter((candidate) => candidate.path !== intent.path), binding]
			return commitChecked(bindings, table.seq + 1)
		},
	}

	/** Re-validate the whole candidate; a table that would be invalid is refused. */
	function commitChecked(bindings: Binding[], seq: number): RouteTableApplyResult {
		let next: { file: RoutesFile; warnings: RouteWarning[] }
		try {
			next = validateRoutesFile(candidateFile(table, bindings, seq), path)
		} catch (error) {
			if (error instanceof RoutesFileError) return { ok: false, violations: error.violations }
			throw error
		}
		commit(next.file.bindings, next.file.seq, next.warnings)
		return { ok: true, changed: true, warnings: next.warnings }
	}
}

/**
 * Boot: read and validate the file, then hand the same bytes to a live table.
 * A missing, unparseable or invalid file still refuses boot (ARCHITECTURE.md
 * §4.4) — `loadRoutesFile` throws before the server exists.
 */
export function loadRouteTable(path: string): RouteTable {
	const loaded = loadRoutesFile(path)
	return createRouteTable({ file: loaded.file, path, warnings: loaded.warnings })
}