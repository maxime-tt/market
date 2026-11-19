import { describe, expect, test } from 'bun:test'
import { chooseHomePage, homePageLoading, instanceHomeAuthors, LEGACY_HOME_PUBKEY } from './instanceHomePage'
import type { StorefrontPageResult } from './storefrontQuery'

const APP = 'a'.repeat(64)
const OWNER = 'b'.repeat(64)
const ADMIN = 'c'.repeat(64)

function result(pubkey: string, createdAt: number, enabled = true): StorefrontPageResult {
	return {
		event: { id: pubkey + createdAt, pubkey, created_at: createdAt, kind: 30024, tags: [['d', 'home']], content: '', sig: '' } as never,
		pubkey,
		page: { version: 1, enabled, root: { props: {} }, content: [{ type: 'Spacer', props: { id: 's', size: 'md' } }] } as never,
		droppedBlocks: 0,
		error: null,
	}
}

describe('instanceHomeAuthors', () => {
	test('app key, then owner, then admins, without duplicates or the legacy key', () => {
		expect(instanceHomeAuthors(APP, OWNER, [OWNER, ADMIN, LEGACY_HOME_PUBKEY])).toEqual([APP, OWNER, ADMIN])
	})

	test('tolerates config and admin list still loading', () => {
		expect(instanceHomeAuthors(undefined, undefined, undefined)).toEqual([])
	})
})

describe('chooseHomePage', () => {
	test('the newest page among the instance’s own authors wins', () => {
		const choice = chooseHomePage([result(OWNER, 100), result(ADMIN, 200)], result(LEGACY_HOME_PUBKEY, 999))
		expect(choice?.pubkey).toBe(ADMIN)
	})

	test('an own page beats a newer legacy page', () => {
		expect(chooseHomePage([result(OWNER, 1)], result(LEGACY_HOME_PUBKEY, 999))?.pubkey).toBe(OWNER)
	})

	test('falls back to the legacy page when no own author has published', () => {
		expect(chooseHomePage([undefined, undefined], result(LEGACY_HOME_PUBKEY, 5))?.pubkey).toBe(LEGACY_HOME_PUBKEY)
	})

	test('a switched-off page does not count', () => {
		expect(chooseHomePage([result(OWNER, 100, false)], undefined)).toBeNull()
	})
})

describe('homePageLoading', () => {
	const base = { configReady: true, adminsLoading: false, ownLoading: [false, false], ownChoice: false, legacyLoading: false }

	test('waits for config and the admin list before deciding', () => {
		expect(homePageLoading({ ...base, configReady: false })).toBe(true)
		expect(homePageLoading({ ...base, adminsLoading: true })).toBe(true)
	})

	test('waits while any own author is still answering', () => {
		expect(homePageLoading({ ...base, ownLoading: [false, true] })).toBe(true)
	})

	test('an own page decides it without waiting for the slow legacy read', () => {
		expect(homePageLoading({ ...base, ownChoice: true, legacyLoading: true })).toBe(false)
	})

	test('with no own page, waits for the legacy fallback', () => {
		expect(homePageLoading({ ...base, legacyLoading: true })).toBe(true)
		expect(homePageLoading(base)).toBe(false)
	})
})
