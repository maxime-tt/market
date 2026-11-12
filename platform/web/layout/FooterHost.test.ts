import { describe, expect, test } from 'bun:test'
import type { PublicAppConfig } from '@sdk/config/instance-config'
import { footerPropsFromConfig } from './FooterHost'

/** Builds a config fixture with only the fields the adapter reads. */
const config = (partial: Partial<PublicAppConfig>) => partial as unknown as PublicAppConfig

describe('footerPropsFromConfig', () => {
	test('resolves the display identity and the support contact fallback chain', () => {
		// (a) a set displayName is used as-is
		expect(footerPropsFromConfig(config({ displayName: 'Plebeian Market' })).displayName).toBe('Plebeian Market')
		// (b) an empty displayName falls back to name
		expect(footerPropsFromConfig(config({ name: 'X', displayName: '' })).displayName).toBe('X')
		// (c) an undefined config falls back to the generic marketplace name
		expect(footerPropsFromConfig(undefined).displayName).toBe('Marketplace')
		// (d) supportContact falls back to contactEmail
		expect(footerPropsFromConfig(config({ contactEmail: 'a@b.c' })).supportContact).toBe('a@b.c')
	})
})
