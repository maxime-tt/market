import { describe, expect, test } from 'bun:test'
import { findOrderClaimType, type OrderClaimTypeDescriptor, type OrderClaimEventLike } from './orderClaims'

interface TestClaimMarker {
	orderId: string
}

/** Both descriptors share the composed set's marker type; each answers a distinguishable marker. */
const alpha: OrderClaimTypeDescriptor<TestClaimMarker> = {
	subject: 'alpha-claim',
	parsePublicMarker: (event) =>
		event.tags.some((tag) => tag[0] === 'subject' && tag[1] === 'alpha-claim') ? { orderId: 'alpha-order' } : null,
}

const beta: OrderClaimTypeDescriptor<TestClaimMarker> = {
	subject: 'beta-claim',
	parsePublicMarker: (event) =>
		event.tags.some((tag) => tag[0] === 'subject' && tag[1] === 'beta-claim') ? { orderId: 'beta-order' } : null,
}

const bothSubjects: OrderClaimEventLike = {
	pubkey: 'a'.repeat(64),
	tags: [
		['subject', 'alpha-claim'],
		['subject', 'beta-claim'],
	],
}

const neitherSubject: OrderClaimEventLike = {
	pubkey: 'a'.repeat(64),
	tags: [['subject', 'unowned-claim']],
}

describe('findOrderClaimType', () => {
	test('resolves the first descriptor whose parser accepts the event, in list order', () => {
		// Both parsers accept `bothSubjects` and each answers its own marker, so the
		// first entry of `types` is provably the winner: the composed set is
		// deterministic and a re-order is a visible behaviour change.
		const first = findOrderClaimType(bothSubjects, [alpha, beta])
		expect(first?.type).toBe(alpha)
		expect(first?.marker).toEqual({ orderId: 'alpha-order' })

		const second = findOrderClaimType(bothSubjects, [beta, alpha])
		expect(second?.type).toBe(beta)
		expect(second?.marker).toEqual({ orderId: 'beta-order' })
	})

	test('carries the matched descriptor and its parsed marker fields', () => {
		const found = findOrderClaimType(bothSubjects, [beta, alpha])
		expect(found?.type.subject).toBe('beta-claim')
		expect(found?.marker).toEqual({ orderId: 'beta-order' })
	})

	test('answers null when every parser rejects the event', () => {
		expect(findOrderClaimType(neitherSubject, [alpha, beta])).toBeNull()
	})

	test('answers null for an empty descriptor list (no claim machinery invented)', () => {
		expect(findOrderClaimType(bothSubjects, [])).toBeNull()
	})

	test('a parser answering null is not a match even for an event naming its subject', () => {
		const strict: OrderClaimTypeDescriptor<TestClaimMarker> = {
			subject: 'alpha-claim',
			parsePublicMarker: () => null,
		}
		expect(findOrderClaimType(bothSubjects, [strict])).toBeNull()
	})
})
