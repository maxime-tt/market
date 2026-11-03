import { useAuth } from '@platform/web/auth/authStore'
import { publishShareProductNote } from '@platform/web/messaging/shareNotes'
import { ShareProductDialogHost } from '@platform/web/messaging/ShareProductDialogHost'
import { ShareButtonView } from '@ui/community/social-buttons'
import { useState } from 'react'
import type { ButtonProps } from '@ui/wrappers/button-props'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'

interface ShareButtonHostProps extends ButtonProps {
	event: NostrEventLike
	itemName?: string
}

/**
 * Host for the pure `@ui/community/social-buttons` share button. Moved
 * verbatim from the retiring `src/components/social/ShareButton.tsx`
 * (H-b kit 6 social cluster): it opens the share dialog and wires the publish
 * adapter. The event type arrives through the read facade, so this host names
 * no transport.
 */
export const ShareButtonHost = ({
	event,
	itemName: itemNameProp,
	onClick: _onClick,
	onPointerDown: _onPointerDown,
	...props
}: ShareButtonHostProps) => {
	const [shareDialogOpen, setShareDialogOpen] = useState(false)

	const itemName = itemNameProp ?? event.tags.find((v) => v[0] === 'title')?.[1] ?? 'Unknown'

	return (
		<>
			<ShareButtonView {...props} onPress={() => setShareDialogOpen(true)} />

			<ShareProductDialogHost
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
