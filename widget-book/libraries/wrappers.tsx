import { useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@ui/primitives/toggle-group'
import { Button } from '@ui/wrappers/button'
import { CollectionSelectField } from '@ui/wrappers/collection-select-field'
import { EditorTextField } from '@ui/wrappers/editor-fields'
import { TooltipButton } from '@ui/wrappers/tooltip-button'
import { TooltipToggleGroupItem } from '@ui/wrappers/tooltip-toggle-group-item'
import type { CollectionReadEvent } from '@sdk/commerce/collections'
import type { WidgetLibrary } from '../libraries'

/**
 * `ui/wrappers/` adapters. `Button` is the primitive plus a `pending` state, so
 * the entries below pin the four states the routes rely on. The tooltip, field
 * and selector adapters render with literal props; the tooltip provider itself
 * is mounted once in `main.tsx`.
 */

/** Literal SDK collection projections: `getCollectionId`/`Title` read the tags. */
const sampleCollections: CollectionReadEvent[] = [
	{
		pubkey: 'd943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782',
		tags: [
			['d', 'summer'],
			['title', 'Summer collection'],
		],
	},
	{
		pubkey: 'd943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782',
		tags: [
			['d', 'winter'],
			['title', 'Winter favourites'],
		],
	},
]

function TooltipToggleGroupItemDemo() {
	const [value, setValue] = useState<string[]>(['grid'])

	return (
		<ToggleGroup type="multiple" variant="outline" value={value} onValueChange={setValue}>
			<TooltipToggleGroupItem value="grid" tooltip="Grid view" aria-label="Grid view">
				Grid
			</TooltipToggleGroupItem>
			<TooltipToggleGroupItem value="list" tooltip="List view" aria-label="List view">
				List
			</TooltipToggleGroupItem>
			<TooltipToggleGroupItem value="plain" aria-label="Plain">
				Plain
			</TooltipToggleGroupItem>
		</ToggleGroup>
	)
}

function CollectionSelectFieldDemo() {
	const [value, setValue] = useState('summer')

	return (
		<div className="max-w-xs space-y-1">
			<CollectionSelectField aria-label="Collection" collections={sampleCollections} value={value} onValueChange={setValue} />
			<p className="text-xs text-muted-foreground">Selected: {value}</p>
		</div>
	)
}

function EditorTextFieldDemo() {
	const [title, setTitle] = useState('Handmade mug')
	const [description, setDescription] = useState('')

	return (
		<div className="max-w-xs space-y-3">
			<EditorTextField id="demo-title" label="Title" value={title} onChange={setTitle} required hint="Shown on the product page." />
			<EditorTextField
				id="demo-description"
				label="Description"
				value={description}
				onChange={setDescription}
				multiline
				placeholder="Describe the item…"
			/>
		</div>
	)
}

function EditorTextFieldErrorDemo() {
	const [price, setPrice] = useState('')

	return (
		<div className="max-w-xs">
			<EditorTextField
				id="demo-price"
				label="Price"
				value={price}
				onChange={setPrice}
				required
				touched
				errors={['Price is required', 'Use whole sats']}
			/>
		</div>
	)
}

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
		{
			name: 'TooltipButton',
			render: () => (
				<div className="flex flex-wrap items-center gap-3">
					<TooltipButton tooltip="Save your changes">Save</TooltipButton>
					<TooltipButton variant="secondary" tooltip="Publish now">
						Publish
					</TooltipButton>
					<TooltipButton disabled disabledTooltip="Connect a wallet first">
						Zap
					</TooltipButton>
				</div>
			),
		},
		{
			name: 'TooltipToggleGroupItem',
			render: () => <TooltipToggleGroupItemDemo />,
		},
		{
			name: 'CollectionSelectField',
			render: () => <CollectionSelectFieldDemo />,
		},
		{
			name: 'EditorTextField',
			render: () => <EditorTextFieldDemo />,
		},
		{
			name: 'EditorTextFieldError',
			render: () => <EditorTextFieldErrorDemo />,
		},
	],
}
