import { useState } from 'react'
import { NwcWalletStatusView } from '@ui/checkout/nwc-wallet-status-view'
import { CartFooter, CartLineShipping, CartSellerCard, CartShippingReminder, CartTotals, CartTotalsDetails } from '@ui/checkout/cart-views'
import { CheckoutMainCard, CheckoutMobileSummaryCard, CheckoutSidebarCard } from '@ui/checkout/checkout-layout-views'
import { CheckoutPaymentSummary } from '@ui/checkout/checkout-payment-summary'
import { CheckoutProgress } from '@ui/checkout/checkout-progress'
import { EmptyCartScreen } from '@ui/checkout/empty-cart-screen'
import { NoPaymentRequestsCard } from '@ui/checkout/no-payment-requests-card'
import { OnChainPaymentView, type OnChainPaymentViewProps } from '@ui/checkout/on-chain-payment-view'
import { OrderFinalizeView } from '@ui/checkout/order-finalize-view'
import { PaymentContentView } from '@ui/checkout/payment-content-view'
import { PaymentDialogView, WalletSelectorView } from '@ui/checkout/payment-views'
import { PaymentProgressBar } from '@ui/checkout/payment-progress-bar'
import { ShippingAddressFormView, type CheckoutFieldBinding } from '@ui/checkout/shipping-address-form-view'
import { Sheet } from '@ui/primitives/sheet'
import {
	EMPTY_CHECKOUT_FORM,
	type CheckoutDeliveryRequirements,
	type CheckoutFormData,
	type CheckoutFormField,
	type PaymentInvoiceData,
} from '@sdk/commerce/checkout'
import type { WidgetLibrary } from '../libraries'

/**
 * Checkout views. The library may only import `ui/` and `sdk/`, so the
 * settings link the route resolves through the router is a plain anchor here.
 *
 * `NwcWalletStatusView` is the one block the checkout route used to write twice
 * (mobile summary and desktop sidebar) with two different footer sentences; it
 * now has a single implementation and a single footer.
 */

const settingsLink = (
	<a href="/dashboard/account/making-payments" className="text-primary hover:underline">
		settings
	</a>
)

/**
 * Resolved physical-delivery requirements, shared by the entries that take
 * `CheckoutDeliveryRequirements` as a literal.
 */
const physicalDeliveryRequirements: CheckoutDeliveryRequirements = {
	hasDigitalDelivery: false,
	hasPhysicalDelivery: true,
	hasPickupDelivery: false,
	needsDigitalDeliveryContact: false,
	needsPhysicalAddress: true,
	isResolved: true,
	unresolvedShippingRefs: [],
}

/** Full literal `PaymentInvoiceData`; only the fields the views read matter. */
function invoice(
	overrides: Partial<PaymentInvoiceData> & Pick<PaymentInvoiceData, 'id' | 'recipientName' | 'status' | 'type' | 'amount'>,
): PaymentInvoiceData {
	return {
		orderId: 'order-1',
		description: 'Order payment',
		createdAt: 0,
		recipientPubkey: 'd943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782',
		...overrides,
	}
}

/** Full literal `OnChainPaymentViewProps` so each entry only overrides its state. */
function onChainProps(overrides: Partial<OnChainPaymentViewProps> = {}): OnChainPaymentViewProps {
	return {
		status: 'idle',
		disabled: false,
		address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
		amountSats: 12000,
		amountBtc: 0.00012,
		bitcoinUri: 'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.00012&label=Order%20123',
		timeLeft: 600,
		expirySeconds: 900,
		checkAttempts: 0,
		error: null,
		transaction: null,
		isManualChecking: false,
		onOpenInWallet: () => {},
		onCopyAddress: () => {},
		onCopyUri: () => {},
		onManualCheck: () => {},
		onCancel: () => {},
		...overrides,
	}
}

/** The collapsible mobile summary holds its own open state, like the host does. */
function MobileSummaryCardDemo() {
	const [open, setOpen] = useState(true)
	return (
		<CheckoutMobileSummaryCard title="Cart Summary" open={open} onToggle={() => setOpen((value) => !value)}>
			<p className="text-sm text-muted-foreground">Collapsed order summary shown below `lg`.</p>
		</CheckoutMobileSummaryCard>
	)
}

/** Controlled `WalletSelectorView`: the host owns the selected wallet id. */
function WalletSelectorDemo() {
	const [walletId, setWalletId] = useState<string | null>(null)
	return (
		<WalletSelectorView
			wallets={[
				{ id: 'w1', label: 'Phantom · Mobile wallet' },
				{ id: 'w2', label: 'Alby · Browser extension' },
			]}
			selectedWalletId={walletId}
			onSelect={setWalletId}
			sellerName="Alice's Emporium"
		/>
	)
}

/**
 * Payment dialog demo. Kept closed at rest, like `ConfirmDialogDemo`: a mounted
 * open modal hides the whole catalogue from the accessibility tree.
 */
