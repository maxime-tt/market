import { describe, expect, test } from 'bun:test'
import { PAGE_SERIES_TAG, isValidPagePath, isValidSeriesTag, readSeriesTags, seriesForPath } from './pagePaths'

describe('pagePaths — the page-path grammar', () => {
	// T1
	test('a valid path segment is a route name and an invalid one is not', () => {
		expect(isValidPagePath('featured-13-11-2026')).toBe(true)
		expect(isValidPagePath('Featured')).toBe(false)
		expect(isValidPagePath('ab')).toBe(false)
		expect(isValidPagePath('a_b')).toBe(true)
		expect(isValidSeriesTag('featured')).toBe(true)
		expect(isValidSeriesTag('ab')).toBe(false)
	})

	// T2
	test('seriesForPath reads a dated suffix only when the prefix is a valid series tag', () => {
		expect(seriesForPath('featured-13-11-2026')).toBe('featured')
		expect(seriesForPath('featured')).toBeNull()
		// The prefix must be a valid series tag: `ab` is below the name grammar's
		// floor, so the dated name derives nothing.
		expect(seriesForPath('ab-13-11-2026')).toBeNull()
		// A prefix that *is* a valid series tag derives — the rule is about the
		// prefix's validity, not about one hardcoded series name.
		expect(seriesForPath('sale-13-11-2026')).toBe('sale')
		// The dated suffix is fixed: an ISO-shaped suffix is not the series form.
		expect(seriesForPath('featured-2026-11-13')).toBeNull()
		expect(seriesForPath('nothing-here')).toBeNull()
	})

	// T3
	test('readSeriesTags dedupes and drops an empty or invalid tag', () => {
		const tags = [
			['d', 'featured-13-11-2026'],
			[PAGE_SERIES_TAG, 'featured'],
			[PAGE_SERIES_TAG, 'sale'],
			[PAGE_SERIES_TAG, 'featured'],
			[PAGE_SERIES_TAG, ''],
			[PAGE_SERIES_TAG, 'NO'],
			['title', 'Featured'],
			[PAGE_SERIES_TAG, 'a_b'],
		]
		expect(readSeriesTags(tags)).toEqual(['featured', 'sale', 'a_b'])
		expect(readSeriesTags([])).toEqual([])
	})
})
