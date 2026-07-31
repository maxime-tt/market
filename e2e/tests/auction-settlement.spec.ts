import { test, expect } from '../fixtures'
import { Relay } from 'nostr-tools/relay'
import { useWebSocketImplementation } from 'nostr-tools/relay'
import { RELAY_URL } from '../test-config'
import { devUser1, devUser2 } from '@/lib/fixtures'
import { seedAuction, seedSettlement } from '../scenarios'
import WebSocket from 'ws'

useWebSocketImplementation(WebSocket)

test.use({ scenario: 'merchant' })

// ============================================================================
// Auction Settlement E2E Tests
//
// These tests verify the AuctionSettlement component's button actions,
// UI state transitions, and that the correct state cards are shown
// for seller, buyer, and losing-bidder perspectives.
//
// Scenarios covered:
// - Seller sees "Reserve Not Met" with "Close Auction" button (reserve configured, no bids)
// - Seller sees "No Bids Received" with "Close Auction" button (no reserve, no bids)
// - Close Auction button transitions after press (settlement published, UI updates)
// - Losing bidder sees no action buttons after settlement
// - Seller sees "Settlement Expired" when window passes
// ============================================================================

test.describe('Auction Settlement - Seller Close Auction (reserve not met)', () => {
	test('seller sees Close Auction button when reserve is not met', async ({ merchantPage: page }) => {
		test.setTimeout(60_000)

		const relay = await Relay.connect(RELAY_URL)
		try {
			const now = Math.floor(Date.now() / 1000)
			// Seed an ended auction with a high reserve price that wasn't met
			// (no bids published, so reserve is not met)
			const auctionEvent = await seedAuction(relay, devUser1.sk, {
				title: 'Reserve Not Met Test',
				reserve: 100000, // High reserve — no bid will meet it
				endAt: now - 100, // Ended 100 seconds ago
				settlementGrace: 7200,
			})

			// Navigate to the auction page as the seller (devUser1)
			await page.goto(`/auctions/${auctionEvent.id}`)
			await page.waitForLoadState('networkidle')

			// Wait for the settlement card to appear
			// The seller should see "Reserve Not Met" with a "Close Auction" button
			await expect(page.getByText('Reserve Not Met')).toBeVisible({ timeout: 15_000 })
			const closeBtn = page.getByRole('button', { name: /close auction/i })
			await expect(closeBtn).toBeVisible()
			await expect(closeBtn).toBeEnabled()
		} finally {
			relay.close()
		}
	})
})

test.describe('Auction Settlement - Seller Close Auction (no reserve, no bids)', () => {
	test('seller sees No Bids Received when no reserve configured and no bids', async ({ merchantPage: page }) => {
		test.setTimeout(60_000)

		const relay = await Relay.connect(RELAY_URL)
		try {
			const now = Math.floor(Date.now() / 1000)
			// Seed an ended auction with no reserve (reserve defaults to 0)
			const auctionEvent = await seedAuction(relay, devUser1.sk, {
				title: 'No Bids Received Test',
				reserve: 0, // No reserve
				endAt: now - 100,
				settlementGrace: 7200,
			})

			await page.goto(`/auctions/${auctionEvent.id}`)
			await page.waitForLoadState('networkidle')

			// The seller should see "No Bids Received" (not "Reserve Not Met")
			await expect(page.getByText('No Bids Received')).toBeVisible({ timeout: 15_000 })
			const closeBtn = page.getByRole('button', { name: /close auction/i })
			await expect(closeBtn).toBeVisible()
		} finally {
			relay.close()
		}
	})
})

