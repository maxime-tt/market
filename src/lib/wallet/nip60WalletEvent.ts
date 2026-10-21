/**
 * nip60WalletEvent.ts — reading the one thing the cut still needs from the relay: the keypair.
 *
 * A NIP-60 wallet event (kind 17375) carries its content NIP-44-encrypted to its owner, and
 * that content is a flat array of name/value pairs:
 *
 *   [["mint", url], ["mint", url], ["privkey", hex], ["relay", url], …]
 *
 * Two properties of that array shape this module.
 *
 * First, `privkey` is a **list**, not a single key. `walletKeys.ts` derives every auction
 * address of an owner from `(walletP2pk, walletPrivkey)`, so choosing the wrong entry does not
 * fail — it derives a *different* HD root and strands whatever is locked to the old one. This
 * module therefore never chooses: it returns every pair it can derive, and
 * {@link selectWalletKeyPair} requires the caller to name the pubkey it expects.
 *
 * Second, the pubkey half is not stored — it is derived from the private half. So a pair this
 * module produces is self-consistent by construction, and the caller's expected pubkey is the
 * only external check that matters.
 *
 * Nothing here decrypts anything: the caller decrypts (the signer owns that) and passes the
 * plaintext. Nothing here logs or returns key material beyond the pairs the caller asked for.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js'

export interface WalletKeyPairCandidate {
	/** Compressed secp256k1 pubkey derived from the private half. */
	readonly walletP2pk: string
	/** The private half. Never log or serialise this. */
	readonly walletPrivkey: string
}

export interface Nip60WalletEventContent {
	readonly mints: string[]
	readonly relays: string[]
	/** Every keypair the event carries, in the order it lists them. */
	readonly pairs: WalletKeyPairCandidate[]
}

export type Nip60WalletEventReason = 'malformed-content' | 'no-keys'

export class Nip60WalletEventError extends Error {
	readonly code: Nip60WalletEventReason

	constructor(reason: Nip60WalletEventReason) {
		super(`nip60 wallet event refused: ${reason}`)
		this.name = 'Nip60WalletEventError'
		this.code = reason
	}
}

const isPrivkey = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value.trim().toLowerCase())

const isUrl = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

const compressedPubkeyFor = (privkeyHex: string): string => {
	const bytes = new Uint8Array(32)
	for (let i = 0; i < 32; i += 1) bytes[i] = parseInt(privkeyHex.slice(i * 2, i * 2 + 2), 16)
	return Array.from(secp256k1.getPublicKey(bytes, true))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * Read the decrypted content of a kind-17375 event. Entries that do not fit the shape are
 * skipped — a wallet event is relay data and is treated as such — but a payload that is not a
 * pair-list at all, or that carries no usable key, is refused rather than reported as empty,
 * because an empty answer would look like "this owner has no wallet" to the caller.
 */
export const parseNip60WalletEventContent = (decryptedContent: string): Nip60WalletEventContent => {
	let parsed: unknown
	try {
		parsed = JSON.parse(decryptedContent)
	} catch {
		throw new Nip60WalletEventError('malformed-content')
	}
	if (!Array.isArray(parsed)) throw new Nip60WalletEventError('malformed-content')

	const mints: string[] = []
	const relays: string[] = []
	const pairs: WalletKeyPairCandidate[] = []

	for (const entry of parsed) {
		if (!Array.isArray(entry) || entry.length < 2) continue
		const [name, value] = entry
		if (name === 'mint' && isUrl(value)) mints.push(value.trim())
		else if (name === 'relay' && isUrl(value)) relays.push(value.trim())
		else if (name === 'privkey' && isPrivkey(value)) {
			const walletPrivkey = value.trim().toLowerCase()
			pairs.push({ walletP2pk: compressedPubkeyFor(walletPrivkey), walletPrivkey })
		}
	}

	if (mints.length === 0 && pairs.length === 0) throw new Nip60WalletEventError('malformed-content')
	if (pairs.length === 0) throw new Nip60WalletEventError('no-keys')

	return { mints, relays, pairs }
}

/**
 * The pair the caller means, by the pubkey it expects.
 *
 * There is deliberately no "first pair" or "only pair" shortcut: with more than one key in the
 * event, an unqualified choice is exactly how an HD root moves. A caller that cannot name an
 * expected pubkey gets null and decides for itself what that means.
 */
export const selectWalletKeyPair = (
	candidates: readonly WalletKeyPairCandidate[],
	expectedP2pk: string | undefined,
): WalletKeyPairCandidate | null => {
	if (!expectedP2pk) return candidates.length === 1 ? candidates[0] : null
	const wanted = expectedP2pk.trim().toLowerCase()
	return candidates.find((pair) => pair.walletP2pk === wanted) ?? null
}
