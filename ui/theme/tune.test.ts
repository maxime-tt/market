import { describe, expect, test } from 'bun:test'
import { DEFAULT_TUNE, TUNE_CONTROLS, surpriseTune, tuneTokens } from './tune'

describe('tuneTokens', () => {
	test('maps every tune setting to its CSS custom property', () => {
		expect(tuneTokens({ radius: 14, shadow: 0.5, glass: 0.25, spacing: 1.1, texture: 0.6, handmade: 0.3 })).toEqual({
			'--radius': '14px',
			'--shadow-scale': '0.5',
			'--glass': '0.25',
			'--gap': '1.1',
			'--grain': '0.6',
			'--handmade': '0.3',
		})
	})

	test('the neutral defaults reproduce the current rendering', () => {
		expect(tuneTokens(DEFAULT_TUNE)).toEqual({
			'--radius': '4px',
			'--shadow-scale': '1',
			'--glass': '0',
			'--gap': '1',
			'--grain': '0',
			'--handmade': '0',
		})
	})
})

describe('TUNE_CONTROLS', () => {
	test('covers every setting exactly once', () => {
		expect(TUNE_CONTROLS.map((control) => control.key).sort()).toEqual((Object.keys(DEFAULT_TUNE) as (keyof typeof DEFAULT_TUNE)[]).sort())
	})

	test('every default is inside its control range', () => {
		for (const control of TUNE_CONTROLS) {
			expect(DEFAULT_TUNE[control.key]).toBeGreaterThanOrEqual(control.min)
			expect(DEFAULT_TUNE[control.key]).toBeLessThanOrEqual(control.max)
		}
	})
})

describe('surpriseTune', () => {
	test('stays inside every control range', () => {
		for (const random of [0, 0.25, 0.5, 0.75, 1]) {
			const nudged = surpriseTune(DEFAULT_TUNE, () => random)
			for (const control of TUNE_CONTROLS) {
				expect(nudged[control.key]).toBeGreaterThanOrEqual(control.min)
				expect(nudged[control.key]).toBeLessThanOrEqual(control.max)
			}
		}
	})

	test('rounds radius to whole px and keeps the other values to two decimals', () => {
		const nudged = surpriseTune(DEFAULT_TUNE, () => 0.42)
		expect(Number.isInteger(nudged.radius)).toBe(true)
		expect(nudged.shadow.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2)
	})
})
