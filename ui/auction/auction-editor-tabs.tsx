import { Fragment, useState, type Dispatch, type Ref, type SetStateAction } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '../primitives/button'
import { Checkbox } from '../primitives/checkbox'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select'
import { cn } from '../utils/cn'
import { type AuctionImage, type RenderAuctionImageUploader, type TabProps } from './model'

/**
 * The four simple auction-editor tabs, as one cluster file (the `ui/AGENTS.md`
 * § Cluster files convention: several closely related presentational views of a
 * single concept in one module, each still owing its own widget-book entry and
 * its own coverage). They share the `AuctionFormData` slice shape and are each
 * well under a screen, so one file is the repo convention — the sibling
 * `ui/products/product-editor-tabs.tsx` set the precedent.
 *
 * T6.3 slice S5a: lifted verbatim out of
 * `ui/components/auction-editor/AuctionEditorTabs.tsx`. Markup, copy and class
 * strings are unchanged; each root only gains the `className`/`ref` contract
 * from `ui/AGENTS.md`, merged through `cn()` (a no-op on a single literal).
 */

/** Title / summary / description / NSFW — the first tab of the auction form. */
export function AuctionNameTab({ formData, setFormData, className, ref }: TabProps & { className?: string; ref?: Ref<HTMLDivElement> }) {
	return (
		<div ref={ref} className={cn('flex flex-col gap-4', className)}>
			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-title">
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Title</span>
				</Label>
				<Input
					id="auction-title"
					value={formData.title}
					onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
					placeholder="e.g. Rare print run #1"
				/>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-summary">Summary</Label>
				<Input
					id="auction-summary"
					value={formData.summary}
					onChange={(e) => setFormData((prev) => ({ ...prev, summary: e.target.value }))}
					placeholder="Short one-liner for list view"
				/>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-description">
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Description</span>
				</Label>
				<textarea
					id="auction-description"
					value={formData.description}
					onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
					className="border-2 min-h-24 p-2 rounded-md"
					placeholder="Describe the item, condition, and shipping notes."
				/>
			</div>

			<div className="flex items-start space-x-3 p-3 border rounded-lg bg-amber-50/50 border-amber-200">
				<Checkbox
					id="auction-nsfw-content"
					checked={formData.isNSFW}
					onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, isNSFW: checked === true }))}
					className="mt-0.5"
				/>
				<div className="space-y-1">
					<Label htmlFor="auction-nsfw-content" className="text-sm font-medium cursor-pointer">
						This auction contains adult/sensitive content
					</Label>
				</div>
			</div>
		</div>
	)
}

