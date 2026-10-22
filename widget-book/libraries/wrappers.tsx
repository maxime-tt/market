import { Button } from '@ui/wrappers/button'
import type { WidgetLibrary } from '../libraries'

/**
 * `ui/wrappers/` adapters. `Button` is the primitive plus a `pending` state, so
 * the entries below pin the four states the routes rely on.
 */

export const wrappers: WidgetLibrary = {
	name: 'wrappers',
	entries: [
		{
			name: 'ButtonVariants',
			render: () => (
				<div className="flex flex-wrap gap-3">
					<Button>Default</Button>
					<Button variant="secondary">Secondary</Button>
					<Button variant="outline">Outline</Button>
					<Button variant="ghost">Ghost</Button>
					<Button variant="destructive">Destructive</Button>
				</div>
			),
		},
		{
			name: 'ButtonPendingStart',
			render: () => <Button pending>Saving…</Button>,
		},
		{
			name: 'ButtonPendingEnd',
			render: () => (
				<Button pending pendingPosition="end">
					Saving…
				</Button>
			),
		},
		{
			name: 'ButtonPendingSmall',
			render: () => (
				<Button variant="outline" size="sm" pending>
					Add
				</Button>
			),
		},
	],
}
