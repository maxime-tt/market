import { Link, createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Zap } from 'lucide-react'
import { CartSummary } from '@/components/CartSummary'
import { LoginDialog } from '@/components/auth/LoginDialog'
import { OrderFinalizeComponent } from '@/components/checkout/OrderFinalizeComponent'
import { PaymentContent } from '@/components/checkout/PaymentContent'
import { ShippingAddressForm } from '@/components/checkout/ShippingAddressForm'
import { CheckoutProgress } from '@ui/components/CheckoutProgress'
import { CheckoutPaymentSummary as PaymentSummary } from '@ui/components/CheckoutPaymentSummary'
import { CheckoutMainCard, CheckoutMobileSummaryCard, CheckoutSidebarCard } from '@ui/checkout/checkout-layout-views'
import { NwcWalletStatusView } from '@ui/checkout/nwc-wallet-status-view'
import { EmptyState } from '@ui/shared/empty-state'
import { ErrorState } from '@ui/shared/error-state'
import { LoadingState } from '@ui/shared/loading-state'
import { Notice } from '@ui/shared/notice'
import { Button } from '@ui/wrappers/button'
import { resolveCheckoutCardTitle, resolveSummaryCardTitle } from '@/feature/checkout/checkoutFlow'
import { useCheckout } from '@/feature/checkout/useCheckout'

export const Route = createFileRoute('/checkout')({
	component: RouteComponent,
})

/**
 * Checkout — the assembler.
 *
 * The flow's state machine lives in `@/feature/checkout/useCheckout` (host half:
 * stores, queries, invoice mutation, publishing) with its pure transitions in
 * `@/feature/checkout/checkoutFlow`. The page frames live in
 * `@ui/checkout/checkout-layout-views`. This module only composes them: it holds
 * no state, computes no derived values and defines nothing but its page
 * container, so the ADR-0007 assembler guard sees the route stop importing
 * primitives (T3.1, the wave 9 tail).
 */
