import { TestLabelDialog } from '@platform/web/curation/TestLabelDialog'
import { testLabelItemSlug } from '@platform/web/curation/testLabelItemKind'
import { getATagFromCoords } from '@sdk/core/utils/coords'
import { useUserRole } from '@platform/web/app-settings/appSettingsQuery'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { useTestLabelForCoordinate } from '@platform/web/config/testLabelsBinding'
import { useState } from 'react'
import { TestLabelButtonView, type TestLabelDialogMode } from '@ui/dashboard/test-label-views'

interface TestLabelButtonProps {
	/** Item event kind: 30402 (product) or 1440 (arena auction lot) */
	kind: number
	/** Author pubkey of the item */
	pubkey: string
	/** Item d-tag identifier */
	dTag: string
	/** Noun used in button labels and copy ('Product' | 'Auction') */
	itemLabel?: string
	/** Optional wrapper className */
	className?: string
}

/**
 * Dashboard action for authorized labelers (ADR-0009): mark / unmark an item
 * as a "test" listing via NIP-32 label events (kind 1985) and NIP-09
 * deletion events (kind 5).
 *
 * - Visible only to authorized labelers — the curation role set is editors
 *   UNION admins (plus the app owner), matching
 *   `useEntityPermissions().canManageTestLabel`.
 * - Opens the shared `TestLabelDialog` for both mark and unmark, so the same
 *   flow is reachable from the public product page's `EntityActionsMenu`.
 */
export function TestLabelButton({ kind, pubkey, dTag, itemLabel = 'Product', className }: TestLabelButtonProps) {
	const { data: config } = useConfigQuery()
	const { userRole, currentUserPubkey } = useUserRole(config?.appPublicKey)

	const [dialogMode, setDialogMode] = useState<TestLabelDialogMode | null>(null)

	// A kind outside the label registry gets no button: the retired 30408
	// listing used to be treated as an "auction" here and would have published a
	// label at a coordinate nothing reads.
	const kindSlug = testLabelItemSlug(kind)

	const coordinate = kindSlug && pubkey && dTag ? getATagFromCoords({ kind, pubkey, identifier: dTag }) : ''
	const { isLabeled } = useTestLabelForCoordinate(coordinate || undefined)

	// Authorized labelers only (editors ∪ admins ∪ owner) — never regular users.
	const isAuthorizedLabeler = userRole === 'owner' || userRole === 'admin' || userRole === 'editor'
	if (!isAuthorizedLabeler || !currentUserPubkey || !kindSlug || !coordinate) return null

	return (
		<>
			<TestLabelButtonView isLabeled={isLabeled} itemLabel={itemLabel} kindSlug={kindSlug} className={className} onPress={setDialogMode} />

			{dialogMode && (
				<TestLabelDialog
					kind={kind}
					pubkey={pubkey}
					dTag={dTag}
					itemLabel={itemLabel}
					open={true}
					onOpenChange={(next) => {
						if (!next) setDialogMode(null)
					}}
					mode={dialogMode}
					contactPubkey={currentUserPubkey}
				/>
			)}
		</>
	)
}
