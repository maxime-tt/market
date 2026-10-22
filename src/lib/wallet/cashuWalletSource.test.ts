import { describe, expect, test } from 'bun:test'
import { Amount, type Proof } from '@cashu/cashu-ts'
import { createCocoWalletSource, type CashuProofRepository } from './cashuWalletSource'

const MINT = 'https://mint.example'
const OTHER_MINT = 'https://mint.other'

const proof = (secret: string, amount: number): Proof => ({ id: '00aa', amount: Amount.from(amount), C: `02${'a'.repeat(64)}`, secret })

/**
 * A fake coco repository: the authority the source must mirror, and the thing every write must
 * actually reach. `ready` is what the repository would answer with.
 */
function fakeRepository(ready: Record<string, Proof[]> = {}) {
	const saved: Array<{ mintUrl: string; proofs: Proof[] }> = []
	const deleted: Array<{ mintUrl: string; secrets: string[] }> = []
	let failSave = false
	const repository: CashuProofRepository = {
		saveProofs: async (mintUrl, proofs) => {
			if (failSave) throw new Error('indexeddb unavailable')
			saved.push({ mintUrl, proofs })
			ready[mintUrl] = [...(ready[mintUrl] ?? []), ...proofs]
		},
		getReadyProofs: async (mintUrl) => ready[mintUrl] ?? [],
		deleteProofs: async (mintUrl, secrets) => {
			deleted.push({ mintUrl, secrets })
			ready[mintUrl] = (ready[mintUrl] ?? []).filter((entry) => !secrets.includes(entry.secret))
		},
	}
	return { repository, saved, deleted, failed: () => failSave, setFailSave: (value: boolean) => (failSave = value), ready }
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
			[MINT]: [proof('one', 5)],
			[OTHER_MINT]: [proof('two', 7)],
		})
		const source = sourceFor(repository, [MINT, OTHER_MINT])

		await source.hydrate()

		expect(source.state.getProofs({ mint: MINT })).toEqual([proof('one', 5)])
		expect(source.state.getProofs({ mint: OTHER_MINT })).toEqual([proof('two', 7)])
		expect(source.mints).toEqual([MINT, OTHER_MINT])
	})

	test('hydrate normalizes the mint key, so both spellings read the same proofs', async () => {
		const { repository } = fakeRepository({ [MINT]: [proof('one', 5)] })
		const source = sourceFor(repository, [`${MINT}/`])

		await source.hydrate()

		expect(source.state.getProofs({ mint: `${MINT}/` })).toEqual([proof('one', 5)])
		expect(source.state.getProofs({ mint: MINT })).toEqual([proof('one', 5)])
	})

	test('update writes through to coco and mirrors the written proofs', async () => {
		const { repository, saved } = fakeRepository()
		const source = sourceFor(repository)

		await source.state.update({ mint: MINT, store: [proof('change', 3)] })

		expect(saved).toEqual([{ mintUrl: MINT, proofs: [proof('change', 3)] }])
		expect(source.state.getProofs({ mint: MINT })).toEqual([proof('change', 3)])
	})

	test('update destroys the spent inputs in coco and drops them from the mirror', async () => {
		const { repository, deleted } = fakeRepository({ [MINT]: [proof('spent', 10), proof('kept', 4)] })
		const source = sourceFor(repository)
		await source.hydrate()

		await source.state.update({ mint: MINT, store: [proof('change', 6)], destroy: [proof('spent', 10)] })

		expect(deleted).toEqual([{ mintUrl: MINT, secrets: ['spent'] }])
		// The destroyed input is gone; the untouched mirrored proof stays first and the change
		// is appended.
		expect(source.state.getProofs({ mint: MINT })).toEqual([proof('kept', 4), proof('change', 6)])
	})

	test('update does not double-count a proof already mirrored', async () => {
		const { repository } = fakeRepository({ [MINT]: [proof('already', 2)] })
		const source = sourceFor(repository)
		await source.hydrate()

		await source.state.update({ mint: MINT, store: [proof('already', 2)] })

		expect(source.state.getProofs({ mint: MINT })).toEqual([proof('already', 2)])
	})

	test('a failed save rejects and leaves the mirror untouched — no invented money', async () => {
		const { repository, setFailSave } = fakeRepository()
		const source = sourceFor(repository)
		setFailSave(true)

		await expect(source.state.update({ mint: MINT, store: [proof('change', 3)] })).rejects.toThrow('indexeddb unavailable')
		expect(source.state.getProofs({ mint: MINT })).toEqual([])
	})

	test('a mint coco cannot be read for does not abort the rest of the hydrate', async () => {
		const { repository } = fakeRepository({ [OTHER_MINT]: [proof('two', 7)] })
		const broken: CashuProofRepository = {
			...repository,
			getReadyProofs: async (mintUrl) => {
				if (mintUrl === MINT) throw new Error('indexeddb unavailable')
				return repository.getReadyProofs(mintUrl)
			},
		}
		const source = sourceFor(broken, [MINT, OTHER_MINT])

		await source.hydrate()

		expect(source.state.getProofs({ mint: OTHER_MINT })).toEqual([proof('two', 7)])
		expect(source.state.getProofs({ mint: MINT })).toEqual([])
	})

	test('the relay-wallet publish has nothing left to publish', async () => {
		const { repository } = fakeRepository()
		const source = sourceFor(repository)

		await expect(source.publish()).resolves.toBeUndefined()
	})

	test('dump flattens the mirror with its mint attached', async () => {
		const { repository } = fakeRepository({ [MINT]: [proof('one', 5)], [OTHER_MINT]: [proof('two', 7)] })
		const source = sourceFor(repository, [MINT, OTHER_MINT])
		await source.hydrate()

		expect(source.state.dump()).toEqual({
			proofs: [
				{ ...proof('one', 5), mint: MINT },
				{ ...proof('two', 7), mint: OTHER_MINT },
			],
		})
	})
})
