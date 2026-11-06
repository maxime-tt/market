import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { StorefrontBuilder } from '@platform/web/storefront/StorefrontBuilder'
import { authStore } from '@platform/web/auth/authStore'
import { LoadingState } from '@ui/shared/loading-state'
import { useDashboardTitle } from '@platform/web/app/dashboardTitle'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/profile-page')({
	component: () => {
		useDashboardTitle('Storefront')
		const user = useStore(authStore, (state) => state.user)
		const pubkey = user?.pubkey

		// The author's pubkey comes from the auth store rather than a route param:
		// there is exactly one page a signed-in user can edit — their own — and taking
		// it from the URL would invite an "edit somebody else's page" shape the signer
		// would then refuse anyway.
		//
		// `_dashboard-layout` already renders the login prompt for signed-out visitors,
		// so this branch only handles the case where auth is present but the pubkey
		// has not arrived yet.
		if (!pubkey) {
			return <LoadingState className="p-8" label="Loading your account…" />
		}

		return <StorefrontBuilder pubkey={pubkey} />
	},
})
