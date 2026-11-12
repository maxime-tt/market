import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * Route-tree composition guard (ledger row `d7-s2-debt-route-loc`).
 *
 * "Routes = composition only" is the rule this file enforces, because it is the one rule a
 * reviewer cannot see in a diff: it used to be broken by ordinary, innocent-looking imports.
 * `useDashboardTitle` was exported from `routes/_dashboard-layout.tsx` and imported back out of
 * the route tree by 30 sibling routes; `npubToHex` was exported from `routes/setup.tsx` and
 * imported by 3 app-settings routes. A route module that other modules import from is a LIBRARY,
 * not a route: no lane could move or rebuild it without colliding with every consumer.
 *
 * Two assertions:
 *   1. No module under `platform/web/routes/**` imports from another route module. The single
 *      permitted cross-route dependency is the generated `routeTree.gen.ts`, which is produced
 *      by the router plugin and is excluded here.
 *   2. The only binding a route module exports is its own `Route`. Shared behaviour belongs in
 *      `platform/web/app/` or the owning feature, not in a route.
 */

const ROUTES_DIR = resolve(import.meta.dir, '..', 'routes')
const GENERATED_ROUTE_TREE = 'routeTree.gen.ts'

interface RouteFile {
	path: string
	source: string
}

function listRouteFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.name !== GENERATED_ROUTE_TREE)
		.flatMap((entry) => {
			const path = join(dir, entry.name)
			if (entry.isDirectory()) return listRouteFiles(path)
			return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
		})
		.sort()
}

const ROUTE_FILES: RouteFile[] = listRouteFiles(ROUTES_DIR).map((path) => ({
	path,
	source: readFileSync(path, 'utf8'),
}))

const repoPath = (path: string) => relative(resolve(import.meta.dir, '..', '..', '..'), path)

/** Every module specifier a file imports or re-exports, in source order. */
function moduleSpecifiers(source: string): string[] {
	const specifiers: string[] = []
	const statement = /^\s*(?:import|export)\s+(?:[^'"\n]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
	for (const match of source.matchAll(statement)) {
		specifiers.push(match[1])
	}
	return specifiers
}

/** True when `specifier` names a module inside the route tree. */
function isRouteModuleSpecifier(specifier: string, fromFile: string): boolean {
	if (specifier.startsWith('@platform/web/routes/')) return true
	if (!specifier.startsWith('.')) return false
	const target = resolve(dirname(fromFile), specifier)
	return target === ROUTES_DIR || target.startsWith(`${ROUTES_DIR}/`)
}

describe('route tree composition', () => {
	test('finds the route modules it is meant to guard', () => {
		expect(ROUTE_FILES.length).toBeGreaterThan(40)
		expect(ROUTE_FILES.some((file) => file.path.endsWith(GENERATED_ROUTE_TREE))).toBe(false)
	})

	test('no route module imports from another route module', () => {
		const violations = ROUTE_FILES.flatMap((file) =>
			moduleSpecifiers(file.source)
				.filter((specifier) => isRouteModuleSpecifier(specifier, file.path))
				.map((specifier) => `${repoPath(file.path)} imports '${specifier}'`),
		)

		expect(violations).toEqual([])
	})

	test('every route module exports only its own Route', () => {
		const exportedNames = /^\s*export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type)\s+([A-Za-z0-9_$]+)/gm
		const exportLists = /^\s*export\s*(?:type\s*)?\{([^}]*)\}/gm

		const violations = ROUTE_FILES.flatMap((file) => {
			const names: string[] = []
			for (const match of file.source.matchAll(exportedNames)) names.push(match[1])
			for (const match of file.source.matchAll(exportLists)) {
				for (const part of match[1].split(',')) {
					const name = part
						.trim()
						.replace(/^type\s+/, '')
						.split(/\s+as\s+/)
						.pop()
					if (name) names.push(`${name} (export list)`)
				}
			}
			return names.filter((name) => name !== 'Route').map((name) => `${repoPath(file.path)} exports ${name}`)
		})

		expect(violations).toEqual([])
	})
})
