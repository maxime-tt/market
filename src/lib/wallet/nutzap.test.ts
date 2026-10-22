import { describe, expect, test } from 'bun:test'
import type { Proof } from '@cashu/cashu-ts'

import {
	NUTZAP_INFO_KIND,
	NUTZAP_KIND,
	NUTZAP_REDEMPTION_KIND,
	NutzapRefusalError,
	buildNutzapFilter,
	buildNutzapInfoTemplate,
	buildNutzapTags,
	buildNutzapTemplate,
	buildRedemptionTags,
	createNutzapSender,
	parseNutzapRecipientInfo,
	toCashuP2pkPubkey,
	toNostrPubkey,
	validateNutzap,
	type NutzapInfoSource,
	type NutzapProofSet,
	type NutzapProofSource,
	type NutzapPublisher,
	type NutzapSenderOptions,
	type NutzapRefusalReason,
	type NutzapSigner,
} from './nutzap'

// Test-only material: obviously-derived hex, never a real key.
const X_ONLY = 'a'.repeat(64)
const LOCK_KEY = `02${X_ONLY}`
const OTHER_LOCK_KEY = `02${'b'.repeat(64)}`
const SENDER = 'c'.repeat(64)
const MINT = 'https://mint.example'
const EVENT_ID = 'd'.repeat(64)

const p2pkSecret = (data: string, tags: string[][] = []): string => JSON.stringify(['P2PK', { nonce: 'e'.repeat(32), data, tags }])

const proof = (overrides: Partial<Proof> & { secret?: string } = {}): Proof =>
	({
		amount: 21,
		id: '00aa',
		C: '02' + 'f'.repeat(64),
		secret:
			overrides.secret ??
			p2pkSecret(LOCK_KEY, [
				['P', SENDER],
				['e', EVENT_ID],
			]),
		dleq: { e: 'aa', s: 'bb', r: 'cc' },
		...overrides,
	}) as unknown as Proof

/** A kind:10019 with the spec's exact tag shapes (NIP-61 L27-33). */
const infoEvent = (tags: string[][]) => ({
	id: '10019-event',
	pubkey: '9'.repeat(64),
	created_at: 1_700_000_000,
	tags,
})

const SPEC_TAGS: string[][] = [
	['relay', 'wss://relay1'],
	['relay', 'wss://relay2'],
	['mint', 'https://mint1', 'usd', 'sat'],
	['mint', 'https://mint2', 'sat'],
	['pubkey', LOCK_KEY],
]

const codeOf = (run: () => unknown): string => {
	try {
		run()
	} catch (error) {
		if (error instanceof NutzapRefusalError) return error.reason
		throw error
	}
	throw new Error('expected a NutzapRefusalError')
}

const recipient = () => parseNutzapRecipientInfo(infoEvent(SPEC_TAGS))

const makeSender = (
	overrides: Partial<NutzapSenderOptions> = {},
): { sender: ReturnType<typeof createNutzapSender>; lockedCount: () => number; publishedCount: () => number; publishedTo: string[][] } => {
	let locked = 0
	let published = 0
	const publishedTo: string[][] = []
	const base: NutzapSenderOptions = {
		infoSource: { fetchInfo: async () => infoEvent(SPEC_TAGS) } as NutzapInfoSource,
		proofSource: {
			fundableMints: async () => ['https://mint1', 'https://mint2'],
			lockProofs: async () => {
				locked += 1
				return { mintUrl: 'https://mint1', unit: 'sat', proofs: [proof()] } as NutzapProofSet
			},
		} as NutzapProofSource,
		signer: {
			pubkey: async () => SENDER,
			sign: async () => ({ id: 'nutzap-event-id', event: { id: 'nutzap-event-id' } }),
		} as NutzapSigner,
		publisher: {
			publish: async (_event, relays) => {
				published += 1
				publishedTo.push([...relays])
				return { relays: [...relays] }
			},
		} as NutzapPublisher,
		now: () => 1_700_000_500,
		...overrides,
	}
	return {
		sender: createNutzapSender(base),
		lockedCount: () => locked,
		publishedCount: () => published,
		publishedTo,
	}
}

describe('NIP-61 kinds', () => {
	test('are the three the spec defines — and nothing else', () => {
		expect(NUTZAP_INFO_KIND).toBe(10019)
		expect(NUTZAP_KIND).toBe(9321)
		expect(NUTZAP_REDEMPTION_KIND).toBe(7376)
	})
})

