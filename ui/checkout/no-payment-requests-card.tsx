import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card'
import { Clock, CreditCard } from 'lucide-react'

interface NoPaymentRequestsCardProps {
	isBuyer: boolean
}

export function NoPaymentRequestsCard({ isBuyer }: NoPaymentRequestsCardProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<CreditCard className="w-5 h-5" />
					Payment Status
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="text-center py-8">
					<Clock className="w-12 h-12 text-text-mid mx-auto mb-4" />
					<p className="text-lg font-medium text-text-high mb-2">
						{isBuyer ? 'Waiting for Payment Requests' : 'No Payment Requests Created'}
					</p>
					<p className="text-text-mid">
						{isBuyer
							? 'The seller has not yet created payment requests for this order.'
							: 'Payment requests have not been created for this order yet.'}
					</p>
				</div>
			</CardContent>
		</Card>
	)
}
