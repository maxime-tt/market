import { Button } from '../primitives/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Notice } from '../shared/notice'

interface IncompleteInvoicesBannerProps {
	count: number
	onRefresh: () => void
}

export function IncompleteInvoicesBanner({ count, onRefresh }: IncompleteInvoicesBannerProps) {
	return (
		<Notice
			tone="warning"
			title={
				<span className="flex items-center gap-2">
					<AlertTriangle className="w-6 h-6 sm:w-5 sm:h-5" />
					{count} invoice{count !== 1 ? 's' : ''} require payment
				</span>
			}
			action={
				<Button variant="outline" size="sm" onClick={onRefresh} className="w-full sm:w-auto">
					<RefreshCw className="w-4 h-4 mr-2" />
					Refresh All
				</Button>
			}
		>
			Make all payments to complete the order
		</Notice>
	)
}
