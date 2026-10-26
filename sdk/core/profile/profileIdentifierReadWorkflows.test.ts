/**
 * Profile-identifier read workflow — pins `readProfileWorkflow` over a fake `ProfileReadPort`,
 * framework-free and offline (store drain D1, slice 4b).
 *
 * Port semantics (the declared D1 slice-4 delta): the identifier is validated BEFORE any I/O; the
 * read then calls `fetchUser(identifier)` and, only when a user comes back, `fetchProfile(user)`.
 * A genuine absence (`fetchProfile` resolving null) is a successful `{ profile: null, user }`, while
 * a rejection from either port (or the timeout) propagates as an error. The default timeout is
 * 8000 ms; a caller may inject a smaller value, which is how the timeout path is exercised offline.
 */
import { describe, expect, test } from 'bun:test'
import { readProfileWorkflow, type ProfileReadPort } from './profileRead'

const ALICE = 'a'.repeat(64)

interface FakeUser {
	id: string
}

interface FakeProfile {
	name: string
}

type Call = ['fetchUser', string] | ['fetchProfile', FakeUser]

/** A port that records the identity and order of the calls it receives. */
function createPort(
	user: FakeUser | null,
	profile: FakeProfile | null,
	options: { rejectUser?: Error; hang?: boolean } = {},
): ProfileReadPort<FakeUser, FakeProfile> & { calls: Call[] } {
	const calls: Call[] = []
	return {
		calls,
		fetchUser: async (identifier: string) => {
			calls.push(['fetchUser', identifier])
			if (options.hang) return await new Promise<FakeUser>(() => {})
			if (options.rejectUser) throw options.rejectUser
			return user
		},
		fetchProfile: async (fetchedUser: FakeUser) => {
			calls.push(['fetchProfile', fetchedUser])
			return profile
		},
	}
}

describe('readProfileWorkflow', () => {
	test('returns the user and the profile when both resolve', async () => {
		const port = createPort({ id: 'u1' }, { name: 'Alice' })

		expect(await readProfileWorkflow(port, ALICE)).toEqual({ profile: { name: 'Alice' }, user: { id: 'u1' } })
	})

	test('a genuine absence (fetchProfile null) is a successful null profile, not an error', async () => {
		const port = createPort({ id: 'u1' }, null)

		expect(await readProfileWorkflow(port, ALICE)).toEqual({ profile: null, user: { id: 'u1' } })
	})

	test('a fetchUser that resolves null is a successful null user, with no fetchProfile call', async () => {
		const port = createPort(null, { name: 'Alice' })

		expect(await readProfileWorkflow(port, ALICE)).toEqual({ profile: null, user: null })
		expect(port.calls).toEqual([['fetchUser', ALICE]])
	})

	test('calls fetchUser then fetchProfile, with the identifier and the fetched user', async () => {
		const user = { id: 'u1' }
		const port = createPort(user, { name: 'Alice' })

		await readProfileWorkflow(port, ALICE)

		expect(port.calls).toEqual([
			['fetchUser', ALICE],
			['fetchProfile', user],
		])
	})

	test('rejects a malformed identifier before any I/O', async () => {
		const port = createPort({ id: 'u1' }, { name: 'Alice' })

		expect(await readProfileWorkflow(port, 'not an identifier')).toEqual({ profile: null, user: null })
		expect(port.calls).toEqual([])
	})

	test('a transient fetchUser rejection propagates', async () => {
		const port = createPort(null, null, { rejectUser: new Error('relay down') })

		await expect(readProfileWorkflow(port, ALICE)).rejects.toThrow('relay down')
	})

	test('the timeout path rejects when the port hangs (default is 8000 ms)', async () => {
		const port = createPort(null, null, { hang: true })

		await expect(readProfileWorkflow(port, ALICE, 10)).rejects.toThrow('Profile fetch timed out')
	})
})
