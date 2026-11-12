import { Media } from '@ui/shared/media'
import { Link } from '@tanstack/react-router'
import { UiProvider, type UiComponents, type UiImageProps, type UiLinkProps } from '@ui/provider/UiProvider'
import type { ReactNode } from 'react'

function HostImage({ src, alt, className }: UiImageProps) {
	return <Media src={src} alt={alt} className={className} />
}

function HostLink({ href, className, tabIndex, onClick, children }: UiLinkProps) {
	const isInternal = href.startsWith('/') && !href.startsWith('//')
	if (!isInternal) {
		// Hrefs may originate from relay data; only allow safe external schemes.
		if (!/^(https?:|mailto:)/i.test(href)) return <span className={className}>{children}</span>
		return (
			<a href={href} className={className} tabIndex={tabIndex} onClick={onClick} target="_blank" rel="noopener noreferrer">
				{children}
			</a>
		)
	}
	// UI passes untyped paths; the router still resolves and validates them at runtime.
	// A path may carry a query string (the Browse product deep links do), which the
	// router's `to` does not parse: split it and hand the params over as `search`,
	// so the rendered anchor has the real `?…` href and client navigation resolves
	// the same location.
	const [pathname, searchString] = href.split('?')
	const search = searchString ? Object.fromEntries(new URLSearchParams(searchString)) : undefined
	return (
		<Link to={pathname as never} search={search as never} className={className} tabIndex={tabIndex} onClick={onClick}>
			{children}
		</Link>
	)
}

const hostComponents: Partial<UiComponents> = { Image: HostImage, Link: HostLink }

/** Platform composition: supplies the web host's primitives to UI components. */
export function WebUiProvider({ children }: { children: ReactNode }) {
	return <UiProvider components={hostComponents}>{children}</UiProvider>
}
