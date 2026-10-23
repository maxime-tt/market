import { describe, expect, test } from 'bun:test'
import { Children, createElement, isValidElement, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DashboardListItem } from '../dashboard/dashboard-list-item'
import { TooltipButton } from '../wrappers/tooltip-button'
import { TooltipProvider } from '../primitives/tooltip'
import { EntityListItem, type EntityListItemAction, type EntityListItemProps } from './entity-list-item'

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement | undefined {
	if (!isValidElement(node)) return undefined
	if (predicate(node)) return node
	const children = (node.props as { children?: ReactNode }).children
	return Children.toArray(children).reduce<ReactElement | undefined>((found, child) => found ?? findElement(child, predicate), undefined)
}

function findAllElements(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement[] {
	if (!isValidElement(node)) return []
	const self = predicate(node) ? [node] : []
	const children = (node.props as { children?: ReactNode }).children
	return [...self, ...Children.toArray(children).flatMap((child) => findAllElements(child, predicate))]
}

const baseProps: EntityListItemProps = {
	isOpen: true,
	onOpenChange: () => {},
	trigger: <span>Product trigger</span>,
	children: <p>Expanded details</p>,
}

/** Extracts the TooltipButton elements built from the `actions` array. */
function actionButtons(props: EntityListItemProps): ReactElement[] {
	const root = findElement(EntityListItem(props), (element) => element.type === DashboardListItem)
	const actions = (root?.props as { actions?: ReactNode }).actions
	return findAllElements(actions, (element) => element.type === TooltipButton)
}

function renderMarkup(props: EntityListItemProps): string {
	return renderToStaticMarkup(createElement(TooltipProvider, null, EntityListItem(props)))
}

describe('EntityListItem', () => {
	test('renders the trigger and the details children', () => {
		const markup = renderMarkup(baseProps)
		expect(markup).toContain('Product trigger')
		expect(markup).toContain('Expanded details')
	})

	test('renders each action with its label as tooltip and aria-label', () => {
		const actions: EntityListItemAction[] = [
			{ key: 'edit', label: 'Edit product', icon: <span data-testid="icon-edit" />, onClick: () => {} },
			{ key: 'delete', label: 'Delete product', icon: <span data-testid="icon-delete" />, onClick: () => {} },
		]
		const buttons = actionButtons({ ...baseProps, actions })

		expect(buttons).toHaveLength(2)
		expect(buttons.map((button) => (button.props as { tooltip?: string }).tooltip)).toEqual(['Edit product', 'Delete product'])
		expect(buttons.map((button) => (button.props as { 'aria-label'?: string })['aria-label'])).toEqual(['Edit product', 'Delete product'])
	})

	test('a pending action renders the spinner and disables the button', () => {
		const actions: EntityListItemAction[] = [
			{ key: 'delete', label: 'Delete product', icon: <span data-testid="icon-delete" />, onClick: () => {}, pending: true },
		]
		const [button] = actionButtons({ ...baseProps, actions })

		expect((button.props as { disabled?: boolean }).disabled).toBe(true)
		const markup = renderMarkup({ ...baseProps, actions })
		expect(markup).toContain('aria-label="Loading"')
		expect(markup).not.toContain('icon-delete')
	})

	test('a destructive action applies text-error to the icon', () => {
		const actions: EntityListItemAction[] = [
			{ key: 'delete', label: 'Delete product', icon: <span data-testid="icon-delete" />, onClick: () => {}, destructive: true },
		]
		const markup = renderMarkup({ ...baseProps, actions })
		expect(markup).toContain('text-error')
		expect(markup).toContain('icon-delete')
	})

	test('a disabled action renders a disabled button', () => {
		const actions: EntityListItemAction[] = [{ key: 'delete', label: 'Delete product', icon: <span />, onClick: () => {}, disabled: true }]
		const [button] = actionButtons({ ...baseProps, actions })
		expect((button.props as { disabled?: boolean }).disabled).toBe(true)
	})

	test('an action click calls the supplied handler and stops propagation', () => {
		let handled = 0
		let stopped = 0
		const actions: EntityListItemAction[] = [
			{
				key: 'edit',
				label: 'Edit product',
				icon: <span />,
				onClick: () => {
					handled += 1
				},
			},
		]
		const [button] = actionButtons({ ...baseProps, actions })
		const event = {
			stopPropagation: () => {
				stopped += 1
			},
		} as unknown as ReactMouseEvent<HTMLButtonElement>

		;(button.props as { onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void }).onClick(event)

		expect(stopped).toBe(1)
		expect(handled).toBe(1)
	})

	test('opts into glass and hand-made surfaces', () => {
		const glass = findElement(EntityListItem({ ...baseProps, surface: 'glass' }), (element) => element.type === DashboardListItem)
		const handmade = findElement(EntityListItem({ ...baseProps, corners: 'handmade' }), (element) => element.type === DashboardListItem)
		const plain = findElement(EntityListItem(baseProps), (element) => element.type === DashboardListItem)

		expect(String((glass?.props as { className?: string }).className)).toContain('glass')
		expect(String((handmade?.props as { className?: string }).className)).toContain('rounded-hand')
		expect(String((plain?.props as { className?: string }).className)).not.toContain('rounded-hand')
	})

	test('passes no action row when actions are empty or undefined', () => {
		const none = findElement(EntityListItem(baseProps), (element) => element.type === DashboardListItem)
		const empty = findElement(EntityListItem({ ...baseProps, actions: [] }), (element) => element.type === DashboardListItem)

		expect((none?.props as { actions?: ReactNode }).actions).toBeUndefined()
		expect((empty?.props as { actions?: ReactNode }).actions).toBeUndefined()
	})
})
