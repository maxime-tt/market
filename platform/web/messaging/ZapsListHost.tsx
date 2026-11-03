import { useZapsViaProvider } from '@platform/web/payments/zapsQuery'
import { AvatarHost } from '@platform/web/profiles/userCardHosts'
import { ZapsListView } from '@ui/community/social-lists'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'

interface ZapsListHostProps {
	event: NostrEventLike
	asChildren?: boolean
}

/**
 * Host for the pure `@ui/community/social-lists` zaps list. Moved verbatim
 * from the retiring `src/components/social/ZapsList.tsx` (H-b kit 6 social
 * cluster) onto the platform zaps binding; the event type arrives through the
 * read facade, so this host names no transport.
 */
export const ZapsListHost = ({ event, asChildren = false }: ZapsListHostProps) => {
	const { data: zaps } = useZapsViaProvider(event)

	return (
		<ZapsListView
			zaps={zaps ?? []}
			asChildren={asChildren}
			renderAvatar={(pubkey, className) => <AvatarHost pubkey={pubkey} className={className} />}
		/>
	)
}
