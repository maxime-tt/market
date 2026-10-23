import { useState, type ReactNode } from 'react'
import { NSFWConfirmationDialogView, ShareProfileDialogView, V4VSetupDialogView } from '@ui/dialogs/dialog-views'
import { PickupLocationDialogView } from '@ui/dialogs/pickup-location-dialog-view'
import { ShareProductDialogView } from '@ui/dialogs/share-product-dialog-view'
import { TermsConditionsDialogView } from '@ui/dialogs/terms-conditions-dialog-view'
import type { WidgetLibrary } from '../libraries'

/**
 * Flow dialog views drained into ui/dialogs.
 *
 * Every entry is kept closed at rest, like `ConfirmDialogDemo`: a mounted open
 * modal hides the whole catalogue from the accessibility tree, so each dialog
 * opens from a trigger and closes through its own callbacks.
 *
 * `PickupLocationDialogView` embeds a maplibre map that only initialises once
 * geocoded locations are present (it fetches OSM tiles, which the harness
 * cannot do deterministically), so the demos cover the loading and error
 * states that render in the map's place.
 */

const DEMO_NPUB = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'

/** Trigger frame shared by the dialog demos: closed at rest, opened by the button. */
function DialogDemo({
	triggerLabel,
	render,
}: {
	triggerLabel: string
	render: (open: boolean, setOpen: (open: boolean) => void) => ReactNode
}) {
	const [open, setOpen] = useState(false)

	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				{triggerLabel}
			</button>
			{render(open, setOpen)}
		</div>
	)
}

/** Controlled `ShareProductDialogView`: the share text and copied flag are host state. */
function ShareProductDialogDemo({ canPost }: { canPost: boolean }) {
	const [open, setOpen] = useState(false)
	const [shareText, setShareText] = useState('Check out this handmade mug on Plebeian Market!')
	const [isCopied, setIsCopied] = useState(false)

	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				Open share dialog
			</button>
			<ShareProductDialogView
				open={open}
				onOpenChange={setOpen}
				canPost={canPost}
				shareText={shareText}
				onShareTextChange={setShareText}
				isCopied={isCopied}
				isPosting={false}
				onCopyUrl={() => {
					setIsCopied(true)
					setTimeout(() => setIsCopied(false), 2000)
				}}
				onPost={() => {}}
			/>
		</div>
	)
}

export const dialogs: WidgetLibrary = {
	name: 'dialogs',
	entries: [
		{
			name: 'NSFWConfirmationDialogView',
			render: () => (
				<DialogDemo
					triggerLabel="Open adult-content warning"
					render={(open, setOpen) => (
						<NSFWConfirmationDialogView open={open} onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />
					)}
				/>
			),
		},
		{
			name: 'ShareProfileDialogView',
			render: () => (
				<DialogDemo
					triggerLabel="Open profile share"
					render={(open, setOpen) => <ShareProfileDialogView open={open} onOpenChange={setOpen} npub={DEMO_NPUB} profileName="satoshi" />}
				/>
			),
		},
		{
			name: 'V4VSetupDialogView',
			render: () => (
				<DialogDemo
					triggerLabel="Open V4V setup"
					render={(open, setOpen) => (
						<V4VSetupDialogView open={open} onOpenChange={setOpen}>
							<p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
								The V4V editor the host supplies renders here.
							</p>
							<p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
								Preview cards and a save button would follow.
							</p>
						</V4VSetupDialogView>
					)}
				/>
			),
		},
		{
			// Loading state: the map area shows a spinner until geocodes arrive.
			name: 'PickupLocationDialogView',
			render: () => (
				<DialogDemo
					triggerLabel="Open pickup location"
					render={(open, setOpen) => (
						<PickupLocationDialogView
							open={open}
							onOpenChange={setOpen}
							locations={[{ name: 'Corner Studio', address: '12 Brick Lane, London' }]}
							geocodedLocations={[]}
							loading
							error={null}
							vendorName="Alice's Emporium"
						/>
					)}
				/>
			),
		},
		{
			// Error state with the multi-location list above it.
			name: 'PickupLocationDialogViewError',
			render: () => (
				<DialogDemo
					triggerLabel="Open pickup locations error"
					render={(open, setOpen) => (
						<PickupLocationDialogView
							open={open}
							onOpenChange={setOpen}
							locations={[
								{ name: 'Corner Studio', address: '12 Brick Lane, London' },
								{ name: 'Harbour Workshop', address: '3 Quay Road, Bristol' },
							]}
							geocodedLocations={[]}
							loading={false}
							error="Could not load the map. Check your connection and try again."
							vendorName="Alice's Emporium"
						/>
					)}
				/>
			),
		},
		{
			name: 'ShareProductDialogView',
			render: () => <ShareProductDialogDemo canPost />,
		},
		{
			// Signed-out viewers only get the copy action.
			name: 'ShareProductDialogViewGuest',
			render: () => <ShareProductDialogDemo canPost={false} />,
		},
		{
			// Forced choice: the shipped default terms text; only Accept closes it.
			name: 'TermsConditionsDialogView',
			render: () => (
				<DialogDemo
					triggerLabel="Open terms and conditions"
					render={(open, setOpen) => (
						<TermsConditionsDialogView open={open} instanceName="Plebeian Market" onAccept={() => setOpen(false)} />
					)}
				/>
			),
		},
		{
			// ADR-018: an instance-supplied terms URL replaces the shipped text.
			name: 'TermsConditionsDialogViewCustom',
			render: () => (
				<DialogDemo
					triggerLabel="Open custom terms"
					render={(open, setOpen) => (
						<TermsConditionsDialogView
							open={open}
							instanceName="Satoshi Bazaar"
							termsUrl="https://satoshi.example/terms"
							onAccept={() => setOpen(false)}
						/>
					)}
				/>
			),
		},
	],
}
