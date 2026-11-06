/**
 * platform/web/payments/payAggregator.ts — wire bolt11, nwc, cashu wrappers into AggregatorWrapper ports.
 *
 * Each SDK wrapper exposes WrapperRegistration + its own reconcile(reference: string) which expects the
 * rail's durable reference (bolt11 invoice, LNURL invoice, engine operation id). The aggregator expects
 * reconcileLeg(legId: string) keyed on the leg's own identity (payment hash for bolt11/nwc, command id
 * for cashu). The adapter bridges: look up the rail reference from the injected store, forward it to
 * the wrapper, and return the FundsHandle unchanged.
 *
 * The aggregator's SetStore is provided by the caller; this module only wires the wrapper ports.
 * The composing app injects one adapter per rail via AggregatorOptions.wrappers.
 *
 * Cashu / coco arrives as `sdk/core/cashu-wrapper`'s `CocoWalletPortAdapter`, whose host
 * (`CocoWalletHost` — the `EngineHost` its `requireHost()` demands) is built by the wallet binding in
 * `platform/web/wallet/cocoWalletHost.ts` over the app's own coco engine. The wrapper cannot be
 * instantiated without that host, so `createCashuAdapter` takes the binding's options and composes the
 * two, exactly as `createBolt11Adapter` composes its wrapper from the injected store and codec.
 */
import type { AggregatorOptions, AggregatorWrapper, SetStore, WitnessVerifier } from '@sdk/core/wallet'
import type { FundsHandle } from '@sdk/core/funds-contract'
import type {
	Bolt11WrapperOptions,
	Bolt11LegStore,
	Bolt11InvoiceCodec,
	Bolt11Signer,
	Bolt11LnurlRequester,
	Bolt11LnurlVerifier,
	Bolt11LegKind,
	Bolt11LegCommand,
} from '@sdk/core/bolt11-wrapper'
import { Bolt11Wrapper } from '@sdk/core/bolt11-wrapper'
export { Bolt11Wrapper } from '@sdk/core/bolt11-wrapper'
import type { NwcWrapperOptions, NwcInvoiceCodec, NwcLegStore } from '@sdk/core/nwc-wrapper'
import { NwcWrapper } from '@sdk/core/nwc-wrapper'
import type { CocoWalletHost, CocoWalletPortAdapter } from '@sdk/core/cashu-wrapper'
import { createCocoWalletHost, type CocoWalletHostOptions } from '@platform/web/wallet/cocoWalletHost'
// ---------------------------------------------------------------------------
// Bolt11 adapter — bridge Bolt11Wrapper.reconcile(reference: bolt11) to
// AggregatorWrapper.reconcileLeg(legId: paymentHash).
// ---------------------------------------------------------------------------

export interface Bolt11AggregatorAdapterOptions {
	readonly wrapperId: string
	readonly store: Bolt11LegStore
	readonly storeKind: string
	readonly codec: Bolt11InvoiceCodec
	readonly signer?: Bolt11Signer
	readonly lnurlRequester?: Bolt11LnurlRequester
	readonly lnurlVerifier?: Bolt11LnurlVerifier
	readonly reconcileDeadlineMs: number
	readonly ceiling: number
	readonly contractVersion: string
	readonly now: () => number
}

export function createBolt11Adapter(opts: Bolt11AggregatorAdapterOptions): { wrapper: Bolt11Wrapper; adapter: AggregatorWrapper } {
	const wrapper = new Bolt11Wrapper({
		wrapperId: opts.wrapperId,
		store: opts.store,
		storeKind: opts.storeKind,
		codec: opts.codec,
		signer: opts.signer,
		lnurlRequester: opts.lnurlRequester,
		lnurlVerifier: opts.lnurlVerifier,
		reconcileDeadlineMs: opts.reconcileDeadlineMs,
		ceiling: opts.ceiling,
		contractVersion: opts.contractVersion,
		now: opts.now,
	})

	return {
		wrapper,
		adapter: {
			get registration() {
				return wrapper.registration
			},
			async reconcileLeg(legId: string): Promise<FundsHandle> {
				const record = await opts.store.get({ wrapperId: opts.wrapperId, legId })
				if (!record) {
					throw new Error(`bolt11: no leg for ${legId}`)
				}
				return wrapper.reconcile(record.bolt11)
			},
		},
	}
}

// ---------------------------------------------------------------------------
// NWC adapter — bridge NwcWrapper.reconcile(reference: paymentHash) to
// AggregatorWrapper.reconcileLeg(legId: paymentHash).
// In the NWC wrapper, reconcile(reference) expects a payment hash, so the
// legId passes through directly.
// ---------------------------------------------------------------------------

