import { file } from 'bun'
import { join } from 'path'
import type { BunRoutes } from './types'

/** Serve a single file from `public/<path>`. */
export const serveStatic = async (path: string): Promise<Response> => {
	const filePath = join(process.cwd(), 'public', path)
	try {
		const f = file(filePath)
		if (!f.exists()) {
			return new Response('File not found', { status: 404 })
		}
		// Determine content type based on file extension.
		const contentType = path.endsWith('.svg')
			? 'image/svg+xml'
			: path.endsWith('.png')
				? 'image/png'
				: path.endsWith('.jpg') || path.endsWith('.jpeg')
					? 'image/jpeg'
					: path.endsWith('.css')
						? 'text/css'
						: path.endsWith('.js')
							? 'application/javascript'
							: path.endsWith('.json')
								? 'application/json'
								: path.endsWith('.ico')
									? 'image/x-icon'
									: 'application/octet-stream'

		return new Response(f, {
			headers: { 'Content-Type': contentType },
		})
	} catch (error) {
		console.error(`Error serving static file ${path}:`, error)
		return new Response('Internal server error', { status: 500 })
	}
}

const FONT_DIR = join(process.cwd(), 'platform/web/app/assets/fonts')
const FONT_FILE = /^[a-z0-9][a-z0-9-]*\.woff2$/i

/**
 * The bundled web fonts (ADR-0026). They are served as plain files, not
 * inlined into the main stylesheet, so a page paints before they arrive
 * (`font-display: swap`) and only the faces a page uses are downloaded.
 * Nothing comes from a third-party host.
 */
export const serveFont = async (name: string): Promise<Response> => {
	const f = FONT_FILE.test(name) ? file(join(FONT_DIR, name)) : null
	if (!f || !(await f.exists())) return new Response('File not found', { status: 404 })
	return new Response(f, {
		headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=604800' },
	})
}

export const serveFontStylesheet = (): Response =>
	new Response(file(join(process.cwd(), 'styles/fonts.css')), {
		headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
	})

// Bun's path-parameterised handler receives a `BunRequest<Path>` whose
// `params` is typed `Record<string, string>` after we erase the literal
// path generics through our merged BunRoutes record. We read `params.file`
// at runtime — Bun's router supplies it for `/images/:file`.
export const staticRoutes: BunRoutes = {
	'/images/:file': (req) => serveStatic(`images/${req.params?.file ?? ''}`),
	'/manifest.json': () => serveStatic('manifest.json'),
	'/sw.js': () => serveStatic('sw.js'),
	'/favicon.ico': () => serveStatic('favicon.ico'),
	'/fonts.css': () => serveFontStylesheet(),
	'/fonts/:file': (req) => serveFont(req.params?.file ?? ''),
}
