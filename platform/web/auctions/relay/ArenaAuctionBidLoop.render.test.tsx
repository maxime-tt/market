/**
 * `ArenaAuctionBidLoop.render.test.tsx` — one delivery of the bid must settle the
 * panel, not re-render it forever.
 *
 * ## The defect this pins
 *
 * Measured live on the served host 2026-11-19 (deploy line `34fdb1d81`): a bid
 * that the chain accepted and then admitted killed the lot page with React
 * error #185 ("Maximum update depth exceeded") at the instant the read
 * delivered the bid. Three facts make that loop:
 *
 * 1. `ArenaAuctionLotHost.tsx:195` projects `toAuctionDetailModel(view, context)`
 *    inline, so the model handed to `useAuctionBidController` is a **fresh
 *    object on every render**;
 * 2. the controller runs the state machine in an effect keyed on that model
 *    (`AuctionBidHost.tsx`, `nextPublishedBidState`), so every render re-runs it;
 * 3. `nextPublishedBidState` allocated a fresh `seen`/`admitted` object for a
 *    state that had **not** changed — which is exactly what its own contract
 *    forbids ("a state that does not change is returned as the same object — a
 *    host calling this on every tick does not re-render for it"). A new object
 *    schedules another render, which re-runs the effect, which allocates another
 *    object: unbounded.
 *
 * ## What this suite renders
 *
 * The REAL hook (`useAuctionBidController`) with the REAL React 19 renderer
 * (`createRoot` + `act`) against the minimal DOM shim the repo already uses for
 * headless render tests (`auctionBidFundingSessionGuard.test.ts` — the unit
 * suite has no jsdom). The probe calls the projection **inline on every render**,
 * exactly as the lot host does, so the model identity is as unstable as it is in
 * production; the publish and the money path are stubbed at their seams (this
 * suite is about the render loop, not about relays or escrow).
 *
 * `bun:test`'s `mock.module` is process-wide, so this file — like the other
 * suites that stub a platform seam — must run under `bun run test:unit`, which
 * passes `--isolate` (running it in one process beside
 * `arenaBidPublish.test.ts` would hand that file the stubbed publisher).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Store } from '@tanstack/react-store'
import type { Event } from '@sdk/core/nostr-io'
import type { ArenaAuctionDetailModel } from '@ui/auction/arena/model'
import type { ArenaBidSubmissionState } from '@ui/auction/arena/bid-panel'

// =============================================================================
// Minimal DOM shim — `react-dom/client` needs a DOM to render into.
// Copied from `platform/web/auctions/auctionBidFundingSessionGuard.test.ts`
// (the repo has no jsdom/happy-dom); it implements what createRoot + commit +
// unmount need for a stateless probe.
// =============================================================================

class FakeNode {
	nodeType: number
	childNodes: FakeNode[] = []
	parentNode: FakeNode | null = null
	constructor(nodeType: number) {
		this.nodeType = nodeType
	}
	appendChild(child: FakeNode) {
		if (child.parentNode) child.parentNode.childNodes.splice(child.parentNode.childNodes.indexOf(child), 1)
		this.childNodes.push(child)
		child.parentNode = this
		return child
	}
	insertBefore(child: FakeNode, ref: FakeNode | null) {
		const idx = ref ? this.childNodes.indexOf(ref) : -1
		if (idx >= 0) this.childNodes.splice(idx, 0, child)
		else this.childNodes.push(child)
		if (child.parentNode) child.parentNode.childNodes.splice(child.parentNode.childNodes.indexOf(child), 1)
		child.parentNode = this
		return child
	}
	removeChild(child: FakeNode) {
		const idx = this.childNodes.indexOf(child)
		if (idx >= 0) this.childNodes.splice(idx, 1)
		child.parentNode = null
		return child
	}
	contains(node: FakeNode): boolean {
		let cursor: FakeNode | null = node
		while (cursor) {
			if (cursor === this) return true
			cursor = cursor.parentNode
		}
		return false
	}
	addEventListener() {}
	removeEventListener() {}
}

class FakeElement extends FakeNode {
	tagName: string
	attributes: Record<string, string> = {}
	style: Record<string, string> = {}
	innerHTML = ''
	ownerDocument: FakeDocument
	constructor(tag: string, ownerDocument: FakeDocument) {
		super(1)
		this.tagName = tag.toUpperCase()
		this.ownerDocument = ownerDocument
	}
	setAttribute(key: string, value: string) {
		this.attributes[key] = value
	}
	removeAttribute(key: string) {
		delete this.attributes[key]
	}
	getAttribute(key: string) {
		return this.attributes[key] ?? null
	}
	set textContent(text: string) {
		for (const child of [...this.childNodes]) {
			if (child.nodeType === 3) this.removeChild(child)
		}
		if (text !== '') this.appendChild(this.ownerDocument.createTextNode(text))
	}
	get textContent(): string {
		return this.childNodes
			.map((child) => (child.nodeType === 3 ? (child as FakeTextNode).nodeValue : (child as FakeElement).textContent))
			.join('')
	}
}

class FakeTextNode extends FakeNode {
	nodeValue: string
	constructor(text: string) {
		super(3)
		this.nodeValue = text
	}
}

class FakeDocument extends FakeElement {
	documentElement!: FakeElement
	head!: FakeElement
	body!: FakeElement
	activeElement!: FakeElement
	implementation!: { hasFeature: () => boolean }
	defaultView: unknown
	constructor() {
		super('#document', null as unknown as FakeDocument)
		this.ownerDocument = this
	}
	createElement(tag: string) {
		return new FakeElement(tag, this)
	}
	createTextNode(text: string) {
		return new FakeTextNode(text)
	}
	createDocumentFragment() {
		return new FakeElement('#fragment', this)
	}
}

const shim = { document: null as unknown as FakeDocument, previous: {} as Record<string, unknown>, restore: () => {} }

const installHeadlessDom = (): void => {
	const doc = new FakeDocument()
	doc.documentElement = doc.createElement('html')
	doc.head = doc.createElement('head')
	doc.body = doc.createElement('body')
	doc.activeElement = doc.body
	doc.implementation = { hasFeature: () => true }
	doc.addEventListener = () => {}
	doc.removeEventListener = () => {}

	const win = {
		document: doc,
		navigator: { userAgent: 'bun-test', product: 'bun' },
		setTimeout,
		clearTimeout,
		requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16),
		cancelAnimationFrame: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		getComputedStyle: () => ({ getPropertyValue: () => '' }),
		location: { href: 'http://localhost/', hostname: 'localhost' },
		MutationObserver: class {
			observe() {}
			disconnect() {}
		},
		HTMLIFrameElement: class HTMLIFrameElement {},
		HTMLElement: class HTMLElement {},
		Element: FakeElement,
		Node: FakeNode,
	}
	doc.defaultView = win

	const globalsToSet: Record<string, unknown> = {
		document: doc,
		window: win,
		navigator: win.navigator,
		MutationObserver: win.MutationObserver,
		IS_REACT_ACT_ENVIRONMENT: true,
	}
	const previous: Record<string, unknown> = {}
	const globalScope = globalThis as Record<string, unknown>
	for (const [key, value] of Object.entries(globalsToSet)) {
		previous[key] = key in globalScope ? globalScope[key] : undefined
		globalScope[key] = value
	}
	shim.document = doc
	shim.previous = previous
	shim.restore = () => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete globalScope[key]
			else globalScope[key] = value
		}
	}
}

// =============================================================================
// Fixtures
// =============================================================================

const SELLER = 'seller-alice'
const BIDDER = 'be'.repeat(32)
const RELAY_A = 'wss://relay-a.test'
const NOW = 2000
const ROOT = 'ab'.repeat(32)
const ESCROW_LOCKTIME = 1_800_000_000
/** The bid the stubbed publish reports, and the id the read then serves back. */
const BID_ID = 'c1'.repeat(32)

