import { Users } from 'lucide-react'

interface V4VRecipientsCardProps {
	shares: Array<{ name: string; percentage: number }>
}

export function V4VRecipientsCard({ shares }: V4VRecipientsCardProps) {
	const formatPercentage = (percentage: number) => {
		const normalized = percentage > 1 ? percentage : percentage * 100
		return new Intl.NumberFormat(undefined, {
			minimumFractionDigits: normalized < 1 ? 2 : 0,
			maximumFractionDigits: 2,
		}).format(normalized)
	}

	return (
		<div className="bg-info-muted border border-info-border rounded-lg p-4">
			<div className="flex items-center gap-2 mb-2">
				<Users className="w-5 h-5 text-info" />
				<h4 className="font-medium text-info-foreground">Value-for-Value Recipients</h4>
			</div>
			<div className="text-sm text-info-foreground">
				This seller shares revenue with {shares.length} community recipient
				{shares.length !== 1 ? 's' : ''}:
			</div>
			<div className="mt-2 space-y-1">
				{shares.map((share, index) => (
					<div key={index} className="flex justify-between text-sm">
						<span className="text-info-foreground">{share.name}</span>
						<span className="text-info font-medium">{formatPercentage(share.percentage)}%</span>
					</div>
				))}
			</div>
		</div>
	)
}
