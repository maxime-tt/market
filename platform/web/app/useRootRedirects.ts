import { configStore } from '@/lib/stores/config'
import { useAmIAdmin } from '@/queries/app-settings'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'

/**
 * Host wiring: the setup redirect and the admin-route gate that used to run as
 * effects inside `__root.tsx`.
 *
 * Deliberately NOT `beforeLoad`:
 * - The setup redirect must react to `configStore` while the user stays on
 *   `/setup` (setup completion flips `needsSetup`, and `setup.tsx` navigates
 *   itself); a `beforeLoad` only fires on navigation and would miss it.
 * - The admin gate depends on an async query (`useAmIAdmin`) and the NDK active
 *   user; gating in `beforeLoad` would change when the redirect fires and block
 *   the route render until the query resolves. This is a client-side workflow
 *   control, not server enforcement.
 */
export function useRootRedirects() {
	const config = useStore(configStore, (s) => s.config)
	const navigate = useNavigate()
	const location = useLocation()
	const { amIAdmin, isLoading: isLoadingAdmin } = useAmIAdmin(config?.appPublicKey)

	const { pathname } = window.location
	const isSetupPage = location.pathname === '/setup'
	const isAdminRoute = pathname.startsWith('/dashboard/app-settings')

	useEffect(() => {
		if (config?.needsSetup && !isSetupPage) {
			navigate({ to: '/setup' })
		} else if (!config?.needsSetup && isSetupPage) {
			navigate({ to: '/' })
		}
	}, [config, navigate, isSetupPage])

	useEffect(() => {
		if (isLoadingAdmin) return
		if (isAdminRoute && !amIAdmin) {
			navigate({ to: '/dashboard' })
		}
	}, [isAdminRoute, amIAdmin, isLoadingAdmin, navigate])
}
