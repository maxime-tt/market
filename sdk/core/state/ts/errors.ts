/**
 * state/ts/errors.ts — the closed error surface.
 *
 * One fail-closed refusal: the factory requires a storage key whenever a storage port is injected, because
 * the primitive owns no key of its own (the storage port's doc gives the host the key, the encryption and
 * the policy). The message names the condition and interpolates no caller value, so no payload can reach it.
 */

/** StateError — the primitive's configuration refusal, carrying a stable code a caller can branch on. */
export class StateError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(message)
		this.name = 'StateError'
		this.code = code
	}
}
