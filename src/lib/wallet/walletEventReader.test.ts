/**
 * Tests for the adapter. No relay and no signer here: both halves are stand-ins.
 */
import { describe, expect, test } from 'bun:test'

import { createWalletEventReader, latestByCreatedAt } from './walletEventReader'
import type { WalletEventOpener, WalletEventRelay } from './walletEventReader'

const OWNER = 'a'.repeat(64)

const relay = (event: { content: string; createdAt: number } | null): WalletEventRelay => ({
	fetchLatestWalletEvent: async () => event,
})

const opener = (): WalletEventOpener => ({
	decrypt: async (sender, ciphertext) => `${sender}:${ciphertext}`,
})

describe('createWalletEventReader', () => {
	test('reads the event content verbatim', async () => {
		const reader = createWalletEventReader({ relay: relay({ content: 'CIPHER', createdAt: 1 }), opener: opener() })
		expect(await reader.readWalletEventContent(OWNER)).toBe('CIPHER')
	})

	test('no event answers null', async () => {
		const reader = createWalletEventReader({ relay: relay(null), opener: opener() })
		expect(await reader.readWalletEventContent(OWNER)).toBeNull()
	})

	test('decrypt passes the owner as the sender, because self-encryption needs it', async () => {
		const reader = createWalletEventReader({ relay: relay(null), opener: opener() })
		// the opener records the sender it was handed
		expect(await reader.decrypt(OWNER, 'CIPHER')).toBe(`${OWNER}:CIPHER`)
	})
})

describe('latestByCreatedAt', () => {
	test('takes the newest, not the first', () => {
		const newest = latestByCreatedAt([
			{ content: 'old', createdAt: 10 },
			{ content: 'new', createdAt: 99 },
			{ content: 'middle', createdAt: 50 },
		])
		expect(newest?.content).toBe('new')
	})

	test('an empty set is null', () => {
		expect(latestByCreatedAt([])).toBeNull()
	})
})
