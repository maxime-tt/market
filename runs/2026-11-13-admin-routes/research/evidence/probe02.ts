// Probe: exercise the real vanity read functions against synthetic tag sets.
import { readVanityEntries, parseVanitySettings, resolveVanity, isVanityAvailable, VANITY_REGISTRY } from '@sdk/core/curation/vanityRead'

const NOW = 1_800_000_000
const P = 'a'.repeat(64)

const cases: Record<string, string[][]> = {
	'validUntil in the future (2030)': [['vanity', 'home', P, '1900000000']],
	'validUntil = 0 (the "no expiry" idiom)': [['vanity', 'home', P, '0']],
	'validUntil = empty string': [['vanity', 'home', P, '']],
	'tag with only 3 elements (no validUntil)': [['vanity', 'home', P]],
	'non-numeric validUntil': [['vanity', 'home', P, 'never']],
	'negative validUntil': [['vanity', 'home', P, '-1']],
}

console.log('VANITY_REGISTRY =', JSON.stringify(VANITY_REGISTRY))
console.log('now =', NOW)
for (const [label, tags] of Object.entries(cases)) {
	const entries = readVanityEntries(tags)
	const settings = parseVanitySettings([{ kind: 30000, created_at: NOW - 10, tags, pubkey: P } as never])
	const resolved = resolveVanity(settings, 'home', NOW)
	console.log(
		JSON.stringify({
			label,
			entriesParsed: entries.length,
			entries,
			resolveVanity: resolved,
			isAvailable: isVanityAvailable(settings, 'home', NOW),
		}),
	)
}

// Is the newest event the one that wins, and can a second event silently drop a route?
const oldEv = { kind: 30000, created_at: NOW - 100, tags: [['d', 'vanity-urls'], ['vanity', 'home', P, '1900000000']], pubkey: P }
const newEv = { kind: 30000, created_at: NOW - 10, tags: [['d', 'vanity-urls'], ['vanity', 'shop', P, '1900000000']], pubkey: P }
const merged = parseVanitySettings([oldEv, newEv] as never)
console.log('whole-event-replacement check:', JSON.stringify({ entries: merged.entries.map((e) => e.vanityName), homeStillResolves: !!resolveVanity(merged, 'home', NOW) }))