function RouteComponent() {
	const {
		currentStep,
		setCurrentInvoiceIndex,
		safeInvoiceIndex,
		currentStepNumber,
		totalSteps,
		progress,
		stepDescription,
		handleBackClick,
		totalInSats,
		isCartEmpty,
		hasAllShippingMethods,
		isCartEditable,
		invoices,
		isGeneratingInvoices,
		unpaidInvoiceCount,
		canOfferPayAll,
		retryInvoiceGeneration,
		deliveryRequirements,
		isDeliveryRequirementsLoading,
		deliveryRequirementsError,
		partialOrderOutcome,
		canContinueToPayment,
		form,
		shippingData,
		handleContinueToPayment,
		isCreatingOrder,
		isAwaitingAuth,
		isWaitingForReconciliation,
		nwcEnabled,
		nwcWalletCount,
		nwcWalletUri,
		availableWalletsBySeller,
		selectedWallets,
		handleWalletChange,
		handlePayAllInvoices,
		paymentContentRef,
		paymentFailure,
		setPaymentFailure,
		handlePaymentComplete,
		handlePaymentFailed,
		handleSkipPayment,
		goBackToShopping,
		goToOrders,
		goBackToPreviousStep,
		animationParent,
		mobileOrderSummaryOpen,
		toggleMobileOrderSummary,
		showLoginDialog,
		handleLoginDialogOpenChange,
	} = useCheckout()

	// Redirect to home if cart is empty (but allow complete step to show summary)
	if (isCartEmpty && currentStep !== 'complete') {
		return (
			<EmptyState
				className="min-h-screen justify-center bg-muted/40"
				title="Your cart is empty"
				description="Add some products to your cart before checking out."
				action={
					<Button onClick={goBackToShopping} className="btn-black">
						Continue Shopping
					</Button>
				}
			/>
		)
	}

	const nwcSettingsLink = (
		<Link to="/dashboard/account/making-payments" className="text-primary hover:underline">
			settings
		</Link>
	)

	const paymentPager = (
		<div className="hidden lg:flex items-center gap-2">
			<Button
				variant="outline"
				size="sm"
				onClick={() => setCurrentInvoiceIndex(Math.max(0, safeInvoiceIndex - 1))}
				disabled={safeInvoiceIndex === 0}
			>
				<ChevronLeft className="w-4 h-4" />
				Previous
			</Button>
			<Button
				variant="outline"
				size="sm"
				onClick={() => setCurrentInvoiceIndex(Math.min(invoices.length - 1, safeInvoiceIndex + 1))}
				disabled={safeInvoiceIndex === invoices.length - 1}
			>
				Next
				<ChevronRight className="w-4 h-4" />
			</Button>
		</div>
	)

	const renderPaymentDetails = (paddedSummary: boolean) => (
		<>
			{/* NWC Status Indicator */}
			<NwcWalletStatusView className="mb-4" connected={nwcEnabled} connectedWalletCount={nwcWalletCount} settingsLink={nwcSettingsLink} />

			{paddedSummary ? (
				<div className="pb-6">
					<PaymentSummary invoices={invoices} currentIndex={safeInvoiceIndex} onSelectInvoice={setCurrentInvoiceIndex} />
				</div>
			) : (
				<PaymentSummary invoices={invoices} currentIndex={safeInvoiceIndex} onSelectInvoice={setCurrentInvoiceIndex} />
			)}
		</>
	)

	return (
		<>
			<div className="flex-grow flex flex-col">
				{/* Fixed Progress Bar */}
				<div className="sticky top-[8.5rem] lg:top-[5rem] z-20 border-b border-border bg-card">
					<CheckoutProgress
						currentStepNumber={currentStepNumber}
						totalSteps={totalSteps}
						progress={progress}
						stepDescription={stepDescription}
						onBackClick={handleBackClick}
						showBackButton={currentStep !== 'complete'}
					/>
				</div>

				{/* Main Content */}
				<div className="px-4 py-8 flex flex-col lg:flex-row lg:gap-4 w-full lg:h-[calc(100vh-10rem)]">
					{/* Mobile Order Summary / Invoices (collapsible) */}
					<CheckoutMobileSummaryCard
						title={resolveSummaryCardTitle(currentStep)}
						open={mobileOrderSummaryOpen}
						onToggle={toggleMobileOrderSummary}
					>
						{currentStep === 'payment' && isGeneratingInvoices ? (
							<LoadingState className="py-8" label="Loading payment details…" />
						) : currentStep === 'payment' && invoices.length > 0 ? (
							renderPaymentDetails(false)
						) : (
							<div className="max-h-[50vh] overflow-y-auto">
								<CartSummary allowQuantityChanges={isCartEditable} allowShippingChanges={isCartEditable} showExpandedDetails={false} />
							</div>
						)}
					</CheckoutMobileSummaryCard>

					{/* Main Content Area */}
					<CheckoutMainCard
						title={resolveCheckoutCardTitle(currentStep)}
						headerActions={currentStep === 'payment' && invoices.length > 1 ? paymentPager : undefined}
					>
						<div ref={animationParent} className="lg:h-full lg:min-h-full">
							{currentStep === 'shipping' && (
								<div className="h-full">
									<ShippingAddressForm
										form={form}
										hasAllShippingMethods={hasAllShippingMethods}
										deliveryRequirements={deliveryRequirements}
										isDeliveryRequirementsLoading={isDeliveryRequirementsLoading}
										deliveryRequirementsError={deliveryRequirementsError}
									/>
								</div>
							)}

							{currentStep === 'summary' && (
								<div className="h-full flex flex-col">
									<div className="flex-1 overflow-y-auto">
										{partialOrderOutcome && (
											<Notice className="mb-4" tone="warning" title="Some seller orders were published, but checkout did not finish.">
												<p>Do not retry this checkout. Published order IDs: {partialOrderOutcome.orderIds.join(', ') || 'none'}.</p>
												<p>
													Failure phase: {partialOrderOutcome.failedPhase}. {partialOrderOutcome.error}
												</p>
											</Notice>
										)}
										<OrderFinalizeComponent
											shippingData={shippingData}
											invoices={[]} // No invoices yet in summary step
											totalInSats={totalInSats}
											onNewOrder={goBackToShopping}
											deliveryRequirements={deliveryRequirements}
											// Note: onContinueToPayment moved to footer
										/>
									</div>
									<div className="flex-shrink-0 border-t bg-card pt-4">
										<Button
											onClick={handleContinueToPayment}
											className="w-full btn-black"
											disabled={isCreatingOrder || isAwaitingAuth || !canContinueToPayment}
											pending={isCreatingOrder || isAwaitingAuth || isWaitingForReconciliation}
										>
											{isCreatingOrder
												? 'Creating Order...'
												: isAwaitingAuth || isWaitingForReconciliation
													? 'Waiting for login...'
													: 'Continue to Payment'}
										</Button>
									</div>
								</div>
							)}

							{/* Loading State for Invoice Generation */}
							{currentStep === 'payment' && isGeneratingInvoices && (
								<LoadingState className="h-full" label="Generating Lightning invoices…" />
							)}

							{/* Error State - No Invoices Generated */}
							{currentStep === 'payment' && !isGeneratingInvoices && invoices.length === 0 && (
								<ErrorState
									title="Unable to generate payment invoices"
									message="There may be an issue with the seller's Lightning configuration, or the Lightning service may be temporarily unavailable."
									retryLabel="Try Again"
									onRetry={retryInvoiceGeneration}
									action={
										<Button onClick={goBackToPreviousStep} variant="ghost">
											Go Back
										</Button>
									}
								/>
							)}

							{/* Payment Interface - Only show when invoices are ready */}
							{currentStep === 'payment' && !isGeneratingInvoices && invoices.length > 0 && (
								<div className="space-y-6">
									{paymentFailure && (
										<Notice tone="error" title="Payment failed" onDismiss={() => setPaymentFailure(null)}>
											{paymentFailure}
										</Notice>
									)}
									{/* desktop header nav exists; mobile under-QR nav is handled inside LightningPaymentProcessor */}

									{/* Pay All Button - Only show if NWC is enabled and there are unpaid invoices */}
									{canOfferPayAll && (
										<div className="flex justify-center mb-4">
											<Button onClick={handlePayAllInvoices} className="btn-product-banner font-medium px-6 py-2" size="lg">
												<Zap className="w-4 h-4 mr-2" />
												Pay All with NWC ({unpaidInvoiceCount} invoices)
											</Button>
										</div>
									)}

									{/* Payment Content - Inline instead of modal */}
									<PaymentContent
										ref={paymentContentRef}
										invoices={invoices}
										currentIndex={safeInvoiceIndex}
										onPaymentComplete={handlePaymentComplete}
										onPaymentFailed={handlePaymentFailed}
										onSkipPayment={handleSkipPayment}
										showNavigation={false} // We have our own navigation above
										nwcEnabled={nwcEnabled}
										nwcWalletUri={nwcWalletUri}
										onNavigate={setCurrentInvoiceIndex}
										availableWalletsBySeller={availableWalletsBySeller}
										selectedWallets={selectedWallets}
										onWalletChange={handleWalletChange}
										mode="checkout"
									/>
								</div>
							)}

							{currentStep === 'complete' && (
								<OrderFinalizeComponent
									shippingData={shippingData}
									invoices={invoices}
									totalInSats={totalInSats}
									onNewOrder={goBackToShopping}
									onViewOrders={goToOrders}
									deliveryRequirements={deliveryRequirements}
								/>
							)}
						</div>
					</CheckoutMainCard>

					{/* Right Sidebar */}
					<CheckoutSidebarCard title={resolveSummaryCardTitle(currentStep)} scrollable={currentStep !== 'payment'}>
						{currentStep === 'payment' && isGeneratingInvoices ? (
							<LoadingState className="h-full" label="Loading payment details…" />
						) : currentStep === 'payment' && invoices.length > 0 ? (
							renderPaymentDetails(true)
						) : (
							<CartSummary
								className="pb-6"
								allowQuantityChanges={isCartEditable}
								allowShippingChanges={isCartEditable}
								showExpandedDetails={false}
							/>
						)}
					</CheckoutSidebarCard>
				</div>
			</div>

			<LoginDialog open={showLoginDialog} onOpenChange={handleLoginDialogOpenChange} />
		</>
	)
}
