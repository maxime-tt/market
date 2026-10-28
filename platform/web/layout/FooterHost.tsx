import type { PublicAppConfig } from '@sdk/config/instance-config'
import { Footer } from '@ui/layout/footer'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'

/**
 * `platform/web/layout/FooterHost.tsx` — the React binding for the site footer
 * (D4 leaves, fused slice). It reads the public config query and hands the
 * footer its identity, terms/support links and social links.
 *
 * It declares no presentation of its own and imports no `@/` specifier: the
 * config read goes through the platform query, so it adds no `platform -> src`
 * edge.
 */
export function footerPropsFromConfig(config: PublicAppConfig | undefined) {
	return {
		displayName: config?.displayName || config?.name || 'Marketplace',
		termsUrl: config?.termsUrl,
		supportContact: config?.supportContact || config?.contactEmail,
		socialLinks: config?.socialLinks,
	}
}

/** The bound footer: resolves the config query, delegates rendering to the ui/ view. */
export function FooterHost() {
	const { data } = useConfigQuery()

	return <Footer {...footerPropsFromConfig(data)} />
}
