/**
 * `platform/web/auctions/auctionFormStorage.ts` — the seller's unfinished auction-create
 * draft, kept in `localStorage` per pubkey.
 *
 * The draft holds exactly what the kind-1440 create form holds (`AuctionFormData`): the
 * auction's `d`, the display fields, the money and time fields, and the split rows. The
 * retired 30408 draft fields (`reserve`, the anti-snipe curve, settlement grace, the
 * auditor pubkey, trusted mints, specs, shipping selections, the image list and the
 * start/end scheduling modes) are **not** read back — a draft written by the old form
 * parses into the fields that still exist and everything else is dropped. There is nothing
 * to migrate: a draft is unsent form state, and re-interpreting a retired knob as a live
 * one is exactly the bug this slice removes.
 *
 * Everything is coerced on read, never trusted: a draft is user-editable text in a shared
 * origin's storage.
 */
import type { AuctionFormData, AuctionV4vSplitRowInput } from '@platform/web/auctions/auctionPublish'

export type AuctionFormDraft = {
	pubkey: string
	formData: AuctionFormData
	savedAt: number
}

const storageKey = (pubkey: string) => `auction_form_draft_${pubkey}`

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

function str(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback
}

function num(v: unknown, fallback: number): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Split rows, keeping only complete-enough rows: a role of `validator` or `v4v`, and text. */
function splitRows(v: unknown): AuctionV4vSplitRowInput[] {
	if (!Array.isArray(v)) return []
	return v
		.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
		.map((row) => ({
			role: (str(row.role) === 'v4v' ? 'v4v' : 'validator') as AuctionV4vSplitRowInput['role'],
			recipientPubkey: str(row.recipientPubkey),
			allocationBps: str(row.allocationBps),
		}))
		.filter((row) => row.recipientPubkey !== '' || row.allocationBps !== '')
}

function validateDraft(raw: unknown): AuctionFormDraft | null {
	if (!raw || typeof raw !== 'object') return null
	const d = raw as Record<string, unknown>

	const pubkey = str(d.pubkey)
	if (!pubkey) return null

	const savedAt = num(d.savedAt, 0)
	if (!savedAt) return null

	const fd = d.formData && typeof d.formData === 'object' ? (d.formData as Record<string, unknown>) : {}

	const formData: AuctionFormData = {
		auctionId: str(fd.auctionId),
		title: str(fd.title),
		description: str(fd.description),
		imageUrl: str(fd.imageUrl),
		category: str(fd.category),
		name: str(fd.name),
		startPrice: str(fd.startPrice),
		minIncrement: str(fd.minIncrement),
		mode: str(fd.mode) === 'antisnipe' ? 'antisnipe' : 'fixed',
		windowSec: str(fd.windowSec),
		durationSec: num(fd.durationSec, 0),
		v4vSplit: splitRows(fd.v4vSplit),
	}

	return { pubkey, formData, savedAt }
}

export const saveAuctionFormDraft = (pubkey: string, draft: Omit<AuctionFormDraft, 'pubkey' | 'savedAt'>): void => {
	if (!isBrowser() || !pubkey) return
	try {
		const record: AuctionFormDraft = { ...draft, pubkey, savedAt: Date.now() }
		localStorage.setItem(storageKey(pubkey), JSON.stringify(record))
	} catch (error) {
		console.error('Failed to save auction form draft:', error)
	}
}

export const getAuctionFormDraft = (pubkey: string): AuctionFormDraft | null => {
	if (!isBrowser() || !pubkey) return null
	try {
		const raw = localStorage.getItem(storageKey(pubkey))
		if (!raw) return null
		return validateDraft(JSON.parse(raw))
	} catch (error) {
		console.error('Failed to get auction form draft:', error)
		return null
	}
}

export const clearAuctionFormDraft = (pubkey: string): void => {
	if (!isBrowser() || !pubkey) return
	try {
		localStorage.removeItem(storageKey(pubkey))
	} catch (error) {
		console.error('Failed to clear auction form draft:', error)
	}
}

export const hasAuctionFormDraft = (pubkey: string): boolean => getAuctionFormDraft(pubkey) !== null