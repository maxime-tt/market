/**
 * walletKeys.ts — the wallet's P2PK keypair, and through it the auction HD root, as a local
 * fact rather than a relay event.
 *
 * The auction HD root is not stored anywhere: `getAuctionHdAccountFromWalletKeys` derives it
 * deterministically from the wallet's P2PK keypair (a SHA-512 over the pair, then
 * `m/30408'/0'/0'`). So the only material that has to survive a device is that one pair per
 * owner — and the NIP-60 wallet recovers it by re-reading the encrypted kind-17375 event,
 * which is the relay dependency this module exists to remove. Moving the pair local is what
 * lets the relay read path be deleted without moving anyone's auction addresses.
 *
 * The store is an **injected port**: this module decides what the material is and refuses
 * material it cannot trust; the composing app decides where — and under what protection — it
 * is kept. Nothing here logs, formats or serialises key material, and no function takes a
 * seed.
 *
 * The correspondence check is the point of the module. Every auction address, and therefore
 * every bid locked to one, is derived from `(walletP2pk, walletPrivkey)`; a pair whose halves
 * disagree derives a *different* root, so a silently corrupted store would move the HD root
 * and strand in-flight collateral. A store is an injected port, so its answer is re-checked
 * on the way out rather than trusted.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { getAuctionHdAccountFromWalletKeys } from '@/lib/auctionHd'
import {
	auctionP2pkPubkeysMatch,
	deriveAuctionChildP2pkPubkeyFromXpub,
	normalizeAuctionDerivationPath,
	toCompressedAuctionP2pkPubkey,
} from '@/lib/auctionP2pk'

const HEX = /^[0-9a-f]+$/
const OWNER_PUBKEY_HEX_LENGTH = 64
const SECRET_KEY_HEX_LENGTH = 64
const COMPRESSED_P2PK_HEX_LENGTH = 66

/**
 * The closed refusal vocabulary. A code names the reason and never interpolates a value, so a
 * malformed or hostile input cannot turn a refusal into another error or echo key material.
 */
export type WalletKeyReason =
	| 'missing'
	| 'not-hex'
	| 'wrong-length'
	| 'mismatched-pair'
	| 'wrong-owner'
	| 'underivable-root'
	| 'underivable-child'
	| 'unexpected-child'

export class WalletKeyMaterialError extends Error {
	readonly code: WalletKeyReason

	constructor(reason: WalletKeyReason) {
		super(`wallet key material refused: ${reason}`)
		this.name = 'WalletKeyMaterialError'
		this.code = reason
	}
}

/** The one keypair the auction HD root depends on. */
export interface WalletKeyMaterial {
	/** The user the pair belongs to, x-only hex. */
	readonly ownerPubkey: string
	/** The wallet's P2PK lock key, compressed secp256k1 hex. */
	readonly walletP2pk: string
	/** The private half of `walletP2pk`, hex. Never log or serialise this. */
	readonly walletPrivkey: string
}

/**
 * Where the pair lives. The implementation is the app's decision (local storage, an encrypted
 * vault, a hardware-backed store); this module only requires that a load answers for one owner
 * and that what it answers is re-validated before use.
 */
export interface WalletKeyStore {
	load(ownerPubkey: string): Promise<WalletKeyMaterial | null>
	save(material: WalletKeyMaterial): Promise<void>
}

const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

const hexToBytes = (hex: string): Uint8Array => {
	const bytes = new Uint8Array(hex.length / 2)
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16)
	}
	return bytes
}

const requireHex = (value: unknown, expectedLength: number): string => {
	if (typeof value !== 'string' || value.trim() === '') throw new WalletKeyMaterialError('missing')
	const normalized = value.trim().toLowerCase()
	if (!HEX.test(normalized)) throw new WalletKeyMaterialError('not-hex')
	if (normalized.length !== expectedLength) throw new WalletKeyMaterialError('wrong-length')
	return normalized
}

const requireCompressedP2pk = (value: unknown): string => {
	if (typeof value !== 'string' || value.trim() === '') throw new WalletKeyMaterialError('missing')
	const normalized = value.trim().toLowerCase()
	if (!HEX.test(normalized)) throw new WalletKeyMaterialError('not-hex')
	if (normalized.length !== COMPRESSED_P2PK_HEX_LENGTH) throw new WalletKeyMaterialError('wrong-length')
	try {
		return toCompressedAuctionP2pkPubkey(normalized)
	} catch {
		// An x-only or non-secp256k1 form is a length/shape fault from this module's point of view.
		throw new WalletKeyMaterialError('wrong-length')
	}
}

