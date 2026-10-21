/**
 * walletKeyStore.ts — where the wallet's P2PK keypair is kept, and under what protection.
 *
 * `walletKeys.ts` decides what the material *is* and refuses material it cannot trust; this
 * module decides where it lives. The private half is sealed with NIP-44 to the owner's own
 * pubkey before it touches storage, because that one key is what every auction address of that
 * owner derives from: a store that is read — a shared machine, a synced browser profile, a
 * backup — must yield ciphertext rather than the material to reconstruct the wallet.
 *
 * There is deliberately no plaintext path in this file. A record that cannot be opened is a
 * refusal, never a reason to fall back to the clear, and no refusal interpolates a value, so a
 * hostile record cannot turn a refusal into a leak.
 *
 * Both the sealer and the storage are injected: the app owns the signer and the storage
 * location, and the tests own neither a browser nor a relay.
 */
import type { WalletKeyMaterial, WalletKeyStore } from './walletKeys'

/**
 * The NIP-44 surface a signer offers. The argument order matches the app's signer
 * (`nip44.encrypt(recipientPubkey, plaintext)`), so the adapter is a direct pass-through and no
 * argument can be swapped by accident.
 */
export interface WalletKeySealer {
	encrypt(recipientPubkey: string, plaintext: string): Promise<string>
	decrypt(senderPubkey: string, ciphertext: string): Promise<string>
}

/** The user-scoped key/value storage the app already owns (`@/lib/wallet/storage`). */
export interface WalletKeyStorage {
	load<T>(key: string, fallback: T): T
	save<T>(key: string, value: T): void
	remove(key: string): void
}

/** The closed refusal vocabulary. A code names the reason and interpolates no value. */
export type WalletKeyStoreReason = 'malformed' | 'unopenable' | 'wrong-owner'

export class WalletKeyStoreError extends Error {
	readonly code: WalletKeyStoreReason

	constructor(reason: WalletKeyStoreReason) {
		super(`wallet key store refused: ${reason}`)
		this.name = 'WalletKeyStoreError'
		this.code = reason
	}
}

const SCHEMA_VERSION = 'wallet-key-v1'
const KEY_PREFIX = 'wallet_key_material'

/** One owner's record: the public halves in the clear, the private half sealed. */
interface SealedRecord {
	schemaVersion: string
	ownerPubkey: string
	walletP2pk: string
	sealedPrivkey: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A `WalletKeyStore` whose private half never reaches storage unsealed.
 *
 * Records are filed per owner, so two accounts on one device cannot read each other's material
 * — a different owner simply has no record, which is the truthful answer. The owner is also
 * re-checked inside the record, so a record moved between slots is refused rather than used.
 */
export class SealedWalletKeyStore implements WalletKeyStore {
	private readonly sealer: WalletKeySealer
	private readonly storage: WalletKeyStorage
	private readonly keyPrefix: string

	constructor(deps: { sealer: WalletKeySealer; storage: WalletKeyStorage; keyPrefix?: string }) {
		this.sealer = deps.sealer
		this.storage = deps.storage
		this.keyPrefix = deps.keyPrefix ?? KEY_PREFIX
	}

	private storageKey(ownerPubkey: string): string {
		return `${this.keyPrefix}:${ownerPubkey}`
	}

	async load(ownerPubkey: string): Promise<WalletKeyMaterial | null> {
		const owner = ownerPubkey.trim().toLowerCase()
		const stored = this.storage.load<unknown>(this.storageKey(owner), null)
		if (stored === null || stored === undefined) return null

		if (!isRecord(stored) || stored.schemaVersion !== SCHEMA_VERSION) {
			throw new WalletKeyStoreError('malformed')
		}
		const { ownerPubkey: recordedOwner, walletP2pk, sealedPrivkey } = stored
		if (typeof recordedOwner !== 'string' || typeof walletP2pk !== 'string' || typeof sealedPrivkey !== 'string') {
			throw new WalletKeyStoreError('malformed')
		}
		if (recordedOwner !== owner) throw new WalletKeyStoreError('wrong-owner')

		let walletPrivkey: string
		try {
			// NIP-44 to self: the owner is both the sender and the recipient.
			walletPrivkey = await this.sealer.decrypt(owner, sealedPrivkey)
		} catch {
			throw new WalletKeyStoreError('unopenable')
		}

		// The caller re-validates the pair; this only reconstructs the shape.
		return { ownerPubkey: owner, walletP2pk, walletPrivkey }
	}

	async save(material: WalletKeyMaterial): Promise<void> {
		const owner = material.ownerPubkey.trim().toLowerCase()
		const sealedPrivkey = await this.sealer.encrypt(owner, material.walletPrivkey)
		const record: SealedRecord = {
			schemaVersion: SCHEMA_VERSION,
			ownerPubkey: owner,
			walletP2pk: material.walletP2pk,
			sealedPrivkey,
		}
		this.storage.save(this.storageKey(owner), record)
	}

	/** Forget one owner's material. Used when a wallet is deliberately replaced, never on failure. */
	async forget(ownerPubkey: string): Promise<void> {
		this.storage.remove(this.storageKey(ownerPubkey.trim().toLowerCase()))
	}
}