/** One detail model, in the shape `toAuctionDetailModel` produces. */
function detail(over: Partial<ArenaAuctionDetailModel> = {}): ArenaAuctionDetailModel {
	return {
		coordinate: `1440:${SELLER}:lot-1`,
		seller: SELLER,
		d: 'lot-1',
		title: 'A handmade mug',
		imageUrl: null,
		startingBid: 1000,
		topBidTotal: null,
		bidCount: 0,
		bidsWithoutAmount: 0,
		endsAt: 4600,
		endSource: 'create-derived',
		createDerivedEndsAt: 4600,
		committedEndHeight: null,
		committedEndOrdinal: null,
		phase: 'open',
		verdict: null,
		verdictCount: 0,
		validatorCount: 0,
		divergent: false,
		relayCount: 2,
		description: null,
		media: [],
		minIncrement: 100,
		mode: 'fixed',
		windowSec: null,
		durationSec: 3600,
		sellerWallet: null,
		v4vSplit: null,
		versions: 1,
		rootEventId: ROOT,
		canonicalEventId: ROOT,
		rootCreatedAt: 1000,
		bids: [],
		positions: [],
		receipts: [],
		refundsByBidder: {},
		settleReceipt: null,
		createRefusal: null,
		acceptance: { accepted: true, acceptedHeight: 4210, admitEventId: 'admit-event-1' },
		bidRefusals: {},
		admissions: {},
		...over,
	}
}

