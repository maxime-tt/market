import { defaultPath, type RoutesFile } from './routeFile'
import type { PagePayload } from './pageHtml'

/**
 * `/` — the default binding. R4: the home is **just another path**, nothing
 * privileged (`ARCHITECTURE.md` §3.5).
 *
 * The routing file's `default` names a *path*, and `/` means that path; the
 * lane below runs the identical ladder for it. So there is no branch on
 * `path === '/'` anywhere in resolution: a default naming a series path, a
 * compiled-in path or a programmed prefix behaves exactly as that path does
 * when it is requested directly.
 *
 * Two facts depend on this, and this module is their single home so that
 * neither `resolve()` nor the serve path re-derives them:
 *
 *   - **which path `/` means** — `defaultBinding()`, consumed by `resolve()`;
 *   - **what `/` answers with when it names nothing** — the compiled-in home
 *     route (`platform/web/routes/index.tsx`), whose *empty* state is the
 *     inline home composition. R4's asymmetry, stated rather than hidden: the
 *     choice between a composed home and a bound page is a renderer decision,
 *     not a resolution branch (`ARCHITECTURE.md` §3.5, R4's closing note).
 *
 * The page payload `/` serves has one shape, and it is the shape every other
 * binding's page carries — `pagePayloadFor`, used by the serve path's single
 * page branch. `/` gets no payload of its own; that is the point of R4.
 */

/** The default target → the page payload, or the inline composition. */
export type DefaultBinding =
	/** `/` means this path (leading slash included); run the ladder for it. */
	| { kind: 'path'; path: string }
	/** The file names no default: `/` is the compiled-in home route. */
	| { kind: 'inline' }

/**
 * What `/` means. A file that names no default yields the inline composition;
 * a file that names one yields that path, validated and normalised at load
 * (`validateRoutesFile` refuses an empty or non-string default).
 */
export function defaultBinding(file: RoutesFile): DefaultBinding {
	const named = defaultPath(file)
	return named === null ? { kind: 'inline' } : { kind: 'path', path: `/${named}` }
}

/**
 * The `#__AR_PAGE__` payload for the page at a resolved `(author, d)`.
 *
 * One function, one shape: `/` is served by the same branch as every other
 * binding, so the default target's page carries the identical payload a
 * `/<name>` binding's page does.
 */
export function pagePayloadFor(address: { author: string; d: string }): PagePayload {
	return { author: address.author, d: address.d, version: 1 }
}
