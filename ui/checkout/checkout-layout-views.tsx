import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card'
import { ScrollArea } from '../primitives/scroll-area'
import { cn } from '../utils/cn'

/**
 * The checkout page's card shells.
 *
 * The checkout route used to build these three cards inline and imported
 * `@ui/primitives/card` and `@ui/primitives/scroll-area` to do it. An assembler
 * may do neither, so the frames live here and the route composes their contents
 * from `@ui/shared`, `@ui/checkout` and the host views.
 *
 * These are frames only: every decision (which branch to render, whether the
 * summary is expanded, what the title says) belongs to the host and arrives as a
 * prop or as already-resolved children. The NWC status block that used to be
 * written out twice — once per card — keeps its single implementation in
 * `nwc-wallet-status-view.tsx` and is injected as a child.
 */

export interface CheckoutMobileSummaryCardProps {
	/** Host-resolved: the route picks "Payment Details" or "Cart Summary". */
	title: string
	open: boolean
	onToggle: () => void
	children: ReactNode
	className?: string
}

/** The collapsible order-summary card shown below `lg`, where the sidebar is hidden. */
export function CheckoutMobileSummaryCard({ title, open, onToggle, children, className }: CheckoutMobileSummaryCardProps) {
	return (
		<div data-slot="checkout-mobile-summary" className={cn('lg:hidden mb-4', className)}>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center justify-between cursor-pointer" aria-expanded={open} onClick={onToggle}>
						<span>{title}</span>
						<ChevronRight className={cn('w-5 h-5 transition-transform', open && 'rotate-90')} />
					</CardTitle>
				</CardHeader>
				{open && <CardContent>{children}</CardContent>}
			</Card>
		</div>
	)
}

export interface CheckoutMainCardProps {
	title: string
	/** Step-dependent controls (the invoice pager); omitted when there is nothing to page. */
	headerActions?: ReactNode
	children: ReactNode
	className?: string
}

/** The primary step card: shipping form, order summary, invoices or completion. */
export function CheckoutMainCard({ title, headerActions, children, className }: CheckoutMainCardProps) {
	return (
		<Card data-slot="checkout-main-card" className={cn('flex-1 lg:w-1/2 flex flex-col lg:h-full shadow-md lg:order-2', className)}>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>{title}</CardTitle>
					{headerActions}
				</div>
			</CardHeader>
			<CardContent className="p-6 pt-0 flex-1 lg:overflow-y-auto">{children}</CardContent>
		</Card>
	)
}

export interface CheckoutSidebarCardProps {
	title: string
	/** Cart summary needs its own scroll region; the payment summary already fits. */
	scrollable?: boolean
	children: ReactNode
	className?: string
}

/** The desktop order-summary sidebar, hidden below `lg`. */
export function CheckoutSidebarCard({ title, scrollable = false, children, className }: CheckoutSidebarCardProps) {
	return (
		<Card data-slot="checkout-sidebar" className={cn('hidden lg:flex flex-1 lg:w-1/2 flex-col h-full shadow-md lg:order-1', className)}>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent className="flex-1 overflow-y-auto pb-0">
				{scrollable ? <ScrollArea className="h-full">{children}</ScrollArea> : children}
			</CardContent>
		</Card>
	)
}
