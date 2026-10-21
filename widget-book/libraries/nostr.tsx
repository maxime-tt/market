import { NpubDisplay } from '@ui/nostr/npub-display'
import { VerifiedBadge } from '@ui/nostr/verified-badge'
import type { WidgetLibrary } from '../libraries'

/**
 * Nostr identity rendering. Each entry is a literal-prop render so the gallery
 * and the Playwright spec show a deterministic state.
 *
 * These components are presentation-only: the host resolves the npub and the
 * NIP-05 state and passes them in, so the library needs no query plumbing.
 */

const SAMPLE_NPUB = 'npub1plebeianmarket0000000000000000000000000000000000000000000000'

export const nostr: WidgetLibrary = {
	name: 'nostr',
	entries: [
		{
			name: 'NpubDisplay',
			render: () => <NpubDisplay npub={SAMPLE_NPUB} />,
		},
		{
			name: 'NpubDisplayShort',
			render: () => <NpubDisplay npub={SAMPLE_NPUB} head={6} tail={4} />,
		},
		{
			name: 'VerifiedBadgeVerified',
			render: () => <VerifiedBadge state="verified" nip05="shop@plebeian.market" />,
		},
		{
			name: 'VerifiedBadgeInvalid',
			render: () => <VerifiedBadge state="invalid" nip05="shop@plebeian.market" />,
		},
		{
			name: 'VerifiedBadgeLoading',
			render: () => <VerifiedBadge state="loading" nip05="shop@plebeian.market" />,
		},
		{
			name: 'VerifiedBadgeAddressHidden',
			render: () => <VerifiedBadge state="verified" showAddress={false} />,
		},
	],
}
