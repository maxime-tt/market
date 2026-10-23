import { useCallback, useEffect, useReducer, useRef } from 'react'

/** Status exposed by `useCopyToClipboard`. `error` is non-null after a failed write. */
export interface CopyToClipboardStatus {
	copied: boolean
	error: unknown
}

/** Idle state: nothing copied, no failure recorded. */
export const INITIAL_COPY_STATUS: CopyToClipboardStatus = { copied: false, error: null }

export type CopyToClipboardAction = { type: 'copied' } | { type: 'failed'; error: unknown } | { type: 'reset' }

/**
 * Pure transition for the clipboard status. Exported so the state machine can be
 * tested directly — the unit suite has no DOM renderer (see the test file).
 */
export function copyToClipboardReducer(state: CopyToClipboardStatus, action: CopyToClipboardAction): CopyToClipboardStatus {
	switch (action.type) {
		case 'copied':
			return { copied: true, error: null }
		case 'failed':
			return { copied: false, error: action.error }
		case 'reset':
			return INITIAL_COPY_STATUS
	}
}

/**
 * Resolves one clipboard write into a status action. A failure is captured and
 * returned as a `failed` action — it is never thrown and never swallowed, so the
 * caller can surface it.
 */
export async function resolveCopyAttempt(value: string, writeText: (value: string) => Promise<void>): Promise<CopyToClipboardAction> {
	try {
		await writeText(value)
		return { type: 'copied' }
	} catch (error) {
		// Normalise a nullish thrown value so `failed` always carries a surfaceable error.
		return { type: 'failed', error: error ?? new Error('Clipboard write failed') }
	}
}

export interface UseCopyToClipboardOptions {
	/** Overrides the clipboard writer; defaults to `navigator.clipboard.writeText`. */
	writeText?: (value: string) => Promise<void>
	/** How long the copied flag stays true before clearing. Defaults to 2000ms. */
	copiedResetMs?: number
}

export interface UseCopyToClipboardResult {
	copied: boolean
	/** Non-null when the most recent write failed; callers surface this. */
	error: unknown
	/**
	 * Writes `value` and resolves with the resulting action, so a caller can
	 * branch on success/failure instead of guessing from render state.
	 */
	copy: (value: string) => Promise<CopyToClipboardAction>
	reset: () => void
}

/**
 * Copy-to-clipboard state for one control. Writes through
 * `navigator.clipboard.writeText`, records failure in `error`, and clears
 * `copied` after a short timeout. Props-only consumers use this through
 * `CopyButton`; views that own their markup use the hook directly.
 */
export function useCopyToClipboard(options: UseCopyToClipboardOptions = {}): UseCopyToClipboardResult {
	const { writeText, copiedResetMs = 2000 } = options
	const [status, dispatch] = useReducer(copyToClipboardReducer, INITIAL_COPY_STATUS)
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const clearResetTimer = useCallback(() => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current)
			timerRef.current = null
		}
	}, [])

	useEffect(() => clearResetTimer, [clearResetTimer])

	const reset = useCallback(() => {
		clearResetTimer()
		dispatch({ type: 'reset' })
	}, [clearResetTimer])

	const copy = useCallback(
		async (value: string) => {
			clearResetTimer()
			const writer = writeText ?? ((text: string) => navigator.clipboard.writeText(text))
			const action = await resolveCopyAttempt(value, writer)
			dispatch(action)
			if (action.type === 'copied') {
				timerRef.current = setTimeout(() => {
					timerRef.current = null
					dispatch({ type: 'reset' })
				}, copiedResetMs)
			}
			return action
		},
		[clearResetTimer, copiedResetMs, writeText],
	)

	return { copied: status.copied, error: status.error, copy, reset }
}
