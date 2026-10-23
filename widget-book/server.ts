/**
 * Widget book server — a deliberately separate client from the platform app.
 *
 * It serves only the widget catalogue (`main.tsx` + `libraries/`), which may
 * import `ui/` and `sdk/` but never `platform/` or `src/`. That is what makes
 * the harness an enforcement test for ADR-0007 §1b: a component that cannot
 * render here is not a `ui/` component.
 */
import index from './index.html'

const port = Number(process.env.WIDGET_BOOK_PORT ?? 3100)
const defaultLibrary = process.env.LIBRARY ?? '*'

const server = Bun.serve({
	port,
	development: true,
	routes: {
		// Exposes the launch-time LIBRARY selection to the browser without a build
		// step or a server-rendered template. The client fetches this before
		// mounting; `?library=` still takes precedence at runtime.
		'/config.json': () => Response.json({ library: defaultLibrary }, { headers: { 'cache-control': 'no-store' } }),
		'/': index,
		'/*': index,
	},
})

console.log(`widget-book listening on http://localhost:${server.port} (LIBRARY=${defaultLibrary})`)
