/**
 * NWC wallet-list and balance read workflows — pin `readNwcWalletsWorkflow` and
 * `readNwcBalanceWorkflow` over fake ports, framework-free and offline (store drain D1, slice 4b).
 *
 * Port semantics (the declared D1 slice-4 delta): the wallet-list read fetches the kind-30078
 * `#l=market_user_nwc_wallets` filter, keeps the newest event, and only NIP-44-decrypts when the
 * event author IS the signer (otherwise it reads the content as plaintext). Every failure is
 * fail-soft: an empty list, not a throw. The balance read converts the NIP-47 millisats answer to
 * sats and returns null on a missing client/uri or an unreadable balance.
 */
import { describe, expect, test } from 'bun:test'
import { USER_NWC_WALLET_LIST_KIND, USER_NWC_WALLET_LIST_LABEL } from '../nwcWalletList'
import { readNwcBalanceWorkflow, readNwcWalletsWorkflow, type NwcWalletEventLike, type NwcWalletListPort } from './nwcWalletRead'

const USER = 'a'.repeat(64)

const walletEvent = (overrides: Partial<NwcWalletEventLike>): NwcWalletEventLike => ({
	content: '[]',
	created_at: 100,
	pubkey: USER,
	...overrides,
})

const wallet = (overrides: Record<string, unknown> = {}) => ({
	id: 'w1',
	name: 'Wallet One',
	nwcUri: 'nostr+walletconnect://abc',
	pubkey: 'p1',
	relays: ['wss://relay.example'],
	createdAt: 111,
	updatedAt: 222,
	...overrides,
})

type WalletCall = ['fetchEvents', unknown] | ['getSignerPubkey'] | ['decrypt', string]

/** A wallet-list port that records its calls and answers fixed values. */
function createWalletPort(
	events: NwcWalletEventLike[],
	signerPubkey: string | null,
	decrypted: string,
): NwcWalletListPort & { calls: WalletCall[] } {
	const calls: WalletCall[] = []
	return {
		calls,
		fetchEvents: async (filter) => {
			calls.push(['fetchEvents', filter])
			return events
		},
		getSignerPubkey: async () => {
			calls.push(['getSignerPubkey'])
			return signerPubkey
		},
		decrypt: async (content: string) => {
			calls.push(['decrypt', content])
			return decrypted
		},
	}
}

const WALLET_FILTER = {
	kinds: [USER_NWC_WALLET_LIST_KIND],
	authors: [USER],
	'#l': [USER_NWC_WALLET_LIST_LABEL],
}

describe('readNwcWalletsWorkflow', () => {
	test('returns the mapped wallets from the newest list event', async () => {
		const port = createWalletPort([walletEvent({ content: JSON.stringify([wallet()]) })], USER, JSON.stringify([wallet()]))

		expect(await readNwcWalletsWorkflow(port, USER)).toEqual([{ ...wallet(), storedOnNostr: true }])
	})

	test('asks for exactly the kind/#l wallet-list filter', async () => {
		const port = createWalletPort([walletEvent({ content: JSON.stringify([wallet()]) })], USER, JSON.stringify([wallet()]))

		await readNwcWalletsWorkflow(port, USER)

		expect(port.calls[0]).toEqual(['fetchEvents', WALLET_FILTER])
	})

	test('two list events: the newest wins', async () => {
		const older = walletEvent({ created_at: 100, content: JSON.stringify([wallet({ nwcUri: 'nostr+walletconnect://old' })]) })
		const newer = walletEvent({ created_at: 200, content: JSON.stringify([wallet({ nwcUri: 'nostr+walletconnect://new' })]) })
		const port = createWalletPort([older, newer], USER, newer.content)

		expect((await readNwcWalletsWorkflow(port, USER))[0]?.nwcUri).toBe('nostr+walletconnect://new')
	})

	test('decrypts with the signer when the list author is the signer, and the decrypted payload wins', async () => {
		const enc = 'ENCRYPTED'
		const decrypted = JSON.stringify([wallet({ nwcUri: 'nostr+walletconnect://decrypted' })])
		const port = createWalletPort([walletEvent({ content: enc })], USER, decrypted)

		expect((await readNwcWalletsWorkflow(port, USER))[0]?.nwcUri).toBe('nostr+walletconnect://decrypted')
		expect(port.calls).toEqual([['fetchEvents', WALLET_FILTER], ['getSignerPubkey'], ['decrypt', enc]])
	})

	test('with no signer the content is read as plaintext and decrypt is never called', async () => {
		const content = JSON.stringify([wallet({ nwcUri: 'nostr+walletconnect://plain' })])
		const port = createWalletPort([walletEvent({ content })], null, 'NOT USED')

		expect((await readNwcWalletsWorkflow(port, USER))[0]?.nwcUri).toBe('nostr+walletconnect://plain')
		expect(port.calls).toEqual([['fetchEvents', WALLET_FILTER], ['getSignerPubkey']])
	})

	test('an empty event set yields an empty list', async () => {
		const port = createWalletPort([], USER, '[]')

		expect(await readNwcWalletsWorkflow(port, USER)).toEqual([])
	})

	test('a missing user pubkey throws before any fetch', async () => {
		const port = createWalletPort([walletEvent({})], USER, '[]')

		await expect(readNwcWalletsWorkflow(port, '')).rejects.toThrow('User pubkey is required')
		expect(port.calls).toEqual([])
	})
})

describe('readNwcBalanceWorkflow', () => {
	test('converts the NIP-47 millisats answer to sats', async () => {
		const port = { getNwcClient: async () => ({ wallet: { getBalance: async () => ({ balance: 123456 }) } }) }

		const balance = await readNwcBalanceWorkflow(port, 'nostr+walletconnect://abc')

		expect(balance?.balance).toBe(123)
		expect(typeof balance?.timestamp).toBe('number')
	})

	test('an empty URI yields null without asking for a client', async () => {
		let asked = false
		const port = {
			getNwcClient: async () => {
				asked = true
				return null
			},
		}

		expect(await readNwcBalanceWorkflow(port, '')).toBeNull()
		expect(asked).toBe(false)
	})

	test('a missing client yields null', async () => {
		expect(await readNwcBalanceWorkflow({ getNwcClient: async () => null }, 'nostr+walletconnect://abc')).toBeNull()
	})

	test('a non-numeric balance is fail-soft null', async () => {
		const port = { getNwcClient: async () => ({ wallet: { getBalance: async () => ({ balance: 'oops' as unknown as number }) } }) }

		expect(await readNwcBalanceWorkflow(port, 'nostr+walletconnect://abc')).toBeNull()
	})

	test('a rejected getBalance is fail-soft null', async () => {
		const port = {
			getNwcClient: async () => ({
				wallet: {
					getBalance: async () => {
						throw new Error('relay down')
					},
				},
			}),
		}

		expect(await readNwcBalanceWorkflow(port, 'nostr+walletconnect://abc')).toBeNull()
	})
})
