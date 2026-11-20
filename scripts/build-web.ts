/**
 * Prebuilt, code-split web bundle (ADR-0027).
 *
 * Bun.serve's runtime HTML bundling ships the whole app as one chunk, because it
 * inlines dynamic imports. This builds the same `index.html` ahead of time with
 * `splitting: true`, so lazily loaded parts (the page editor, the pickup map, the
 * QR scanner, the intro animation) become their own chunks and public pages never
 * download them.
 *
 * Output: `dist/web/index.html` plus hashed files under `dist/web/_app/`. The
 * production server runs this on boot and serves the result
 * (`platform/server/http/prebuilt.ts`), falling back to runtime bundling if it
 * fails.
 *
 *   bun run build:web
 */
import tailwind from 'bun-plugin-tailwind'
import { rm } from 'node:fs/promises'

const OUT = 'dist/web'

await rm(OUT, { recursive: true, force: true })
const started = performance.now()
const result = await Bun.build({
	entrypoints: ['./platform/web/app/index.html'],
	outdir: OUT,
	target: 'browser',
	splitting: true,
	minify: true,
	sourcemap: 'none',
	plugins: [tailwind],
	// Runtime bundling leaves unset `process.env.X` reads as undefined; match it so
	// browser code that probes optional env vars doesn't hit a missing `process`.
	define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
	env: 'BUN_PUBLIC_*',
	publicPath: '/',
	naming: { entry: '[dir]/[name].[ext]', chunk: '_app/[name]-[hash].[ext]', asset: '_app/[name]-[hash].[ext]' },
})

if (!result.success) {
	for (const log of result.logs) console.error(log)
	process.exit(1)
}

const js = result.outputs.filter((o) => o.path.endsWith('.js'))
const entry = result.outputs.find((o) => o.kind === 'entry-point' && o.path.endsWith('.js'))
const kb = (n: number) => `${Math.round(n / 1024)} KB`
console.log(
	`[build:web] ${result.outputs.length} files in ${Math.round(performance.now() - started)} ms · entry ${entry ? kb(entry.size) : '?'} · ${js.length} JS chunks · ${kb(js.reduce((n, o) => n + o.size, 0))} JS total`,
)