export interface NwcAggregatorAdapterOptions {
	readonly wrapperId: string
	readonly store: NwcLegStore
	readonly storeKind: string
	readonly session: NwcWrapperOptions['session']
	readonly codec: NwcInvoiceCodec
	readonly newId: NwcWrapperOptions['newId']
	readonly reconcileDeadlineMs: number
	readonly ceiling: number
	readonly contractVersion: string
	readonly now: () => number
	readonly reconnect: NwcWrapperOptions['reconnect']
}

export function createNwcAdapter(opts: NwcAggregatorAdapterOptions): { wrapper: NwcWrapper; adapter: AggregatorWrapper } {
	const wrapper = new NwcWrapper({
		wrapperId: opts.wrapperId,
		store: opts.store,
		storeKind: opts.storeKind,
		session: opts.session,
		codec: opts.codec,
		newId: opts.newId,
		reconcileDeadlineMs: opts.reconcileDeadlineMs,
		ceiling: opts.ceiling,
		contractVersion: opts.contractVersion,
		now: opts.now,
		reconnect: opts.reconnect,
	})

	return {
		wrapper,
		adapter: {
			get registration() {
				return wrapper.registration
			},
			async reconcileLeg(legId: string): Promise<FundsHandle> {
				// NWC wrapper's reconcile(reference) uses the reference as payment hash,
				// which is the same as legId in the NWC rail.
				return wrapper.reconcile(legId)
			},
		},
	}
}

// ---------------------------------------------------------------------------
// Cashu adapter — bridge CocoWalletPortAdapter.reconcile(reference: engine
// operation id) to AggregatorWrapper.reconcileLeg(legId: command id), over the
// wallet host built in platform/web/wallet/cocoWalletHost.ts.
// ---------------------------------------------------------------------------

/**
 * What the cashu adapter is composed from: the wallet binding's own options (the app's engine, the
 * wrapper identity, the two durable stores and the injected clock). The host is built here rather than
 * handed in, because the wrapper's port adapter and the host it runs on are mutually dependent — the
 * host registers the adapter at construction and the adapter attaches to the host immediately after.
 */
export type CashuAggregatorAdapterOptions = CocoWalletHostOptions

export function createCashuAdapter(options: CashuAggregatorAdapterOptions): {
	host: CocoWalletHost
	portAdapter: CocoWalletPortAdapter
	adapter: AggregatorWrapper
} {
	const { host, portAdapter } = createCocoWalletHost(options)

	return {
		host,
		portAdapter,
		adapter: {
			get registration() {
				return portAdapter.registration
			},
			async reconcileLeg(legId: string): Promise<FundsHandle> {
				const record = await options.legStore.get({ wrapperId: options.wrapperId, legId })
				if (!record) {
					throw new Error(`cashu: no leg for ${legId}`)
				}
				// The wrapper's reconcile() takes the leg's durable reference, which for a melt is the
				// engine's operation id; a leg that never obtained one is still readable by the command id
				// the wrapper's own projection falls back to.
				return portAdapter.reconcile(record.engineOperationId ?? record.commandId)
			},
		},
	}
}

// ---------------------------------------------------------------------------
// Factory that builds every adapter and returns the full list for
// AggregatorOptions.wrappers. Call once at app bootstrap.
// ---------------------------------------------------------------------------

export interface PayAggregatorConfig {
	readonly bolt11: Bolt11AggregatorAdapterOptions
	readonly nwc?: NwcAggregatorAdapterOptions
	readonly cashu?: CashuAggregatorAdapterOptions
}

export function buildAggregatorWrappers(
	config: PayAggregatorConfig,
	verifier: WitnessVerifier,
	setStore: SetStore,
): {
	wrappers: readonly AggregatorWrapper[]
	options: AggregatorOptions
	bolt11Wrapper: Bolt11Wrapper
	/** the cashu host binding and its wrapper port, or null when the config registered no cashu rail */
	cashu: { host: CocoWalletHost; portAdapter: CocoWalletPortAdapter } | null
} {
	const bolt11 = createBolt11Adapter(config.bolt11)
	const wrappers: AggregatorWrapper[] = [bolt11.adapter]
	if (config.nwc) {
		wrappers.push(createNwcAdapter(config.nwc).adapter)
	}
	let cashu: { host: CocoWalletHost; portAdapter: CocoWalletPortAdapter } | null = null
	if (config.cashu) {
		const built = createCashuAdapter(config.cashu)
		cashu = { host: built.host, portAdapter: built.portAdapter }
		wrappers.push(built.adapter)
	}

	return {
		wrappers,
		options: {
			store: setStore,
			verifier,
			contractVersion: config.bolt11.contractVersion,
			toleranceSat: 2,
			now: config.bolt11.now,
			wrappers,
		},
		bolt11Wrapper: bolt11.wrapper,
		cashu,
	}
}
