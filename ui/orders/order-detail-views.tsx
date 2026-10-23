import { CheckCircle, Copy, CreditCard, LockKeyhole, Package, RefreshCw, Truck, Users, Zap } from 'lucide-react'
import { format } from 'date-fns'
import type { PaymentInvoiceData } from '@sdk/commerce/checkout'
import { parseOrderAddress, type InvoiceWithSource, type PrivateOrderDetailRow } from '@sdk/commerce/orders/orderDetail'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card'
import { UiLink } from '../provider/UiProvider'
import { StatusBadge } from '../shared/status-badge'
import { cn } from '../utils/cn'

export function getInvoiceStatusColor(status: string): string {
	switch (status) {
		case 'paid':
			return 'bg-success-muted text-success-foreground border-success-border'
		case 'pending':
			return 'bg-warning-muted text-warning-foreground border-warning-border'
		case 'processing':
			return 'bg-info-muted text-info-foreground border-info-border'
		case 'expired':
			return 'bg-error-muted text-error-foreground border-error-border'
		default:
			return 'bg-surface-sunken text-text-high border-border-default'
	}
}

export function PaymentSummaryView({ enrichedInvoices }: { enrichedInvoices: readonly InvoiceWithSource[] }) {
	return (
		<div className="sm:mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
			<div className="flex items-center gap-2">
				<CreditCard className="w-4 h-4 text-success" />
				<div>
					<p className="text-text-mid">Merchant</p>
					<p className="font-semibold">{enrichedInvoices.filter((inv) => inv.description === 'Merchant Payment').length} invoice</p>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<Users className="w-4 h-4 text-info" />
				<div>
					<p className="text-text-mid">V4V Recipients</p>
					<p className="font-semibold">{enrichedInvoices.filter((inv) => inv.description === 'V4V Community Payment').length} invoices</p>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<Package className="w-4 h-4 text-info" />
				<div>
					<p className="text-text-mid">Total Amount</p>
					<p className="font-semibold">{enrichedInvoices.reduce((sum, inv) => sum + inv.amount, 0).toLocaleString()} sats</p>
				</div>
			</div>
		</div>
	)
}

export interface TrackingInfoViewProps {
	trackingNumber?: string
	carrier?: string
	shippingStatus?: string
	onCopy: (value: string) => void
}

