/**
 * ui/browse/intro-search-on-type.tsx — Search-on-type animation (§5.1).
 *
 * Typing in the hero search field triggers:
 * 1. Animate the search field upward toward the nav position
 * 2. Fade page contents away as results stream in
 *
 * Does not modify: existing scroll handoff, route state, or nav search logic.
 * Purely an overlay animation layer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'

export interface SearchOnTypeProps {
	/** Current search value — changes on every keystroke. */
	value: string
	/** Whether results are streaming (search active). */
	isSearching: boolean
	/** The search field ref so we can target it for animation. */
	searchFieldRef: React.RefObject<HTMLElement | null>
}

/**
 * Animates the search field upward and fades page contents when typing begins.
 *
 * When the user types in the hero search:
 * - The field slides up to the nav position
 * - Page contents fade to 30% opacity as results stream in
 * - On clearing, everything returns to normal
 */
export function SearchOnType({ value, isSearching, searchFieldRef }: SearchOnTypeProps) {
	const contentRef = useRef<HTMLElement | null>(null)
	const [isFading, setIsFading] = useState(false)
	const fadeTimeline = useRef<gsap.core.Timeline | null>(null)

	// Animate: fade contents when searching, restore when clearing.
	const animate = useCallback(() => {
		fadeTimeline.current?.kill()

		if (isSearching && value.length > 0 && searchFieldRef.current) {
			setIsFading(true)
			const el = searchFieldRef.current
			fadeTimeline.current = gsap.timeline()

			// Fade out the search field as it moves up
			fadeTimeline.current.to(el, {
				opacity: 0,
				y: -60,
				duration: 0.3,
				ease: 'power2.in',
			})

			// Fade page content
			if (contentRef.current) {
				fadeTimeline.current.to(contentRef.current, {
					opacity: 0.3,
					duration: 0.3,
					ease: 'power2.in',
					// Delay until search field is done fading
					delay: 0.1,
				})
			}
		} else if (isFading) {
			// Restore: field slides back down, content returns to full opacity
			const el = searchFieldRef.current
			fadeTimeline.current = gsap.timeline()

			if (el) {
				fadeTimeline.current.fromTo(el, { opacity: 0, y: -60 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' })
			}

			if (contentRef.current) {
				fadeTimeline.current.to(contentRef.current, {
					opacity: 1,
					duration: 0.3,
					ease: 'power2.out',
					delay: 0.1,
				})
			}

			setIsFading(false)
		}
	}, [isSearching, value, searchFieldRef, isFading])

	useEffect(() => {
		animate()
		return () => {
			void fadeTimeline.current?.kill()
		}
	}, [animate])

	// Wrapper for content that fades during search.
	// Pass this ref to the content container you want to fade.
	const getContentRef = useCallback((el: HTMLElement | null) => {
		contentRef.current = el
	}, [])

	return { getContentRef, isFading }
}
