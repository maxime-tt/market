import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
	clearAuctionFormDraft,
	getAuctionFormDraft,
	hasAuctionFormDraft,
	saveAuctionFormDraft,
	type AuctionFormDraft,
} from './auctionFormStorage'

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const store: Record<string, string> = {}

const localStorageMock = {
	getItem: (key: string) => store[key] ?? null,
	setItem: (key: string, value: string) => {
		store[key] = value
	},
	removeItem: (key: string) => {
		delete store[key]
	},
	clear: () => {
		for (const k of Object.keys(store)) delete store[k]
	},
}

Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true, configurable: true })
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true, configurable: true })

// bun test runs every test file in the same process and shares one globalThis.
// Undo the shims above once this file's tests finish so downstream files don't
// enter browser mode and crash mid-run.
afterAll(() => {
	delete (globalThis as any).window
	delete (globalThis as any).localStorage
})

// ---------------------------------------------------------------------------
// Fixtures — the kind-1440 create form's fields, and nothing else
// ---------------------------------------------------------------------------

const PUBKEY_A = 'aaaa1111'
const PUBKEY_B = 'bbbb2222'

const baseDraft: Omit<AuctionFormDraft, 'pubkey' | 'savedAt'> = {
	formData: {
		auctionId: 'lot-1',
		title: 'Vintage Camera',
		description: 'A beautiful vintage camera in great condition.',
		imageUrl: 'https://example.com/camera.jpg',
		category: 'Photography',
		name: 'Studio Nord',
		startPrice: '5000',
		minIncrement: '100',
		mode: 'antisnipe',
		windowSec: '300',
		durationSec: 86_400,
		v4vSplit: [{ role: 'validator', recipientPubkey: 'aa'.repeat(32), allocationBps: '250' }],
	},
}

beforeEach(() => localStorageMock.clear())
afterEach(() => localStorageMock.clear())

// ---------------------------------------------------------------------------
// Save / load roundtrip
// ---------------------------------------------------------------------------

describe('save/load roundtrip', () => {
	test('restores the create form fields exactly', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const loaded = getAuctionFormDraft(PUBKEY_A)

		expect(loaded).not.toBeNull()
		expect(loaded!.formData).toEqual(baseDraft.formData)
	})

	test('savedAt is a recent timestamp', () => {
		const before = Date.now()
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const after = Date.now()
		const loaded = getAuctionFormDraft(PUBKEY_A)

		expect(loaded!.savedAt).toBeGreaterThanOrEqual(before)
		expect(loaded!.savedAt).toBeLessThanOrEqual(after)
	})

	test('overwriting a draft replaces it entirely', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		saveAuctionFormDraft(PUBKEY_A, { formData: { ...baseDraft.formData, title: 'Updated Title' } })
		expect(getAuctionFormDraft(PUBKEY_A)!.formData.title).toBe('Updated Title')
	})
})

// ---------------------------------------------------------------------------
// Malformed JSON and retired fields
// ---------------------------------------------------------------------------

