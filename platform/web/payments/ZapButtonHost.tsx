/**
 * Host/binding for the pure `@ui/community/social-buttons` `ZapButtonView`.
 * It is the retired `src/components/social/ZapButton.tsx` moved verbatim onto
 * its platform homes: the zap-capability read comes from the platform profile
 * query binding and the dialog is the platform `ZapDialogHost`. The event type
 * is whatever the capability query accepts, so this host never names the NDK
 * transport. The open/close state machine is extracted as
 * `zapDialogVisibility` so it has one behaviour test.
 */
import { ZapDialogHost } from '@platform/web/payments/ZapDialogHost'
import { useZapCapability } from '@platform/web/profiles/profileQuery'
import { useState } from 'react'
import type { ButtonProps } from '@ui/wrappers/button-props'
import { ZapButtonView } from '@ui/community/social-buttons'

/** The zap target type, taken from the capability query instead of naming the transport. */
type ZapTargetEvent = Parameters<typeof useZapCapability>[0]

interface ZapButtonHostProps extends ButtonProps {
	event: ZapTargetEvent
}

/**
 * The dialog open/close state machine the legacy button owned: opening starts
 * the zap interaction; closing it — through any path — clears the zapping flag.
 */
export const zapDialogVisibility = (open: boolean, isZapping: boolean): { isZapping: boolean; dialogOpen: boolean } =>
	open ? { isZapping, dialogOpen: true } : { isZapping: false, dialogOpen: false }

export function ZapButtonHost({ event, ...props }: ZapButtonHostProps) {
	const [isZapping, setIsZapping] = useState(false)
	const [dialogOpen, setDialogOpen] = useState(false)

	const { data: canAuthorReceiveZaps, isLoading: checkingZapCapability } = useZapCapability(event)

	const handleZapComplete = () => {
		setIsZapping(false)
		setDialogOpen(false)
	}

	const handleOpenChange = (open: boolean) => {
		const next = zapDialogVisibility(open, isZapping)
		setIsZapping(next.isZapping)
		setDialogOpen(next.dialogOpen)
	}

	return (
		<>
			<ZapButtonView
				{...props}
				isCheckingCapability={checkingZapCapability}
				canReceiveZaps={!!canAuthorReceiveZaps}
				isZapping={isZapping}
				onPress={() => {
					setIsZapping(true)
					setDialogOpen(true)
				}}
			/>
			<ZapDialogHost isOpen={dialogOpen} onOpenChange={handleOpenChange} event={event} onZapComplete={handleZapComplete} />
		</>
	)
}
