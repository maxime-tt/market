import { useId, useState, type MouseEvent, type ReactNode } from 'react'
import { EyeOff, FlaskConical } from 'lucide-react'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '../primitives/alert-dialog'
import { Button } from '../primitives/button'
import { Checkbox } from '../primitives/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../primitives/dialog'
import { Label } from '../primitives/label'
import { Textarea } from '../primitives/textarea'

export type TestLabelKindSlug = 'product' | 'auction'
export type TestLabelDialogMode = 'mark' | 'unmark'

export interface TestLabelButtonViewProps {
	isLabeled: boolean
	/** Noun used in copy, e.g. 'Product' or 'Auction'. */
	itemLabel: string
	kindSlug: TestLabelKindSlug
	className?: string
	onPress: (mode: TestLabelDialogMode) => void
}

export function TestLabelButtonView({ isLabeled, itemLabel, kindSlug, className, onPress }: TestLabelButtonViewProps) {
	const mode: TestLabelDialogMode = isLabeled ? 'unmark' : 'mark'
	return (
		<Button
			variant="outline"
			size="sm"
			className={className}
			data-testid={`${mode}-test-label-${kindSlug}-button`}
			onClick={() => onPress(mode)}
		>
			<FlaskConical className="h-3.5 w-3.5" />
			{isLabeled ? 'Unmark' : 'Mark'} as Test {itemLabel}
		</Button>
	)
}

export interface TestListingsToggleViewProps {
	checked: boolean
	onCheckedChange: (checked: boolean) => void
	className?: string
	label?: string
}

/**
 * Browsing-surface toggle (ADR-0009 rev 3): reveals test-labeled items in feeds.
 * Pure props view: the host owns the platform binding and the query invalidation.
 */
export function TestListingsToggleView({ checked, onCheckedChange, className, label = 'Show test listings' }: TestListingsToggleViewProps) {
	return (
		<div className={'flex items-center space-x-2' + (className ? ' ' + className : '')}>
			<Checkbox id="show-test-listings" checked={checked} onCheckedChange={(value) => onCheckedChange(Boolean(value))} />
			<Label htmlFor="show-test-listings" className="text-sm font-normal cursor-pointer">
				{label}
			</Label>
		</div>
	)
}

export interface TestLabelDialogViewProps {
	mode: TestLabelDialogMode
	open: boolean
	onOpenChange: (open: boolean) => void
	itemLabel: string
	kindSlug: TestLabelKindSlug
	/** Appeal message published with the label (mark mode only). */
	content: string
	onContentChange: (content: string) => void
	isBusy: boolean
	onConfirm: () => void
}

/**
 * A test label gates browsing and discovery only (ADR-0009); the copy must state
 * that the item stays reachable by direct link, seller profile and dashboard.
 */
export function TestLabelDialogView({
	mode,
	open,
	onOpenChange,
	itemLabel,
	kindSlug,
	content,
	onContentChange,
	isBusy,
	onConfirm,
}: TestLabelDialogViewProps) {
	const contentFieldId = useId()
	const itemNoun = itemLabel.toLowerCase()

	if (mode === 'unmark') {
		return (
			<AlertDialog open={open} onOpenChange={onOpenChange}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove the test label?</AlertDialogTitle>
						<AlertDialogDescription data-testid={`test-label-unmark-description-${kindSlug}`}>
							A NIP-09 deletion event is published for the label you applied. This {itemNoun} returns to browsing, search and collections
							immediately — it was never hidden from direct links, seller profiles, or the owner's dashboard.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={onConfirm} disabled={isBusy}>
							Unmark as Test
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		)
	}

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Mark this {itemNoun} as a test listing?</AlertDialogTitle>
					<AlertDialogDescription data-testid={`test-label-mark-description-${kindSlug}`}>
						A NIP-32 label is published under your key as an authorized labeler. This {itemNoun} is hidden from browsing, search and
						collections — the home feed, browse listings, search results and collection pages — but it stays reachable by direct link, on
						the seller's profile, and in the owner's dashboard. The message below is published with the label, so the seller sees it was
						curated and knows how to appeal.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="space-y-1.5">
					<Label htmlFor={contentFieldId} className="text-sm font-medium">
						Message published with the label
					</Label>
					<Textarea
						id={contentFieldId}
						data-testid={`test-label-content-${kindSlug}`}
						value={content}
						onChange={(event) => onContentChange(event.target.value)}
						rows={4}
						className="text-sm"
					/>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm} disabled={isBusy}>
						Mark as Test
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