const BID_ROW = { eventId: BID_ID, bidder: BIDDER, createdAt: NOW, amount: 1000, relays: [RELAY_A] }
const ADMISSION = {
	bidId: BID_ID,
	bidder: BIDDER,
	amount: 1000,
	position: 1105,
	highBid: 'high-1',
	height: 3490,
	blockHash: 'ab'.repeat(32),
	eventId: 'admit-1',
	validatorPubkey: 'v1',
}

/** What the read has delivered, as the lot host would project it. */
const readState: { bids: ArenaAuctionDetailModel['bids']; admissions: ArenaAuctionDetailModel['admissions'] } = {
	bids: [],
	admissions: {},
}

// =============================================================================
// The stubs at the seams (relays, wallet, escrow, publish)
// =============================================================================

const authStore = new Store({ isAuthenticated: true, user: { pubkey: BIDDER } })

// Every mock spreads the real module and overrides only the seam this suite
// stubs: the host's import graph is wider than the hook, and a mock that drops
// an export breaks a sibling module's import (measured: `sdkNostrIo`'s
// `createWebRelayReadContext`, imported by the read context).
const realAuth = await import('@platform/web/auth/authStore')
mock.module('@platform/web/auth/authStore', () => ({
	...realAuth,
	authStore,
	getActiveSignerCapability: () => ({
		pubkey: BIDDER,
		signEvent: async (template: Record<string, unknown>) => ({ ...template, pubkey: BIDDER, id: 'f'.repeat(64), sig: 's'.repeat(128) }),
	}),
}))

const realNostrIo = await import('@platform/web/sdkNostrIo')
mock.module('@platform/web/sdkNostrIo', () => ({
	...realNostrIo,
	webRelayPolicy: () => [RELAY_A],
	createWebNostrIo: () => ({
		publish: async (event: Event) => ({ id: event.id, acks: [{ url: RELAY_A, accepted: true }] }),
	}),
}))

const realWalletOps = await import('@platform/web/wallet/walletOps')
mock.module('@platform/web/wallet/walletOps', () => ({
	...realWalletOps,
	walletOps: {
		...realWalletOps.walletOps,
		ensureAuctionWalletKey: async () => {},
		getAuctionBidWalletSigner: () => null,
	},
}))

