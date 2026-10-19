/**
 * nwc-wrapper/ts/errors.ts — the closed error surface and the error taxonomy.
 *
 * `#d843ee` the module collapses every error the library throws into one small vocabulary the rest of the
 * system acts on, and states which members are recoverable. `NwcWrapperError` carries a stable code for the
 * module's own fail-closed conditions; `classifyNwcFailure` maps a thrown library error onto the taxonomy
 * without importing the library.
 */
import type { NwcErrorCode } from './types'

/**
 * `#d843ee` NWC_ERROR_RECOVERABLE — which taxonomy members can make progress on a retry or a reconcile:
 * `unreachable` and `ambiguous` can, while `rejected`, `expired` and `insufficient_balance` cannot until
 * something outside the rail changes.
 */
export const NWC_ERROR_RECOVERABLE: Readonly<Record<NwcErrorCode, boolean>> = {
	unreachable: true,
	ambiguous: true,
	rejected: false,
	expired: false,
	insufficient_balance: false,
}

/**
 * `#d843ee` NwcWrapperError — the module's own fail-closed error, carrying a stable code a caller can branch
 * on: a leg that is unknown, an operation a leg does not declare, a reference that does not match, or a
 * configuration that is missing its injected clock or id factory.
 */
export class NwcWrapperError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(message)
		this.name = 'NwcWrapperError'
		this.code = code
	}
}

/**
 * `#d843ee` classifyNwcFailure — collapse a thrown library error into the taxonomy, by the error's class name
 * and its NIP-47 code, without importing the library. A network or publish error is `unreachable`, a timeout
 * is `ambiguous` (a no-answer), a wallet error is read by its code, and anything unrecognized is `ambiguous` —
 * fail-open to uncertainty, never to a false `rejected`.
 */
export function classifyNwcFailure(error: unknown): NwcErrorCode {
	const record = (error ?? {}) as { name?: unknown; code?: unknown }
	const name = typeof record.name === 'string' ? record.name : ''
	const code = typeof record.code === 'string' ? record.code.toUpperCase() : ''
	if (name.includes('Network') || name.includes('Publish')) return 'unreachable'
	if (name.includes('Timeout')) return 'ambiguous'
	if (code.includes('INSUFFICIENT')) return 'insufficient_balance'
	if (code.includes('NOT_FOUND') || code.includes('EXPIRED')) return 'expired'
	if (
		code.includes('QUOTA') ||
		code.includes('FORBIDDEN') ||
		code.includes('UNAUTHORIZED') ||
		code.includes('RESTRICTED') ||
		code.includes('RATE_LIMITED') ||
		code.includes('BLOCKED')
	) {
		return 'rejected'
	}
	if (name.includes('WalletError')) return 'rejected'
	return 'ambiguous'
}
