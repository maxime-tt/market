/**
 * Spend attribution — unit tests.
 *
 * Real cryptography throughout: every signature below is produced with `schnorr.sign` over
 * `sha256(secret)` and verified by the module itself, so a passing test means the module accepts
 * genuine NUT-11 evidence, not a mocked shape.
 */

import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
	aggregateSpendAttribution,
	attributeSpend,
	describeSpendAttribution,
	readP2pkSecretKeySets,
	readWitnessSignatures,
	toXOnlyPublicKey,
	type SpendAttribution,
} from '@/lib/cashu/spendAttribution'

// ---------- helpers -------------------------------------------------------

const encoder = new TextEncoder()

const toHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

/** Deterministic 32-byte private key from a seed string. */
const privKey = (seed: string): Uint8Array => sha256(encoder.encode(seed))

/** x-only (32-byte / 64-hex) public key for a seed. */
const xOnlyPub = (seed: string): string => toHex(schnorr.getPublicKey(privKey(seed)))

/** 33-byte compressed ('02' || x) public key for a seed. */
const compressedPub = (seed: string): string => `02${xOnlyPub(seed)}`

const messageHash = (secret: string): Uint8Array => sha256(encoder.encode(secret))

const signSecret = (secret: string, seed: string): string => toHex(schnorr.sign(messageHash(secret), privKey(seed)))

const witnessOf = (...signatures: string[]): string => JSON.stringify({ signatures })

const LOCKTIME = 1790000600

/** Build a genuine NUT-11 P2PK secret. `data` and/or `pubkeys` are lock keys, `refund` the refund keys. */
const buildSecret = (options: { nonce?: string; data?: string; pubkeys?: string[]; refund?: string[]; locktime?: number }): string => {
	const tags: unknown[] = []
	if (options.pubkeys?.length) tags.push(['pubkeys', ...options.pubkeys])
	if (options.locktime !== undefined) tags.push(['locktime', String(options.locktime)])
	if (options.refund?.length) tags.push(['refund', ...options.refund])
	return JSON.stringify([
		'P2PK',
		{
			nonce: options.nonce ?? 'attr-test-nonce',
			...(options.data === undefined ? {} : { data: options.data }),
			tags,
		},
	])
}

// ---------- toXOnlyPublicKey / forms --------------------------------------

