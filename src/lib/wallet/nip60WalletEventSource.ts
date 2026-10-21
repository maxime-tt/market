/**
 * nip60WalletEventSource.ts — the `WalletKeyMigrationSource` the app runs, over the relay.
 *
 * This is the one place the cut still reads NIP-60 from a relay, and it exists to be deleted:
 * once an owner's keypair is local, nothing consults the event again (the migration is one-way
 * and refuses to overwrite), so this module can go when the relay path does.
 *
 * It is written as a port pair rather than a direct relay call, so that the fetch and the
 * decryption are supplied by the app and the behaviour is testable without either. The signer
 * does the decryption — this module never holds the key that opens the event.
 *
 * The rule worth stating: a failure to *open* the event is raised, never answered as "no
 * pairs". The migration reads an empty candidate list as `nothing-to-migrate`, and a caller
 * that takes that route may create a fresh wallet over a real one. An unreadable event is a
 * failure, not an absence — the same distinction the migration's `local-unreadable` makes on
 * the other side.
 */
import { parseNip60WalletEventContent } from './nip60WalletEvent'
import type { WalletKeyPairCandidate } from './nip60WalletEvent'
import type { WalletKeyMigrationSource } from './walletKeyMigration'

/** Raised when the event exists but cannot be opened or read. Carries no value. */
export class WalletEventUnreadableError extends Error {
	constructor() {
		super('wallet event unreadable: the signer could not open the stored wallet event')
		this.name = 'WalletEventUnreadableError'
	}
}

export interface WalletEventReader {
	/** The latest kind-17375 event's content for this owner, as stored, or null if there is none. */
	readWalletEventContent(ownerPubkey: string): Promise<string | null>
	/** NIP-44 to self. The owner is both sender and recipient. */
	decrypt(ciphertext: string): Promise<string>
}

export const createRelayWalletKeyMigrationSource = (reader: WalletEventReader): WalletKeyMigrationSource => ({
	loadWalletPairs: async (ownerPubkey: string): Promise<WalletKeyPairCandidate[]> => {
		const content = await reader.readWalletEventContent(ownerPubkey)
		// no event at all is a real absence
		if (content === null || content === '') return []

		let plaintext: string
		try {
			plaintext = await reader.decrypt(content)
		} catch {
			// an event we cannot open is NOT "no wallet" — see the module note
			throw new WalletEventUnreadableError()
		}

		return parseNip60WalletEventContent(plaintext).pairs
	},
})
