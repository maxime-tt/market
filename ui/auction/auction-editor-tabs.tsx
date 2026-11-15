import type { Ref } from 'react'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select'
import { cn } from '../utils/cn'
import { type TabProps } from './model'

/**
 * The two simple auction-editor tabs, as one cluster file (the `ui/AGENTS.md`
 * § Cluster files convention): the lot's display fields and its category.
 *
 * Both write only fields the kind-1440 create carries — `title`, `description`, `name`,
 * `category`. The retired tabs are gone with their protocol: there is no `summary` tag, no
 * `content-warning`, no `spec` tag list and no `t` tag list, so there is no control for
 * them. The lot has **one** image (`image` in the create), so images are not a tab here —
 * the host renders a single uploader.
 */

/** Title / description / seller-facing name — the display fields the create carries. */
export function AuctionNameTab({ formData, setFormData, className, ref }: TabProps & { className?: string; ref?: Ref<HTMLDivElement> }) {
	return (
		<div ref={ref} className={cn('flex flex-col gap-4', className)}>
			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-title">
					<span className="after:content-['*'] after:ml-0.5 after:text-error">Title</span>
				</Label>
				<Input
					id="auction-title"
					value={formData.title}
					onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
					placeholder="e.g. Rare print run #1"
				/>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-description">
					<span className="after:content-['*'] after:ml-0.5 after:text-error">Description</span>
				</Label>
				<textarea
					id="auction-description"
					value={formData.description}
					onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
					className="border-2 min-h-24 p-2 rounded-md"
					placeholder="Describe the item and its condition."
				/>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-name">Seller display name</Label>
				<p className="text-xs text-text-mid">Shown as the lot&apos;s name on the auction page. Defaults to your profile name.</p>
				<Input
					id="auction-name"
					value={formData.name}
					onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
					placeholder="e.g. Studio Nord"
				/>
			</div>
		</div>
	)
}

/** The single free-text category the create's `category` field carries. */
export function AuctionCategoryTab({
	formData,
	setFormData,
	mainCategories,
	className,
	ref,
}: TabProps & {
	mainCategories: readonly string[]
	className?: string
	ref?: Ref<HTMLDivElement>
}) {
	return (
		<div ref={ref} className={cn('flex flex-col gap-4', className)}>
			<div className="grid w-full gap-1.5">
				<Label>Category</Label>
				<Select value={formData.category} onValueChange={(value) => setFormData((prev) => ({ ...prev, category: value }))}>
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
				<Label htmlFor="auction-category-free">…or type one</Label>
				<Input
					id="auction-category-free"
					value={formData.category}
					onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
					placeholder="Collectibles"
				/>
			</div>
		</div>
	)
}
