import { Button } from '@ui/wrappers/button'
import { BackButton } from '@ui/nav/back-button'
import { SidebarNav } from '@ui/nav/sidebar-nav'
import {
	DASHBOARD_NAV,
	findNavEmoji,
	isEditorWorkspaceRoute,
	isFullBleedRoute,
	resolveBackTarget,
	resolveNavView,
	shouldShowSidebarOnMobile,
	showsPageTitle,
	type NavBackTarget,
	type NavBadgeCounts,
} from '@ui/nav/model'
import { useBreakpoint } from '@platform/web/app/useBreakpoint'
import { cn } from '@ui/utils/cn'
import { useAmIAdmin } from '@platform/web/app-settings/appSettingsQuery'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { fetchProfileByIdentifier } from '@platform/web/profiles/profileQuery'
import { profileKeys } from '@sdk/core/query/queryKeyFactory'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStore } from '@tanstack/react-store'
import { uiStore, uiActions } from '@platform/web/app/uiStore'
import { authStore } from '@platform/web/auth/authStore'
import { appNotificationsBinding, appUnseenCounts } from '@platform/web/notifications'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import React, { useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { AppearanceControl } from '@ui/admin-theme/appearance-control'
import { dashboardNavIcon } from '@ui/nav/nav-icons'
import { useAdminAppearance } from '@platform/web/admin-theme/useAdminAppearance'
import { useAdminPortalTheme } from '@platform/web/admin-theme/useAdminPortalTheme'
import { UserCardHost } from '@platform/web/profiles/userCardHosts'

export const Route = createFileRoute('/_dashboard-layout')({
	component: DashboardLayout,
})

// Custom hook to manage dashboard title using uiStore lives in `platform/web/app/dashboardTitle.ts`:
// a route module is composition only, and 30 dashboard routes import that hook.

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
	const ledgerCounts = useStore(appNotificationsBinding.store, (snapshot) => snapshot.ledger.counts)
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
	} = appUnseenCounts(ledgerCounts)
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
	// The page builders fold the dashboard menu away on desktop so the editor
	// columns and the live preview get the whole width. The menu stays one
	// click away and folds again whenever the route changes.
	const workspace = !isMobile && isEditorWorkspaceRoute(location.pathname)
	const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
	React.useEffect(() => {
		setWorkspaceMenuOpen(false)
	}, [location.pathname])
	const showDesktopMenu = !workspace || workspaceMenuOpen
	// The admin console theme (ADR-0022): this admin's own style, colour and mode.
	const { appearance, resolvedMode, setAppearance } = useAdminAppearance()
	// Pop-ups opened from the console wear it too (the header's keep the public theme).
	useAdminPortalTheme(appearance, resolvedMode)

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

	// Offsets follow the app bar's measured height (`--app-bar-h`, set by the
	// AppBar host); the old fixed 61px / 117px are only fallbacks.
	return (
		<div
			className="lg:flex lg:flex-col lg:h-[calc(100vh-var(--app-bar-h,61px))] admin-console"
			data-admin-style={appearance.style}
			data-admin-color={appearance.color}
			data-admin-mode={resolvedMode}
			data-testid="admin-console"
		>
			{/* Header - responsive for mobile/desktop */}
			<div className="admin-titlebar-mobile lg:hidden top-[var(--app-bar-h,117px)] z-10 sticky">
				<h1 className="arena-dash-title relative flex justify-center items-center gap-2 p-4 font-heading text-center">
					{/* Mobile back button - only visible on small screens when not showing sidebar */}
					{!showSidebar && isMobile && <BackButton variant="icon" ariaLabel="Back to sidebar" onClick={handleBackToSidebar} />}

					{/* Title */}
					<span className="flex justify-center items-center gap-2 px-8 sm:px-12 md:px-16 w-full min-w-0 text-3xl truncate">
						{showSidebar || !isMobile ? (
							'Dashboard'
						) : (
							<>
								{isMessageDetailView && chatProfile ? (
									<UserCardHost pubkey={chatProfile?.user?.pubkey || ''} size="sm" className="[&>h2]:text-white" />
								) : (
									<>
										{dashboardEmoji && <span className="text-2xl">{dashboardEmoji}</span>}
										<span className="flex-1 min-w-0 text-center truncate">{dashboardTitleWithoutEmoji}</span>
									</>
								)}
							</>
						)}
					</span>

					{/* Appearance - on the menu screen, where the page emoji is not shown */}
					{showSidebar && (
						<AppearanceControl
							value={appearance}
							resolvedMode={resolvedMode}
							onChange={setAppearance}
							compact
							className="top-1/2 right-2 sm:right-3 md:right-4 z-20 absolute -translate-y-1/2"
						/>
					)}

					{/* Mobile emoji - only visible on small screens when not showing sidebar */}
					{!showSidebar && emoji && isMobile && !dashboardEmoji && (
						<span className="top-1/2 right-2 sm:right-3 md:right-4 z-20 absolute flex justify-center items-center w-12 h-12 text-2xl -translate-y-1/2 select-none">
							{emoji}
						</span>
					)}
				</h1>
			</div>

			<div className="hidden lg:block">
				<h1 className="arena-dash-title relative flex justify-center lg:justify-start items-center gap-2 px-6 py-3 font-heading text-center">
					Dashboard
					<AppearanceControl value={appearance} resolvedMode={resolvedMode} onChange={setAppearance} className="ml-auto" />
					{workspace && (
						<button
							type="button"
							onClick={() => setWorkspaceMenuOpen((open) => !open)}
							aria-expanded={workspaceMenuOpen}
							aria-controls="dashboard-menu"
							className="inline-flex items-center gap-2 px-3 py-1.5 border border-white/25 hover:border-white/60 rounded-md text-sm transition-colors arena-dash-toggle"
							data-testid="dashboard-menu-toggle"
						>
							{workspaceMenuOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
							<span>{workspaceMenuOpen ? 'Hide menu' : 'Show menu'}</span>
						</button>
					)}
				</h1>
			</div>

			{/* Main container - responsive layout */}
			<div
				className={cn(
					'lg:flex lg:flex-1 lg:gap-6 lg:px-6 lg:pt-6 lg:pb-4 lg:max-w-none lg:min-h-0 lg:overflow-hidden',
					workspace && 'lg:px-3 lg:pt-3 lg:pb-3',
				)}
			>
				<div ref={parent} className={cn('lg:flex lg:gap-6 lg:w-full', workspace && 'lg:gap-3')}>
					{/* Sidebar - responsive behavior */}
					{(isMobile ? showSidebar : showDesktopMenu) && (
						<aside
							id="dashboard-menu"
							className="admin-panel admin-sidebar lg:flex-shrink-0 lg:bg-white lg:border lg:border-black lg:rounded w-full lg:w-80 lg:max-h-full lg:overflow-y-auto"
						>
							<SidebarNav
								sections={navSections}
								onNavigate={handleSidebarItemClick}
								renderIcon={(item) => {
									const Icon = dashboardNavIcon(item.path)
									return <Icon aria-hidden="true" />
								}}
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
							className={`admin-panel w-full lg:flex-1 lg:max-w-[67rem] lg:border lg:border-black lg:rounded lg:bg-white flex flex-col lg:max-h-full lg:overflow-hidden ${
								isMessageDetailView && isMobile ? 'h-[calc(100vh-var(--app-bar-h,117px))]' : ''
							} ${workspace ? 'lg:max-w-none' : ''}`}
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
												<UserCardHost pubkey={chatProfile?.user?.pubkey} size="md" />
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