describe('malformed and legacy payloads', () => {
	test('returns null for unparseable JSON', () => {
		store[`auction_form_draft_${PUBKEY_A}`] = '{not valid json'
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})

	test('returns null for JSON null', () => {
		store[`auction_form_draft_${PUBKEY_A}`] = 'null'
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})

	test('returns null when pubkey field is missing', () => {
		const { pubkey: _omit, ...withoutPubkey } = { ...baseDraft, pubkey: PUBKEY_A, savedAt: Date.now() }
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify(withoutPubkey)
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})

	test('returns null when savedAt is missing', () => {
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify({ ...baseDraft, pubkey: PUBKEY_A })
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})

	test('a 30408-era draft parses into the fields that still exist, dropping the retired ones', () => {
		// Exactly what the retired form wrote: no auctionId, no imageUrl, no mode…
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify({
			pubkey: PUBKEY_A,
			savedAt: Date.now(),
			images: [{ imageUrl: 'https://example.com/camera.jpg', imageOrder: 0 }],
			startMode: 'immediate',
			endMode: 'absolute',
			durationSeconds: 86_400,
			subCategoryInput: 'Collectibles, Film',
			formData: {
				title: 'Old draft',
				description: 'From the tag protocol',
				startingBid: '5000',
				bidIncrement: '100',
				reserve: '10000',
				antiSnipeWindowMinutes: 15,
				minBidCurveShape: 'linear',
				settlementGracePreset: '1h',
				trustedMints: ['https://mint.example.com'],
				specs: [{ key: 'Brand', value: 'Leica' }],
				shippings: [{ shippingRef: '30406:seller:standard', extraCost: '200' }],
				isNSFW: false,
			},
		})

		const loaded = getAuctionFormDraft(PUBKEY_A)!
		expect(loaded.formData.title).toBe('Old draft')
		expect(loaded.formData.description).toBe('From the tag protocol')
		// The identity and the create's own fields come back empty, not invented.
		expect(loaded.formData.auctionId).toBe('')
		expect(loaded.formData.imageUrl).toBe('')
		expect(loaded.formData.startPrice).toBe('')
		expect(loaded.formData.minIncrement).toBe('')
		expect(loaded.formData.durationSec).toBe(0)
		expect(loaded.formData.mode).toBe('fixed')
		expect(loaded.formData.v4vSplit).toEqual([])
		// Nothing retired survives on the object at all.
		for (const retired of ['reserve', 'antiSnipeWindowMinutes', 'minBidCurveShape', 'settlementGracePreset', 'trustedMints', 'specs', 'shippings', 'isNSFW']) {
			expect(Object.keys(loaded.formData)).not.toContain(retired)
		}
	})

	test('coerces an unknown mode to "fixed"', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const raw = JSON.parse(store[`auction_form_draft_${PUBKEY_A}`]!)
		raw.formData.mode = 'dutch'
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify(raw)

		expect(getAuctionFormDraft(PUBKEY_A)!.formData.mode).toBe('fixed')
	})

	test('drops split rows with no text, keeps the rest', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const raw = JSON.parse(store[`auction_form_draft_${PUBKEY_A}`]!)
		raw.formData.v4vSplit = [
			{ role: 'validator', recipientPubkey: '', allocationBps: '' },
			{ role: 'v4v', recipientPubkey: 'bb'.repeat(32), allocationBps: '100' },
		]
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify(raw)

		expect(getAuctionFormDraft(PUBKEY_A)!.formData.v4vSplit).toEqual([
			{ role: 'v4v', recipientPubkey: 'bb'.repeat(32), allocationBps: '100' },
		])
	})
})

// ---------------------------------------------------------------------------
// Cross-user safety
// ---------------------------------------------------------------------------

describe('cross-user safety', () => {
	test('drafts are isolated per pubkey', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		saveAuctionFormDraft(PUBKEY_B, { formData: { ...baseDraft.formData, title: 'User B Draft' } })

		expect(getAuctionFormDraft(PUBKEY_A)!.formData.title).toBe('Vintage Camera')
		expect(getAuctionFormDraft(PUBKEY_B)!.formData.title).toBe('User B Draft')
	})

	test('clearing one user draft does not affect the other', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		saveAuctionFormDraft(PUBKEY_B, baseDraft)

		clearAuctionFormDraft(PUBKEY_A)

		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
		expect(getAuctionFormDraft(PUBKEY_B)).not.toBeNull()
	})

	test('empty pubkey is rejected on save and returns null on load', () => {
		saveAuctionFormDraft('', baseDraft)
		expect(getAuctionFormDraft('')).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// Clear / publish
// ---------------------------------------------------------------------------

describe('clear draft behaviour', () => {
	test('getAuctionFormDraft returns null after clear', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		clearAuctionFormDraft(PUBKEY_A)
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})

	test('hasAuctionFormDraft returns false after clear', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		clearAuctionFormDraft(PUBKEY_A)
		expect(hasAuctionFormDraft(PUBKEY_A)).toBe(false)
	})

	test('clearing a non-existent draft is a no-op', () => {
		expect(() => clearAuctionFormDraft(PUBKEY_A)).not.toThrow()
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})

	test('saving a new draft after publish works correctly', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		clearAuctionFormDraft(PUBKEY_A)

		saveAuctionFormDraft(PUBKEY_A, { formData: { ...baseDraft.formData, title: 'New Auction' } })
		expect(getAuctionFormDraft(PUBKEY_A)!.formData.title).toBe('New Auction')
	})

	test('hasAuctionFormDraft returns false when nothing has been saved', () => {
		expect(hasAuctionFormDraft(PUBKEY_A)).toBe(false)
	})
})