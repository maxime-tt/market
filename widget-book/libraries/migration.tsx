import { useState } from 'react'
import type { Nip15ProductData } from '@sdk/commerce/products/nip15Migration'
import { MigrationFormView, type MigrationFormData } from '@ui/migration/migration-form-view'
import { MigrationProgressDialog, type MigrationStep, type RelayStatus } from '@ui/migration/migration-progress-dialog'
import type { WidgetLibrary } from '../libraries'

/**
 * Migration progress view drained into ui/migration.
 *
 * Both views are literal-prop renders: the NIP-15 original, the form state and
 * the migration step list all come from the host, so the catalogue passes them
 * as literals. `MigrationFormView` is fully controlled — the demo holds the
 * `MigrationFormData` in `useState` and applies each `onChange` patch.
 */

/** Inline SVG data URI so the original product image renders without any network. */
const svgImage = (fill: string) =>
	`data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${fill}"/><circle cx="200" cy="200" r="110" fill="rgba(255,255,255,0.7)"/></svg>`,
	)}`

const ORIGINAL_NIP15: Nip15ProductData = {
	id: 'prod-1',
	name: 'Handmade mug',
	description: 'Wheel-thrown stoneware mug with a honey glaze.',
	price: '20',
	currency: 'USD',
	quantity: 5,
	images: [svgImage('#10b981')],
	specs: [['Material', 'Stoneware']],
}

const EMPTY_MIGRATION_FORM: MigrationFormData = {
	name: 'Handmade mug',
	summary: 'One-of-a-kind stoneware mug',
	description: 'Wheel-thrown stoneware mug with a honey glaze.',
	price: '20',
	currency: 'USD',
	quantity: '5',
	status: 'on-sale',
	productType: 'single',
	mainCategory: 'Ceramics',
	images: [],
	specs: [{ key: 'Material', value: 'Stoneware' }],
	categories: [{ key: 'sub-1', name: 'Mugs', checked: true }],
	shippings: [{ shipping: { id: 'ship-1', name: 'Standard Post' }, extraCost: '0' }],
	weight: { value: '0.4', unit: 'kg' },
	dimensions: { value: '10x8x9', unit: 'cm' },
	selectedCollection: null,
}

/** Controlled `MigrationFormView`: every field patch flows through demo state. */
function MigrationFormDemo({ isPublishing = false }: { isPublishing?: boolean }) {
	const [formData, setFormData] = useState<MigrationFormData>({ ...EMPTY_MIGRATION_FORM })

	return (
		<MigrationFormView
			original={ORIGINAL_NIP15}
			formData={formData}
			onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
			currencies={['SATS', 'USD', 'EUR']}
			categories={['Ceramics', 'Textiles', 'Art']}
			renderImageUploader={(index) => (
				<div key={index} className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
					Image uploader slot {index + 1}
				</div>
			)}
			shippingOptions={[
				{ id: 'ship-1', name: 'Standard Post', cost: 5, currency: 'USD' },
				{ id: 'ship-2', name: 'Express Courier', cost: 25, currency: 'USD', countries: ['United Kingdom'] },
			]}
			isLoadingShipping={false}
			collections={[
				{ id: 'col-1', name: 'Summer favourites', pubkey: 'a'.repeat(64) },
				{ id: 'col-2', name: 'Kitchenware', pubkey: 'b'.repeat(64) },
			]}
			isLoadingCollections={false}
			onAddSubCategory={() =>
				setFormData((prev) => ({
					...prev,
					categories: [...prev.categories, { key: `sub-${prev.categories.length + 1}`, name: '', checked: true }],
				}))
			}
			onAddShipping={(option) =>
				setFormData((prev) => ({
					...prev,
					shippings: [...prev.shippings, { shipping: { id: option.id, name: option.name ?? option.id }, extraCost: '0' }],
				}))
			}
			isPublishing={isPublishing}
			onSubmit={() => {}}
			onBack={() => {}}
			progressDialog={null}
		/>
	)
}

const PUBLISHING_STEPS: MigrationStep[] = [
	{ id: 'extract', label: 'Reading NIP-15 product', status: 'complete' },
	{ id: 'transform', label: 'Converting to NIP-99', status: 'complete' },
	{ id: 'publishing', label: 'Publishing NIP-99 product', status: 'active' },
	{ id: 'complete', label: 'Migration complete', status: 'pending' },
]

const RELAY_STATUSES: RelayStatus[] = [
	{ url: 'wss://relay.plebeian.market', status: 'success' },
	{ url: 'wss://relay.damus.io', status: 'pending' },
	{ url: 'wss://nos.lol', status: 'pending' },
]

/**
 * Progress dialog demo. Kept closed at rest, like `ConfirmDialogDemo`: a mounted
 * open modal hides the whole catalogue from the accessibility tree.
 *
 * The view takes no `onOpenChange`, so the publishing dialog cannot be closed
 * from inside — the demo trigger is the only way back out.
 */
function MigrationProgressDialogDemo() {
	const [open, setOpen] = useState(false)

	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				Open migration progress
			</button>
			<MigrationProgressDialog open={open} steps={PUBLISHING_STEPS} relayStatuses={RELAY_STATUSES} />
		</div>
	)
}

/** Failed migration: the error banner appears and the Cancel/Try Again actions wire back to the demo. */
function MigrationProgressDialogErrorDemo() {
	const [open, setOpen] = useState(false)
	const steps: MigrationStep[] = [
		{ id: 'extract', label: 'Reading NIP-15 product', status: 'complete' },
		{ id: 'publishing', label: 'Publishing NIP-99 product', status: 'error' },
	]

	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				Open failed migration
			</button>
			<MigrationProgressDialog
				open={open}
				steps={steps}
				relayStatuses={[{ url: 'wss://relay.plebeian.market', status: 'error' }]}
				error="The relay rejected the product event: duplicate d tag."
				onRetry={() => {}}
				onCancel={() => setOpen(false)}
			/>
		</div>
	)
}

export const migration: WidgetLibrary = {
	name: 'migration',
	entries: [
		{
			name: 'MigrationFormView',
			render: () => <MigrationFormDemo />,
		},
		{
			// The disabled-with-reason publish state while the host is publishing.
			name: 'MigrationFormViewPublishing',
			render: () => <MigrationFormDemo isPublishing />,
		},
		{
			name: 'MigrationProgressDialog',
			render: () => <MigrationProgressDialogDemo />,
		},
		{
			name: 'MigrationProgressDialogError',
			render: () => <MigrationProgressDialogErrorDemo />,
		},
	],
}
