import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CopyButton, reportCopyButtonError, resolveCopyButtonAriaLabel, resolveCopyButtonState } from './copy-button'

/**
 * Static-markup assertions for the render output plus direct tests of the pure
 * seams the component uses (`resolveCopyButtonState`, `resolveCopyButtonAriaLabel`,
 * `reportCopyButtonError`). The interactive click path runs in the widget-book
 * Playwright spec, which has a real browser and clipboard API.
 */

describe('CopyButton render', () => {
	test('icon-only button always has an accessible name', () => {
		const markup = renderToStaticMarkup(createElement(CopyButton, { value: 'npub1abc' }))

		expect(markup).toContain('data-slot="copy-button"')
		expect(markup).toContain('aria-label="Copy to clipboard"')
		expect(markup).toContain('lucide-copy')
		expect(markup).toContain('data-copied="false"')
		expect(markup).not.toContain('Copied!')
	})

	test('accepts a custom accessible name without a visible label', () => {
		const markup = renderToStaticMarkup(createElement(CopyButton, { value: 'npub1abc', ariaLabel: 'Copy npub' }))

		expect(markup).toContain('aria-label="Copy npub"')
		expect(markup).not.toContain('>Copy<')
	})

	test('renders a visible label and defaults the size to sm', () => {
		const markup = renderToStaticMarkup(createElement(CopyButton, { value: 'npub1abc', label: 'Copy URL' }))

		expect(markup).toContain('aria-label="Copy URL"')
		expect(markup).toContain('data-size="sm"')
		expect(markup).toContain('Copy URL')
	})

	test('merges the host className and forwards the size and variant', () => {
		const markup = renderToStaticMarkup(
			createElement(CopyButton, { value: 'npub1abc', className: 'shrink-0 host-copy', variant: 'ghost', size: 'icon-sm' }),
		)

		expect(markup).toContain('host-copy')
		expect(markup).toContain('data-variant="ghost"')
		expect(markup).toContain('data-size="icon-sm"')
	})
})

describe('resolveCopyButtonState', () => {
	test('shows Copy with the given label before success', () => {
		expect(resolveCopyButtonState({ copied: false, label: 'Copy' })).toEqual({ icon: 'copy', label: 'Copy' })
	})

	test('swaps to Check and "Copied!" after success', () => {
		expect(resolveCopyButtonState({ copied: true, label: 'Copy' })).toEqual({ icon: 'check', label: 'Copied!' })
	})

	test('stays icon-only when no label is given', () => {
		expect(resolveCopyButtonState({ copied: false })).toEqual({ icon: 'copy', label: undefined })
		expect(resolveCopyButtonState({ copied: true })).toEqual({ icon: 'check', label: undefined })
	})
})

describe('resolveCopyButtonAriaLabel', () => {
	test('prefers the explicit ariaLabel', () => {
		expect(resolveCopyButtonAriaLabel({ ariaLabel: 'Copy npub', label: 'Copy' })).toBe('Copy npub')
	})

	test('falls back to the visible label', () => {
		expect(resolveCopyButtonAriaLabel({ label: 'Copy URL' })).toBe('Copy URL')
	})

	test('never returns an empty name for an icon-only button', () => {
		expect(resolveCopyButtonAriaLabel({})).toBe('Copy to clipboard')
	})
})

describe('reportCopyButtonError', () => {
	test('reports a failure to the host', () => {
		const reported: unknown[] = []
		const denial = new Error('clipboard denied')

		expect(reportCopyButtonError(null, denial, (error) => reported.push(error))).toBe(denial)
		expect(reported).toEqual([denial])
	})

	test('does not report the same error twice', () => {
		const reported: unknown[] = []
		const denial = new Error('clipboard denied')

		reportCopyButtonError(null, denial, (error) => reported.push(error))
		reportCopyButtonError(denial, denial, (error) => reported.push(error))
		expect(reported).toEqual([denial])
	})

	test('clears the last-reported error on reset so a later identical failure is reported', () => {
		const reported: unknown[] = []
		const denial = new Error('clipboard denied')

		reportCopyButtonError(null, denial, (error) => reported.push(error))
		expect(reportCopyButtonError(denial, null, (error) => reported.push(error))).toBeNull()
		reportCopyButtonError(null, denial, (error) => reported.push(error))
		expect(reported).toEqual([denial, denial])
	})

	test('ignores a nullish error', () => {
		const reported: unknown[] = []
		expect(reportCopyButtonError(null, null, (error) => reported.push(error))).toBeNull()
		expect(reportCopyButtonError(null, undefined, (error) => reported.push(error))).toBeNull()
		expect(reported).toEqual([])
	})
})
