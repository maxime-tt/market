import { DecryptPasswordDialog } from '@/components/auth/DecryptPasswordDialog'
import { MigratePrivateKeyDialog } from '@/components/auth/MigratePrivateKeyDialog'
import { PIIExposureModal } from '@/components/pii/PIIExposureModal'
import { DialogRegistry } from '@/components/DialogRegistry'
import { SheetRegistry } from '@/components/SheetRegistry'
import { usePIIMonitor } from '@/hooks/usePIIMonitor'
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
			<MigratePrivateKeyDialog />
			<DecryptPasswordDialog />
			<SheetRegistry />
			<DialogRegistry />
			<Toaster />
		</>
	)
}
