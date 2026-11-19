import { describe, expect, test } from 'bun:test'
import { Amount, type Proof } from '@cashu/cashu-ts'
import {
	createCocoWalletSource,
	type CashuProofRepository,
	type StoredProof,
} from '@sdk/commerce/payments/wallet/cashuWalletSource'

const MINT = 'https://mint.example'
const OTHER_MINT = 'https://mint.other'

/** A cashu-ts v5 proof: the shape the mint issues — no `unit`, no `state`. */
const proof = (secret: string, amount: number): Proof => ({ id: '00aa', amount: Amount.from(amount), C: `02${'a'.repeat(64)}`, secret })

/** A proof as coco's repository holds it: the two fields `mapProofToCoreProof` attaches. */
const storedProof = (
	secret: string,
	amount: number,
	overrides: Partial<Pick<StoredProof, 'unit' | 'state'>> = {},
): StoredProof => ({
	...proof(secret, amount),
	unit: overrides.unit ?? 'sat',
	state: overrides.state ?? 'ready',
})

/**
 * A fake coco repository: the authority the source must mirror, and the thing every write must
 * actually reach. `ready` is what the repository would answer with.
 */
function fakeRepository(ready: Record<string, StoredProof[]> = {}) {
	const saved: Array<{ mintUrl: string; proofs: StoredProof[] }> = []
	const deleted: Array<{ mintUrl: string; secrets: string[] }> = []
	let saveError: Error | null = null
	const repository: CashuProofRepository = {
		saveProofs: async (mintUrl, proofs) => {
			if (saveError) throw saveError
			saved.push({ mintUrl, proofs })
			ready[mintUrl] = [...(ready[mintUrl] ?? []), ...proofs]
		},
		getReadyProofs: async (mintUrl) => ready[mintUrl] ?? [],
		deleteProofs: async (mintUrl, secrets) => {
			deleted.push({ mintUrl, secrets })
			ready[mintUrl] = (ready[mintUrl] ?? []).filter((entry) => !secrets.includes(entry.secret))
		},
	}
	return { repository, saved, deleted, setSaveError: (error: Error | null) => (saveError = error), ready }
}

const sourceFor = (repository: CashuProofRepository, mints: string[] = [MINT]) =>
	createCocoWalletSource({ getMints: () => mints, proofs: repository })

