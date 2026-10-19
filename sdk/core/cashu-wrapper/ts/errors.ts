import type { WalletStep } from './types'

export class WalletHostError extends Error {
	readonly code: string

	constructor(name: string, code: string, message: string) {
		super(message)
		this.name = name
		this.code = code
	}
}

export class WalletConfigurationError extends WalletHostError {
	constructor(message: string) {
		super('WalletConfigurationError', 'wallet_configuration', message)
	}
}

export class WalletAdapterNotFoundError extends WalletHostError {
	constructor(applicationId: string, operationKind: string) {
		super('WalletAdapterNotFoundError', 'wallet_adapter_not_found', `No wallet adapter is registered for ${applicationId}/${operationKind}`)
	}
}

export class WalletCommandConflictError extends WalletHostError {
	constructor(commandId: string) {
		super(
			'WalletCommandConflictError',
			'wallet_command_conflict',
			`Wallet command ${commandId} already exists with a different immutable intent`,
		)
	}
}

export class WalletInvalidTransitionError extends WalletHostError {
	constructor(commandId: string, message: string) {
		super('WalletInvalidTransitionError', 'wallet_invalid_transition', `Wallet command ${commandId}: ${message}`)
	}
}

export class WalletStaleWriterError extends WalletHostError {
	constructor(commandId: string) {
		super('WalletStaleWriterError', 'wallet_stale_writer', `Wallet command ${commandId} changed before this writer could commit`)
	}
}

export class WalletRecoveryRequiredError extends WalletHostError {
	constructor(commandId: string) {
		super(
			'WalletRecoveryRequiredError',
			'wallet_recovery_required',
			`Wallet command ${commandId} requires reconciliation before it can continue`,
		)
	}
}

export class WalletStepExecutionError extends WalletHostError {
	readonly commandId: string
	readonly action: WalletStep | 'cancel' | 'recover'

	constructor(commandId: string, action: WalletStep | 'cancel' | 'recover', failureCode: string) {
		super(
			'WalletStepExecutionError',
			failureCode,
			`Wallet command ${commandId} failed during ${action}; inspect its durable state before retrying`,
		)
		this.commandId = commandId
		this.action = action
	}
}
