/**
 * `AuctionWonModal.tsx` — the global "you won" surface.
 *
 * Mounted once above the router (`routes/__root.tsx`, `AppOverlays`), it renders
 * the active `auction-won` notification wherever the user is in the app. The win
 * is produced by the arena read (`useAuctionWinMonitor` → `arenaWinRead.ts`), so
 * this surface only presents it.
 *
 * ## What changed from the retired pipeline
 *
 * The old modal was the winner's **settlement** seat: it verified a path release
 * had not been published, counted down the settlement window, and called
 * `settleAuctionAsWinner`. The arena has no winner-side settle action — the chain
 * settles — so the CTA now **opens the lot page**, where the claim/fulfilment
 * flow lives. Nothing here reads settlements, path releases or the 30408
 * pipeline; the only read is the arena lot read, for the lot's title and image.
 */
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Trophy, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@ui/primitives/dialog'
import { Button } from '@ui/primitives/button'
import { Media } from '@ui/shared/media'
import { UserCardHost } from '@platform/web/profiles/userCardHosts'
import { ConfettiBurst } from '@ui/shared/confetti-burst'
import { appNotifications, auctionWonPayloadOf, useAppNotifications } from '@platform/web/notifications'
import type { AuctionWonPayload } from '@platform/web/notifications'
import { authStore } from '@platform/web/auth/authStore'
import { useArenaLotRead } from '@platform/web/auctions/relay/ArenaAuctionLotHost'
import { resolveArenaLot } from '@platform/web/auctions/relay/arenaLotRead'
import { shouldUseNonBlockingAuctionWinPrompt } from '@sdk/commerce/auctions/winNotification'
import { formatSats } from '@sdk/commerce/payments/display'

/**
 * The globally-mounted entry point. It only decides whether the signed-in user
 * has an active win; the hooks the dialog needs live in {@link AuctionWonDialog},
 * so a signed-out or winless render mounts no read.
 */
export function AuctionWonModal() {
	const { active } = useAppNotifications()
	// The queue is shared, so the pending win is the first auction-won notification, not necessarily the head:
	// a notification of another type at the head must not hide it.
	const win = active.map(auctionWonPayloadOf).find((payload) => payload !== null) ?? null
	const { isAuthenticated, user } = useStore(authStore)

	if (!win || !isAuthenticated || !user?.pubkey || win.bidderPubkey !== user.pubkey) return null
	return <AuctionWonDialog win={win} />
}

function AuctionWonDialog({ win }: { win: AuctionWonPayload }) {
	const location = useLocation()
	const navigate = useNavigate()

	// The lot read is the only read this surface makes: the payload carries the
	// lot's own address, so the title, image and seller come from the arena read
	// and never from the retired pipeline. A read that has not delivered the lot
	// simply shows the win without its display details.
	const read = useArenaLotRead({ d: win.lotD, seller: win.lotSeller, refreshKey: 0 })
	const lot = read.snapshot === null ? null : resolveArenaLot(read.snapshot, win.lotD, win.lotSeller)
	const view = lot?.kind === 'found' ? lot.view : null
	const title = view?.content.title ?? 'This auction'
	const imageUrl = view?.content.image ?? null
	const sellerPubkey = view?.seller ?? win.lotSeller

	const dismiss = () => appNotifications.queue.dismissActive()
	const openLot = () => {
		dismiss()
		void navigate({ to: '/auctions/$auctionId', params: { auctionId: win.lotD }, search: { seller: win.lotSeller } })
	}

	const bidLine = win.bidAmount === null ? 'amount not stated' : `${formatSats(win.bidAmount)} sats`

	// On a lot/dashboard page a blocking dialog would cover the very page the CTA
	// opens, so the prompt goes non-blocking there (the retired pipeline used the
	// same route test for the same reason).
	const useNonBlockingPrompt = shouldUseNonBlockingAuctionWinPrompt(location.pathname)

	const viewLotButton = (
		<Button size="lg" className="w-full" onClick={openLot}>
			View lot &amp; claim
		</Button>
	)

	if (useNonBlockingPrompt) {
		return (
			<>
				<ConfettiBurst />
				<aside
					role="dialog"
					aria-modal="false"
					aria-labelledby="auction-win-prompt-title"
					className="fixed top-20 right-3 z-40 w-[calc(100%-1.5rem)] max-w-sm overflow-hidden rounded-lg border-2 border-amber-400 bg-background shadow-2xl sm:top-24 sm:right-5"
				>
					<div className="h-1.5 bg-amber-400" />
					<button
						type="button"
						onClick={dismiss}
						className="absolute top-4 right-4 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						aria-label="Dismiss auction win"
					>
						<X className="h-4 w-4" />
					</button>

					<div className="space-y-4 p-5 pr-11">
						<div className="flex items-start gap-3">
							<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
								<Trophy className="h-6 w-6" />
							</div>
							<div className="min-w-0">
								<h2 id="auction-win-prompt-title" className="text-lg font-bold">
									You won this auction
								</h2>
								<p className="truncate text-sm font-medium text-muted-foreground">{title}</p>
							</div>
						</div>

						<div className="flex items-end justify-between gap-4 border-y py-3">
							<div>
								<p className="text-xs text-muted-foreground">Winning bid</p>
								<p className="text-xl font-bold">{bidLine}</p>
							</div>
						</div>

						{viewLotButton}
					</div>
				</aside>
			</>
		)
	}

	return (
		<Dialog open onOpenChange={(open) => !open && dismiss()}>
			<DialogContent className="overflow-hidden sm:max-w-md">
				<ConfettiBurst />
				<div className="relative flex flex-col items-center gap-4 pt-2 text-center">
					<div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
						<Trophy className="h-7 w-7" />
					</div>

					<div>
						<DialogTitle className="text-2xl font-bold">You won!</DialogTitle>
						<DialogDescription className="mt-1 text-sm text-muted-foreground">
							Your bid was the highest when the auction closed. Open the lot to claim and arrange fulfilment.
						</DialogDescription>
					</div>

					{imageUrl && (
						<div className="h-40 w-40 overflow-hidden rounded-lg border">
							<Media src={imageUrl} alt={title} video={false} className="h-full w-full object-cover" />
						</div>
					)}

					<h3 className="text-lg font-semibold">{title}</h3>

					{sellerPubkey && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<span>Seller:</span>
							<UserCardHost pubkey={sellerPubkey} size="xs" subtitle="none" onPress="none" />
						</div>
					)}

					<div className="rounded-lg bg-muted px-4 py-2">
						<div className="text-xs text-muted-foreground">Your winning bid</div>
						<div className="text-xl font-bold">{bidLine}</div>
					</div>

					{viewLotButton}
				</div>
			</DialogContent>
		</Dialog>
	)
}