export function TrackingInfoView({ trackingNumber, carrier, shippingStatus, onCopy }: TrackingInfoViewProps) {
	if (!trackingNumber && !carrier) return null

	return (
		<div className="mt-4 p-4 bg-info-muted border border-info-border rounded-lg">
			<div className="flex items-start gap-3">
				<Package className="w-5 h-5 text-info mt-0.5 flex-shrink-0" />
				<div className="flex-1 min-w-0">
					<p className="font-semibold text-info-foreground mb-2">Tracking Information</p>
					<div className="space-y-2">
						{trackingNumber && (
							<div className="flex items-center justify-between gap-2">
								<div className="min-w-0 flex-1">
									<p className="text-xs font-medium text-info-foreground uppercase tracking-wide">Tracking URL</p>
									<p className="text-info-foreground font-mono text-sm break-all">{trackingNumber}</p>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="h-8 px-2 text-info-foreground hover:bg-info-muted flex-shrink-0"
									onClick={() => onCopy(trackingNumber)}
								>
									<Copy className="h-4 w-4" />
								</Button>
							</div>
						)}
						{carrier && (
							<div>
								<p className="text-xs font-medium text-info-foreground uppercase tracking-wide">Carrier</p>
								<p className="text-info-foreground">{carrier}</p>
							</div>
						)}
						{shippingStatus && (
							<div>
								<p className="text-xs font-medium text-info-foreground uppercase tracking-wide">Status</p>
								<p className="text-info-foreground capitalize">{shippingStatus}</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

function AddressField({ label, value, emphasis }: { label: string; value?: string; emphasis?: boolean }) {
	if (!value) return null
	return (
		<div>
			<p className="text-xs font-medium text-success-foreground uppercase tracking-wide">{label}</p>
			<p className={emphasis ? 'text-success-foreground font-medium' : 'text-success-foreground'}>{value}</p>
		</div>
	)
}

export function DeliveryAddressView({ shippingAddress }: { shippingAddress: string }) {
	const parsedAddress = parseOrderAddress(shippingAddress)

	return (
		<div className="mt-4 p-4 bg-success-muted border border-success-border rounded-lg">
			<div className="flex items-start gap-3">
				<Truck className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
				<div className="flex-1 min-w-0">
					<p className="font-semibold text-success-foreground mb-3">Delivery Address</p>
					{parsedAddress ? (
						<div className="space-y-2">
							<AddressField label="Name" value={parsedAddress.name} emphasis />
							{parsedAddress.street && (
								<div>
									<p className="text-xs font-medium text-success-foreground uppercase tracking-wide">Street Address</p>
									<p className="text-success-foreground">{parsedAddress.street}</p>
									{parsedAddress.street2 && <p className="text-success-foreground">{parsedAddress.street2}</p>}
								</div>
							)}
							<div className="grid grid-cols-2 gap-3">
								<AddressField label="City" value={parsedAddress.city} />
								<AddressField label="State" value={parsedAddress.state} />
							</div>
							<div className="grid grid-cols-2 gap-3">
								<AddressField label="ZIP Code" value={parsedAddress.zip} />
								<AddressField label="Country" value={parsedAddress.country} />
							</div>
						</div>
					) : (
						<div className="text-success-foreground space-y-0.5">
							{shippingAddress.split('\n').map((line, index) => (
								<p key={index} className="leading-relaxed">
									{line.trim()}
								</p>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export interface InvoiceCardViewProps {
	invoice: InvoiceWithSource
	index: number
	totalInvoices: number
	isBuyer: boolean
	isGenerating: boolean
	onPay: (invoice: PaymentInvoiceData) => void
	onGenerateNew: (invoice: PaymentInvoiceData) => void
	onCopy: (value: string) => void
	/** Current time in seconds; injectable for tests. */
	now?: number
}

function formatExpiryDisplay(timestamp?: number): string {
	if (!timestamp) return 'No expiry'
	const millis = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000
	return format(millis, 'PPP p')
}

export function InvoiceCardView({
	invoice,
	index,
	totalInvoices,
	isBuyer,
	isGenerating,
	onPay,
	onGenerateNew,
	onCopy,
	now = Math.floor(Date.now() / 1000),
}: InvoiceCardViewProps) {
	const isPaid = invoice.status === 'paid'
	// Prefer a still-valid local copy of the invoice over the relay request.
	const validLocalCopy = invoice.localCopies.find(
		(copy) => copy.status !== 'paid' && copy.bolt11 && (!copy.expiresAt || copy.expiresAt > now),
	)
	const invoiceToUse = validLocalCopy || invoice
	const isExpired = !!invoiceToUse.expiresAt && invoiceToUse.expiresAt < now
	const hasBolt11 = !!invoiceToUse.bolt11
	const preimage = invoice.preimage || invoiceToUse.preimage

	return (
		<Card className={cn('p-4', isPaid ? 'bg-success-muted' : 'bg-card')}>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-3 min-w-0">
					{totalInvoices > 1 && (
						<div
							className={cn(
								'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold',
								isPaid ? 'bg-success-muted text-success-foreground' : 'bg-surface-hover text-text-high',
							)}
						>
							{index + 1}
						</div>
					)}
					{isPaid ? (
						<CheckCircle className="w-5 h-5 text-success flex-shrink-0" />
					) : (
						<CreditCard className="w-5 h-5 text-text-mid flex-shrink-0" />
					)}
					<div className="min-w-0">
						<h4 className="font-medium truncate">{invoice.type === 'merchant' ? 'Merchant Payment' : invoice.recipientName}</h4>
						<p className="text-sm text-muted-foreground">
							{invoice.amount.toLocaleString()} sats
							{invoiceToUse.expiresAt && (
								<span className={cn('ml-2', isExpired ? 'text-error' : 'text-text-mid')}>
									· {isExpired ? 'Expired' : 'Expires'} {formatExpiryDisplay(invoiceToUse.expiresAt)}
								</span>
							)}
						</p>
					</div>
				</div>
				<StatusBadge
					status={isPaid ? 'Paid' : isExpired ? 'Expired' : 'Pending'}
					tone={isPaid ? 'success' : isExpired ? 'error' : 'warning'}
					className="flex-shrink-0"
				/>
			</div>

			{isBuyer && !isPaid && (
				<div className="mt-4 pt-4 border-t border-muted space-y-3">
					<div className="flex flex-wrap gap-2">
						{hasBolt11 && !isExpired && (
							<Button size="sm" className="flex-1 min-w-[140px]" onClick={() => onPay(invoiceToUse)}>
								<Zap className="w-4 h-4 mr-2" />
								Pay {invoice.amount.toLocaleString()} sats
							</Button>
						)}

						{(isExpired || !hasBolt11) && (
							<Button
								variant={hasBolt11 ? 'outline' : undefined}
								size="sm"
								className="flex-1 min-w-[140px]"
								onClick={() => onGenerateNew(invoice)}
								disabled={isGenerating}
							>
								<RefreshCw className={cn('w-4 h-4 mr-2', isGenerating && 'animate-spin')} />
								{isExpired ? 'Generate New Invoice' : 'Generate Invoice'}
							</Button>
						)}

						{hasBolt11 && (
							<Button variant="ghost" size="sm" onClick={() => onCopy(invoiceToUse.bolt11 || '')} title="Copy lightning invoice">
								<Copy className="w-4 h-4" />
							</Button>
						)}
					</div>

					{isExpired && hasBolt11 && <p className="text-xs text-warning">Invoice expired. Generate a new one to continue payment.</p>}
				</div>
			)}

			{isPaid && (
				<div className="mt-3 pt-3 border-t border-success-border space-y-2">
					<div className="flex items-center gap-2 text-sm text-success-foreground">
						<CheckCircle className="w-4 h-4" />
						<span>Payment completed</span>
					</div>
					<div className="flex flex-wrap gap-2">
						{invoiceToUse.bolt11 && (
							<Button
								variant="ghost"
								size="sm"
								className="text-text-high hover:text-text-high h-auto py-1"
								onClick={() => onCopy(invoiceToUse.bolt11 || '')}
							>
								<Copy className="w-3 h-3 mr-1" />
								Copy invoice
							</Button>
						)}
						{preimage && (
							<Button
								variant="ghost"
								size="sm"
								className="text-text-high hover:text-text-high h-auto py-1"
								onClick={() => onCopy(preimage)}
							>
								<Copy className="w-3 h-3 mr-1" />
								Copy preimage
							</Button>
						)}
					</div>
				</div>
			)}
		</Card>
	)
}

export interface PrivateOrderDetailsViewProps {
	/** Null when the seller cannot decrypt the delivery details. */
	rows: readonly PrivateOrderDetailRow[] | null
	orderId?: string
	compact?: boolean
	className?: string
}

export function PrivateOrderDetailsView({ rows, orderId, compact = false, className }: PrivateOrderDetailsViewProps) {
	if (rows === null) {
		return (
			<Card className={cn('border-warning-border bg-warning-muted', className)}>
				<CardHeader className={cn(compact ? 'p-3 pb-2' : 'p-4 pb-2')}>
					<div className="flex items-center gap-2">
						<LockKeyhole className="h-4 w-4 text-warning-foreground" />
						<CardTitle className={compact ? 'text-sm' : 'text-base'}>Private delivery details</CardTitle>
					</div>
				</CardHeader>
				<CardContent className={cn('text-sm text-warning-foreground', compact ? 'p-3 pt-0' : 'p-4 pt-0')}>
					Encrypted delivery details are unavailable. Connect the seller signer that received this order.
				</CardContent>
			</Card>
		)
	}

	if (rows.length === 0) return null

	return (
		<Card className={cn('border-success-border bg-success-muted', className)}>
			<CardHeader className={cn(compact ? 'p-3 pb-2' : 'p-4 pb-2')}>
				<div className="flex items-center gap-2">
					<LockKeyhole className="h-4 w-4 text-success-foreground" />
					<div>
						<CardTitle className={compact ? 'text-sm' : 'text-base'}>Private encrypted seller delivery details</CardTitle>
						{compact && <p className="text-xs text-success-foreground">Order {orderId ? `${orderId.substring(0, 8)}...` : 'details'}</p>}
					</div>
				</div>
			</CardHeader>
			<CardContent className={cn(compact ? 'p-3 pt-0' : 'p-4 pt-0')}>
				<dl className={cn('grid gap-3', compact ? 'text-sm' : 'sm:grid-cols-2')}>
					{rows.map((row) => (
						<div key={row.label} className={row.label === 'Address' || row.label === 'Order notes' ? 'sm:col-span-2' : undefined}>
							<dt className="text-xs font-medium uppercase tracking-wide text-success-foreground">{row.label}</dt>
							<dd className="mt-1 whitespace-pre-line break-words text-sm text-success-foreground">{row.value}</dd>
						</div>
					))}
				</dl>
			</CardContent>
		</Card>
	)
}

export interface OrderCardViewProps {
	href: string
	orderEventId: string
	isBuyer: boolean
	status: string
	createdAt?: number
}

export function OrderCardView({ href, orderEventId, isBuyer, status, createdAt }: OrderCardViewProps) {
	return (
		<UiLink
			href={href}
			className="flex justify-between items-center hover:bg-accent p-4 border rounded-lg overflow-hidden transition-colors"
		>
			<div className="flex items-center gap-4 min-w-0">
				<div className="flex justify-center items-center bg-fill-accent rounded-full w-12 h-12 text-2xl shrink-0">
					{isBuyer ? '🛍️' : '💰'}
				</div>
				<div className="min-w-0">
					<div className="font-medium truncate">
						{isBuyer ? 'Purchase' : 'Sale'} #{orderEventId.slice(0, 8)}
					</div>
					<div className="text-muted-foreground text-sm">{new Date((createdAt || 0) * 1000).toLocaleDateString()}</div>
				</div>
			</div>
			<Badge variant={status.toLowerCase() === 'completed' ? 'default' : 'outline'} className="shrink-0">
				{status}
			</Badge>
		</UiLink>
	)
}