function PaymentDialogDemo() {
	const [open, setOpen] = useState(false)
	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				Open payment dialog
			</button>
			<PaymentDialogView open={open} onOpenChange={setOpen} title="Lightning Payment" description="Invoice 1 of 3 · satoshi 12,000">
				<p className="text-sm text-muted-foreground">The wallet selector and processor for this invoice render here.</p>
				<button
					type="button"
					className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
					onClick={() => setOpen(false)}
				>
					Close payment dialog
				</button>
			</PaymentDialogView>
		</div>
	)
}

/** Controlled `ShippingAddressFormView`: every field binding is host state. */
function ShippingAddressFormDemo() {
	const [values, setValues] = useState<CheckoutFormData>({ ...EMPTY_CHECKOUT_FORM })
	const binding = (field: CheckoutFormField): CheckoutFieldBinding => ({
		value: values[field],
		onChange: (value) => setValues((prev) => ({ ...prev, [field]: value })),
		onBlur: () => {},
	})
	return (
		<ShippingAddressFormView
			fields={{
				name: binding('name'),
				email: binding('email'),
				phone: binding('phone'),
				firstLineOfAddress: binding('firstLineOfAddress'),
				zipPostcode: binding('zipPostcode'),
				city: binding('city'),
				country: binding('country'),
				additionalInformation: binding('additionalInformation'),
			}}
			hasAllShippingMethods
			deliveryRequirements={physicalDeliveryRequirements}
			isDeliveryRequirementsLoading={false}
			deliveryRequirementsError={null}
			pickupAddresses={[]}
			isSubmitting={false}
			onSubmit={() => {}}
		/>
	)
}

