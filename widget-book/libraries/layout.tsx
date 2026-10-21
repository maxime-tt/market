import { MobilePageHeader, PageHeader } from '@ui/layout/page-header'
import type { WidgetLibrary } from '../libraries'

/**
 * Layout shells and bands. Each entry is a literal-prop render so the gallery
 * and the Playwright spec show a deterministic state.
 *
 * `PageHeader` is `hidden` below `lg`, and `MobilePageHeader` is `lg:hidden`, so
 * the spec asserts the desktop band as visible and the compact band as attached.
 */
export const layout: WidgetLibrary = {
	name: 'layout',
	entries: [
		{
			name: 'PageHeader',
			render: () => (
				<PageHeader>
					<div>
						<h1 className="text-2xl font-bold">Products</h1>
						<p className="text-sm text-muted-foreground">Everything you have listed for sale.</p>
					</div>
					<button type="button" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
						Add product
					</button>
				</PageHeader>
			),
		},
		{
			name: 'MobilePageHeader',
			render: () => (
				<MobilePageHeader>
					<h1 className="text-xl font-bold">Dashboard</h1>
				</MobilePageHeader>
			),
		},
	],
}
