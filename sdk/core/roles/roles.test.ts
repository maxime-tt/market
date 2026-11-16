/**
 * `roles.test.ts` — the role parsers, predicates and projections.
 *
 * Roles are security-relevant in both directions: `isAdmin === false` locks a real admin out of
 * `/dashboard/app-settings`, and `=== true` grants publish rights. Every grant and every refusal is
 * asserted explicitly, and the fail-closed table pins the exact-match pubkey comparison (a
 * differently-cased hex pubkey is *not* an admin — see `roles.md`, "Role precedence and fail-closed").
 */
import { describe, expect, test } from 'bun:test'
import {
	getFormattedAdmins,
	getFormattedEditors,
	getUserRoleForPubkey,
	isAdmin,
	isEditor,
	isOwner,
	parseAdminSettings,
	parseEditorSettings,
} from './roles'

const APP = 'a'.repeat(64)
const ALICE = 'b'.repeat(64)
const BOB = 'c'.repeat(64)
const CAROL = 'd'.repeat(64)

const event = (tags: string[][], created_at?: number) => ({ tags, created_at })

describe('admin and editor settings', () => {
	test('admins come from p tags in order; first admin is the owner', () => {
		const ev = event(
			[
				['d', 'admins'],
				['p', ALICE],
				['e', 'x'],
				['p', ''],
				['p', BOB],
			],
			100,
		)
		const settings = parseAdminSettings(ev, APP)
		expect(settings).toEqual({ admins: [ALICE, BOB], owner: ALICE, lastUpdated: 100, event: ev })
	})

	test('owner falls back to app pubkey and lastUpdated to 0', () => {
		expect(parseAdminSettings(event([['d', 'admins']]), APP)).toMatchObject({ admins: [], owner: APP, lastUpdated: 0 })
	})

	test('missing editor event yields an empty list', () => {
		expect(parseEditorSettings(null)).toEqual({ editors: [], lastUpdated: 0, event: null })
		expect(parseEditorSettings(event([['p', CAROL]], 5))).toMatchObject({ editors: [CAROL], lastUpdated: 5 })
	})

	test('role helpers', () => {
		const admins = parseAdminSettings(
			event([
				['p', ALICE],
				['p', BOB],
			]),
			APP,
		)
		const editors = parseEditorSettings(event([['p', CAROL]]))
		expect(isOwner(admins, ALICE)).toBe(true)
		expect(isOwner(admins, BOB)).toBe(false)
		expect(isAdmin(admins, BOB)).toBe(true)
		expect(isAdmin(admins, '')).toBe(false)
		expect(isAdmin(null, ALICE)).toBe(false)
		expect(isEditor(editors, CAROL)).toBe(true)
		expect(isEditor(undefined, CAROL)).toBe(false)
		expect(getUserRoleForPubkey(admins, editors, ALICE)).toBe('owner')
		expect(getUserRoleForPubkey(admins, editors, BOB)).toBe('admin')
		expect(getUserRoleForPubkey(admins, editors, CAROL)).toBe('editor')
		expect(getUserRoleForPubkey(null, null, APP)).toBe('user')
		expect(getFormattedAdmins(admins)).toEqual([
			{ pubkey: ALICE, isOwner: true, index: 0 },
			{ pubkey: BOB, isOwner: false, index: 1 },
		])
		expect(getFormattedAdmins(null)).toEqual([])
		expect(getFormattedEditors(editors)).toEqual([{ pubkey: CAROL, role: 'editor' }])
		expect(getFormattedEditors(undefined)).toEqual([])
	})
})

describe('role precedence', () => {
	const admins = parseAdminSettings(
		event([
			['p', ALICE],
			['p', BOB],
		]),
		APP,
	)
	const editors = parseEditorSettings(
		event([
			['p', BOB],
			['p', CAROL],
		]),
	)

	test('owner beats admin beats editor beats user', () => {
		expect(getUserRoleForPubkey(admins, editors, ALICE)).toBe('owner')
		expect(getUserRoleForPubkey(admins, editors, BOB)).toBe('admin')
		expect(getUserRoleForPubkey(admins, editors, CAROL)).toBe('editor')
		expect(getUserRoleForPubkey(admins, editors, APP)).toBe('user')
	})

	test('a pubkey that is both admin and editor is reported as admin', () => {
		expect(isAdmin(admins, BOB)).toBe(true)
		expect(isEditor(editors, BOB)).toBe(true)
		expect(getUserRoleForPubkey(admins, editors, BOB)).toBe('admin')
	})
})

describe('fail-closed refusals', () => {
	const admins = parseAdminSettings(
		event([
			['p', ALICE],
			['p', BOB],
		]),
		APP,
	)
	const editors = parseEditorSettings(event([['p', CAROL]]))

	test('null, undefined, empty and empty-list settings refuse', () => {
		expect(isAdmin(null, ALICE)).toBe(false)
		expect(isAdmin(undefined, ALICE)).toBe(false)
		expect(isOwner(null, APP)).toBe(false)
		expect(isOwner(undefined, APP)).toBe(false)
		expect(isEditor(null, CAROL)).toBe(false)
		expect(isEditor(undefined, CAROL)).toBe(false)
		expect(isAdmin(parseAdminSettings(event([]), APP), APP)).toBe(false)
		expect(isEditor(parseEditorSettings(event([])), CAROL)).toBe(false)
		expect(getUserRoleForPubkey(null, undefined, ALICE)).toBe('user')
		expect(getUserRoleForPubkey(parseAdminSettings(event([]), APP), parseEditorSettings(event([])), ALICE)).toBe('user')
	})

	test('an empty pubkey refuses even when the lists are real', () => {
		expect(isAdmin(admins, '')).toBe(false)
		expect(isOwner(admins, '')).toBe(false)
		expect(isEditor(editors, '')).toBe(false)
	})

	test('a prefix of a listed pubkey is not that pubkey', () => {
		expect(isAdmin(admins, ALICE.slice(0, 63))).toBe(false)
		expect(isEditor(editors, CAROL.slice(0, 10))).toBe(false)
	})

	test('pubkey comparison is exact: a differently-cased hex pubkey is not an admin', () => {
		// `isAdmin` uses `includes` on the stored string, not `isHexPubkey`'s case-insensitive regex.
		// This pins today's behaviour; a case-insensitive compare would be a behaviour change.
		expect(isAdmin(admins, ALICE.toUpperCase())).toBe(false)
		expect(isEditor(editors, CAROL.toUpperCase())).toBe(false)
		expect(getUserRoleForPubkey(admins, editors, ALICE.toUpperCase())).toBe('user')
	})
})

describe('formatted projections', () => {
	test('the owner is flagged at the documented index only', () => {
		const admins = parseAdminSettings(
			event([
				['p', ALICE],
				['p', BOB],
			]),
			APP,
		)
		expect(getFormattedAdmins(admins)).toEqual([
			{ pubkey: ALICE, isOwner: true, index: 0 },
			{ pubkey: BOB, isOwner: false, index: 1 },
		])
	})

	test('editors map to { pubkey, role: editor }', () => {
		expect(
			getFormattedEditors(
				parseEditorSettings(
					event([
						['p', CAROL],
						['p', BOB],
					]),
				),
			),
		).toEqual([
			{ pubkey: CAROL, role: 'editor' },
			{ pubkey: BOB, role: 'editor' },
		])
	})
})
