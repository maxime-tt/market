import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card'
import { Check, Clock, Users, CreditCard, SkipForward } from 'lucide-react'
import { formatSats } from '../utils/format'

/** Display fields only; invoice lifecycle is decided by the host checkout flow. */
export interface CheckoutInvoiceSummaryItem {
	id: string
	amount: number
	recipientName: string
	status: string
	type: string
	expiresAt?: number
}

interface PaymentSummaryProps {
	invoices: readonly CheckoutInvoiceSummaryItem[]
	currentIndex: number
	onSelectInvoice: (index: number) => void
}

export function CheckoutPaymentSummary({ invoices, currentIndex, onSelectInvoice }: PaymentSummaryProps) {
	const paidCount = invoices.filter((inv) => inv.status === 'paid').length
	const skippedCount = invoices.filter((inv) => inv.status === 'skipped').length
	const totalAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0)
	const paidAmount = invoices.filter((inv) => inv.status === 'paid').reduce((sum, inv) => sum + inv.amount, 0)
	const skippedAmount = invoices.filter((inv) => inv.status === 'skipped').reduce((sum, inv) => sum + inv.amount, 0)
	const remainingAmount = totalAmount - paidAmount - skippedAmount

	const currentInvoice = invoices[currentIndex]

	return (
		<div className="flex flex-col lg:flex-col-reverse gap-4">
			{/* Payment Summary - Mobile first, Desktop second */}
			<Card className="lg:order-1">
				<CardHeader className="pb-2">
					<CardTitle className="text-sm">Payment Summary</CardTitle>
				</CardHeader>
				<CardContent className="p-6 space-y-2">
					<div className="flex justify-between text-sm">
						<span>Paid</span>
						<span className="font-medium">
							{paidCount}/{invoices.length}
						</span>
					</div>
					{skippedCount > 0 && (
						<div className="flex justify-between text-sm">
							<span>Skipped</span>
							<span className="font-medium">
								{skippedCount}/{invoices.length}
							</span>
						</div>
					)}
					<div className="flex justify-between text-sm">
						<span>Completed</span>
						<span className="font-medium text-success">{formatSats(paidAmount)} sats</span>
					</div>
					{skippedAmount > 0 && (
						<div className="flex justify-between text-sm">
							<span>Skipped Amount</span>
							<span className="font-medium text-warning">{formatSats(skippedAmount)} sats</span>
						</div>
					)}
					<div className="flex justify-between text-sm">
						<span>Remaining</span>
						<span className="font-medium">{formatSats(remainingAmount)} sats</span>
					</div>
					<div className="border-t pt-2 flex justify-between font-medium">
						<span>Total</span>
						<span>{formatSats(totalAmount)} sats</span>
					</div>
				</CardContent>
			</Card>

			{/* All Payments - Mobile second, Desktop first */}
			<Card className="lg:order-2">
				<CardHeader className="pb-2">
					<CardTitle className="text-sm">All Payments ({invoices.length})</CardTitle>
				</CardHeader>
				<CardContent className="p-6">
					<div className="space-y-1">
						{invoices.map((invoice, index) => (
							<button
								key={invoice.id}
								onClick={() => onSelectInvoice(index)}
								className={`w-full p-3 rounded-lg border text-left transition-all ${
									index === currentIndex
										? 'border-fill-accent bg-fill-accent/10 shadow-sm'
										: invoice.status === 'paid'
											? 'border-success-border bg-success-muted'
											: invoice.status === 'skipped'
												? 'border-warning-border bg-warning-muted'
												: 'border-border-default bg-surface-raised hover:bg-surface-hover'
								}`}
							>
								<div className="flex items-center justify-between mb-1">
									<div className="flex items-center gap-2">
										{invoice.type === 'v4v' ? <Users className="w-4 h-4 text-info" /> : <CreditCard className="w-4 h-4 text-info" />}
										<span className="font-medium text-sm truncate">{invoice.recipientName}</span>
										{invoice.status === 'paid' && <Check className="w-4 h-4 text-success" />}
										{invoice.status === 'skipped' && <SkipForward className="w-4 h-4 text-warning" />}
									</div>
								</div>

								<div className="flex items-center justify-between">
									<span className="text-xs text-text-mid">{invoice.type === 'v4v' ? 'V4V Payment' : 'Merchant Payment'}</span>
									<div className="text-right">
										<div className="font-medium text-sm">{formatSats(invoice.amount)} sats</div>
										{invoice.status === 'paid' && <div className="text-xs text-success">Paid</div>}
										{invoice.status === 'skipped' && <div className="text-xs text-warning">Skipped</div>}
										{invoice.status === 'pending' && invoice.expiresAt && (
											<div className="text-xs text-text-mid flex items-center gap-1">
												<Clock className="w-3 h-3" />
												<span>{Math.max(0, Math.floor((invoice.expiresAt - Date.now()) / 60000))}m</span>
											</div>
										)}
									</div>
								</div>
							</button>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