describe('spendAttribution', () => {
	test('toXOnlyPublicKey reduces a 66-char 02-compressed form to the same x-only value as the raw x', () => {
		const x = xOnlyPub('key-forms')
		expect(x).toHaveLength(64)
		expect(compressedPub('key-forms')).toHaveLength(66)
		expect(toXOnlyPublicKey(x)).toBe(x)
		expect(toXOnlyPublicKey(`02${x}`)).toBe(x)
		expect(toXOnlyPublicKey(`03${x}`)).toBe(x)
		expect(toXOnlyPublicKey(`  02${x.toUpperCase()}  `)).toBe(x)
		expect(toXOnlyPublicKey('not-a-key')).toBeNull()
	})

	// 1
	test('a spend signed by the lock key is redeemed', () => {
		const secret = buildSecret({ data: xOnlyPub('lock'), refund: [xOnlyPub('refund')], locktime: LOCKTIME })
		const observation = {
			state: 'spent' as const,
			secret,
			witness: witnessOf(signSecret(secret, 'lock')),
			now: LOCKTIME + 10,
		}
		expect(attributeSpend(observation)).toBe('redeemed')
	})

	test('a lock key published in the compressed 02||x form matches a signature made by its x-only key', () => {
		const secret = buildSecret({ data: compressedPub('lock'), refund: [compressedPub('refund')], locktime: LOCKTIME })
		expect(attributeSpend({ state: 'spent', secret, witness: witnessOf(signSecret(secret, 'lock')) })).toBe('redeemed')
		expect(attributeSpend({ state: 'spent', secret, witness: witnessOf(signSecret(secret, 'refund')), now: LOCKTIME })).toBe('reclaimed')
	})

	// 2
	test('a spend signed by the refund key with now after locktime is reclaimed', () => {
		const secret = buildSecret({ data: xOnlyPub('lock'), refund: [xOnlyPub('refund')], locktime: LOCKTIME })
		const observation = {
			state: 'spent' as const,
			secret,
			witness: witnessOf(signSecret(secret, 'refund')),
			now: LOCKTIME + 1,
		}
		expect(attributeSpend(observation)).toBe('reclaimed')
	})

	// 3
	test('the same refund signature with now BEFORE locktime is unattributed', () => {
		const secret = buildSecret({ data: xOnlyPub('lock'), refund: [xOnlyPub('refund')], locktime: LOCKTIME })
		const signature = signSecret(secret, 'refund')
		expect(attributeSpend({ state: 'spent', secret, witness: witnessOf(signature), now: LOCKTIME - 1 })).toBe('unattributed')
		// exactly at the locktime the refund path is open again
		expect(attributeSpend({ state: 'spent', secret, witness: witnessOf(signature), now: LOCKTIME })).toBe('reclaimed')
	})

	// 4
	test('a witness with signatures matching BOTH key sets is unattributed (ambiguous, never guessed)', () => {
		const secret = buildSecret({ data: xOnlyPub('lock'), refund: [xOnlyPub('refund')], locktime: LOCKTIME })
		const observation = {
			state: 'spent' as const,
			secret,
			witness: witnessOf(signSecret(secret, 'lock'), signSecret(secret, 'refund')),
			now: LOCKTIME + 1,
		}
		expect(attributeSpend(observation)).toBe('unattributed')
	})

	// 5
	test('state spent with an empty or absent witness is unattributed', () => {
		const secret = buildSecret({ data: xOnlyPub('lock'), locktime: LOCKTIME })
		expect(attributeSpend({ state: 'spent', secret })).toBe('unattributed')
		expect(attributeSpend({ state: 'spent', secret, witness: null })).toBe('unattributed')
		expect(attributeSpend({ state: 'spent', secret, witness: '' })).toBe('unattributed')
		expect(attributeSpend({ state: 'spent', secret, witness: '   ' })).toBe('unattributed')
		expect(attributeSpend({ state: 'spent', secret, witness: '{}' })).toBe('unattributed')
		expect(attributeSpend({ state: 'spent', secret, witness: JSON.stringify({ signatures: [] }) })).toBe('unattributed')
		expect(attributeSpend({ state: 'spent', secret, witness: witnessOf('not-hex') })).toBe('unattributed')
		// a valid signature over a DIFFERENT secret proves nothing here
		const otherSecret = buildSecret({ data: xOnlyPub('lock'), nonce: 'another-nonce' })
		expect(attributeSpend({ state: 'spent', secret, witness: witnessOf(signSecret(otherSecret, 'lock')) })).toBe('unattributed')
	})

	// 6
	test('state spent with no secret, or a malformed/HTLC/non-JSON secret, is unattributed', () => {
		const witness = witnessOf(signSecret(buildSecret({ data: xOnlyPub('lock') }), 'lock'))
		expect(attributeSpend({ state: 'spent', witness })).toBe('unattributed')
		expect(attributeSpend({ state: 'spent', secret: '', witness })).toBe('unattributed')
		expect(attributeSpend({ state: 'spent', secret: '   ', witness })).toBe('unattributed')
		expect(attributeSpend({ state: 'spent', secret: 'not json', witness })).toBe('unattributed')
		expect(attributeSpend({ state: 'spent', secret: '{}', witness })).toBe('unattributed')
		expect(attributeSpend({ state: 'spent', secret: '[]', witness })).toBe('unattributed')
		expect(
			attributeSpend({
				state: 'spent',
				secret: JSON.stringify(['HTLC', { nonce: 'n', data: xOnlyPub('lock'), tags: [['locktime', String(LOCKTIME)]] }]),
				witness,
			}),
		).toBe('unattributed')
	})

	// 7
	test('unspent, pending and unknown/missing states pass through untouched', () => {
		const secret = buildSecret({ data: xOnlyPub('lock'), refund: [xOnlyPub('refund')], locktime: LOCKTIME })
		const witness = witnessOf(signSecret(secret, 'lock'))
		expect(attributeSpend({ state: 'unspent', secret, witness })).toBe('unspent')
		expect(attributeSpend({ state: 'pending', secret, witness })).toBe('pending')
		expect(attributeSpend({ state: 'unknown', secret, witness })).toBe('unknown')
		// 'missing' is not one of the three attributable states, so it degrades to 'unknown'
		expect(attributeSpend({ state: 'missing', secret, witness })).toBe('unknown')
	})

	// 8
	test('multi-key lock: a signature matching a key in the pubkeys tag is redeemed', () => {
		const lockA = xOnlyPub('lock-a')
		const lockB = compressedPub('lock-b')
		const secret = buildSecret({ data: lockA, pubkeys: [lockB], refund: [xOnlyPub('refund')], locktime: LOCKTIME })
		const keySets = readP2pkSecretKeySets(secret)
		expect(keySets.malformed).toBe(false)
		expect(keySets.lockKeys.slice().sort()).toEqual([lockA, xOnlyPub('lock-b')].sort())
		expect(attributeSpend({ state: 'spent', secret, witness: witnessOf(signSecret(secret, 'lock-b')), now: LOCKTIME + 1 })).toBe('redeemed')
		expect(attributeSpend({ state: 'spent', secret, witness: witnessOf(signSecret(secret, 'lock-a')), now: LOCKTIME + 1 })).toBe('redeemed')
		expect(attributeSpend({ state: 'spent', secret, witness: witnessOf(signSecret(secret, 'nobody')), now: LOCKTIME + 1 })).toBe(
			'unattributed',
		)
	})

	// 9
	test('readP2pkSecretKeySets on garbage returns malformed=true and empty key sets, never throwing', () => {
		const garbage = [
			'',
			'   ',
			'not json',
			'{}',
			'[]',
			'["P2PK"]',
			'["P2PK", "nope"]',
			'["P2PK", null]',
			'["P2PK", {}]',
			'["HTLC", { nonce: "n", data: "abc", tags: [["locktime", String(LOCKTIME)]] }]',
			'null',
			'42',
		]
		for (const secret of garbage) {
			const keySets = readP2pkSecretKeySets(secret)
			expect(keySets.malformed).toBe(true)
			expect(keySets.lockKeys).toEqual([])
			expect(keySets.refundKeys).toEqual([])
		}
		// a P2PK secret with keys but no locktime is still readable and carries no locktime
		const readable = readP2pkSecretKeySets(buildSecret({ data: xOnlyPub('lock') }))
		expect(readable.malformed).toBe(false)
		expect(readable.locktime).toBeUndefined()
		expect(readable.lockKeys).toEqual([xOnlyPub('lock')])
	})

	// 10
	test('readWitnessSignatures on null / not json / {} returns [] and never throws', () => {
		expect(readWitnessSignatures(null)).toEqual([])
		expect(readWitnessSignatures(undefined)).toEqual([])
		expect(readWitnessSignatures('')).toEqual([])
		expect(readWitnessSignatures('   ')).toEqual([])
		expect(readWitnessSignatures('not json')).toEqual([])
		expect(readWitnessSignatures('{}')).toEqual([])
		expect(readWitnessSignatures('[]')).toEqual([])
		expect(readWitnessSignatures(JSON.stringify({ signatures: 'nope' }))).toEqual([])
		expect(readWitnessSignatures(JSON.stringify({ signatures: ['', '  ', 7, null, 'abc'] }))).toEqual(['abc'])
	})

	// 11
	test('aggregateSpendAttribution precedence: reclaimed beats redeemed; unattributed beats redeemed; empty is unknown; all-redeemed is redeemed; redeemed+unspent is not redeemed', () => {
		expect(aggregateSpendAttribution([])).toBe('unknown')
		expect(aggregateSpendAttribution(['redeemed', 'redeemed'])).toBe('redeemed')
		expect(aggregateSpendAttribution(['redeemed', 'reclaimed'])).toBe('reclaimed')
		expect(aggregateSpendAttribution(['redeemed', 'unattributed'])).toBe('unattributed')
		expect(aggregateSpendAttribution(['reclaimed', 'unattributed'])).toBe('reclaimed')
		expect(aggregateSpendAttribution(['redeemed', 'unknown'])).toBe('unknown')
		expect(aggregateSpendAttribution(['redeemed', 'pending'])).toBe('pending')

		const mixed = aggregateSpendAttribution(['redeemed', 'unspent'])
		expect(mixed).not.toBe('redeemed')
		expect(mixed).toBe('unspent')
	})

	// 12
	test('describeSpendAttribution returns a distinct non-empty sentence for every verdict', () => {
		const verdicts: SpendAttribution[] = ['redeemed', 'reclaimed', 'unattributed', 'unspent', 'pending', 'unknown']
		const sentences = verdicts.map((verdict) => describeSpendAttribution(verdict))
		for (const sentence of sentences) {
			expect(typeof sentence).toBe('string')
			expect(sentence.trim().length).toBeGreaterThan(0)
		}
		expect(new Set(sentences).size).toBe(verdicts.length)
	})
})
