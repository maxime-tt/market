import { describe, expect, test } from 'bun:test'
import { DEFAULT_ADMIN_APPEARANCE, parseAdminAppearance, resolveAdminMode } from './admin-appearance'

describe('parseAdminAppearance', () => {
	test('defaults to glass, teal, light', () => {
		expect(DEFAULT_ADMIN_APPEARANCE).toEqual({ style: 'glass', color: 'teal', mode: 'light' })
		expect(parseAdminAppearance(null)).toEqual(DEFAULT_ADMIN_APPEARANCE)
		expect(parseAdminAppearance('not json')).toEqual(DEFAULT_ADMIN_APPEARANCE)
	})

	test('keeps valid fields from a stored string', () => {
		expect(parseAdminAppearance(JSON.stringify({ style: 'glass', color: 'violet', mode: 'dark' }))).toEqual({
			style: 'glass',
			color: 'violet',
			mode: 'dark',
		})
	})

	test('falls back field by field', () => {
		expect(parseAdminAppearance({ style: 'brutalist', color: 'pink', mode: 'auto' })).toEqual({
			style: 'glass',
			color: 'teal',
			mode: 'auto',
		})
	})

	test('keeps Solid and Minimal now that they ship', () => {
		expect(parseAdminAppearance({ style: 'solid', color: 'ocean', mode: 'dark' })).toEqual({ style: 'solid', color: 'ocean', mode: 'dark' })
		expect(parseAdminAppearance({ style: 'minimal', color: 'teal', mode: 'light' })).toEqual({
			style: 'minimal',
			color: 'teal',
			mode: 'light',
		})
	})
})

describe('resolveAdminMode', () => {
	test('auto follows the system preference', () => {
		expect(resolveAdminMode('auto', true)).toBe('dark')
		expect(resolveAdminMode('auto', false)).toBe('light')
		expect(resolveAdminMode('dark', false)).toBe('dark')
	})
})
