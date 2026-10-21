import { Button } from '@ui/primitives/button'
import { BackButton } from '@ui/nav/back-button'
import { SidebarNav } from '@ui/nav/sidebar-nav'
import {
	DASHBOARD_NAV,
	findNavEmoji,
	isFullBleedRoute,
	resolveBackTarget,
	resolveNavView,
	shouldShowSidebarOnMobile,
	showsPageTitle,
	type NavBackTarget,
	type NavBadgeCounts,
} from '@ui/nav/model'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { cn } from '@/lib/utils'
import { useAmIAdmin } from '@/queries/app-settings'
import { useConfigQuery } from '@/queries/config'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { profileKeys } from '@/queries/queryKeyFactory'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStore } from '@tanstack/react-store'
import { uiStore, uiActions } from '@/lib/stores/ui'
import { authStore } from '@/lib/stores/auth'
import { notificationStore } from '@/lib/stores/notifications'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import React, { useState } from 'react'
import { UserCard } from '@/components/UserCard'

export const Route = createFileRoute('/_dashboard-layout')({
	component: DashboardLayout,
})

// Custom hook to manage dashboard title using uiStore
export function useDashboardTitle(title: string) {
	React.useEffect(() => {
		uiActions.setDashboardTitle(title)
		return () => uiActions.setDashboardTitle('') // Reset to default on unmount
	}, [title])
}

// Component to show when user is not authenticated
function LoginPrompt() {
	const handleLoginClick = () => {
		uiActions.openDialog('login')
	}

	return (
		<div className="flex justify-center items-center h-full">
			<div className="flex flex-col items-center space-y-4">
				<p className="text-muted-foreground text-lg">Please log in to view</p>
				<Button variant="default" onClick={handleLoginClick}>
					Login
				</Button>
			</div>
		</div>
	)
}

