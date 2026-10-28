/**
 * auth/errors.ts — the closed error surface.
 *
 * One fail-closed refusal: a platform binding asked to use an auth machine nobody registered. The message
 * names the condition and interpolates no caller value, so no payload can reach it. The machine itself
 * throws plain `Error`s carrying the legacy strings; this class is the binding's configuration refusal.
 */

/** AuthError — the auth module's refusal, carrying a stable code a caller can branch on. */
export class AuthError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(message)
		this.name = 'AuthError'
		this.code = code
	}
}

/** The platform binding's configuration refusal: it was asked to use a machine that was never registered. */
export class AuthMachineNotRegisteredError extends AuthError {
	constructor() {
		super('auth_machine_not_registered', 'The auth machine is not registered on this platform binding')
	}
}