/** Fallback contact when the labeler's pubkey is not known (or not encodable). */
export const TEST_LISTING_TEAM_FALLBACK = 'the Plebeian team'

export interface TestListingNoticeViewProps {
	/** Noun used in copy, e.g. 'Product' or 'Auction'. */
	itemLabel?: string
	/**
	 * 'badge' — full pill with label text, used on detail pages where there is room.
	 * 'icon' — compact corner marker for cards in a grid, where clicking must not navigate.
	 */
	variant?: 'badge' | 'icon'
	className?: string
	/**
	 * The curator identifier, already shortened for display, or null when the labeler's
	 * pubkey is unknown / cannot be encoded. The shortening needs nip19, which `ui/` may
	 * not import, so the host supplies it.
	 */
	curatorNpubShort: string | null
	/**
	 * Renders the curator profile link. The host supplies the router `Link`; when absent
	 * (or when there is no curator identifier) the view falls back to the team copy.
	 */
	renderCuratorLink?: (args: { label: string; title: string }) => ReactNode
}

/**
 * ADR-0009 — user-facing "this is a test listing" indicator.
 *
 * A test label hides an item from browsing and discovery surfaces only. The item stays
 * reachable by direct link, on the seller's profile, and in the owner's dashboard — so a
 * visitor who arrives through one of those routes sees a listing that is missing from the
 * feed with no explanation. This notice supplies that explanation and an appeal path.
 *
 * Pure props view: the host decides whether the coordinate carries an active label and
 * supplies the curator identity, so nothing is rendered here for an unlabeled item.
 */
export function TestListingNoticeView({
	itemLabel = 'Product',
	variant = 'badge',
	className,
	curatorNpubShort,
	renderCuratorLink,
}: TestListingNoticeViewProps) {
	const [isOpen, setIsOpen] = useState(false)
	const itemNoun = itemLabel.toLowerCase()

	// Card clicks navigate to the product, so opening the explainer must not bubble up to
	// the surrounding link.
	const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
		event.preventDefault()
		event.stopPropagation()
		setIsOpen(true)
	}

	return (
		<>
			{variant === 'icon' ? (
				<button
					type="button"
					data-testid="test-listing-notice-icon"
					aria-label={`This ${itemNoun} is marked as a test listing — see why`}
					title="Marked as a test listing"
					onClick={handleOpen}
					className={`flex justify-center items-center bg-warning hover:bg-warning/90 shadow rounded-full w-6 h-6 text-warning-foreground transition-colors ${className ?? ''}`}
				>
					<EyeOff className="w-3.5 h-3.5" />
				</button>
			) : (
				<button
					type="button"
					data-testid="test-listing-notice"
					aria-label={`This ${itemNoun} is marked as a test listing — see why`}
					onClick={handleOpen}
					// `w-fit` keeps the pill at its intrinsic width. Without it a flex column
					// parent (the product hero) stretches it to the full column width because
					// align-items defaults to stretch.
					className={`inline-flex justify-center items-center gap-1.5 w-fit bg-warning-muted hover:bg-warning-muted/80 px-2.5 py-1 border border-warning-border rounded-full font-medium text-warning-muted-foreground text-xs transition-colors ${className ?? ''}`}
				>
					<EyeOff className="w-3.5 h-3.5" />
					<span>Test listing</span>
				</button>
			)}

			<Dialog open={isOpen} onOpenChange={setIsOpen}>
				<DialogContent className="max-w-md" data-testid="test-listing-notice-dialog">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<EyeOff className="w-5 h-5 text-warning" />
							This {itemNoun} is marked as a test listing
						</DialogTitle>
						<DialogDescription>
							A marketplace curator (an editor or admin) marked this listing as a test. Test listings are hidden from browsing, search and
							collections — the home feed, browse listings, search results and collection pages — but they stay reachable by direct link, on
							the seller's profile, and in the owner's dashboard.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-2 text-sm">
						<p className="font-medium">Think this is a mistake?</p>
						<p className="text-text-mid">
							Contact the curator who applied the label, or the Plebeian team, and ask for the label to be removed. Only the curator who
							applied a label can delete it.
						</p>
						<p data-testid="test-listing-notice-contact" className="text-text-mid">
							{curatorNpubShort && renderCuratorLink ? (
								<>
									Curator:{' '}
									{renderCuratorLink({
										label: curatorNpubShort,
										title: 'Curator',
									})}
								</>
							) : (
								<>Curator: {TEST_LISTING_TEAM_FALLBACK}</>
							)}
						</p>
					</div>

					<DialogFooter>
						<Button variant="outline" data-testid="test-listing-notice-close" onClick={() => setIsOpen(false)}>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
