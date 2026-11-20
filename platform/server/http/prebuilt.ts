import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { file, spawn } from 'bun'
import type { BunRoutes } from './types'

/**
 * The prebuilt, code-split web bundle (ADR-0027).
 *
 * In production the server builds it on boot (`prepareWebBundle`, a child
 * `bun scripts/build-web.ts`, about 2 s) and serves it: the shell as a plain
 * Response, and the hashed chunks from `/_app/<file>` with a one-year
 * immutable cache. It always rebuilds on boot, so a folder reused across
 * versions never serves stale chunks. If the build fails, the server keeps
 * Bun's runtime HTML bundling, so the site still comes up.
 * `AR_PREBUILT=0` forces the runtime path.
 */
export const PREBUILT_DIR = join(process.cwd(), 'dist/web')

const ASSET_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface PrebuiltShell {
	indexHtml: Response
	routes: BunRoutes
}

export function servePrebuiltAsset(dir: string, name: string): Promise<Response> | Response {
	if (!ASSET_FILE.test(name) || name.includes('..')) return new Response('File not found', { status: 404 })
	const f = file(join(dir, '_app', name))
	return f
		.exists()
		.then((ok) =>
			ok
				? new Response(f, { headers: { 'Content-Type': f.type, 'Cache-Control': 'public, max-age=31536000, immutable' } })
				: new Response('File not found', { status: 404 }),
		)
}

export function loadPrebuiltShell(dir: string = PREBUILT_DIR, env: Record<string, string | undefined> = process.env): PrebuiltShell | null {
	if (env.AR_PREBUILT === '0') return null
	const indexPath = join(dir, 'index.html')
	if (!existsSync(indexPath)) return null
	const html = readFileSync(indexPath, 'utf8')
	return {
		indexHtml: new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-cache' } }),
		routes: {
			'/_app/:file': (req: { params?: Record<string, string> }) => servePrebuiltAsset(dir, req.params?.file ?? ''),
		} as BunRoutes,
	}
}

/**
 * Build the bundle in a child process (so the build's memory is released when it
 * exits), then load it. Returns null, keeping runtime bundling, when switched
 * off or when the build fails.
 */
export async function prepareWebBundle(env: Record<string, string | undefined> = process.env): Promise<PrebuiltShell | null> {
	if (env.AR_PREBUILT === '0') return null
	try {
		const child = spawn([process.execPath, 'scripts/build-web.ts'], { cwd: process.cwd(), stdout: 'inherit', stderr: 'inherit' })
		const code = await child.exited
		if (code !== 0) {
			console.warn(`⚠️ build:web exited ${code}; bundling index.html at runtime instead`)
			return null
		}
	} catch (error) {
		console.warn('⚠️ build:web could not run; bundling index.html at runtime instead', error)
		return null
	}
	return loadPrebuiltShell(PREBUILT_DIR, env)
}
