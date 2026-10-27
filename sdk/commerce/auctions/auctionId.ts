import type { NostrEventLike } from '../../core/nostr/eventLike'

export const getAuctionId = (event: NostrEventLike | null): string => event?.tags.find((t) => t[0] === 'd')?.[1] || ''
