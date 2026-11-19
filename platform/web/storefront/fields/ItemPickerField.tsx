import { collectionsByPubkeyQueryOptions, getCollectionId, getCollectionTitle } from '@platform/web/collections/collectionQuery'
import { getProductId, getProductTitle, productsByPubkeyQueryOptions, productsQueryOptions } from '@platform/web/products/productQuery'
import { useStorefrontContext } from '@ui/storefront/StorefrontContext'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

/**
 * Sidebar fields for choosing one of the author's own products or collections.
 *
 * The persisted value is the item's `d` tag, not its title: a title is display
 * text, and the repo rule is to reference items by identifier so renaming a
 * product does not silently break every page that features it.
 *
 * The dropdown is populated from the author's own listings, which also means
 * the editor cannot express a reference to somebody else's item — the same
 * guarantee the renderer enforces, made visible in the UI.
 */

const selectClassName =
	'w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary'

function FieldShell({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
			{label}
			{children}
		</label>
	)
}

export function ProductPickerField({
	label,
	value,
	onChange,
	readOnly,
}: {
	label: string
	value: string
	onChange: (value: string) => void
	readOnly?: boolean
}) {
	const { pubkey } = useStorefrontContext()
	const { data: products, isLoading } = useQuery(productsByPubkeyQueryOptions(pubkey))

	const options = (products ?? []).map((product) => ({
		value: getProductId(product),
		label: getProductTitle(product) || getProductId(product),
	}))

	// A value pointing at something no longer listed must stay selectable, or
	// opening the editor would silently rewrite the page to the first product
	// in the list. Show it, marked, and let the author decide.
	const hasCurrent = value.length > 0 && options.some((option) => option.value === value)

	return (
		<FieldShell label={label}>
			<select className={selectClassName} value={value} disabled={readOnly} onChange={(event) => onChange(event.target.value)}>
				<option value="">{isLoading ? 'Loading your products…' : 'Select a product…'}</option>
				{!hasCurrent && value.length > 0 && <option value={value}>{value} (not currently listed)</option>}
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			{!isLoading && options.length === 0 && <span className="text-[11px] font-normal">You have no published products yet.</span>}
		</FieldShell>
	)
}

export function CollectionPickerField({
	label,
	value,
	onChange,
	readOnly,
}: {
	label: string
	value: string
	onChange: (value: string) => void
	readOnly?: boolean
}) {
	const { pubkey } = useStorefrontContext()
	const { data: collections, isLoading } = useQuery(collectionsByPubkeyQueryOptions(pubkey))

	const options = (collections ?? []).map((collection) => ({
		value: getCollectionId(collection),
		label: getCollectionTitle(collection) || getCollectionId(collection),
	}))

	const hasCurrent = value.length > 0 && options.some((option) => option.value === value)

	return (
		<FieldShell label={label}>
			<select className={selectClassName} value={value} disabled={readOnly} onChange={(event) => onChange(event.target.value)}>
				<option value="">{isLoading ? 'Loading your collections…' : 'Select a collection…'}</option>
				{!hasCurrent && value.length > 0 && <option value={value}>{value} (not found)</option>}
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			{!isLoading && options.length === 0 && <span className="text-[11px] font-normal">You have no collections yet.</span>}
		</FieldShell>
	)
}

/**
 * The hand-picked product row's field: any product listed on the
 * marketplace, not only the author's own. The row block resolves its `d` tags
 * across every seller (see `ProductRowSlot`), and a home page is written by an
 * operator key that owns no listings, so an own-listings picker would always
 * be empty there. Stores ordered `d` tags.
 */
export function ProductRowPickerField({
	label,
	value,
	onChange,
	readOnly,
}: {
	label: string
	value: string[]
	onChange: (value: string[]) => void
	readOnly?: boolean
}) {
	const { data: products, isLoading } = useQuery(productsQueryOptions(500))
	const [filter, setFilter] = useState('')

	const options = (products ?? [])
		.map((product) => ({ value: getProductId(product), label: getProductTitle(product) || getProductId(product) }))
		.filter((option) => option.value)
	const byValue = new Map(options.map((option) => [option.value, option.label]))
	const needle = filter.trim().toLowerCase()
	const visible = options.filter((option) => !value.includes(option.value) && (!needle || option.label.toLowerCase().includes(needle))).slice(0, 40)

	const remove = (dTag: string) => !readOnly && onChange(value.filter((entry) => entry !== dTag))
	const add = (dTag: string) => !readOnly && !value.includes(dTag) && onChange([...value, dTag])

	return (
		<div className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
			<span>{label}</span>
			{value.length > 0 && (
				<ol className="flex flex-col gap-1 font-normal" data-testid="product-row-selected">
					{value.map((dTag, index) => (
						<li key={dTag} className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1 text-foreground">
							<span className="truncate">
								{index + 1}. {byValue.get(dTag) ?? `${dTag}${isLoading ? '' : ' (not currently listed)'}`}
							</span>
							{!readOnly && (
								<button type="button" className="text-[11px] underline" onClick={() => remove(dTag)}>
									Remove
								</button>
							)}
						</li>
					))}
				</ol>
			)}
			<input
				type="search"
				className={selectClassName}
				placeholder={isLoading ? 'Loading products…' : 'Filter products by name'}
				value={filter}
				disabled={readOnly}
				onChange={(event) => setFilter(event.target.value)}
				data-testid="product-row-filter"
			/>
			{!isLoading && options.length === 0 && <span className="text-[11px] font-normal">No products are listed yet.</span>}
			{visible.length > 0 && (
				<ul className="flex max-h-64 flex-col gap-1 overflow-y-auto font-normal">
					{visible.map((option) => (
						<li key={option.value}>
							<button
								type="button"
								className="flex w-full items-start gap-2 rounded border border-border px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted/40"
								disabled={readOnly}
								onClick={() => add(option.value)}
							>
								<span aria-hidden>+</span>
								<span className="truncate">{option.label}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
