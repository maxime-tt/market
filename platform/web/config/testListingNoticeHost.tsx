/**
 * Host/binding for `@ui/dashboard/test-label-views`' `TestListingNoticeView`.
 *
 * It supplies the two things `ui/` cannot own: the test-label read (the platform
 * binding) and the curator profile link (the router). The identifier shortening
 * needs `nip19`, which `ui/` may not import, so it happens here and the view
 * receives an already-shortened string.
 *
 * The legacy `src/components/TestListingNotice.tsx` retired in batch 2 lane D; its
 * remaining platform route consumers already alias this host (`TestListingNoticeHost
 * as TestListingNotice`).
 */
import { useTestLabelForCoordinate } from '@platform/web/config/testLabelsBinding'
import { TestListingNoticeView } from '@ui/dashboard/test-label-views'
import { truncateNpub } from '@ui/nostr/npub-display'
import { Link } from '@tanstack/react-router'
import { nip19 } from 'nostr-tools'

/**
 * Shorten an npub for display: `npub1abcdefgh…wxyz12`. Returns null when the pubkey
 * cannot be encoded, so the view can fall back to the Plebeian team rather than render
 * a broken identifier. Moved verbatim from the retiring legacy component.
 */
export const shortenLabelerNpub = (pubkey: string): string | null => {
	try {
		return truncateNpub(nip19.npubEncode(pubkey), { head: 14, tail: 6, separator: '…' })
	} catch {
		return null
	}
}

interface TestListingNoticeHostProps {
	/**
	 * Item coordinate ("kind:pubkey:identifier"), or '' when the item has no coordinate yet.
	 * Computed by the caller via `getItemTestLabelCoordinate` or `getProductCoordinates`.
	 */
	coordinate: string
	/** Noun used in copy ('Product' | 'Auction'). */
	itemLabel?: string
	variant?: 'badge' | 'icon'
	className?: string
}

/**
 * Renders nothing unless the coordinate carries an active test label, so it is safe to
 * mount unconditionally on any item surface.
 */
export function TestListingNoticeHost({ coordinate, itemLabel = 'Product', variant = 'badge', className }: TestListingNoticeHostProps) {
	const { isLabeled, labelerPubkey } = useTestLabelForCoordinate(coordinate || undefined)

	if (!isLabeled) return null

	const curatorNpubShort = labelerPubkey ? shortenLabelerNpub(labelerPubkey) : null

	return (
		<TestListingNoticeView
			itemLabel={itemLabel}
			variant={variant}
			className={className}
			curatorNpubShort={curatorNpubShort}
			renderCuratorLink={
				labelerPubkey && curatorNpubShort
					? ({ label }) => (
							<Link
								to="/profile/$profileId"
								params={{ profileId: labelerPubkey }}
								title={labelerPubkey}
								className="font-medium text-primary underline"
							>
								{label}
							</Link>
						)
					: undefined
			}
		/>
	)
}
