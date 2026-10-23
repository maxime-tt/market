import { useState } from 'react'
import { ShareProductDialog } from '../dialogs/ShareProductDialog'
import { publishShareProductNote } from '@/publish/shareNotes'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { ButtonProps } from '@ui/wrappers/button-props'
import { ShareButtonView } from '@ui/community/social-buttons'

interface ShareButtonProps extends ButtonProps {
	event: NDKEvent
	itemName?: string
}

export const ShareButton = ({
	event,
	itemName: itemNameProp,
	onClick: _onClick,
	onPointerDown: _onPointerDown,
	...props
}: ShareButtonProps) => {
	const [shareDialogOpen, setShareDialogOpen] = useState(false)

	const itemName = itemNameProp ?? event.tags.find((v) => v[0] === 'title')?.[1] ?? 'Unknown'

	return (
		<>
			<ShareButtonView {...props} onPress={() => setShareDialogOpen(true)} />

			<ShareProductDialog
				open={shareDialogOpen}
				onOpenChange={setShareDialogOpen}
				productId={event.id}
				pubkey={event.pubkey}
				title={itemName}
				onPost={publishShareProductNote}
			/>
		</>
	)
}
