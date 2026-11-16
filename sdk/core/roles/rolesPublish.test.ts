/**
 * `rolesPublish.test.ts` — `publishRoleChangeWorkflow`.
 *
 * Two things are pinned: the admins list is published before the editors list, and the publish is
 * **not atomic** — a refusal on the editors list leaves the already-published admins event in place.
 */
import { describe, expect, test } from 'bun:test'
import { createTestPublishContext } from '../testing/publishContext'
import { publishRoleChangeWorkflow } from './rolesPublish'

const pk = (char: string) => char.repeat(64)

describe('publishRoleChangeWorkflow', () => {
	test('publishes admins before editors', async () => {
		const { context, published } = createTestPublishContext()
		const outcome = await publishRoleChangeWorkflow(context, { admins: [pk('a'), pk('b')], editors: [] })

		expect(outcome.ok).toBe(true)
		expect(published.map((event) => event.tags[0])).toEqual([
			['d', 'admins'],
			['d', 'editors'],
		])
	})

	test('an admin-only plan publishes one event and reports only that event', async () => {
		const { context, published } = createTestPublishContext()
		const outcome = await publishRoleChangeWorkflow(context, { admins: [pk('a')] })

		expect(outcome.ok).toBe(true)
		expect(published).toHaveLength(1)
		expect(published[0]?.tags[0]).toEqual(['d', 'admins'])
		if (outcome.ok) expect(outcome.editorEvent).toBeUndefined()
	})

	test('not atomic: an invalid editor item is refused after the admins event is already published', async () => {
		const { context, published } = createTestPublishContext()
		const outcome = await publishRoleChangeWorkflow(context, { admins: [pk('a')], editors: ['not-a-pubkey'] })

		expect(outcome).toEqual({ ok: false, issue: 'invalid-item', item: 'not-a-pubkey', list: 'editors' })
		expect(published.map((event) => event.tags[0])).toEqual([['d', 'admins']])
	})

	test('an empty admin list is refused as admins-required, before anything is published', async () => {
		const { context, published } = createTestPublishContext()
		const outcome = await publishRoleChangeWorkflow(context, { admins: [], editors: [pk('e')] })

		expect(outcome).toEqual({ ok: false, issue: 'admins-required', list: 'admins' })
		expect(published).toHaveLength(0)
	})
})
