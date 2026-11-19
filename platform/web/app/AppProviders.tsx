import { SearchPresenceProvider } from '@ui/browse/search-presence'
import { TooltipProvider } from '@ui/primitives/tooltip'
import type { ReactNode } from 'react'

/**
 * Host wiring: app-level providers around the routed content.
 *
 * Lives in the assembler layer (`platform/web/app/`) rather than in a route so
 * the providers mount once, above the router, and do not remount on
 * navigation. It renders no presentational markup of its own.
 *
 * `SearchPresenceProvider` is here for the same reason, and its placement is
 * load-bearing: it must sit above both the frame-level `AppBar` (rendered by
 * `routes/__root.tsx`) and every page's own content, so a page field can tell
 * the bar to retreat. It is a context, not a module store — `servedPage.tsx`
 * renders on the server, and a shared module registry would leak one request's
 * search field into another's.
 */
export function AppProviders({ children }: { children: ReactNode }) {
	return (
		<SearchPresenceProvider>
			<TooltipProvider>{children}</TooltipProvider>
		</SearchPresenceProvider>
	)
}
