/**
 * ui/browse/intro-google-mode.tsx — Logo → blank home (Google mode) (§5.2).
 *
 * Clicking the Plebeian logo during idle state triggers:
 * 1. Search bar animates down to centre over a blank white background
 * 2. Page contents (strips, category rows, CTAs) fade away over 300 ms
 * 3. After ~1500 ms with no typing, products fade back in staggered over 800 ms
 * 4. Search bar returns to original hero position
 *
 * Does not modify: route state, search query, or existing navigation logic.
 * Purely a visual layer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'

export interface GoogleModeProps {
	/** Whether the logo was clicked (triggering Google mode). */
	active: boolean
	/** Duration to wait before fading products back in (ms). */
	returnDelay?: number
	/** Callback when Google mode ends. */
	onExit: () => void
}

/**
 * Google mode — the logo click brings search to centre on a blank background.
 *
 * This is a full-screen overlay that captures the search interaction,
 * then fades products back in. It never modifies route state.
 */
export function GoogleMode({ active, returnDelay = 1500, onExit }: GoogleModeProps) {
	const overlayRef = useRef<HTMLDivElement>(null)
	const searchRef = useRef<HTMLDivElement>(null)
	const contentRef = useRef<HTMLDivElement>(null)
	const timeline = useRef<gsap.core.Timeline | null>(null)
	const [visible, setVisible] = useState(false)

	// Show the overlay when Google mode activates.
	useEffect(() => {
		if (!active) return

		setVisible(true)
		timeline.current?.kill()
		timeline.current = gsap.timeline()

		const overlay = overlayRef.current
		const search = searchRef.current
		const content = contentRef.current

		if (!overlay || !search || !content) return

		// 1. Fade in the blank overlay
		gsap.set(overlay, { display: 'flex', opacity: 0 })
		timeline.current.to(overlay, {
			opacity: 1,
			duration: 0.2,
			ease: 'power2.out',
		})

		// 2. Position search at centre
		gsap.set(search, { display: 'flex', opacity: 0, y: 30 })
		timeline.current.to(
			search,
			{
				opacity: 1,
				y: 0,
				duration: 0.3,
				ease: 'power2.out',
			},
			'-=0.1',
		)

		// 3. Fade out page content
		timeline.current.to(
			content,
			{
				opacity: 0,
				duration: 0.3,
				ease: 'power2.in',
			},
			'-=0.2',
		)

		// 4. After delay, fade products back in staggered
		const productTimeline = gsap.timeline({
			onComplete: onExit,
		})

		// Find all product cards in the overlay and stagger them in
		productTimeline.fromTo(
			'.intro-google-card',
			{ opacity: 0, y: 12 },
			{
				opacity: 1,
				y: 0,
				duration: 0.4,
				ease: 'power2.out',
				stagger: {
					each: 0.05,
					from: 'start',
				},
				delay: returnDelay / 1000,
			},
		)
	}, [active, returnDelay, onExit])

	// Hide the overlay when Google mode exits.
	useEffect(() => {
		if (active) return

		const overlay = overlayRef.current
		if (!overlay) return

		const tl = gsap.timeline({
			onComplete: () => setVisible(false),
		})

		tl.to(overlay, {
			opacity: 0,
			duration: 0.2,
			ease: 'power2.in',
		})
	}, [active])

	if (!visible && !active) return null

	return (
		<div ref={overlayRef} data-slot="intro-google-mode" className="fixed inset-0 z-[60] flex items-center justify-center bg-white">
			{/* Centre search bar */}
			<div ref={searchRef} data-slot="intro-google-search" className="w-full max-w-[600px] px-4">
				<div
					data-testid="intro-google-search-field"
					className="mx-auto w-full max-w-[560px] rounded-full border border-border-default px-5 py-3 bg-surface-raised shadow-sm text-text-high text-sm"
				>
					{/* Search field slot rendered by the host */}
				</div>
			</div>

			{/* Product cards fade back in here */}
			<div ref={contentRef} className="mt-8 w-full max-w-[1120px] px-4">
				{/* Products render as staggered cards */}
				<div
					className="intro-google-card grid grid-cols-3 gap-5 mt-5"
					style={{
						gridTemplateColumns: 'repeat(auto-fit, minmax(0, 320px))',
						justifyContent: 'center',
					}}
				>
					{/* Cards populated by the host's feed data */}
				</div>
			</div>
		</div>
	)
}
