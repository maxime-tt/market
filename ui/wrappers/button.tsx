import type { ComponentProps, ReactNode, Ref } from 'react'
import { Button as ButtonPrimitive } from '../primitives/button'
import { Spinner } from '../primitives/spinner'
import { cn } from '../utils/cn'

export { buttonVariants } from '../primitives/button'

export interface ButtonProps extends ComponentProps<typeof ButtonPrimitive> {
	/**
	 * Shows the canonical `primitives/spinner` and disables the button while
	 * true. Callers no longer hand-roll a ring div or a `Loader2` icon.
	 */
	pending?: boolean
	/** Where the spinner sits relative to the label. Defaults to `start`. */
	pendingPosition?: 'start' | 'end'
	children?: ReactNode
	ref?: Ref<HTMLButtonElement>
}

/**
 * The button routes should import instead of `@ui/primitives/button`.
 *
 * It is the primitive plus one behaviour — a pending state — which was
 * previously hand-rolled in four different ways across the routes
 * (a `border-2` ring with a white border, the same with a destructive-token
 * border, a `border-4` ring with a primary-token border, and a bare
 * `Loader2 … animate-spin`). ADR-0007 §1d
 * names `ui/wrappers/` as the layer routes consume primitives through, so this
 * is also what lets a route drop its `@ui/primitives/button` import.
 *
 * With `pending` false the rendered output is the primitive's, plus a
 * `data-pending="false"` marker.
 *
 * Accessibility: the spinner is `aria-hidden` so it does not pollute the
 * button's accessible name (a `role="status"` labelled "Loading" inside a
 * button would otherwise rename it to "Loading …"), and the pending state is
 * exposed as `aria-busy`.
 */
export function Button({ pending = false, pendingPosition = 'start', disabled, children, className, ref, ...props }: ButtonProps) {
	const spinner = pending ? <Spinner aria-hidden="true" data-slot="button-spinner" className={cn('shrink-0')} /> : null

	return (
		<ButtonPrimitive
			ref={ref}
			disabled={disabled || pending}
			aria-busy={pending || undefined}
			data-pending={pending ? 'true' : 'false'}
			className={className}
			{...props}
		>
			{pendingPosition === 'start' && spinner}
			{children}
			{pendingPosition === 'end' && spinner}
		</ButtonPrimitive>
	)
}