function DashboardLayout() {
	const navigate = useNavigate()
	const location = useLocation()
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm' || breakpoint === 'md' || breakpoint === 'lg' // Changed: treat anything below xl (1024px) as mobile
	const [showSidebar, setShowSidebar] = useState(true)
	const [parent] = useAutoAnimate()
	const { dashboardTitle, dashboardHeaderAction } = useStore(uiStore)
	const { isAuthenticated } = useStore(authStore)
	const {
		unseenOrders,
		unseenMessages,
		unseenPurchases,
		unseenAuctionBids,
		unseenAuctionComments: unseenAuctionLiveChatComments,
		unseenAuctionEventComments: unseenAuctionThreadComments,
		unseenProductComments: unseenProductThreadComments,
		unseenAuctionLive: unseenScheduledAuctionsNowLive,
		unseenAuctionSettlementBegins,
		unseenBidUpdates,
	} = useStore(notificationStore)
	const isMessageDetailView =
		location.pathname.startsWith('/dashboard/sales/messages/') && location.pathname !== '/dashboard/sales/messages'
	// Admin checking
	const { data: config } = useConfigQuery()
	const { amIAdmin, isLoading: isLoadingAdmin } = useAmIAdmin(config?.appPublicKey)

	// Badge counters the nav model keys off; the model sums each item's declared keys.
	const badgeCounts: NavBadgeCounts = {
		unseenOrders,
		unseenMessages,
		unseenPurchases,
		unseenAuctionBids,
		unseenAuctionLiveChatComments,
		unseenAuctionThreadComments,
		unseenProductThreadComments,
		unseenScheduledAuctionsNowLive,
		unseenAuctionSettlementBegins,
		unseenBidUpdates,
	}

	// Admin filtering, badge resolution and active state all come from the model.
	const navSections = React.useMemo(
		() => resolveNavView(DASHBOARD_NAV, location.pathname, badgeCounts, { isAdmin: amIAdmin, isAdminLoading: isLoadingAdmin }),
		// badgeCounts is rebuilt every render, so depend on its members instead.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[
			location.pathname,
			amIAdmin,
			isLoadingAdmin,
			unseenOrders,
			unseenMessages,
			unseenPurchases,
			unseenAuctionBids,
			unseenAuctionLiveChatComments,
			unseenAuctionThreadComments,
			unseenProductThreadComments,
			unseenScheduledAuctionsNowLive,
			unseenAuctionSettlementBegins,
			unseenBidUpdates,
		],
	)

	// Simple emoji detection - match common emoji patterns at start
	const emojiRegex =
		/^([\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\uD83C][\uDF00-\uDFFF]|[\uD83D][\uDC00-\uDE4F]|[\uD83D][\uDE80-\uDEFF])\s*/
	const dashboardTitleWithoutEmoji = dashboardTitle.replace(emojiRegex, '')
	const dashboardEmoji = dashboardTitle.match(
		/^([\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\uD83C][\uDF00-\uDFFF]|[\uD83D][\uDC00-\uDE4F]|[\uD83D][\uDE80-\uDEFF])/,
	)?.[1]

	// Extract pubkey from pathname for message detail views
	const chatPubkey = isMessageDetailView ? location.pathname.split('/').pop() : null

	// Fetch profile data for chat header avatar
	const { data: chatProfile } = useQuery({
		queryKey: profileKeys.details(chatPubkey || ''),
		queryFn: () => fetchProfileByIdentifier(chatPubkey!),
		enabled: !!chatPubkey,
	})

	// Back control comes from the model's rules, not a per-path table.
	const backTarget = resolveBackTarget(location.pathname)
	const needsBackButton = !!backTarget && !isMobile
	const fullBleed = isFullBleedRoute(DASHBOARD_NAV, location.pathname)

	// When route changes on mobile, show sidebar for /dashboard, main content otherwise
	React.useEffect(() => {
		if (isMobile) {
			setShowSidebar(shouldShowSidebarOnMobile(location.pathname))
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [location.pathname, isMobile])

	const handleSidebarItemClick = () => {
		if (isMobile) setShowSidebar(false)
	}

	const followBackTarget = (target: NavBackTarget) => {
		// A `history` target means "go back in browser history": order details are
		// reachable from both sales and purchases, so there is no single parent.
		if (target.kind === 'history') {
			window.history.back()
			return
		}
		navigate({ to: target.path })
	}

	const handleBackToSidebar = () => {
		if (!isMobile) return
		// Unified with the desktop path. The legacy mobile handler duplicated this
		// branch logic and disagreed with it for order details, which it forced to
		// /dashboard/sales/sales while desktop used browser history.
		if (backTarget) {
			followBackTarget(backTarget)
			return
		}
		setShowSidebar(true)
		navigate({ to: '/dashboard' })
	}

	const handleBackToParent = () => {
		if (backTarget) followBackTarget(backTarget)
	}

	const emoji = findNavEmoji(DASHBOARD_NAV, location.pathname)
	const showTitle = showsPageTitle(DASHBOARD_NAV, location.pathname, needsBackButton)

	return (
		<div className="lg:flex lg:flex-col lg:h-[calc(100vh-5rem)]">
			{/* Header - responsive for mobile/desktop */}
			<div className="lg:hidden top-[8.5rem] z-10 sticky">
				<h1 className="relative flex justify-center items-center gap-2 bg-secondary-black p-4 font-heading text-secondary text-center">
					{/* Mobile back button - only visible on small screens when not showing sidebar */}
					{!showSidebar && isMobile && <BackButton variant="icon" ariaLabel="Back to sidebar" onClick={handleBackToSidebar} />}

					{/* Title */}
					<span className="flex justify-center items-center gap-2 px-8 sm:px-12 md:px-16 w-full min-w-0 text-3xl truncate">
						{showSidebar || !isMobile ? (
							'Dashboard'
						) : (
							<>
								{isMessageDetailView && chatProfile ? (
									<UserCard pubkey={chatProfile?.user?.pubkey || ''} size="sm" className="[&>h2]:text-white" />
								) : (
									<>
										{dashboardEmoji && <span className="text-2xl">{dashboardEmoji}</span>}
										<span className="flex-1 min-w-0 text-center truncate">{dashboardTitleWithoutEmoji}</span>
									</>
								)}
							</>
						)}
					</span>

					{/* Mobile emoji - only visible on small screens when not showing sidebar */}
					{!showSidebar && emoji && isMobile && !dashboardEmoji && (
						<span className="top-1/2 right-2 sm:right-3 md:right-4 z-20 absolute flex justify-center items-center w-12 h-12 text-2xl -translate-y-1/2 select-none">
							{emoji}
						</span>
					)}
				</h1>
			</div>

			<div className="hidden lg:block">
				<h1 className="relative flex justify-center lg:justify-start items-center gap-2 bg-secondary-black px-4 py-2 font-heading text-secondary text-center">
					Dashboard
				</h1>
			</div>

			{/* Main container - responsive layout */}
			<div className="lg:flex lg:flex-1 lg:gap-6 lg:px-6 lg:pt-6 lg:pb-4 lg:max-w-none lg:min-h-0 lg:overflow-hidden">
				<div ref={parent} className="lg:flex lg:gap-6 lg:w-full">
					{/* Sidebar - responsive behavior */}
					{(showSidebar || !isMobile) && (
						<aside className="lg:flex-shrink-0 lg:bg-white lg:border lg:border-black lg:rounded w-full lg:w-80 lg:max-h-full lg:overflow-y-auto">
							<SidebarNav
								sections={navSections}
								onNavigate={handleSidebarItemClick}
								renderLink={({ item, className, active, onNavigate, children }) => (
									<Link
										key={item.path}
										to={item.path}
										className={className}
										onClick={onNavigate}
										data-status={active ? 'active' : 'inactive'}
									>
										{children}
									</Link>
								)}
							/>
						</aside>
					)}

					{/* Main content - responsive behavior */}
					{(!showSidebar || !isMobile) && (
						<div
							className={`w-full lg:flex-1 lg:max-w-[67rem] lg:border lg:border-black lg:rounded lg:bg-white flex flex-col lg:max-h-full lg:overflow-hidden ${
								isMessageDetailView && isMobile ? 'h-[calc(100vh-8.5rem)]' : ''
							}`}
						>
							{/* Desktop back button and title - fixed to top of container */}
							{needsBackButton && (
								<div className="top-0 z-10 relative sticky flex flex-shrink-0 items-center bg-white mb-0 p-4 lg:p-8 pb-4 border-gray-200 border-b">
									<BackButton
										variant="inline"
										label={backTarget.kind === 'route' ? `Back to ${backTarget.label}` : 'Back'}
										ariaLabel={backTarget.kind === 'route' ? `Back to ${backTarget.label}` : 'Go back'}
										onClick={handleBackToParent}
									/>

									{!isMobile && (
										<h1 className="left-1/2 absolute flex items-center gap-2 font-bold text-[1.6rem] -translate-x-1/2">
											{isMessageDetailView && chatProfile?.user?.pubkey ? (
												<UserCard pubkey={chatProfile?.user?.pubkey} size="md" />
											) : (
												dashboardTitle
											)}
										</h1>
									)}

									{/* Header action button (e.g., Discard Edits) */}
									{dashboardHeaderAction && (
										<button
											onClick={dashboardHeaderAction.onClick}
											className="top-1/2 right-4 lg:right-8 absolute bg-pink-500 hover:bg-pink-600 px-3 py-1 rounded font-medium text-white text-sm transition-colors -translate-y-1/2"
										>
											{dashboardHeaderAction.label}
										</button>
									)}
								</div>
							)}

							<div className="flex-1 min-h-0 lg:overflow-y-auto">
								{isMessageDetailView ? (
									<div className="h-full">{!isAuthenticated ? <LoginPrompt /> : <Outlet />}</div>
								) : (
									<div className="h-full">
										<div className={cn('bg-white lg:bg-transparent p-4 lg:p-8 h-full', fullBleed && 'p-0 lg:p-0')}>
											{/* Only show title here if there's no back button */}
											{!isMobile && showTitle && <h1 className="mb-4 font-bold text-[1.6rem]">{dashboardTitle}</h1>}
											{!isAuthenticated ? (
												<LoginPrompt />
											) : (
												<>
													<Outlet />
												</>
											)}
										</div>
									</div>
								)}
								{/* Always render Outlet invisibly to ensure dashboard titles get set */}
								{!isAuthenticated && (
									<div className="hidden">
										<Outlet />
									</div>
								)}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
