import { describe, expect, test } from 'bun:test'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogTitle,
} from '../primitives/alert-dialog'
import { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog'

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement | undefined {
	if (!isValidElement(node)) return undefined
	if (predicate(node)) return node
	const children = (node.props as { children?: ReactNode }).children
	return Children.toArray(children).reduce<ReactElement | undefined>((found, child) => found ?? findElement(child, predicate), undefined)
}

const baseProps: ConfirmDialogProps = {
	open: true,
	onOpenChange: () => {},
	title: 'Delete product?',
	description: 'This cannot be undone.',
	onConfirm: () => {},
}

describe('ConfirmDialog', () => {
	test('renders nothing while closed', () => {
		const markup = renderToStaticMarkup(<ConfirmDialog {...baseProps} open={false} />)
		expect(markup).toBe('')
	})

	test('routes the title, description and labels into the dialog', () => {
		const tree = ConfirmDialog({ ...baseProps, confirmLabel: 'Delete', cancelLabel: 'Keep' })
		const title = findElement(tree, (element) => element.type === AlertDialogTitle)
		const description = findElement(tree, (element) => element.type === AlertDialogDescription)
		const action = findElement(tree, (element) => element.type === AlertDialogAction)
		const cancel = findElement(tree, (element) => element.type === AlertDialogCancel)

		expect((title?.props as { children?: ReactNode }).children).toBe('Delete product?')
		expect((description?.props as { children?: ReactNode }).children).toBe('This cannot be undone.')
		expect(Children.toArray((action?.props as { children?: ReactNode }).children)).toContain('Delete')
		expect((cancel?.props as { children?: ReactNode }).children).toBe('Keep')
	})

	test('marks the action destructive only when requested', () => {
		const destructive = findElement(ConfirmDialog({ ...baseProps, destructive: true }), (element) => element.type === AlertDialogAction)
		const plain = findElement(ConfirmDialog({ ...baseProps }), (element) => element.type === AlertDialogAction)

		expect(String((destructive?.props as { className?: string }).className)).toContain('bg-error')
		expect(String((plain?.props as { className?: string }).className)).not.toContain('bg-error')
	})

	test('opts into a glass surface', () => {
		const content = findElement(ConfirmDialog({ ...baseProps, surface: 'glass' }), (element) => element.type === AlertDialogContent)
		expect(String((content?.props as { className?: string }).className)).toContain('glass')
	})

	test('invokes onConfirm from the action button', () => {
		let calls = 0
		const tree = ConfirmDialog({
			...baseProps,
			onConfirm: () => {
				calls += 1
			},
		})
		const action = findElement(tree, (element) => element.type === AlertDialogAction)
		expect(action).toBeDefined()
		;(action?.props as { onClick: () => void }).onClick()
		expect(calls).toBe(1)
	})

	test('isPending disables both actions and blocks dismissal', () => {
		let dismissals = 0
		const tree = ConfirmDialog({
			...baseProps,
			isPending: true,
			onOpenChange: () => {
				dismissals += 1
			},
		})
		const action = findElement(tree, (element) => element.type === AlertDialogAction)
		const cancel = findElement(tree, (element) => element.type === AlertDialogCancel)
		const root = findElement(tree, (element) => element.type === AlertDialog)

		// A disabled Radix action cannot dispatch a click, so this is the guard
		// that keeps `onConfirm` from running while the request is in flight.
		expect((action?.props as { disabled?: boolean }).disabled).toBe(true)
		expect((cancel?.props as { disabled?: boolean }).disabled).toBe(true)
		;(root?.props as { onOpenChange: (open: boolean) => void }).onOpenChange(false)
		expect(dismissals).toBe(0)
	})

	test('allows the host to close while not pending', () => {
		let dismissals = 0
		const tree = ConfirmDialog({
			...baseProps,
			onOpenChange: () => {
				dismissals += 1
			},
		})
		const root = findElement(tree, (element) => element.type === AlertDialog)
		;(root?.props as { onOpenChange: (open: boolean) => void }).onOpenChange(false)
		expect(dismissals).toBe(1)
	})
})
