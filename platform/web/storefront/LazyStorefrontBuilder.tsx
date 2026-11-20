import { Suspense, type ComponentProps } from 'react'
import { lazyRetry } from '@ui/utils/lazy-retry'

/**
 * The Puck page editor, loaded on first use (ADR-0027). Puck, its rich-text
 * and drag-and-drop stack are only needed in the dashboard editor, so public
 * pages never download them.
 */
const StorefrontBuilderImpl = lazyRetry(() => import('./StorefrontBuilder').then((m) => ({ default: m.StorefrontBuilder })))

export type StorefrontBuilderProps = ComponentProps<typeof import('./StorefrontBuilder').StorefrontBuilder>

export function StorefrontBuilder(props: StorefrontBuilderProps) {
	return (
		<Suspense
			fallback={
				<div data-testid="editor-loading" aria-busy="true" className="flex min-h-[60vh] items-center justify-center">
					<span className="sr-only">Loading the page editor</span>
					<span aria-hidden className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40" />
				</div>
			}
		>
			<StorefrontBuilderImpl {...props} />
		</Suspense>
	)
}