test.describe('Auction Settlement - Close Auction Button Reactivity', () => {
	test('Close Auction button transitions after press', async ({ merchantPage: page }) => {
		test.setTimeout(60_000)

		const relay = await Relay.connect(RELAY_URL)
		try {
			const now = Math.floor(Date.now() / 1000)
			const auctionEvent = await seedAuction(relay, devUser1.sk, {
				title: 'Close Auction Reactivity Test',
				reserve: 100000,
				endAt: now - 100,
				settlementGrace: 7200,
			})

			await page.goto(`/auctions/${auctionEvent.id}`)
			await page.waitForLoadState('networkidle')

			await expect(page.getByText('Reserve Not Met')).toBeVisible({ timeout: 15_000 })
			const closeBtn = page.getByRole('button', { name: /close auction/i })
			await expect(closeBtn).toBeVisible()

			// Press the button
			await closeBtn.click()

			// After the settlement is published, the "Close Auction" button should
			// disappear and the UI should transition to "Refund Pending" (since
			// the settlement window hasn't expired yet — settlementGrace=7200).
			// The settlement is fetched on refetch (no more early return blocking it).
			await expect(page.getByRole('button', { name: /close auction/i })).not.toBeVisible({ timeout: 15_000 })
			await expect(page.getByText('Refund Pending')).toBeVisible({ timeout: 15_000 })
		} finally {
			relay.close()
		}
	})
})

test.describe('Auction Settlement - Losing Bidder View', () => {
	test('losing bidder sees no action buttons after settlement', async ({ buyerPage: page }) => {
		test.setTimeout(60_000)

		const relay = await Relay.connect(RELAY_URL)
		try {
			const now = Math.floor(Date.now() / 1000)
			// Seed an ended auction
			const auctionEvent = await seedAuction(relay, devUser1.sk, {
				title: 'Losing Bidder Test',
				reserve: 1000,
				endAt: now - 100,
				settlementGrace: 7200,
			})

			const auctionDTag = auctionEvent.tags.find((t) => t[0] === 'd')?.[1] || ''
			const auctionCoord = `30408:${devUser1.pk}:${auctionDTag}`

			// Seed a settlement with a different winner (not devUser2/buyer)
			// Use valid 64-char hex values for winningBidId and pathReleaseEventId
			// so the settlement passes parseSettlementEvent schema validation.
			const otherWinnerPubkey = 'a'.repeat(64)
			const dummyBidEventId = 'b'.repeat(64)
			const dummyPathReleaseId = 'c'.repeat(64)
			await seedSettlement(relay, devUser1.sk, {
				auctionRootEventId: auctionEvent.id,
				auctionCoordinate: auctionCoord,
				status: 'settled',
				closeAt: now - 50,
				winnerPubkey: otherWinnerPubkey,
				winningBidId: dummyBidEventId,
				finalAmount: 5000,
				pathReleaseEventId: dummyPathReleaseId,
			})

			// Navigate to the auction page as the buyer (devUser2 — the losing bidder)
			await page.goto(`/auctions/${auctionEvent.id}`)
			await page.waitForLoadState('networkidle')

			// The losing bidder should NOT see any action buttons
			// (no "Release path & settle", no "Submit Shipping Address", no "View Order")
			await expect(page.getByRole('button', { name: /release path/i })).not.toBeVisible({ timeout: 10_000 })
			await expect(page.getByRole('button', { name: /submit shipping/i })).not.toBeVisible()
			await expect(page.getByRole('button', { name: /view order/i })).not.toBeVisible()
		} finally {
			relay.close()
		}
	})
})

test.describe('Auction Settlement - Settlement Expired', () => {
	test('seller sees settlement expired when window passes', async ({ merchantPage: page }) => {
		test.setTimeout(60_000)

		const relay = await Relay.connect(RELAY_URL)
		try {
			const now = Math.floor(Date.now() / 1000)
			// Seed an auction that ended long ago with a short settlement grace
			// so the settlement window has expired
			const auctionEvent = await seedAuction(relay, devUser1.sk, {
				title: 'Settlement Expired Test',
				reserve: 100000, // High reserve — no bid
				endAt: now - 10000, // Ended ~2.7 hours ago
				settlementGrace: 60, // 1 minute grace — window expired
			})

			// Navigate to the auction page as the seller
			await page.goto(`/auctions/${auctionEvent.id}`)
			await page.waitForLoadState('networkidle')

			// The seller should see "Settlement Expired"
			await expect(page.getByText('Settlement Expired')).toBeVisible({ timeout: 15_000 })
		} finally {
			relay.close()
		}
	})
})
