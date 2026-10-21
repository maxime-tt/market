/**
 * walletKeyMigration.ts — the one-way move of the keypair from the relay event to the local store.
 *
 * Until now the pair existed in exactly one place: the `privkeys` list inside the owner's
 * NIP-44-encrypted kind-17375 wallet event. `walletKeys.ts` derives every auction address from
 * that pair, so a migration that writes a *different* pair does not "repair" anything — it moves
 * the owner's HD root and strands whatever is locked to the old one. The rules below exist for
 * that reason and are the whole point of the module:
 *
 *   1. **A local copy is never overwritten.** The move is one-way and runs once. If the store
 *      already answers with material, the source is not even consulted.
 *   2. **A local copy that cannot be opened stops the migration.** It is not treated as absent,
 *      because "absent" is an invitation to write, and writing here can move the root.
 *   3. **The source pair is validated before it is saved**, so a stale or mismatched event
 *      cannot put a pair into the store that the store would then have to refuse.
 *   4. **Nothing is written when there is nothing to migrate.**
 *
 * The source is injected, so this module imports neither the relay client nor the wallet library;
 * the app passes a reader, and the tests pass a stand-in.
 */
import { normalizeWalletKeyMaterial } from './walletKeys'
import { selectWalletKeyPair } from './nip60WalletEvent'
import type { WalletKeyPairCandidate } from './nip60WalletEvent'
import type { WalletKeyMaterial, WalletKeyStore } from './walletKeys'

/**
 * Where the pair currently lives: the owner's existing relay wallet event.
 *
 * It answers with **candidates**, plural, because that event carries a list of keys. Selecting
 * one is {@link selectWalletKeyPair}'s job, against a pubkey the caller names — a source that
 * returned one pair would be choosing, and choosing is how an HD root moves.
 */
export interface WalletKeyMigrationSource {
	/** Every keypair the owner's kind-17375 event carries; empty when the owner has none. */
	loadWalletPairs(ownerPubkey: string): Promise<WalletKeyPairCandidate[]>
}

export type WalletKeyMigrationOutcome = 'already-local' | 'migrated' | 'nothing-to-migrate' | 'no-matching-pair' | 'local-unreadable'

export interface WalletKeyMigrationResult {
	readonly outcome: WalletKeyMigrationOutcome
	/** The material the caller should use, or null when there is none to use. */
	readonly material: WalletKeyMaterial | null
}

export const migrateWalletKeyMaterial = async (deps: {
	store: WalletKeyStore
	source: WalletKeyMigrationSource
	ownerPubkey: string
	/**
	 * The pubkey this caller means. When the event holds several keys the expectation is what
	 * decides, and an unmatched expectation is reported rather than resolved by picking one.
	 */
	expectedP2pk?: string
}): Promise<WalletKeyMigrationResult> => {
	const owner = deps.ownerPubkey.trim().toLowerCase()

	// 1 + 2: what is already local is final. An unreadable local record is a stop, not an absence.
	let local: WalletKeyMaterial | null
	try {
		const stored = await deps.store.load(owner)
		local = stored ? normalizeWalletKeyMaterial(stored) : null
	} catch {
		// Absence is an invitation to write and a refusal is not, so anything the store refuses
		// about a record it already holds ends the migration here.
		return { outcome: 'local-unreadable', material: null }
	}
	if (local && local.ownerPubkey === owner) return { outcome: 'already-local', material: local }
	if (local) {
		// the store answered for someone else; walletKeys refuses that, and so does this
		return { outcome: 'local-unreadable', material: null }
	}

	// 3: the event's keys are candidates until the caller's expectation names one
	const candidates = await deps.source.loadWalletPairs(owner)
	if (candidates.length === 0) return { outcome: 'nothing-to-migrate', material: null }

	const selected = selectWalletKeyPair(candidates, deps.expectedP2pk)
	if (!selected) return { outcome: 'no-matching-pair', material: null }

	// 4: validate before writing, so a stale event cannot seed the store with a bad pair
	const material = normalizeWalletKeyMaterial({ ownerPubkey: owner, ...selected })
	await deps.store.save(material)
	return { outcome: 'migrated', material }
}
