interface PaymentProgressBarProps {
	paidCount: number
	totalCount: number
	progressPercent: number
}

export function PaymentProgressBar({ paidCount, totalCount, progressPercent }: PaymentProgressBarProps) {
	return (
		<div className="space-y-2">
			<div className="flex justify-between text-sm">
				<span>Payment Progress</span>
				<span>
					{paidCount}/{totalCount} Complete
				</span>
			</div>
			<div className="w-full bg-surface-hover rounded-full h-2">
				<div className="bg-success h-2 rounded-full transition-all duration-300" style={{ width: `${progressPercent}%` }} />
			</div>
		</div>
	)
}
