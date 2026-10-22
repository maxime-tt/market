import { describe, expect, test } from 'bun:test'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '../primitives/button'
import { ErrorState } from './error-state'

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement | undefined {
	if (!isValidElement(node)) return undefined
	if (predicate(node)) return node
	const children = (node.props as { children?: ReactNode }).children
	return Children.toArray(children).reduce<ReactElement | undefined>((found, child) => found ?? findElement(child, predicate), undefined)
}

describe('ErrorState', () => {
	test('renders the default title and no retry button', () => {
		const markup = renderToStaticMarkup(<ErrorState />)
		expect(markup).toContain('role="alert"')
		expect(markup).toContain('Something went wrong')
		expect(markup).not.toContain('<button')
	})

	test('renders the message and a labelled retry button using destructive tokens', () => {
		const markup = renderToStaticMarkup(
			<ErrorState title="Upload failed" message="The relay refused the event" onRetry={() => {}} retryLabel="Retry now" />,
		)
		expect(markup).toContain('Upload failed')
		expect(markup).toContain('The relay refused the event')
		expect(markup).toContain('Retry now')
		expect(markup).toContain('text-destructive')
	})

	test('retry button invokes onRetry', () => {
		let calls = 0
		const tree = ErrorState({
			onRetry: () => {
				calls += 1
			},
		})
		const retry = findElement(tree, (element) => element.type === Button)
		expect(retry).toBeDefined()
		;(retry?.props as { onClick: () => void }).onClick()
		expect(calls).toBe(1)
	})

	test('renders an extra action beside the retry button', () => {
		const markup = renderToStaticMarkup(<ErrorState onRetry={() => {}} action={<Button variant="ghost">Go back</Button>} />)
		expect(markup).toContain('Try again')
		expect(markup).toContain('Go back')
	})

	test('carries a host testid onto the retry button', () => {
		const markup = renderToStaticMarkup(<ErrorState onRetry={() => {}} retryTestId="community-collections-retry" />)
		expect(markup).toContain('data-testid="community-collections-retry"')
	})

	test('merges host className and switches to compact spacing', () => {
		const markup = renderToStaticMarkup(<ErrorState compact className="host-error" />)
		expect(markup).toContain('host-error')
		expect(markup).toContain('py-6')
	})
})
