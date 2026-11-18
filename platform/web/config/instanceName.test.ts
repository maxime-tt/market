import { describe, expect, test } from 'bun:test'
import { DEFAULT_INSTANCE_NAME, resolveInstanceName } from './instanceName'

describe('resolveInstanceName', () => {
	test('prefers the display name the operator set', () => {
		expect(resolveInstanceName({ displayName: 'Plebeian Reckless', name: 'reckless' })).toBe('Plebeian Reckless')
	})

	test('falls back to the instance name when there is no display name', () => {
		expect(resolveInstanceName({ displayName: '  ', name: 'Corner Shop' })).toBe('Corner Shop')
	})

	test('falls back to the default before config resolves or before setup', () => {
		expect(resolveInstanceName(null)).toBe(DEFAULT_INSTANCE_NAME)
		expect(resolveInstanceName({})).toBe(DEFAULT_INSTANCE_NAME)
	})
})