/** Main category + free-text sub-category list. */
export function AuctionCategoryTab({
	formData,
	setFormData,
	subCategoryInput,
	setSubCategoryInput,
	mainCategories,
	className,
	ref,
}: TabProps & {
	subCategoryInput: string
	setSubCategoryInput: Dispatch<SetStateAction<string>>
	mainCategories: readonly string[]
	className?: string
	ref?: Ref<HTMLDivElement>
}) {
	return (
		<div ref={ref} className={cn('flex flex-col gap-4', className)}>
			<div className="grid w-full gap-1.5">
				<Label>Main Category</Label>
				<Select value={formData.mainCategory} onValueChange={(value) => setFormData((prev) => ({ ...prev, mainCategory: value }))}>
					<SelectTrigger>
						<SelectValue placeholder="Select category" />
					</SelectTrigger>
					<SelectContent>
						{mainCategories.map((category) => (
							<SelectItem key={category} value={category}>
								{category}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-sub-categories">Sub Categories (comma or newline separated)</Label>
				<textarea
					id="auction-sub-categories"
					value={subCategoryInput}
					onChange={(e) => setSubCategoryInput(e.target.value)}
					className="border-2 min-h-20 p-2 rounded-md"
					placeholder="Collectibles, Art, Bitcoin"
				/>
			</div>
		</div>
	)
}

/** Key/value spec rows the host seeds from `formData.specs`. */
export function AuctionSpecTab({ formData, setFormData, className, ref }: TabProps & { className?: string; ref?: Ref<HTMLDivElement> }) {
	const specs = formData.specs

	const updateSpec = (index: number, field: 'key' | 'value', value: string) => {
		setFormData((prev) => {
			const next = [...prev.specs]
			next[index] = { ...next[index], [field]: value }
			return { ...prev, specs: next }
		})
	}

	const addSpec = () => {
		setFormData((prev) => ({ ...prev, specs: [...prev.specs, { key: '', value: '' }] }))
	}

	const removeSpec = (index: number) => {
		setFormData((prev) => ({ ...prev, specs: prev.specs.filter((_, i) => i !== index) }))
	}

	return (
		<div ref={ref} className={cn('flex flex-col gap-4', className)}>
			<div className="space-y-1">
				<Label className="text-base font-medium">Item Specifications</Label>
				<p className="text-sm text-zinc-600">
					Key/value pairs describing the item (e.g. brand, model, condition). Shown on the auction detail page.
				</p>
			</div>

			<div className="space-y-3">
				{specs.map((spec, index) => (
					<div key={index} className="flex gap-2 items-start">
						<Input
							placeholder="Name (e.g. Brand)"
							value={spec.key}
							onChange={(e) => updateSpec(index, 'key', e.target.value)}
							className="flex-1"
						/>
						<Input
							placeholder="Value (e.g. Leica)"
							value={spec.value}
							onChange={(e) => updateSpec(index, 'value', e.target.value)}
							className="flex-1"
						/>
						<Button type="button" variant="outline" size="sm" onClick={() => removeSpec(index)} className="text-red-600 hover:text-red-700">
							<X className="w-4 h-4" />
						</Button>
					</div>
				))}

				<Button type="button" variant="outline" onClick={addSpec} className="w-full flex items-center gap-2">
					<Plus className="w-4 h-4" />
					Add Specification
				</Button>
			</div>
		</div>
	)
}

/** Uploaded images, delegated to the host-supplied `renderUploader`. */
export function AuctionImagesTab({
	images,
	setImages,
	error,
	renderUploader,
	className,
	ref,
}: {
	images: AuctionImage[]
	setImages: Dispatch<SetStateAction<AuctionImage[]>>
	error?: string
	renderUploader: RenderAuctionImageUploader
	className?: string
	ref?: Ref<HTMLDivElement>
}) {
	const [needsUploader, setNeedsUploader] = useState(true)

	const handleSaveImage = ({ url, index }: { url: string; index: number }) => {
		if (index >= 0) {
			setImages((prev) => {
				const next = [...prev]
				next[index] = { ...next[index], imageUrl: url }
				return next
			})
		} else {
			setImages((prev) => [...prev, { imageUrl: url, imageOrder: prev.length }])
			setNeedsUploader(true)
		}
	}

	const handleDeleteImage = (index: number) => {
		setImages((prev) => prev.filter((_, i) => i !== index).map((img, i) => ({ ...img, imageOrder: i })))
	}

	const handlePromoteImage = (index: number) => {
		if (index <= 0) return
		setImages((prev) => {
			const next = [...prev]
			const tmp = next[index]
			next[index] = next[index - 1]
			next[index - 1] = tmp
			return next.map((img, i) => ({ ...img, imageOrder: i }))
		})
	}

	const handleDemoteImage = (index: number) => {
		setImages((prev) => {
			if (index >= prev.length - 1) return prev
			const next = [...prev]
			const tmp = next[index]
			next[index] = next[index + 1]
			next[index + 1] = tmp
			return next.map((img, i) => ({ ...img, imageOrder: i }))
		})
	}

	return (
		<div ref={ref} className={cn('space-y-4', className)}>
			<p className="text-gray-600">We recommend using square images of 1600x1600 and under 2mb.</p>

			<div className="flex flex-col gap-4">
				<Label>
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Image Upload</span>
					<span className="sr-only">required</span>
					{error && <span className="text-sm text-red-500 ml-2">({error})</span>}
				</Label>

				{images.map((image, i) => (
					<Fragment key={i}>
						{renderUploader({
							src: image.imageUrl,
							index: i,
							imagesLength: images.length,
							onSave: handleSaveImage,
							onDelete: handleDeleteImage,
							onPromote: handlePromoteImage,
							onDemote: handleDemoteImage,
						})}
					</Fragment>
				))}

				{needsUploader &&
					renderUploader({ src: null, index: -1, imagesLength: 0, onSave: handleSaveImage, onDelete: () => setNeedsUploader(false) })}
			</div>
		</div>
	)
}
