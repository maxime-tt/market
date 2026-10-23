import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { applyThemeTokens, ThemeMigrationWrapper } from './theme-migration-wrapper'

function fakeElement() {
	const properties = new Map<string, string>()
	const element = {
		style: {
			setProperty: (key: string, value: string) => properties.set(key, value),
			removeProperty: (key: string) => properties.delete(key),
		},
	} as unknown as HTMLElement
	return { element, properties }
}

describe('ThemeMigrationWrapper', () => {
	test('applies the scoped class and dynamic tokens to the subtree', () => {
		const markup = renderToStaticMarkup(createElement(ThemeMigrationWrapper, { theme: { '--primary': 'oklch(0.6 0.2 250)' } }, 'content'))

		expect(markup).toContain('theme-new')
		expect(markup).toContain('--primary:oklch(0.6 0.2 250)')
		expect(markup).toContain('content')
	})

	test('merges an external className without dropping the scope', () => {
		const markup = renderToStaticMarkup(createElement(ThemeMigrationWrapper, { className: 'p-4' }, 'content'))

		expect(markup).toContain('theme-new')
		expect(markup).toContain('p-4')
	})

	test('ignores keys that are not CSS custom properties', () => {
		const markup = renderToStaticMarkup(
			createElement(ThemeMigrationWrapper, { theme: { '--card': 'white', color: 'red' } as Record<`--${string}`, string> }, 'content'),
		)

		expect(markup).toContain('--card:white')
		expect(markup).not.toContain('color:red')
	})
})

describe('applyThemeTokens', () => {
	test('adds tokens and removes the ones that disappear', () => {
		const { element, properties } = fakeElement()

		applyThemeTokens(element, { '--primary': 'red', '--card': 'white' })
		expect(properties.get('--primary')).toBe('red')
		expect(properties.get('--card')).toBe('white')

		applyThemeTokens(element, { '--primary': 'blue' })
		expect(properties.get('--primary')).toBe('blue')
		expect(properties.has('--card')).toBe(false)
	})

	test('clears every applied token when called without tokens', () => {
		const { element, properties } = fakeElement()

		applyThemeTokens(element, { '--primary': 'red' })
		applyThemeTokens(element, undefined)

		expect(properties.size).toBe(0)
	})
})