describe('createCocoWalletSource', () => {
	test('a fresh source holds no proofs — it fails closed until it is hydrated', () => {
		const { repository } = fakeRepository()
		const source = sourceFor(repository)

		expect(source.state.getProofs({ mint: MINT })).toEqual([])
		expect(source.state.dump()).toEqual({ proofs: [] })
	})

	test('hydrate mirrors exactly the ready proofs coco reports, per mint', async () => {
		const { repository } = fakeRepository({
			[MINT]: [storedProof('one', 5)],
			[OTHER_MINT]: [storedProof('two', 7)],
		})
		const source = sourceFor(repository, [MINT, OTHER_MINT])

		await source.hydrate()

		expect(source.state.getProofs({ mint: MINT })).toEqual([storedProof('one', 5)])
		expect(source.state.getProofs({ mint: OTHER_MINT })).toEqual([storedProof('two', 7)])
		expect(source.mints).toEqual([MINT, OTHER_MINT])
	})

	test('hydrate normalizes the mint key, so both spellings read the same proofs', async () => {
		const { repository } = fakeRepository({ [MINT]: [storedProof('one', 5)] })
		const source = sourceFor(repository, [`${MINT}/`])

		await source.hydrate()

		expect(source.state.getProofs({ mint: `${MINT}/` })).toEqual([storedProof('one', 5)])
		expect(source.state.getProofs({ mint: MINT })).toEqual([storedProof('one', 5)])
	})

	test('a cashu-ts proof is stamped unit/ready at the boundary, reaches coco, and counts toward the balance', async () => {
		const { repository, saved } = fakeRepository()
		const source = sourceFor(repository)

		await source.state.update({ mint: MINT, store: [proof('change', 3)] })

		// The exact object coco's repository needs — no caller remembered either field.
		expect(saved).toEqual([{ mintUrl: MINT, proofs: [storedProof('change', 3)] }])
		// And it is spendable: a balance read over the mirror counts it.
		expect(source.state.getProofs({ mint: MINT })).toEqual([storedProof('change', 3)])
	})

	test('a proof that already carries a unit and state is written exactly as it arrived', async () => {
		const { repository, saved } = fakeRepository()
		const source = sourceFor(repository)
		const foreign = storedProof('foreign', 4, { unit: 'usd' })
		const inflight = storedProof('inflight', 5, { state: 'inflight' })

		await source.state.update({ mint: MINT, store: [foreign, inflight] })

		// Neither field is overwritten — a re-written proof is not corrupted.
		expect(saved[0]?.proofs).toEqual([foreign, inflight])
		// Only `ready` proofs are spendable, so only the ready (foreign-unit) proof is mirrored.
		expect(source.state.getProofs({ mint: MINT })).toEqual([foreign])
	})

	test('update destroys the spent inputs in coco and drops them from the mirror', async () => {
		const { repository, deleted } = fakeRepository({ [MINT]: [storedProof('spent', 10), storedProof('kept', 4)] })
		const source = sourceFor(repository)
		await source.hydrate()

		await source.state.update({ mint: MINT, store: [proof('change', 6)], destroy: [storedProof('spent', 10)] })

		expect(deleted).toEqual([{ mintUrl: MINT, secrets: ['spent'] }])
		// The destroyed input is gone; the untouched mirrored proof stays first and the change
		// is appended.
		expect(source.state.getProofs({ mint: MINT })).toEqual([storedProof('kept', 4), storedProof('change', 6)])
	})

	test('update does not double-count a proof already mirrored', async () => {
		const { repository } = fakeRepository({ [MINT]: [storedProof('already', 2)] })
		const source = sourceFor(repository)
		await source.hydrate()

		await source.state.update({ mint: MINT, store: [proof('already', 2)] })

		expect(source.state.getProofs({ mint: MINT })).toEqual([storedProof('already', 2)])
	})

	test('a repository refusal propagates verbatim and leaves the mirror untouched — no invented money', async () => {
		const { repository, setSaveError } = fakeRepository()
		const source = sourceFor(repository)
		setSaveError(new Error('Proof with secret already exists: change'))

		await expect(source.state.update({ mint: MINT, store: [proof('change', 3)] })).rejects.toThrow(
			'Proof with secret already exists: change',
		)
		expect(source.state.getProofs({ mint: MINT })).toEqual([])
	})

	test('a mint coco cannot be read for does not abort the rest of the hydrate', async () => {
		const { repository } = fakeRepository({ [OTHER_MINT]: [storedProof('two', 7)] })
		const broken: CashuProofRepository = {
			...repository,
			getReadyProofs: async (mintUrl) => {
				if (mintUrl === MINT) throw new Error('indexeddb unavailable')
				return repository.getReadyProofs(mintUrl)
			},
		}
		const source = sourceFor(broken, [MINT, OTHER_MINT])

		await source.hydrate()

		expect(source.state.getProofs({ mint: OTHER_MINT })).toEqual([storedProof('two', 7)])
		expect(source.state.getProofs({ mint: MINT })).toEqual([])
	})

	test('the relay-wallet publish has nothing left to publish', async () => {
		const { repository } = fakeRepository()
		const source = sourceFor(repository)

		await expect(source.publish()).resolves.toBeUndefined()
	})

	test('dump flattens the mirror with its mint attached', async () => {
		const { repository } = fakeRepository({ [MINT]: [storedProof('one', 5)], [OTHER_MINT]: [storedProof('two', 7)] })
		const source = sourceFor(repository, [MINT, OTHER_MINT])
		await source.hydrate()

		expect(source.state.dump()).toEqual({
			proofs: [
				{ ...storedProof('one', 5), mint: MINT },
				{ ...storedProof('two', 7), mint: OTHER_MINT },
			],
		})
	})
})
