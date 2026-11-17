/**
 * walletKeyProvisioning.ts — where the wallet's P2PK pair comes from now: the wallet's own key ring.
 *
 * The auction HD root is not stored anywhere: `getAuctionHdAccountFromWalletKeys` derives it
 * deterministically from the wallet's P2PK pair (`(walletP2pk, walletPrivkey)`). The pair used to
 * come, one-way, from the legacy NIP-60 relay wallet event (kind 17375); the app no longer
 * publishes that event, so a wallet that never had one could never obtain a pair and both auction
 * create and bid funding were dead for it. This module is the replacement source of truth: the
 * pair is the wallet's **latest `p2pk` keypair in coco's key ring**, which coco derives from the
 * wallet seed and persists itself. Nothing here reads a relay, and nothing here keeps a second
 * copy of the pair — coco's key ring is the one home.
 *
 * ## What this module is, and is not
 *
 * It is a **pure decision** over an injected port: read the ring's latest pair; if it is there,
 * validate it and return it **without ever calling generate**; if it is null, generate **exactly
 * once** and validate the result. It performs no I/O of its own and **writes nothing** — coco's
 * key ring owns generation and persistence, so a refusal leaves the ring exactly as it was.
 *
 * ## The spelling of `walletP2pk` is load-bearing
 *
 * `walletKeys.ts` describes `walletP2pk` as *compressed secp256k1 hex*, and the HD root's input
 * string is `${walletP2pk}:${walletPrivkey}` — so the spelling of the public key is an input to
 * every derived auction address. coco reports a `p2pk` pair's public key in the **02-prefixed
 * x-only** form (`'02' + schnorr.getPublicKey(secret)`), which is not the compressed encoding of
 * the secret when its Y is odd: the true compressed form is `'03' + x`. Two spellings of the same
 * key must never be compared by string equality (they are compared with
 * `auctionP2pkPubkeysMatch`), and for an odd-Y key they also derive **different roots**.
 *
 * This module therefore keeps `walletP2pk` the **parity-correct compressed encoding recomputed
 * from the secret key** (`secp256k1.getPublicKey(secret, true)`), after first checking that coco's
 * reported key agrees with it x-only. That makes the HD root a function of the secret alone —
 * stable across any future change in how coco spells a public key — and consistent with the
 * compressed form the app's own `arenaWalletPubkey` produces. The wider consequences are spelled
 * out in the slice report; the alternative (coco's spelling verbatim) would move the root for half
 * of all wallets on the day coco ever normalises its prefix.
 *
 * ## The owner check is a real check
 *
 * The port may stamp each pair with the owner it belongs to. When it does and the owner disagrees
 * with the caller's, the pair is refused (`wrong-owner`) rather than used — the same fail-closed
 * stance `loadWalletKeyMaterial` takes for a store that answers for the wrong owner. coco's key
 * ring is per-wallet and the app adapter stamps the owner it bound, so this is a guard rail, not a
 * lookup.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { auctionP2pkPubkeysMatch, toCompressedAuctionP2pkPubkey } from '@sdk/commerce/auctions/auctionP2pk'
import { normalizeWalletKeyMaterial, WalletKeyMaterialError, type WalletKeyMaterial } from './walletKeys'

const HEX = /^[0-9a-f]+$/
const SECRET_KEY_BYTES = 32
const COMPRESSED_P2PK_HEX_LENGTH = 66

const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

/** One `p2pk` pair as a key ring answers it. */
export interface WalletKeyP2pkPair {
	/** The lock key in whatever spelling the port reports (`ok`'s is the 02-prefixed x-only form). */
	publicKeyHex: string
	/** The 32-byte secret. Never log or serialise this. */
	secretKey: Uint8Array
	/**
	 * The owner this pair is scoped to, when the port can state one. Omitted by a port that is
	 * already owner-scoped by construction; refused when present and different from the caller's
	 * owner.
	 */
	ownerPubkey?: string
}

/**
 * The pair's home, as a port. `latestP2pk` answers the ring's current pair or `null` when it holds
 * none; `generateP2pk` creates one, seed-derived, and answers it. Neither method takes the owner —
 * the ring belongs to one owner, and the adapter stamps it on the pair it returns.
 */
export interface WalletKeyPort {
	latestP2pk(): Promise<WalletKeyP2pkPair | null>
	generateP2pk(): Promise<WalletKeyP2pkPair>
}

const secretKeyToHex = (secret: Uint8Array): string => {
	if (!(secret instanceof Uint8Array)) throw new WalletKeyMaterialError('not-hex')
	if (secret.length !== SECRET_KEY_BYTES) throw new WalletKeyMaterialError('wrong-length')
	return bytesToHex(secret)
}