export const checkout: WidgetLibrary = {
	name: 'checkout',
	entries: [
		{
			name: 'NwcWalletStatusConnected',
			render: () => <NwcWalletStatusView connected connectedWalletCount={2} settingsLink={settingsLink} />,
		},
		{
			name: 'NwcWalletStatusConnectedOne',
			render: () => <NwcWalletStatusView connected connectedWalletCount={1} settingsLink={settingsLink} />,
		},
		{
			name: 'NwcWalletStatusDisconnected',
			render: () => <NwcWalletStatusView connected={false} connectedWalletCount={0} settingsLink={settingsLink} />,
		},
		{
			name: 'CheckoutMainCard',
			render: () => (
				<CheckoutMainCard title="Order Review" headerActions={<span className="text-xs text-text-mid">Step 2 of 3</span>}>
					<p className="text-sm text-muted-foreground">The step content (shipping form, summary, invoices) renders here.</p>
				</CheckoutMainCard>
			),
		},
		{
			name: 'CheckoutMobileSummaryCard',
			render: () => <MobileSummaryCardDemo />,
		},
		{
			name: 'CheckoutSidebarCard',
			render: () => (
				<CheckoutSidebarCard title="Order Summary" scrollable>
					<p className="text-sm text-muted-foreground">The payment summary or cart totals render here on desktop.</p>
				</CheckoutSidebarCard>
			),
		},
		{
			name: 'CartFooter',
			render: () => <CartFooter totalSats={21000} shippingSats={500} canCheckout onClear={() => {}} onCheckout={() => {}} />,
		},
		{
			name: 'CartFooterDisabled',
			render: () => <CartFooter totalSats={21000} shippingSats={500} canCheckout={false} onClear={() => {}} onCheckout={() => {}} />,
		},
		{
			name: 'CartLineShipping',
			render: () => (
				<div className="max-w-sm space-y-2">
					<CartLineShipping shippingMethodId="standard" shippingMethodName="Standard Post" shippingCost={500} shippingCostCurrency="USD" />
					<CartLineShipping shippingMethodId={null} shippingMethodName={null} shippingCost={0} shippingCostCurrency={null} />
				</div>
			),
		},
		{
			name: 'CartSellerCard',
			render: () => (
				<div className="max-w-md">
					<CartSellerCard
						seller={<span className="text-sm font-semibold">Alice's Emporium</span>}
						items={[
							{
								key: 'mug',
								content: (
									<div>
										<p className="text-sm font-medium">Handmade mug</p>
										<CartLineShipping
											shippingMethodId="standard"
											shippingMethodName="Standard Post"
											shippingCost={500}
											shippingCostCurrency="USD"
										/>
									</div>
								),
							},
							{
								key: 'vase',
								content: <p className="text-sm font-medium">Frosted vase</p>,
							},
						]}
						totals={{
							satsTotal: 21000,
							shippingSats: 500,
							currencyTotals: { USD: 214.5 },
							shares: { sellerAmount: 20000, communityAmount: 1000, sellerPercentage: 95.24 },
						}}
					/>
				</div>
			),
		},
		{
			name: 'CartShippingReminder',
			render: () => (
				<div className="max-w-md">
					<CartShippingReminder count={2} />
					<CartShippingReminder count={1} context="checkout" />
				</div>
			),
		},
		{
			name: 'CartTotals',
			render: () => <CartTotals totalSats={21000} shippingSats={500} />,
		},
		{
			name: 'CartTotalsDetails',
			render: () => (
				<div className="max-w-sm">
					<CartTotalsDetails totalSats={21000} shippingSats={500} totalByCurrency={{ USD: 214.5 }} shippingByCurrency={{ USD: 5 }} />
				</div>
			),
		},
		{
			name: 'CheckoutPaymentSummary',
			render: () => (
				<div className="max-w-md">
					<CheckoutPaymentSummary
						invoices={[
							{ id: 'inv-1', amount: 12000, recipientName: "Alice's Emporium", status: 'paid', type: 'merchant' },
							{
								id: 'inv-2',
								amount: 5000,
								recipientName: 'Relay Fund',
								status: 'pending',
								type: 'v4v',
								expiresAt: Date.now() + 6 * 60_000,
							},
						]}
						currentIndex={1}
						onSelectInvoice={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'CheckoutPaymentSummarySkipped',
			render: () => (
				<div className="max-w-md">
					<CheckoutPaymentSummary
						invoices={[
							{ id: 'inv-1', amount: 12000, recipientName: "Alice's Emporium", status: 'paid', type: 'merchant' },
							{ id: 'inv-2', amount: 5000, recipientName: 'Relay Fund', status: 'skipped', type: 'v4v' },
						]}
						currentIndex={0}
						onSelectInvoice={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'CheckoutProgress',
			render: () => (
				<CheckoutProgress currentStepNumber={2} totalSteps={3} progress={66} stepDescription="Review payment" onBackClick={() => {}} />
			),
		},
		{
			// `SheetClose` needs a `Sheet` root; the host mounts the screen inside
			// the open cart sheet, so the demo provides the same context.
			name: 'EmptyCartScreen',
			render: () => (
				<Sheet>
					<EmptyCartScreen />
				</Sheet>
			),
		},
		{
			name: 'NoPaymentRequestsCard',
			render: () => (
				<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
					<NoPaymentRequestsCard isBuyer />
					<NoPaymentRequestsCard isBuyer={false} />
				</div>
			),
		},
		{
			name: 'OnChainPaymentView',
			render: () => (
				<div className="max-w-md">
					<OnChainPaymentView {...onChainProps()} />
				</div>
			),
		},
		{
			name: 'OnChainPaymentViewConfirmed',
			render: () => (
				<div className="max-w-md">
					<OnChainPaymentView
						{...onChainProps({
							status: 'completed',
							timeLeft: 0,
							transaction: { txid: 'f4184fc596403b5d382b5d1c8d3a4b0a3e1d2c4b5a6f7e8d9c0b1a2f3e4d5c6f', confirmed: true },
						})}
					/>
				</div>
			),
		},
		{
			name: 'OrderFinalizeView',
			render: () => (
				<div className="max-w-md">
					<OrderFinalizeView
						shippingData={{
							name: 'Satoshi Nakamoto',
							email: 'satoshi@example.com',
							phone: '+44 7700 900123',
							firstLineOfAddress: '21 Generation Street',
							zipPostcode: 'E1 6AN',
							city: 'London',
							country: 'United Kingdom',
							additionalInformation: 'Ring the bell twice.',
						}}
						invoices={[
							invoice({ id: 'inv-1', amount: 12000, recipientName: "Alice's Emporium", status: 'paid', type: 'merchant' }),
							invoice({ id: 'inv-2', amount: 5000, recipientName: 'Relay Fund', status: 'paid', type: 'v4v' }),
						]}
						totalInSats={17000}
						deliveryRequirements={physicalDeliveryRequirements}
						pickupAddresses={[]}
						onMessageSeller={() => {}}
						onNewOrder={() => {}}
						onViewOrders={() => {}}
						onPrint={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'PaymentContentView',
			render: () => (
				<div className="max-w-md">
					<PaymentContentView
						invoiceCount={3}
						completedCount={1}
						activeIndex={1}
						showNavigation
						onNavigate={() => {}}
						current={{ status: 'pending', recipientName: 'Relay Fund', amount: 5000 }}
						isCurrentCompleted={false}
						walletSelector={<p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Wallet selector slot</p>}
						processor={<p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Processor slot</p>}
					/>
				</div>
			),
		},
		{
			name: 'PaymentContentViewCompleted',
			render: () => (
				<div className="max-w-md">
					<PaymentContentView
						invoiceCount={3}
						completedCount={1}
						activeIndex={0}
						showNavigation
						onNavigate={() => {}}
						current={{ status: 'paid', recipientName: "Alice's Emporium", amount: 12000 }}
						isCurrentCompleted
						processor={<p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Processor slot</p>}
					/>
				</div>
			),
		},
		{
			name: 'PaymentProgressBar',
			render: () => <PaymentProgressBar paidCount={2} totalCount={5} progressPercent={40} />,
		},
		{
			name: 'PaymentDialogView',
			render: () => <PaymentDialogDemo />,
		},
		{
			name: 'WalletSelectorView',
			render: () => <WalletSelectorDemo />,
		},
		{
			name: 'ShippingAddressFormView',
			render: () => <ShippingAddressFormDemo />,
		},
	],
}