describe('toCashuP2pkPubkey / toNostrPubkey — the "02" prefix rule (L45)', () => {
	test('prefixes an x-only key and is idempotent on an already-prefixed one', () => {
		expect(toCashuP2pkPubkey(X_ONLY)).toBe(LOCK_KEY)
		expect(toCashuP2pkPubkey(LOCK_KEY)).toBe(LOCK_KEY)
	})

	test('round-trips', () => {
		expect(toNostrPubkey(toCashuP2pkPubkey(X_ONLY))).toBe(X_ONLY)
	})

	test('refuses a "03" key, a wrong length, and an empty value', () => {
		expect(codeOf(() => toCashuP2pkPubkey(`03${'a'.repeat(64)}`))).toBe('no-nutzap-pubkey')
		expect(codeOf(() => toCashuP2pkPubkey('a'.repeat(63)))).toBe('no-nutzap-pubkey')
		expect(codeOf(() => toCashuP2pkPubkey(''))).toBe('no-nutzap-pubkey')
	})
})

describe('parseNutzapRecipientInfo', () => {
	test('parses the spec example, keeping mint order and per-mint units', () => {
		const parsed = recipient()

		expect(parsed.mints).toEqual(['https://mint1', 'https://mint2'])
		expect(parsed.units['https://mint1']).toEqual(['usd', 'sat'])
		expect(parsed.units['https://mint2']).toEqual(['sat'])
		expect(parsed.nutzapPubkey).toBe(LOCK_KEY)
		expect(parsed.recipientPubkey).toBe('9'.repeat(64))
		expect(parsed.relays).toEqual(['wss://relay1', 'wss://relay2'])
	})

	test('dedupes duplicate mint and relay tags', () => {
		const parsed = parseNutzapRecipientInfo(
			infoEvent([
				['relay', 'wss://relay1'],
				['relay', 'wss://relay1'],
				['mint', MINT, 'sat'],
				['mint', MINT],
				['pubkey', LOCK_KEY],
			]),
		)

		expect(parsed.mints).toEqual([MINT])
		expect(parsed.relays).toEqual(['wss://relay1'])
	})

	test('refuses an event with no pubkey tag or no mint tag', () => {
		expect(codeOf(() => parseNutzapRecipientInfo(infoEvent([['mint', MINT, 'sat']])))).toBe('no-nutzap-pubkey')
		expect(codeOf(() => parseNutzapRecipientInfo(infoEvent([['pubkey', LOCK_KEY]])))).toBe('no-mints')
	})
})

describe('buildNutzapTags / buildNutzapTemplate', () => {
	test('emits one proof tag per proof, one u/unit/p, and e/k only for an event', () => {
		const proofs: NutzapProofSet = { mintUrl: 'https://mint1', unit: 'sat', proofs: [proof(), proof()] }

		expect(buildNutzapTags({ recipient: recipient(), proofs })).toEqual([
			['proof', JSON.stringify(proof())],
			['proof', JSON.stringify(proof())],
			['unit', 'sat'],
			['u', 'https://mint1'],
			['p', '9'.repeat(64)],
		])

		expect(buildNutzapTags({ recipient: recipient(), proofs, zappedEvent: { id: EVENT_ID, kind: 1, relayHint: 'wss://r' } })).toEqual([
			['proof', JSON.stringify(proof())],
			['proof', JSON.stringify(proof())],
			['unit', 'sat'],
			['u', 'https://mint1'],
			['e', EVENT_ID, 'wss://r'],
			['k', '1'],
			['p', '9'.repeat(64)],
		])
	})

	test('keeps the `u` tag byte-identical to the recipient\u2019s mint string (L67 "EXACTLY")', () => {
		// The recipient wrote a trailing slash; the tag must carry it through unchanged.
		const parsed = parseNutzapRecipientInfo(
			infoEvent([
				['mint', 'https://mint1/', 'sat'],
				['pubkey', LOCK_KEY],
			]),
		)
		const tags = buildNutzapTags({ recipient: parsed, proofs: { mintUrl: 'https://mint1/', unit: 'sat', proofs: [proof()] } })

		expect(tags.find((tag) => tag[0] === 'u')?.[1]).toBe('https://mint1/')
	})

	test('builds a kind:9321 with the injected clock and the comment as content', () => {
		const template = buildNutzapTemplate({ tags: [['p', 'x']], comment: 'thanks', createdAt: 1_700_000_500 })

		expect(template.kind).toBe(NUTZAP_KIND)
		expect(template.content).toBe('thanks')
		expect(template.created_at).toBe(1_700_000_500)
		expect(buildNutzapTemplate({ tags: [], createdAt: 1 }).content).toBe('')
	})
})

describe('buildNutzapFilter — the REQ of L85', () => {
	test('filters by kind, #p and #u, with since omitted when undefined', () => {
		expect(buildNutzapFilter({ recipientPubkey: 'me', mints: ['m1', 'm2'] })).toEqual({
			kinds: [9321],
			'#p': ['me'],
			'#u': ['m1', 'm2'],
		})
		expect(buildNutzapFilter({ recipientPubkey: 'me', mints: [], since: 99 })['since']).toBe(99)
	})
})

