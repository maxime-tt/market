import { describe, expect, test } from 'bun:test'
import {
	APP_BAR_SELECTOR,
	INTRO_BEATS,
	INTRO_DURATION_MS,
	SEARCH_FIELD_SELECTOR,
	type HandoffCandidate,
	type HandoffPill,
	findHandoffField,
	introCounter,
	pickHandoffField,
	positionHandoffPill,
	rectFromField,
} from './intro'

describe('intro counters', () => {
	test('start at zero, end exactly at the measured total, and never run backwards', () => {
		expect(introCounter(108, 0)).toBe(0)
		expect(introCounter(108, 1)).toBe(108)
		const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => introCounter(108, p))
		expect(samples).toEqual([...samples].sort((a, b) => a - b))
	})

	test('an absent or zero total states nothing rather than a fabricated number', () => {
		expect(introCounter(undefined, 1)).toBe(0)
		expect(introCounter(0, 1)).toBe(0)
	})

	test('progress outside 0..1 is clamped, never overshooting the total', () => {
		expect(introCounter(50, -1)).toBe(0)
		expect(introCounter(50, 2)).toBe(50)
	})
})

// The handoff is measured against the live DOM in the app; these fakes carry the
// two things the chooser actually touches (a box, and whether it sits in the
// bar), so the decision is proven without a browser. What they do NOT prove is
// painting: that a `fixed` pill over a real field fades to an identical element
// is a compositor fact, checked by eye.
function fakeField(box: { top: number; left: number; width: number; height: number }, inBar = false): HandoffCandidate {
	return {
		getBoundingClientRect: () => box,
		closest: (selector: string) => (inBar && selector === APP_BAR_SELECTOR ? {} : null),
	}
}

const BOX = { top: 64, left: 320, width: 560, height: 70 }
const ZERO_BOX = { top: 64, left: 320, width: 0, height: 70 }

describe('intro handoff: which field to meet', () => {
	test('the page field wins over the bar field when both are mounted', () => {
		const page = fakeField(BOX)
		const bar = fakeField({ top: 12, left: 400, width: 560, height: 40 }, true)
		expect(pickHandoffField([bar, page])).toBe(page)
		expect(pickHandoffField([page])).toBe(page)
	})

	test('a lone bar field is still a real field — it is met, not skipped', () => {
		const bar = fakeField({ top: 12, left: 400, width: 560, height: 40 }, true)
		expect(pickHandoffField([bar])).toBe(bar)
	})

	test('no field mounted yields nothing to meet', () => {
		expect(pickHandoffField([])).toBeNull()
		expect(findHandoffField(null)).toBeNull()
	})

	test('the lookup queries the search-field slot and prefers the page one', () => {
		const page = fakeField(BOX)
		const bar = fakeField({ top: 12, left: 400, width: 560, height: 40 }, true)
		const doc = {
			querySelectorAll: (selector: string) => (selector === SEARCH_FIELD_SELECTOR ? [bar, page] : []),
		} as unknown as Document
		expect(findHandoffField(doc)).toBe(page)
	})
})

describe('intro handoff: the rect', () => {
	test('a mounted field yields its viewport box verbatim', () => {
		expect(rectFromField(fakeField(BOX))).toEqual(BOX)
	})

	test('an unmeasured pill or a hidden field yields no rect', () => {
		expect(rectFromField(null)).toBeNull()
		expect(rectFromField(undefined)).toBeNull()
		// A zero-width field is a field the page is hiding; meeting it would be a lie.
		expect(rectFromField(fakeField(ZERO_BOX))).toBeNull()
	})
})

describe('intro handoff: positioning the pill', () => {
	function fakePill(): HandoffPill {
		return { style: { position: '', top: '', left: '', width: '', height: '' } }
	}

	test('the pill is pinned exactly onto the field it must reveal', () => {
		const pill = fakePill()
		const doc = { querySelectorAll: () => [fakeField(BOX)] } as unknown as Document
		expect(positionHandoffPill(pill, doc)).toEqual(BOX)
		expect(pill.style).toEqual({ position: 'fixed', top: '64px', left: '320px', width: '560px', height: '70px' })
	})

	test('with nothing mounted the pill is left untouched — the caller keeps it hidden', () => {
		const pill = fakePill()
		const doc = { querySelectorAll: () => [] } as unknown as Document
		expect(positionHandoffPill(pill, doc)).toBeNull()
		expect(pill.style).toEqual({ position: '', top: '', left: '', width: '', height: '' })
		expect(positionHandoffPill(null, doc)).toBeNull()
	})
})

describe('intro storyboard', () => {
	test('the beats are ordered and inside the timeline', () => {
		const values = Object.values(INTRO_BEATS)
		expect(values).toEqual([...values].sort((a, b) => a - b))
		expect(values[0]).toBe(0)
		expect(Math.max(...values)).toBeLessThan(1)
		expect(INTRO_DURATION_MS).toBeGreaterThan(1000)
	})
})