/** The parity-correct compressed encoding of a secret — the form the HD root's string expects. */
const compressedP2pkFromSecret = (secret: Uint8Array): string => {
	try {
		return bytesToHex(secp256k1.getPublicKey(secret, true))
	} catch {
		// A secret the curve rejects (zero, or ≥ the group order) is a broken pair, not a key.
		throw new WalletKeyMaterialError('mismatched-pair')
	}
}

/** The port's reported key, validated as compressed hex; an x-only or non-secp form is refused. */
const requireCompressedReported = (value: unknown): string => {
	if (typeof value !== 'string' || value.trim() === '') throw new WalletKeyMaterialError('missing')
	const normalized = value.trim().toLowerCase()
	if (!HEX.test(normalized)) throw new WalletKeyMaterialError('not-hex')
	if (normalized.length !== COMPRESSED_P2PK_HEX_LENGTH) throw new WalletKeyMaterialError('wrong-length')
	try {
		return toCompressedAuctionP2pkPubkey(normalized)
	} catch {
		throw new WalletKeyMaterialError('wrong-length')
	}
}

/**
 * Turn one port answer into validated material, or refuse. The reported key must agree x-only with
 * the secret's parity-correct key (a pair whose halves disagree would derive a *different* root,
 * so it is a different wallet, not a repair), and the returned `walletP2pk` is the parity-correct
 * compressed form recomputed from the secret — never the port's spelling verbatim.
 */
const materialFromPair = (pair: WalletKeyP2pkPair, ownerPubkey: string): WalletKeyMaterial => {
	const owner = ownerPubkey.trim().toLowerCase()
	if (pair.ownerPubkey !== undefined && pair.ownerPubkey.trim().toLowerCase() !== owner) {
		throw new WalletKeyMaterialError('wrong-owner')
	}

	const walletPrivkey = secretKeyToHex(pair.secretKey)
	const compressed = compressedP2pkFromSecret(pair.secretKey)
	const reported = requireCompressedReported(pair.publicKeyHex)
	if (!auctionP2pkPubkeysMatch(reported, compressed)) throw new WalletKeyMaterialError('mismatched-pair')

	return normalizeWalletKeyMaterial({ ownerPubkey: owner, walletP2pk: compressed, walletPrivkey })
}

/**
 * Resolve the wallet's P2PK pair, generating it once when the ring holds none.
 *
 * Read-then-generate, in that order, so an existing pair is never overwritten: an existing pair is
 * validated and returned and `generateP2pk` is **never** called. Only a `null` answer generates,
 * and exactly once. A refusal is thrown as {@link WalletKeyMaterialError} with a closed code and
 * no value interpolated into the message; the module has no store and so leaves the ring untouched
 * on every refusal.
 */
export const provisionWalletKeyMaterial = async (deps: { port: WalletKeyPort; ownerPubkey: string }): Promise<WalletKeyMaterial> => {
	const existing = await deps.port.latestP2pk()
	if (existing !== null) return materialFromPair(existing, deps.ownerPubkey)

	const generated = await deps.port.generateP2pk()
	return materialFromPair(generated, deps.ownerPubkey)
}

/**
 * The shape of coco's key ring that this port needs, stated structurally so neither the SDK nor
 * this module depends on coco's `KeyRingApi` class. `KeyPairApi` (coco 2.0.0) satisfies it: its
 * `getLatestKeyPair()` is filtered to `purpose: 'p2pk'` and `generateKeyPair(true)` dumps the
 * secret.
 */
export interface KeyRingP2pkSource {
	getLatestKeyPair(): Promise<{ publicKeyHex: string; secretKey: Uint8Array } | null>
	generateKeyPair(dumpSecretKey: true): Promise<{ publicKeyHex: string; secretKey: Uint8Array }>
}

/**
 * Bind a coco key ring to the port, stamping each pair with the owner it belongs to. This is the
 * whole seam: coco's `publicKeyHex` and `secretKey` pass through unchanged and the module — not
 * this adapter — decides what the pair means.
 */
export const walletKeyPortFromKeyRing = (keyring: KeyRingP2pkSource, ownerPubkey: string): WalletKeyPort => ({
	latestP2pk: async () => {
		const pair = await keyring.getLatestKeyPair()
		return pair ? { ownerPubkey, publicKeyHex: pair.publicKeyHex, secretKey: pair.secretKey } : null
	},
	generateP2pk: async () => {
		const pair = await keyring.generateKeyPair(true)
		return { ownerPubkey, publicKeyHex: pair.publicKeyHex, secretKey: pair.secretKey }
	},
})
