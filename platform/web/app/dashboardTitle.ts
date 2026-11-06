/**
 * `platform/web/app/dashboardTitle.ts` — publishes a dashboard page's title into the
 * shell's `uiStore`.
 *
 * WHY IT LIVES HERE (and not in the layout route):
 *   It used to be exported from `platform/web/routes/_dashboard-layout.tsx`, which made a
 *   route module a LIBRARY: 30 sibling routes imported the hook back out of the route tree
 *   that owns them, so no lane could move or rebuild a dashboard route without colliding
 *   with every consumer. Route modules are composition only; shared behaviour lives in
 *   `platform/web/app/` (the ledger row `d7-s2-debt-route-loc`).
 */
import { useEffect } from 'react'
import { uiActions } from '@platform/web/app/uiStore'

/** Sets the dashboard header title for as long as the calling route is mounted. */
export function useDashboardTitle(title: string) {
	useEffect(() => {
		uiActions.setDashboardTitle(title)
		return () => uiActions.setDashboardTitle('') // Reset to default on unmount
	}, [title])
}
