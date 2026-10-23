import { useAuctionWinMonitor } from '@/hooks/useAuctionWinMonitor'
import { useBlacklistSync } from '@/hooks/useBlacklistSync'
import { useNip05Sync } from '@/hooks/useNip05Sync'
import { useNotificationMonitor } from '@/hooks/useNotificationMonitor'
import { useVanitySync } from '@/hooks/useVanitySync'
import { authStore } from '@/lib/stores/auth'
import { notificationActions } from '@/lib/stores/notifications'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'

/**
 * Host wiring: runs the app-wide sync and notification monitors. Renders nothing.
 *
 * None of these hooks depend on router context, so they mount above
 * `RouterProvider` in `frontend.tsx` and keep running across navigations. The
 * overlays they drive live in `AppOverlays`.
 */
export function AppMonitors() {
	const { isAuthenticated } = useStore(authStore)

	// Store <-> relay/query sync for instance-managed lists.
	useBlacklistSync()
	useVanitySync()
	useNip05Sync()

	// Notification pipeline: initialize once authenticated, then watch.
	useEffect(() => {
		if (isAuthenticated) {
			notificationActions.initialize()
		}
	}, [isAuthenticated])

	useNotificationMonitor()
	useAuctionWinMonitor()

	return null
}
