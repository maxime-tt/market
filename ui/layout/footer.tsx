import type { SocialLinks } from '@sdk/config/schemas/app'
import type { Ref } from 'react'
import { cn } from '../utils/cn'

export interface FooterProps {
	/** Instance display name; the host resolves the config fallback chain. */
	displayName: string
	termsUrl?: string
	supportContact?: string
	socialLinks?: SocialLinks
	className?: string
	ref?: Ref<HTMLElement>
}

/**
 * The site footer band: the identity line, the FAQ/Terms/Support links and the
 * social icon row.
 *
 * Lifted out of `src/components/layout/Footer.tsx` (D4 leaves, fused slice),
 * which read the config query itself and resolved the display name, the contact
 * address and the social links. The `platform/web` host now resolves that data
 * and passes it down, so this view is props-only.
 */
export function Footer({ displayName, termsUrl, supportContact, socialLinks, className, ref }: FooterProps) {
	return (
		<footer
			ref={ref}
			data-slot="footer"
			className={cn('sticky top-0 bg-fill-ink p-4 font-bold text-on-fill-ink lg:px-12 flex justify-center', className)}
		>
			<div className="container flex justify-between items-center flex-col gap-4 md:gap-0 md:flex-row">
				<div className="flex gap-4 flex-col md:flex-row items-center">
					<span>{displayName}: Powered by Nostr.</span>
					<div className="flex gap-4">
						<a className="underline" href="/faqs">
							FAQ
						</a>
						{termsUrl && (
							<a className="underline" href={termsUrl} target="_blank" rel="noopener noreferrer">
								Terms
							</a>
						)}
						{supportContact && (
							<a className="underline" href={`mailto:${supportContact}`}>
								Support
							</a>
						)}
					</div>
				</div>
				<div className="text-right flex justify-between items-center gap-6">
					{socialLinks?.nostr && (
						<a
							className="border-none hover:bg-secondary p-1 inline-flex justify-center items-center"
							href={socialLinks.nostr}
							target="_blank"
							rel="noopener noreferrer"
						>
							<img src="/images/ostrich.svg" alt="Ostrich" className="h-6 w-6" />
						</a>
					)}
					{socialLinks?.twitter && (
						<a
							href={socialLinks.twitter}
							className="border-none hover:bg-secondary p-1 inline-flex justify-center items-center"
							target="_blank"
							rel="noopener noreferrer"
						>
							<img src="/images/x.svg" alt="X" className="h-6 w-6" style={{ filter: 'invert(1)' }} />
						</a>
					)}
					{socialLinks?.newsletter && (
						<a
							className="border-none hover:bg-secondary p-1 inline-flex justify-center items-center"
							href={socialLinks.newsletter}
							target="_blank"
							rel="noopener noreferrer"
						>
							<img src="/images/substack-icon.svg" alt="Substack" className="h-6 w-6" style={{ filter: 'brightness(0) invert(1)' }} />
						</a>
					)}
					{socialLinks?.telegram && (
						<a
							className="border-none hover:bg-secondary p-1 inline-flex justify-center items-center"
							href={socialLinks.telegram}
							target="_blank"
							rel="noopener noreferrer"
						>
							<img src="/images/telegram.svg" alt="Telegram" className="h-6 w-6" style={{ filter: 'invert(1)' }} />
						</a>
					)}
					{socialLinks?.github && (
						<a
							className="border-none hover:bg-secondary p-1 inline-flex justify-center items-center"
							href={socialLinks.github}
							target="_blank"
							rel="noopener noreferrer"
						>
							<img src="/images/github.svg" alt="GitHub" className="h-6 w-6" style={{ filter: 'invert(1)' }} />
						</a>
					)}
				</div>
			</div>
		</footer>
	)
}
