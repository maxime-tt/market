import { FeaturedUserCardView, type FeaturedUserCardRenderLink } from '@ui/nostr/featured-user-card'
import { NpubDisplay } from '@ui/nostr/npub-display'
import { VerifiedBadge } from '@ui/nostr/verified-badge'
import { PubkeyField } from '@ui/nostr/pubkey-field'
import { ShieldIcon } from 'lucide-react'
import type { WidgetLibrary } from '../libraries'

/**
 * Nostr identity rendering. Each entry is a literal-prop render so the gallery
 * and the Playwright spec show a deterministic state.
 *
 * These components are presentation-only: the host resolves the npub and the
 * NIP-05 state and passes them in, so the library needs no query plumbing.
 */

const SAMPLE_NPUB = 'npub1plebeianmarket0000000000000000000000000000000000000000000000'
const SAMPLE_HEX = '86a82cab18b293f53cbaaae8cdcbee3f7ec427fdf9f9c933db77800bb5ef38a0'

/**
 * The catalogue cannot use the app router (libraries may only import `ui/` and
 * `sdk/`), so the featured card's injected link renderer is a plain anchor.
 */
const plainLink: FeaturedUserCardRenderLink = ({ href, className, children }) => (
	<a href={href} className={className}>
		{children}
	</a>
)

const SAMPLE_PRODUCTS = [
	{ id: 'p1', href: '/product/p1', imageUrl: 'https://placehold.co/96x96/131313/ff3eb5?text=1' },
	{ id: 'p2', href: '/product/p2', imageUrl: 'https://placehold.co/96x96/ff3eb5/131313?text=2' },
	{ id: 'p3', href: '/product/p3' },
]

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
		{
			name: 'FeaturedUserCard',
			render: () => (
				<FeaturedUserCardView
					profileHref="/profile/abc"
					displayName="Mugsmith"
					about="Handmade ceramics, fired in small batches."
					picture="https://placehold.co/400x400/ff3eb5/131313?text=M"
					productCount={12}
					products={SAMPLE_PRODUCTS}
					renderLink={plainLink}
				/>
			),
		},
		{
			name: 'FeaturedUserCardNoProducts',
			render: () => (
				<FeaturedUserCardView
					profileHref="/profile/abc"
					displayName="New Seller"
					picture="https://placehold.co/400x400/131313/ff3eb5?text=N"
					productCount={0}
					renderLink={plainLink}
				/>
			),
		},
		{
			name: 'PubkeyField',
			render: () => (
				<div className="w-96">
					<PubkeyField label="App Public Key" npub={SAMPLE_NPUB} hex={SAMPLE_HEX} icon={<ShieldIcon />} />
				</div>
			),
		},
		{
			name: 'FeaturedUserCardLoading',
			render: () => (
				<FeaturedUserCardView
					profileHref="/profile/abc"
					displayName="Loading Seller"
					picture="https://placehold.co/400x400/131313/ff3eb5?text=L"
					productCount={0}
					isLoadingProducts
					renderLink={plainLink}
				/>
			),
		},
	],
}
