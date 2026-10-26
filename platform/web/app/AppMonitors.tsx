import { useAuctionWinMonitor } from '@/hooks/useAuctionWinMonitor'
import { useBlacklistSync } from '@/hooks/useBlacklistSync'
import { useNip05Sync } from '@/hooks/useNip05Sync'
import { useNotificationMonitor } from '@/hooks/useNotificationMonitor'
import { useVanitySync } from '@/hooks/useVanitySync'

/**
 * Host wiring: runs the app-wide sync and notification monitors. Renders nothing.
 *
 * None of these hooks depend on router context, so they mount above
 * `RouterProvider` in `frontend.tsx` and keep running across navigations. The
 * overlays they drive live in `AppOverlays`.
 *
 * The notification pipeline needs no lifecycle kick. The legacy store's `initialize()` set nothing but an
 * `isInitialized` flag (it did not load read state — the store read its `lastSeenTimestamps` at module
 * import), and the mechanism's read marks seed synchronously at module load
 * (`platform/web/notifications/readMarks.ts`). So `useNotificationMonitor` gates only on an authenticated
 * user, and `initialize()` was deleted with the store in store-drain C3.
 */
export function AppMonitors() {
	// Store <-> relay/query sync for instance-managed lists.
	useBlacklistSync()
	useVanitySync()
	useNip05Sync()

	// Notification pipeline: watch once an authenticated user is present.
	useNotificationMonitor()
	useAuctionWinMonitor()

	return null
}
