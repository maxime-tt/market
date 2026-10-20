import type { ReactNode } from 'react'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '../primitives/alert-dialog'
import { buttonVariants } from '../primitives/button'
import { Spinner } from '../primitives/spinner'
import { cn } from '../utils/cn'

export interface ConfirmDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	title: string
	description?: ReactNode
	/** Label for the action button. Defaults to "Confirm". */
	confirmLabel?: string
	/** Label for the cancel button. Defaults to "Cancel". */
	cancelLabel?: string
	/** Styles the action as destructive. Defaults to false. */
	destructive?: boolean
	/** Disables both actions and shows a spinner while the action is in flight. */
	isPending?: boolean
	onConfirm: () => void
	className?: string
}

/**
 * Controlled confirmation dialog for destructive or irreversible actions.
 *
 * Replaces bare `window.confirm`. The host owns the open state and the async
 * work; the dialog only renders the question and routes the two callbacks.
 * While `isPending` is true both actions are disabled and overlay/cancel
 * dismissal is ignored so the in-flight action cannot be abandoned.
 */
export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel = 'Confirm',
	cancelLabel = 'Cancel',
	destructive = false,
	isPending = false,
	onConfirm,
	className,
}: ConfirmDialogProps) {
	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen && isPending) return
				onOpenChange(nextOpen)
			}}
		>
			<AlertDialogContent className={cn(className)}>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					{description && <AlertDialogDescription>{description}</AlertDialogDescription>}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>{cancelLabel}</AlertDialogCancel>
					<AlertDialogAction
						className={cn(destructive && buttonVariants({ variant: 'destructive' }))}
						disabled={isPending}
						onClick={onConfirm}
					>
						{isPending && <Spinner className="mr-2" />}
						{confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
