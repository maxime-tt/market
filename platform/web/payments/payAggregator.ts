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
import type { NwcWrapperOptions, NwcInvoiceCodec, NwcLegStore } from '@sdk/core/nwc-wrapper'
import { NwcWrapper } from '@sdk/core/nwc-wrapper'

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

export function createBolt11Adapter(opts: Bolt11AggregatorAdapterOptions): AggregatorWrapper {
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
		get registration() {
			return wrapper.registration
		},
		async reconcileLeg(legId: string): Promise<FundsHandle> {
			// legId is the payment hash; look up the bolt11 invoice from the leg store
			// and forward it to the wrapper's reconcile(reference) which decodes the hash again.
			const record = await opts.store.get({ wrapperId: opts.wrapperId, legId })
			if (!record) {
				throw new Error(`bolt11: no leg for ${legId}`)
			}
			return wrapper.reconcile(record.bolt11)
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

export function createNwcAdapter(opts: NwcAggregatorAdapterOptions): AggregatorWrapper {
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
		get registration() {
			return wrapper.registration
		},
		async reconcileLeg(legId: string): Promise<FundsHandle> {
			// NWC wrapper's reconcile(reference) uses the reference as payment hash,
			// which is the same as legId in the NWC rail.
			return wrapper.reconcile(legId)
		},
	}
}

// ---------------------------------------------------------------------------
// Factory that builds both adapters and returns the full list for
// AggregatorOptions.wrappers. Call once at app bootstrap.
// ---------------------------------------------------------------------------

export interface PayAggregatorConfig {
	readonly bolt11: Bolt11AggregatorAdapterOptions
	readonly nwc?: NwcAggregatorAdapterOptions
	// cashu would go here when the engine host adapter is ready
}

export function buildAggregatorWrappers(
	config: PayAggregatorConfig,
	verifier: WitnessVerifier,
	setStore: SetStore,
): {
	wrappers: readonly AggregatorWrapper[]
	options: AggregatorOptions
} {
	const wrappers: AggregatorWrapper[] = [createBolt11Adapter(config.bolt11)]
	if (config.nwc) {
		wrappers.push(createNwcAdapter(config.nwc))
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
	}
}
