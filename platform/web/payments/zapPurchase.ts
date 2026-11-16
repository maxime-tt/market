import { ZAP_RELAYS } from '@sdk/config/constants'
import { getActiveSignerCapability } from '@platform/web/auth/authStore'

/**
 * A kind-9734 zap request, built and signed at the app boundary.
 *
 * The `ndk` field is retained for call-site compatibility and is no longer read:
 * signing goes through the active signer capability instead of NDK's instance
 * signer (`event.sign()` with no argument, whose `ndk.signer` the store's signer
 * surface no longer sets — so the old path was already the broken one whenever no
 * instance signer had been wired). Nothing is published to a relay here; the
 * signed request is POSTed to `/api/zapPurchase`.
 */
export interface ZapPurchaseInvoiceOptions {
	ndk?: unknown
	appPubkey: string
	appRelay: string
	zapLabel: string
	registryTag: string
	registryKey: string
	amountSats: number
}

export interface ZapPurchaseInvoiceResult {
	pr: string
	invoiceId: string
}

export async function zapPurchase(opts: ZapPurchaseInvoiceOptions): Promise<ZapPurchaseInvoiceResult> {
	const { appPubkey, appRelay, zapLabel, registryTag, registryKey, amountSats } = opts

	const signer = getActiveSignerCapability()
	if (!signer) throw new Error('No signer available')

	// Build and sign a kind-9734 zap request.
	const zapRequest = await signer.signEvent({
		kind: 9734,
		content: '',
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['p', appPubkey],
			['amount', (amountSats * 1000).toString()],
			['L', zapLabel],
			[registryTag, registryKey],
			['relays', ...Array.from(new Set([appRelay, ...ZAP_RELAYS].filter(Boolean)))],
		],
	})

	const invoiceId = `${zapLabel}-${registryKey}-${amountSats}-${Date.now()}`

	const res = await fetch('/api/zapPurchase', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			amountSats,
			registryKey,
			// The signed event *is* the raw event; `rawEvent()` had no other job.
			zapRequest,
		}),
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(text || `Failed to create invoice (${res.status})`)
	}

	const data = (await res.json()) as { pr?: string; error?: string }
	if (!data.pr) {
		throw new Error(data.error || 'Failed to create invoice')
	}

	return { pr: data.pr, invoiceId }
}

// Shared context every purchase helper needs.
export interface PurchaseContext {
	ndk?: unknown
	appPubkey: string
	appRelay: string
}

export async function purchaseVanityForPubkey(
	ctx: PurchaseContext,
	options: { name: string; amountSats: number },
): Promise<ZapPurchaseInvoiceResult> {
	return zapPurchase({
		...ctx,
		zapLabel: 'vanity-register',
		registryTag: 'vanity',
		registryKey: options.name.toLowerCase(),
		amountSats: options.amountSats,
	})
}

export async function purchaseNip05ForPubkey(
	ctx: PurchaseContext,
	options: { username: string; amountSats: number },
): Promise<ZapPurchaseInvoiceResult> {
	return zapPurchase({
		...ctx,
		zapLabel: 'nip05-register',
		registryTag: 'nip05',
		registryKey: options.username.toLowerCase(),
		amountSats: options.amountSats,
	})
}