/**
 * Validate and normalize a pair, refusing one whose private key does not produce the stored
 * public key. This is the invariant that keeps the HD root from moving: the root is a pure
 * function of the pair, so a mismatched pair is a *different wallet*, not a repair.
 */
export const normalizeWalletKeyMaterial = (input: {
	ownerPubkey: string
	walletP2pk: string
	walletPrivkey: string
}): WalletKeyMaterial => {
	const ownerPubkey = requireHex(input.ownerPubkey, OWNER_PUBKEY_HEX_LENGTH)
	const walletP2pk = requireCompressedP2pk(input.walletP2pk)
	const walletPrivkey = requireHex(input.walletPrivkey, SECRET_KEY_HEX_LENGTH)

	const derivedPubkey = bytesToHex(secp256k1.getPublicKey(hexToBytes(walletPrivkey), true))
	if (!auctionP2pkPubkeysMatch(derivedPubkey, walletP2pk)) throw new WalletKeyMaterialError('mismatched-pair')

	return { ownerPubkey, walletP2pk, walletPrivkey }
}

/**
 * Read the pair for one owner and re-validate it. A store that answers for a different owner,
 * or with a pair whose halves disagree, is refused rather than used — the caller has no
 * non-destructive fallback for a root that has already moved.
 */
export const loadWalletKeyMaterial = async (store: WalletKeyStore, ownerPubkey: string): Promise<WalletKeyMaterial | null> => {
	const stored = await store.load(ownerPubkey)
	if (!stored) return null
	const material = normalizeWalletKeyMaterial(stored)
	if (material.ownerPubkey !== ownerPubkey.trim().toLowerCase()) throw new WalletKeyMaterialError('wrong-owner')
	return material
}

/** The auction HD account's xpub — the value an auction publishes as `p2pk_xpub`. */
export const deriveAuctionHdXpub = async (material: WalletKeyMaterial): Promise<string> => {
	const account = await getAuctionHdAccountFromWalletKeys(material.walletP2pk, material.walletPrivkey)
	const xpub = account.publicExtendedKey
	if (!xpub) throw new WalletKeyMaterialError('underivable-root')
	return xpub
}

/**
 * The child private key for one derivation path — what a bidder needs to spend a bid locked to
 * the path's child pubkey. When the caller names the pubkey it expects (the auction's
 * `p2pk_xpub` derivation, as the path grant published it), a derivation that lands elsewhere
 * is refused before the caller locks anything.
 */
export const deriveAuctionChildPrivkey = async (
	material: WalletKeyMaterial,
	request: { derivationPath: string; expectedPubkey?: string },
): Promise<string> => {
	const account = await getAuctionHdAccountFromWalletKeys(material.walletP2pk, material.walletPrivkey)
	const xpub = account.publicExtendedKey
	if (!xpub) throw new WalletKeyMaterialError('underivable-root')

	if (request.expectedPubkey) {
		const derivedPubkey = deriveAuctionChildP2pkPubkeyFromXpub(xpub, request.derivationPath)
		if (!auctionP2pkPubkeysMatch(derivedPubkey, request.expectedPubkey)) {
			throw new WalletKeyMaterialError('unexpected-child')
		}
	}

	const child = account.derive(normalizeAuctionDerivationPath(request.derivationPath))
	if (!child.privateKey) throw new WalletKeyMaterialError('underivable-child')
	return bytesToHex(child.privateKey)
}

/** A process-local store, for tests and for a caller that has its own durability. */
export class InMemoryWalletKeyStore implements WalletKeyStore {
	private readonly byOwner = new Map<string, WalletKeyMaterial>()

	async load(ownerPubkey: string): Promise<WalletKeyMaterial | null> {
		const material = this.byOwner.get(ownerPubkey.trim().toLowerCase())
		return material ? { ...material } : null
	}

	async save(material: WalletKeyMaterial): Promise<void> {
		this.byOwner.set(material.ownerPubkey, { ...material })
	}
}
