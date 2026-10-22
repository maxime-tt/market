import { NwcWalletStatusView } from '@ui/checkout/nwc-wallet-status-view'
import type { WidgetLibrary } from '../libraries'

/**
 * Checkout views. The library may only import `ui/` and `sdk/`, so the
 * settings link the route resolves through the router is a plain anchor here.
 *
 * `NwcWalletStatusView` is the one block the checkout route used to write twice
 * (mobile summary and desktop sidebar) with two different footer sentences; it
 * now has a single implementation and a single footer.
 */

const settingsLink = (
	<a href="/dashboard/account/making-payments" className="text-primary hover:underline">
		settings
	</a>
)

export const checkout: WidgetLibrary = {
	name: 'checkout',
	entries: [
		{
			name: 'NwcWalletStatusConnected',
			render: () => <NwcWalletStatusView connected connectedWalletCount={2} settingsLink={settingsLink} />,
		},
		{
			name: 'NwcWalletStatusConnectedOne',
			render: () => <NwcWalletStatusView connected connectedWalletCount={1} settingsLink={settingsLink} />,
		},
		{
			name: 'NwcWalletStatusDisconnected',
			render: () => <NwcWalletStatusView connected={false} connectedWalletCount={0} settingsLink={settingsLink} />,
		},
	],
}