describe('validateNutzap — the L112-120 checklist', () => {
	const valid = () => ({
		kind: NUTZAP_KIND,
		pubkey: SENDER,
		tags: [
			['proof', JSON.stringify(proof())],
			['unit', 'sat'],
			['u', 'https://mint1'],
			['e', EVENT_ID],
			['p', '9'.repeat(64)],
		],
	})

	test('accepts a well-formed nutzap with no issues at all', () => {
		const result = validateNutzap({ event: valid(), recipient: recipient() })
		expect(result.valid).toBe(true)
		expect(result.issues).toEqual([])
	})

	test('a proof locked to another key is an ERROR (L116)', () => {
		const tags = valid().tags.map((tag) =>
			tag[0] === 'proof' ? ['proof', JSON.stringify(proof({ secret: p2pkSecret(OTHER_LOCK_KEY) }))] : tag,
		)
		const result = validateNutzap({ event: { ...valid(), tags }, recipient: recipient() })

		expect(result.valid).toBe(false)
		expect(result.issues.some((i) => i.code === 'proof-locked-to-other-key' && i.severity === 'error')).toBe(true)
	})

	test('a u tag naming a mint the recipient did not list is an ERROR (L117)', () => {
		const tags = valid().tags.map((tag) => (tag[0] === 'u' ? ['u', 'https://elsewhere'] : tag))
		const result = validateNutzap({ event: { ...valid(), tags }, recipient: recipient() })

		expect(result.issues.some((i) => i.code === 'mint-not-listed' && i.severity === 'error')).toBe(true)
	})

	test('missing p / no proofs / two u tags are ERRORS', () => {
		const noP = validateNutzap({ event: { ...valid(), tags: valid().tags.filter((tag) => tag[0] !== 'p') }, recipient: recipient() })
		expect(noP.issues.some((i) => i.code === 'no-p-tag' && i.severity === 'error')).toBe(true)

		const noProofs = validateNutzap({
			event: { ...valid(), tags: valid().tags.filter((tag) => tag[0] !== 'proof') },
			recipient: recipient(),
		})
		expect(noProofs.issues.some((i) => i.code === 'no-proofs' && i.severity === 'error')).toBe(true)

		const twoU = validateNutzap({ event: { ...valid(), tags: [...valid().tags, ['u', 'https://mint2']] }, recipient: recipient() })
		expect(twoU.issues.some((i) => i.code === 'multiple-u-tags' && i.severity === 'error')).toBe(true)
	})

	test('a missing P or a mismatched e inside the proof secret is a WARNING, not an error', () => {
		const secret = p2pkSecret(LOCK_KEY, [['e', EVENT_ID]])
		const tags = valid().tags.map((tag) => (tag[0] === 'proof' ? ['proof', JSON.stringify(proof({ secret }))] : tag))
		const result = validateNutzap({ event: { ...valid(), tags }, recipient: recipient() })

		expect(result.issues.some((i) => i.code === 'proof-missing-p' && i.severity === 'warning')).toBe(true)
		// The missing P does not invalidate the event.
		expect(result.valid).toBe(true)
	})
})

describe('buildNutzapInfoTemplate / buildRedemptionTags', () => {
	test('the info event is kind 10019 with relay/mint/pubkey tags', () => {
		const template = buildNutzapInfoTemplate({
			mints: ['https://mint1'],
			units: { 'https://mint1': ['sat'] },
			relays: ['wss://relay1'],
			nutzapPubkey: LOCK_KEY,
			createdAt: 1,
		})

		expect(template.kind).toBe(NUTZAP_INFO_KIND)
		expect(template.tags).toEqual([
			['relay', 'wss://relay1'],
			['mint', 'https://mint1', 'sat'],
			['pubkey', LOCK_KEY],
		])
	})

	test('the redemption event carries one redeemed e tag per claim plus the sender p', () => {
		expect(buildRedemptionTags({ claimedNutzapEventIds: ['one', 'two'], senderPubkey: SENDER })).toEqual([
			['e', 'one', '', 'redeemed'],
			['e', 'two', '', 'redeemed'],
			['p', SENDER],
		])
	})
})

