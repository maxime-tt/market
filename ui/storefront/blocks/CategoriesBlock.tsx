import { cn } from '@ui/utils/cn'
import type { ReactNode } from 'react'
import { StorefrontEditorHint, StorefrontSection, StorefrontSectionTitle } from './shared'
import { StorefrontLink } from '../StorefrontLink'

/** The document-facing configuration of the block (what the page event stores). */
export interface CategoriesBlockProps {
	/** Display label shown to visitors. */
	label: string
	/** Platform category key — the identifier the host resolves into an in-app path. */
	key: string
}

/**
 * The document-facing configuration of the Categories block — the author-ordered
 * list of category entries.
 */
export interface CategoriesBlockBlockProps {
	categories: CategoriesBlockProps[]
	title: string
}

/**
 * The props-only view contract: the block plus the host-supplied path resolver.
 * `ui/` never resolves the data itself — the platform host maps category keys
 * to in-app navigation paths.
 */
export interface CategoriesBlockViewProps extends CategoriesBlockBlockProps {
	/** Resolves a category key to a platform path (e.g. `?tag=bitcoin`). */
	categoryToPath: (key: string) => string
}

/**
 * A flat, authorable category list with explicit ordering.
 *
 * Categories are author-picked from the platform's category list and ordered
 * in the document. The host resolves each category key into its in-app path
 * (typically `?tag=<key>`). No taxonomy resolution happens on the front end —
 * the flat list is the full authority.
 */
export function CategoriesBlock({ categories, title, categoryToPath }: CategoriesBlockViewProps) {
	// No categories configured.
	if (categories.length === 0) {
		return (
			<StorefrontSection className="py-8">
				<StorefrontSectionTitle title={title} />
			</StorefrontSection>
		)
	}

	return (
		<StorefrontSection className={cn('py-8', 'pointer-events-none')}>
			<StorefrontSectionTitle title={title} />
			<div className="flex flex-wrap gap-2">
				{categories.map((cat) => (
					<StorefrontLink key={cat.key} href={categoryToPath(cat.key)} className="inline-block">
						<span
							className={cn(
								'rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground',
								'hover:bg-accent hover:text-accent-foreground transition-colors',
							)}
						>
							{cat.label}
						</span>
					</StorefrontLink>
				))}
			</div>
		</StorefrontSection>
	)
}
