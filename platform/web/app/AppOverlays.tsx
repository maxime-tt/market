import { AuthKeyDialogsHost } from '@platform/web/auth/AuthKeyDialogsHost'
import { PIIExposureModal } from '@platform/web/account/PIIExposureModal'
import { DialogRegistry } from '@platform/web/app/DialogRegistry'
import { SheetRegistry } from '@platform/web/app/SheetRegistry'
import { usePIIMonitor } from '@platform/web/account/usePIIMonitor'
import { Toaster } from 'sonner'
import { useEffect, useState } from 'react'

/**
 * Host wiring: app-wide overlays that do not require router context.
 *
 * Mounted above `RouterProvider` so they survive navigation. `AuctionWonModal`
 * is deliberately NOT here — it reads `useLocation`, so it stays inside the
 * router subtree in `__root.tsx`.
 */
export function AppOverlays() {
	const { hasPII, scanResult } = usePIIMonitor()
	const [showPIIModal, setShowPIIModal] = useState(false)

	useEffect(() => {
		if (hasPII && scanResult) {
			setShowPIIModal(true)
		}
	}, [hasPII, scanResult])

	return (
		<>
			{showPIIModal && scanResult && (
				<PIIExposureModal isOpen={showPIIModal} onClose={() => setShowPIIModal(false)} scanResult={scanResult} />
			)}
			<AuthKeyDialogsHost />
			<SheetRegistry />
			<DialogRegistry />
			<Toaster />
		</>
	)
}