const realCashuStore = await import('@platform/web/wallet/cashuStore')
mock.module('@platform/web/wallet/cashuStore', () => ({
	...realCashuStore,
	cashuStore: { state: { manager: null } },
}))

// The escrow assembly is stubbed: this suite is about the render loop, not the
// money path. `publishArenaBid` is stubbed for the same reason — the real state
// machine it feeds is NOT stubbed (see the spread below).
const realFund = await import('@platform/web/auctions/relay/arenaBidFund')
mock.module('@platform/web/auctions/relay/arenaBidFund', () => ({
	...realFund,
	assembleArenaBidFunding: async () => ({ funding: { locktime: ESCROW_LOCKTIME }, fundingTerms: null }),
}))

const realPublish = await import('@platform/web/auctions/relay/arenaBidPublish')
const presumedState: ArenaBidSubmissionState = {
	phase: 'presumed',
	amount: 1000,
	eventId: BID_ID,
	acceptedBy: [RELAY_A],
	totalRelays: 1,
}
mock.module('@platform/web/auctions/relay/arenaBidPublish', () => ({
	...realPublish,
	publishArenaBid: async () => ({ state: presumedState, eventId: BID_ID }),
}))

const { useAuctionBidController } = await import('@platform/web/auctions/relay/AuctionBidHost')
const { bidSubmissionStepper } = await import('@ui/auction/arena/bid-panel')

// =============================================================================
// The probe — the lot host's own shape
// =============================================================================

/**
 * Renders since the last {@link mark}, and the ceiling a single mark may reach.
 *
 * The ceiling exists so a regression fails by name in milliseconds instead of
 * letting React's own nested-update guard flood the log (and the test run) with
 * "Maximum update depth exceeded": a render loop is detected here as the thing
 * it is — more renders than a delivery could possibly need.
 */
let renders = 0
let renderCeiling = 50
const mark = (ceiling = 50) => {
	renders = 0
	renderCeiling = ceiling
}

let latest: ReturnType<typeof useAuctionBidController> = null as unknown as ReturnType<typeof useAuctionBidController>

