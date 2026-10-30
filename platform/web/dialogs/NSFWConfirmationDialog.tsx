import { uiActions, uiStore } from '@platform/web/app/uiStore'
import { useStore } from '@tanstack/react-store'
import { NSFWConfirmationDialogView } from '@ui/dialogs/dialog-views'

export function NSFWConfirmationDialog() {
	const { dialogs } = useStore(uiStore)

	return (
		<NSFWConfirmationDialogView
			open={dialogs['nsfw-confirmation']}
			onConfirm={() => uiActions.enableNSFWContent()}
			onCancel={() => uiActions.closeDialog('nsfw-confirmation')}
		/>
	)
}
