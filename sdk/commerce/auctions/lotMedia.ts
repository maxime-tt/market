/**
 * A lot's gallery: the 1440 create content's optional `media` list.
 *
 * Wire shape (display field, mutable on edit like `image`):
 *
 * ```
 * "image": "https://…/front.jpg",                      the primary photo, still required
 * "media": [                                           optional, in display order
 *   { "type": "image", "url": "https://…/back.jpg" },
 *   { "type": "video", "url": "https://…/demo.mp4" },
 *   { "type": "live",  "url": "https://…/stream.m3u8" }
 * ]
 * ```
 *
 * `image` stays the first item of the gallery, so a reader that knows nothing of
 * `media` still shows the lot's main photo. `media` holds the items after it.
 * Every URL passes the same gate as storefront media: absolute `https:` or an
 * in-app path. Anything else is dropped on read and refused on publish.
 */

import { isSafeMediaSrc } from '@sdk/commerce/storefront/storefrontPage'

export type LotMediaType = 'image' | 'video' | 'live'

export interface LotMediaItem {
	type: LotMediaType
	url: string
}

/** The most extra items a create may carry (the primary `image` is not counted). */
export const LOT_MEDIA_MAX_EXTRA = 12

const TYPES: ReadonlySet<string> = new Set<LotMediaType>(['image', 'video', 'live'])

/** One wire item → a safe item, or null. */
export function parseLotMediaItem(value: unknown): LotMediaItem | null {
	if (value === null || typeof value !== 'object') return null
	const { type, url } = value as { type?: unknown; url?: unknown }
	if (typeof type !== 'string' || !TYPES.has(type)) return null
	if (typeof url !== 'string') return null
	const trimmed = url.trim()
	if (!isSafeMediaSrc(trimmed)) return null
	return { type: type as LotMediaType, url: trimmed }
}

/** The wire `media` value → the safe extra items, capped, unsafe entries dropped. */
export function parseLotMedia(value: unknown): LotMediaItem[] {
	if (!Array.isArray(value)) return []
	const out: LotMediaItem[] = []
	for (const entry of value) {
		const item = parseLotMediaItem(entry)
		if (item) out.push(item)
		if (out.length >= LOT_MEDIA_MAX_EXTRA) break
	}
	return out
}

/**
 * The whole gallery in display order: the primary `image` first (when safe),
 * then the extra items, with exact duplicates of the primary removed.
 */
export function lotGallery(primary: string | null | undefined, extra: readonly LotMediaItem[]): LotMediaItem[] {
	const out: LotMediaItem[] = []
	const head = typeof primary === 'string' ? primary.trim() : ''
	if (head !== '' && isSafeMediaSrc(head)) out.push({ type: 'image', url: head })
	for (const item of extra) {
		if (item.type === 'image' && item.url === head) continue
		out.push(item)
	}
	return out
}
