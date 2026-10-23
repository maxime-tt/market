import { MapPin } from 'lucide-react'

interface PickupAddressDisplayProps {
	pickupAddress: string
}

export function PickupAddressDisplay({ pickupAddress }: PickupAddressDisplayProps) {
	return (
		<div className="mt-4 p-4 bg-info-muted border border-info-border rounded-lg">
			<div className="flex items-start gap-2">
				<MapPin className="w-4 h-4 text-info mt-0.5" />
				<div>
					<p className="font-medium text-info-foreground">Pickup Address</p>
					<p className="text-info-foreground mt-1">{pickupAddress}</p>
				</div>
			</div>
		</div>
	)
}
