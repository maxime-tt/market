import { describe, expect, test } from 'bun:test'
import { nutzapBlocker } from './ZapDialogHost'

const RECEIVING: Parameters<typeof nutzapBlocker>[2] = {
	canReceiveZaps: true,
	hasNip57: true,
	hasNip61: true,
}

describe('nutzapBlocker', () => {
	test('null when the amount is valid, a wallet exists and the recipient accepts NIP-61', () => {
		expect(nutzapBlocker(true, true, RECEIVING)).toBeNull()
	})
	test('invalid amount is blocked first', () => {
		expect(nutzapBlocker(false, true, RECEIVING)).toBe('Please enter a valid zap amount')
	})
	test('a missing NIP-60 wallet blocks before the capability check', () => {
		expect(nutzapBlocker(true, false, RECEIVING)).toBe('NIP-60 wallet is required for nutzaps')
	})
	test('a recipient without NIP-61 blocks the nutzap', () => {
		expect(nutzapBlocker(true, true, { ...RECEIVING, hasNip61: false })).toBe('This user does not accept nutzaps')
	})
})
