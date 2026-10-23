import { describe, expect, test } from 'bun:test'
import { copyToClipboardReducer, INITIAL_COPY_STATUS, resolveCopyAttempt, type CopyToClipboardStatus } from './use-copy-to-clipboard'

/**
 * The unit suite has no DOM renderer (no jsdom/happy-dom, no
 * `@testing-library/react`), so the hook's state machine is tested directly:
 * `resolveCopyAttempt` maps a write outcome to an action, and
 * `copyToClipboardReducer` performs the transition the hook dispatches.
 * `useCopyToClipboard` is the thin React binding around these two functions.
 */

describe('resolveCopyAttempt', () => {
	test('reports success without an error', async () => {
		const calls: string[] = []
		const action = await resolveCopyAttempt('npub1abc', async (value) => {
			calls.push(value)
		})

		expect(action).toEqual({ type: 'copied' })
		expect(calls).toEqual(['npub1abc'])
	})

	test('maps a rejected clipboard write to a failed action instead of throwing', async () => {
		const denial = new Error('clipboard denied')
		const action = await resolveCopyAttempt('npub1abc', async () => {
			throw denial
		})

		expect(action).toEqual({ type: 'failed', error: denial })
	})

	test('captures a synchronous failure, e.g. a missing navigator.clipboard', async () => {
		const action = await resolveCopyAttempt('npub1abc', () => {
			throw new TypeError('navigator.clipboard is undefined')
		})

		expect(action.type).toBe('failed')
		if (action.type === 'failed') {
			expect(action.error).toBeInstanceOf(TypeError)
		}
	})

	test('normalises a nullish thrown value so the failure is still surfaceable', async () => {
		const action = await resolveCopyAttempt('npub1abc', () => {
			throw undefined
		})

		expect(action.type).toBe('failed')
		if (action.type === 'failed') {
			expect(action.error).toBeInstanceOf(Error)
		}
	})
})

describe('copyToClipboardReducer', () => {
	test('success sets copied and clears any previous error', () => {
		const withError: CopyToClipboardStatus = { copied: false, error: new Error('previous') }
		expect(copyToClipboardReducer(withError, { type: 'copied' })).toEqual({ copied: true, error: null })
	})

	test('failure clears copied and surfaces the error', () => {
		const denial = new Error('clipboard denied')
		expect(copyToClipboardReducer({ copied: true, error: null }, { type: 'failed', error: denial })).toEqual({
			copied: false,
			error: denial,
		})
	})

	test('reset returns to the idle state from copied and from failed', () => {
		expect(copyToClipboardReducer({ copied: true, error: null }, { type: 'reset' })).toEqual(INITIAL_COPY_STATUS)
		expect(copyToClipboardReducer({ copied: false, error: new Error('denied') }, { type: 'reset' })).toEqual(INITIAL_COPY_STATUS)
	})
})
