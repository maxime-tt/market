import { PlusIcon, TruckIcon } from 'lucide-react'
import { Button } from '../primitives/button'
import { Card, CardContent } from '../primitives/card'
import { Label } from '../primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select'
import { Spinner } from '../primitives/spinner'
import { EmptyState } from '../shared/empty-state'

export interface ShippingServiceOption {
	value: string
	label: string
}

interface ServiceFilterSelectProps {
	value: string
	onChange: (value: string) => void
	serviceTypes: readonly ShippingServiceOption[]
	triggerClassName: string
	placeholder: string
}

function ServiceFilterSelect({ value, onChange, serviceTypes, triggerClassName, placeholder }: ServiceFilterSelectProps) {
	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger className={triggerClassName}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="all">All services</SelectItem>
				{serviceTypes.map((service) => (
					<SelectItem key={service.value} value={service.value}>
						{service.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

export interface ShippingOptionsToolbarProps {
	serviceFilter: string
	onServiceFilterChange: (value: string) => void
	serviceTypes: readonly ShippingServiceOption[]
	onAdd: () => void
}

/** Sticky desktop header with filter + add; mobile gets the stacked variant via `ShippingOptionsMobileToolbar`. */
export function ShippingOptionsToolbar({ serviceFilter, onServiceFilterChange, serviceTypes, onAdd }: ShippingOptionsToolbarProps) {
	return (
		<div className="sticky top-0 z-10 hidden items-center justify-between border-b bg-bg px-4 py-4 lg:flex lg:px-6">
			<h1 className="text-2xl font-bold">Shipping Options</h1>
			<div className="flex items-center gap-4">
				<div className="flex items-center gap-2">
					<Label htmlFor="service-filter" className="text-sm font-medium">
						Filter:
					</Label>
					<ServiceFilterSelect
						value={serviceFilter}
						onChange={onServiceFilterChange}
						serviceTypes={serviceTypes}
						triggerClassName="w-[180px]"
						placeholder="All services"
					/>
				</div>
				<Button
					onClick={onAdd}
					className="flex items-center gap-2 bg-fill-ink px-4 py-2 text-sm font-semibold text-on-fill-ink hover:bg-fill-ink-hover"
				>
					<PlusIcon className="h-5 w-5" />
					Add Shipping Option
				</Button>
			</div>
		</div>
	)
}

export function ShippingOptionsMobileToolbar({ serviceFilter, onServiceFilterChange, serviceTypes, onAdd }: ShippingOptionsToolbarProps) {
	return (
		<div className="space-y-4 lg:hidden">
			<div>
				<p className="text-muted-foreground">Manage your shipping options for customers</p>
			</div>

			<ServiceFilterSelect
				value={serviceFilter}
				onChange={onServiceFilterChange}
				serviceTypes={serviceTypes}
				triggerClassName="w-full"
				placeholder="Filter by service type"
			/>

			<Button
				onClick={onAdd}
				className="flex w-full items-center justify-center gap-2 rounded-t-md rounded-b-none border-b border-border-strong bg-fill-ink py-3 text-base font-semibold text-on-fill-ink hover:bg-fill-ink-hover"
			>
				<PlusIcon className="h-5 w-5" />
				Add Shipping Option
			</Button>
		</div>
	)
}

export function ShippingOptionsLoading() {
	return (
		<div className="flex items-center justify-center p-8">
			<Spinner />
			<span className="ml-2">Loading shipping options...</span>
		</div>
	)
}

export function ShippingOptionsEmptyState({
	serviceFilter,
	serviceTypes,
}: {
	serviceFilter: string
	serviceTypes: readonly ShippingServiceOption[]
}) {
	const serviceLabel = serviceTypes.find((service) => service.value === serviceFilter)?.label.toLowerCase()
	return (
		<Card>
			<CardContent className="py-10">
				<EmptyState
					icon={<TruckIcon />}
					title={
						serviceFilter === 'all'
							? 'No shipping options configured yet. Add a shipping option to start offering delivery to your customers.'
							: `No ${serviceLabel} shipping options found.`
					}
				/>
			</CardContent>
		</Card>
	)
}
