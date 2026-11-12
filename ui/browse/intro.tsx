import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'

/**
 * The home intro.
 *
 * It is an OVERLAY, not a wrapper: the real hero renders underneath from the
 * first paint, so the last animated frame simply fades into the hero's first
 * frame — there is no second layout to keep in sync, and no way for the
 * animation to delay data (the brief's non-negotiable).
 *
 * `prefers-reduced-motion` is handled before anything renders: a visitor who
 * asks for reduced motion gets the hero's first frame and no timeline at all.
 *
 * Counters come from the caller's measured `stats` (the feed's own numbers).
 * Nothing here invents a total — `introCounters` only interpolates a value the
 * read already produced.
 */

export interface IntroStats {
	products?: number
	sellers?: number
	postedLast24h?: number
	relays?: number
}

/** How long the overlay owns the screen. Roughly the storyboard's total. */
export const INTRO_DURATION_MS = 2400

/** Progress from 0..1 at which each beat starts, per the storyboard. */
export const INTRO_BEATS = {
	flash: 0,
	logo: 0.1,
	wordmark: 0.28,
	typedMarket: 0.45,
	search: 0.62,
	stats: 0.74,
	cards: 0.86,
} as const

/**
 * The counter value at `progress` (0..1) for a target total.
 *
 * Pure and monotonic so it can be tested without a timeline: at 0 it is 0, at
 * 1 it is exactly the measured total, and it never runs backwards.
 */
export function introCounter(total: number | undefined, progress: number): number {
	if (total === undefined || total <= 0) return 0
	const clamped = Math.min(1, Math.max(0, progress))
	return Math.round(total * clamped)
}

function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined' || !window.matchMedia) return false
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface IntroOverlayProps {
	stats?: IntroStats
	/** One switch, so the intro can be turned off without reverting the code. */
	enabled?: boolean
	onDone?: () => void
}

export function IntroOverlay({ stats, enabled = true, onDone }: IntroOverlayProps) {
	const [done, setDone] = useState(false)
	const rootRef = useRef<HTMLDivElement | null>(null)
	const wordRef = useRef<HTMLSpanElement | null>(null)
	const marketRef = useRef<HTMLSpanElement | null>(null)
	const searchRef = useRef<HTMLDivElement | null>(null)
	const statsRef = useRef<HTMLParagraphElement | null>(null)

	useEffect(() => {
		if (!enabled || done) return
		if (prefersReducedMotion()) {
			setDone(true)
			onDone?.()
			return
		}
		const root = rootRef.current
		if (!root) return
		const timeline = gsap.timeline({
			defaults: { ease: 'power2.out' },
			onComplete: () => {
				setDone(true)
				onDone?.()
			},
		})
		timeline
			.fromTo(root, { opacity: 1 }, { opacity: 1, duration: 0.08 })
			.fromTo(wordRef.current, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45 })
			.fromTo(marketRef.current, { opacity: 0 }, { opacity: 1, duration: 0.35, delay: 0.1 })
			.fromTo(searchRef.current, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4 })
			.fromTo(statsRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3 })
			.to(root, { opacity: 0, duration: 0.45, delay: 0.25 })
		return () => {
			timeline.kill()
		}
	}, [enabled, done, onDone])

	if (!enabled || done) return null

	const counted = introCounter(stats?.products, INTRO_BEATS.stats)
	const sellers = introCounter(stats?.sellers, INTRO_BEATS.stats)
	const relays = introCounter(stats?.relays, INTRO_BEATS.stats)

	return (
		<div
			ref={rootRef}
			data-slot="browse-intro"
			data-testid="browse-intro"
			className="fixed inset-0 z-40 grid place-items-center bg-background pointer-events-none"
		>
			<div className="flex flex-col items-center gap-5 px-6 text-center">
				<p className="flex items-baseline gap-2 font-display text-4xl sm:text-5xl tracking-tight">
					<span ref={wordRef} className="inline-block">
						Plebeian
					</span>
					<span ref={marketRef} className="inline-block italic font-serif text-fill-ink">
						Market
					</span>
				</p>
				<div ref={searchRef} className="h-[54px] w-[min(560px,80vw)] rounded-full border border-border-strong bg-surface-raised opacity-0" />
				{stats ? (
				<p ref={statsRef} className="text-sm text-text-mid opacity-0 font-variant-numeric-tabular-nums">
					{counted.toLocaleString('en-US')} products from {sellers.toLocaleString('en-US')} sellers ·{' '}
					{relays.toLocaleString('en-US')} relays
				</p>
				) : null}
			</div>
		</div>
	)
}
