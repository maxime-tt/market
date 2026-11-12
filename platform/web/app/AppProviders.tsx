import { TooltipProvider } from '@ui/primitives/tooltip'
import type { ReactNode } from 'react'

/**
 * Host wiring: app-level providers around the routed content.
 *
 * Lives in the assembler layer (`platform/web/app/`) rather than in a route so
 * the providers mount once, above the router, and do not remount on
 * navigation. It renders no presentational markup of its own.
 */
export function AppProviders({ children }: { children: ReactNode }) {
	return <TooltipProvider>{children}</TooltipProvider>
}