function LotHostLikeProbe() {
	// EXACTLY the lot host's line (`ArenaAuctionLotHost.tsx:195`): the model is
	// projected on every render, so its identity changes every pass.
	const model = detail({ bids: readState.bids, admissions: readState.admissions })
	const bid = useAuctionBidController({ model, readStatus: 'settled', now: NOW, chainAdvancing: false, onRefresh: () => {} })
	latest = bid
	renders += 1
	if (renders > renderCeiling) {
		throw new Error(`render loop: more than ${renderCeiling} renders without the read changing`)
	}
	return React.createElement('span', { 'data-phase': bid.submission.phase })
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// =============================================================================
// Lifecycle
// =============================================================================

let root: Root
let container: FakeElement

beforeAll(() => {
	installHeadlessDom()
})

afterAll(() => {
	shim.restore()
})

beforeEach(async () => {
	readState.bids = []
	readState.admissions = {}
	mark()
	container = shim.document.createElement('div')
	root = createRoot(container as unknown as HTMLElement)
	await act(async () => {
		root.render(React.createElement(LotHostLikeProbe))
	})
})

const unmount = async () => {
	await act(async () => {
		root.unmount()
	})
}

// =============================================================================
// The loop
// =============================================================================

describe('the lot host’s projection shape does not loop', () => {
	test('one delivery of the bid settles the panel instead of re-rendering forever', async () => {
		expect(latest.submission.phase).toBe('idle')

		// Publish: the stubbed relay accepts, so the panel is a published bid.
		mark(50)
		await act(async () => {
			latest.onSubmit()
			await flush()
		})
		expect(['presumed', 'unconfirmed']).toContain(latest.submission.phase)
		const submission = latest.submission
		if (submission.phase !== 'presumed' && submission.phase !== 'unconfirmed') throw new Error('the probe did not reach a published state')
		expect(submission.eventId).toBe(BID_ID)

		// The read delivers the bid. The model is a NEW object this pass — the
		// host's own shape — and the effect runs again.
		readState.bids = [BID_ROW]
		mark(4)
		await act(async () => {
			root.render(React.createElement(LotHostLikeProbe))
		})
		expect(latest.submission.phase).toBe('seen')
		// One render for the delivery, and nothing the effect asked for: a second
		// render here means the state machine handed back a new object for a state
		// that did not change, and the next pass would do it again.
		// A transition costs a couple of renders (the effect's own write, and the
		// delivery itself) — but a bounded couple, and the ceiling above would have
		// fired long before this if the effect were re-triggering itself.
		expect(renders).toBeLessThanOrEqual(4)

		// Every further pass says the same thing and renders **exactly once** — the
		// explicit render, with nothing the effect asked for. That is the property
		// the crash was the absence of.
		for (let pass = 0; pass < 4; pass += 1) {
			mark(4)
			await act(async () => {
				root.render(React.createElement(LotHostLikeProbe))
			})
			expect(latest.submission.phase).toBe('seen')
			expect(renders).toBe(1)
		}
		await unmount()
	})

	test('the chain’s admission fact advances the panel once and then stands still', async () => {
		mark(50)
		await act(async () => {
			latest.onSubmit()
			await flush()
		})
		readState.bids = [BID_ROW]
		mark(4)
		await act(async () => {
			root.render(React.createElement(LotHostLikeProbe))
		})
		expect(latest.submission.phase).toBe('seen')

		// The admission fact arrives on a later read.
		readState.admissions = { [BID_ID]: ADMISSION }
		mark(4)
		await act(async () => {
			root.render(React.createElement(LotHostLikeProbe))
		})
		expect(latest.submission.phase).toBe('admitted')
		expect(renders).toBeLessThanOrEqual(4)

		for (let pass = 0; pass < 4; pass += 1) {
			mark(4)
			await act(async () => {
				root.render(React.createElement(LotHostLikeProbe))
			})
			expect(latest.submission.phase).toBe('admitted')
			expect(renders).toBe(1)
		}
		await unmount()
	})
})

describe('a delivered bid/admission settles the stepper', () => {
	test('the three steps reach lock done, publish done, validator confirmation done — and only then', async () => {
		mark(50)
		await act(async () => {
			latest.onSubmit()
			await flush()
		})
		// On the relays, waiting for the chain: the admit step is the active one.
		const waiting = bidSubmissionStepper(latest.submission)
		expect(waiting).not.toBeNull()
		expect(waiting?.steps.map((step) => [step.key, step.status])).toEqual([
			['lock', 'done'],
			['publish', 'done'],
			['admit', 'active'],
		])
		expect(waiting?.complete).toBe(false)

		// The read delivers the bid: storage, not admission — the admit step stays
		// unfinished and no admission is claimed.
		readState.bids = [BID_ROW]
		mark(4)
		await act(async () => {
			root.render(React.createElement(LotHostLikeProbe))
		})
		expect(latest.submission.phase).toBe('seen')
		const served = bidSubmissionStepper(latest.submission)
		expect(served?.steps.find((step) => step.key === 'admit')?.status).toBe('active')
		expect(served?.complete).toBe(false)

		// The chain's own fact: an admission naming this bid, and the third step is
		// done with the chain's position.
		readState.admissions = { [BID_ID]: ADMISSION }
		mark(4)
		await act(async () => {
			root.render(React.createElement(LotHostLikeProbe))
		})
		expect(latest.submission.phase).toBe('admitted')
		const settled = bidSubmissionStepper(latest.submission)
		expect(settled?.steps.map((step) => [step.key, step.status])).toEqual([
			['lock', 'done'],
			['publish', 'done'],
			['admit', 'done'],
		])
		expect(settled?.complete).toBe(true)
		expect(settled?.steps.find((step) => step.key === 'admit')?.detail).toContain('height 3490')
		await unmount()
	})
})
