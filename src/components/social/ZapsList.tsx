import { useZapsViaProvider } from '@/queries/zaps'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ZapsListView } from '@ui/community/social-lists'
import { AvatarUser } from '../AvatarUser'

interface ZapsListProps {
	event: NDKEvent
	asChildren?: boolean
}

export const ZapsList = ({ event, asChildren = false }: ZapsListProps) => {
	const { data: zaps } = useZapsViaProvider(event)

	return (
		<ZapsListView
			zaps={zaps ?? []}
			asChildren={asChildren}
			renderAvatar={(pubkey, className) => <AvatarUser pubkey={pubkey} className={className} />}
		/>
	)
}