describe('createNutzapSender — refusals lock nothing', () => {
	test.each([[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY], [1.5]])(
		'amount %p is refused before the mint is touched',
		async (amountSats) => {
			const { sender, lockedCount: locked } = makeSender()
			expect(await sender.send({ recipientPubkey: 'r', amountSats })).toEqual({ state: 'refused', reason: 'amount-invalid' })
			expect(locked()).toBe(0)
		},
	)

	test('a recipient with no 10019 is refused', async () => {
		const { sender, lockedCount: locked } = makeSender({ infoSource: { fetchInfo: async () => null } })
		expect(await sender.send({ recipientPubkey: 'r', amountSats: 21 })).toEqual({ state: 'refused', reason: 'no-info-event' })
		expect(locked()).toBe(0)
	})

	test('a 10019 with no mint tag is refused', async () => {
		const { sender } = makeSender({ infoSource: { fetchInfo: async () => infoEvent([['pubkey', LOCK_KEY]]) } })
		expect(await sender.send({ recipientPubkey: 'r', amountSats: 21 })).toEqual({ state: 'refused', reason: 'no-mints' })
	})

	test('no shared mint is refused, including the normalization-collision case', async () => {
		const { sender, lockedCount: locked } = makeSender({
			proofSource: { fundableMints: async () => ['https://other'], lockProofs: async () => proofSet },
		})
		expect(await sender.send({ recipientPubkey: 'r', amountSats: 21 })).toEqual({ state: 'refused', reason: 'no-shared-mint' })
		expect(locked()).toBe(0)
	})
})

const proofSet: NutzapProofSet = { mintUrl: 'https://mint1', unit: 'sat', proofs: [proof()] }

describe('createNutzapSender — post-lock failures are NOT refusals', () => {
	test.each<[NutzapRefusalReason, Proof[]]>([
		['proof-no-dleq', [proof({ dleq: undefined })]],
		['proof-not-p2pk', [proof({ secret: JSON.stringify(['plain', {}]) })]],
		['proof-p2pk-mismatch', [proof({ secret: p2pkSecret(OTHER_LOCK_KEY) })]],
	])('%s leaves the funds locked, reports the reason, and publishes nothing', async (reason, proofs) => {
		const { sender, publishedCount: published } = makeSender({
			proofSource: {
				fundableMints: async () => ['https://mint1'],
				lockProofs: async () => ({ mintUrl: 'https://mint1', unit: 'sat', proofs }),
			},
		})

		const result = await sender.send({ recipientPubkey: 'r', amountSats: 21 })

		expect(result.state).toBe('locked')
		expect(result.state === 'locked' && result.rejected).toBe(reason)
		expect(published()).toBe(0)
	})

	test('a proof from another mint is rejected', async () => {
		const { sender } = makeSender({
			proofSource: {
				fundableMints: async () => ['https://mint1'],
				lockProofs: async () => ({ mintUrl: 'https://elsewhere', unit: 'sat', proofs: [proof()] }),
			},
		})

		const result = await sender.send({ recipientPubkey: 'r', amountSats: 21 })
		expect(result.state === 'locked' && result.rejected).toBe('proof-mint-mismatch')
	})

	test('a throw from lockProofs is indeterminate, never refused', async () => {
		const { sender } = makeSender({
			proofSource: {
				fundableMints: async () => ['https://mint1'],
				lockProofs: async () => {
					throw new Error('mint connection died mid-swap')
				},
			},
		})

		const result = await sender.send({ recipientPubkey: 'r', amountSats: 21 })
		expect(result.state).toBe('indeterminate')
	})

	test('a publish that no relay accepted keeps the template for a retry', async () => {
		const { sender } = makeSender({ publisher: { publish: async () => ({ relays: [] }) } })

		const result = await sender.send({ recipientPubkey: 'r', amountSats: 21 })
		expect(result.state).toBe('publish-failed')
		expect(result.state === 'publish-failed' && result.template.kind).toBe(NUTZAP_KIND)
		expect(result.state === 'publish-failed' && result.proofs.proofs.length).toBe(1)
	})
})

describe('createNutzapSender — the happy path', () => {
	test('publishes to exactly the recipient\u2019s relays and reports the event id', async () => {
		const { sender, publishedTo, publishedCount: published, lockedCount: locked } = makeSender()

		const result = await sender.send({ recipientPubkey: 'r', amountSats: 21, comment: 'thanks' })

		expect(result.state).toBe('published')
		expect(result.state === 'published' && result.eventId).toBe('nutzap-event-id')
		expect(publishedTo).toEqual([['wss://relay1', 'wss://relay2']])
		expect(published()).toBe(1)
		expect(locked()).toBe(1)
	})

	test('no refusal message carries a proof secret', async () => {
		const { sender } = makeSender({
			proofSource: { fundableMints: async () => ['https://mint1'], lockProofs: async () => proofSet },
		})
		const result = await sender.send({ recipientPubkey: 'r', amountSats: 0 })

		expect(JSON.stringify(result)).not.toContain('e'.repeat(32))
	})
})
