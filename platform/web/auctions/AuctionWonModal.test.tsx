/**
 * `AuctionWonModal.test.tsx` — the global "you won" surface, repointed at the
 * arena read.
 *
 * The modal renders the active `auction-won` notification wherever the user is.
 * No relay: the arena lot read is doubled (the modal mounts it for display only),
 * the notification queue is doubled, and the auth store is a real store with a
 * signed-in user. What is asserted is the **shape** of the repoint: the surface
 * no longer offers a settlement — its CTA opens the lot page — and it renders the
 * win's lot address, never a settlement countdown.
 *
 * Pubkeys are short and non-hex on purpose: they are opaque strings here, and a
 * 64-hex literal in a test file is indistinguishable from a key to the
 * pre-commit scanner (`auctionSurfacesRead.test.ts:10-13`).
 */
import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Store } from '@tanstack/react-store'
import type { AuctionWonPayload } from '@platform/web/notifications/types'

const BIDDER = 'bidder-me'

const win: AuctionWonPayload = {
	bidderPubkey: BIDDER,
	auctionRootEventId: 'r'.repeat(64),
	bidEventId: 'b'.repeat(64),
	bidAmount: 5_000,
	lotD: 'lot-1',
	lotSeller: 'seller-one',
}

const authStore = new Store({ isAuthenticated: true, user: { pubkey: BIDDER } })

// A mutable active win the doubled queue reads, so a case can hand the modal a
// win owned by another bidder without re-mocking the module.
let activeWin: AuctionWonPayload | null = win

mock.module('@platform/web/auth/authStore', () => ({ authStore }))

mock.module('@platform/web/notifications', () => ({
	useAppNotifications: () => ({ active: activeWin ? [{ type: 'auction-won', payload: activeWin }] : [] }),
	auctionWonPayloadOf: (notification: { type?: string; payload?: unknown } | undefined) =>
		notification && notification.type === 'auction-won' ? (notification.payload as AuctionWonPayload) : null,
	appNotifications: { queue: { dismissActive: () => {} } },
}))

// The lot read mounts relay I/O; the modal uses it only for the title, so it is
// doubled to an honest empty read (the shell must still render).
mock.module('@platform/web/auctions/relay/ArenaAuctionLotHost', () => ({
	useArenaLotRead: () => ({ snapshot: null, status: 'loading', relayHealth: { answered: 0, total: 0 }, chainClock: null }),
}))

mock.module('@platform/web/profiles/userCardHosts', () => ({
	UserCardHost: (props: { pubkey?: string }) => createElement('span', { 'data-testid': 'user-card-stub' }, props.pubkey ?? ''),
}))

mock.module('@tanstack/react-router', () => ({
	useLocation: () => ({ pathname: '/auctions/lot-1' }),
	useNavigate: () => () => {},
}))

// Imported after the mocks (`mock.module` must run before the module graph is
// built, so the static import cannot be used here).
let AuctionWonModal: (typeof import('./AuctionWonModal'))['AuctionWonModal']
beforeAll(async () => {
	;({ AuctionWonModal } = await import('./AuctionWonModal'))
})

describe('AuctionWonModal — the arena win', () => {
	test('shows the win and opens the lot, never a settlement', () => {
		const markup = renderToStaticMarkup(createElement(AuctionWonModal) as ReactNode)
		expect(markup).toContain('You won this auction')
		expect(markup).toContain('5,000 sats')
		expect(markup).toContain('View lot &amp; claim')
		// The retired winner-settlement seat is gone: no settle action, no countdown.
		expect(markup).not.toContain('Settle')
		expect(markup).not.toContain('settle now')
	})

	test('renders nothing for a win owned by another bidder', () => {
		activeWin = { ...win, bidderPubkey: 'someone-else' }
		try {
			expect(renderToStaticMarkup(createElement(AuctionWonModal) as ReactNode)).toBe('')
		} finally {
			activeWin = win
		}
	})
})
