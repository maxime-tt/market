/**
 * nwc-wrapper/ts/index.ts — the entry: the port implementation and the rail's surface.
 *
 * `#0643db` the wrapper implements the contract's port over the NIP-47 rail; `#c90403` the library is behind
 * the injected session port; and the port's vocabulary itself is obtained from the ancestor, the funds
 * contract (`#c997ae`), and re-exported here for the composing app.
 */
export { NwcWrapper } from './wrapper'
export { GetalbyNwcSession } from './session'
export { MemoryNwcLegStore } from './memory'
export { NwcWrapperError, classifyNwcFailure, NWC_ERROR_RECOVERABLE } from './errors'
export type { GetalbyNwcSessionOptions } from './session'
export type {
	NwcLegKind,
	NwcFallbackStep,
	NwcSessionStatus,
	NwcOutcome,
	NwcPaymentBody,
	NwcTransactionBody,
	NwcErrorCode,
	NwcSession,
	NwcInvoiceCodec,
	NwcLegKey,
	NwcLegRecord,
	NwcLegStore,
	NwcLegCommand,
	NwcWrapperOptions,
} from './types'
