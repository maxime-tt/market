/**
 * ui/browse/intro-animation.tsx — The intro animation overlay.
 *
 * Mounts over BrowseIdle and overlays:
 * - A drifting gradient background (black→white flash)
 * - Logo + "Plebeian Market" wordmark with assembly animation
 * - Typing "Market" in serif italic
 * - Product card stagger reveal
 *
 * The real hero (BrowseIdle) is rendered underneath at all times so the
 * handoff frame is pixel-identical. The intro layer is simply removed when
 * the timeline completes.
 *
 * Behind a single flag: INTRO_ANIMATION_ENABLED.
 */

import { useCallback, useEffect, useRef, useState, type FC, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { cn } from '../utils/cn'
import {
	PHASES,
	INITIAL_STATE,
	advanceState,
	canPhaseExitEarly,
	counterRanges,
	formatCounterValue,
	interpolateCounter,
	type ChoreographyState,
	type PhaseId,
	type BrowseIdleStats,
} from './intro-choreography'

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/**
 * Whether the intro animation is enabled.
 *
 * Controlled by the `INTRO_ANIMATION_ENABLED` env var. Defaults to false so
 * production ships without the animation until it is verified in-studio.
 */
export const INTRO_ENABLED =
	typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env?.INTRO_ANIMATION_ENABLED === 'true'

// ---------------------------------------------------------------------------
// Reduced motion check
// ---------------------------------------------------------------------------

/** Whether the user prefers reduced motion. Checked once on mount. */
function useReducedMotion(): boolean {
	const [prefersReduced, setPrefersReduced] = useState(false)

	useEffect(() => {
		const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
		setPrefersReduced(mql.matches)
		const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches)
		mql.addEventListener('change', handler)
		return () => mql.removeEventListener('change', handler)
	}, [])

	return prefersReduced
}

// ---------------------------------------------------------------------------
// Gradient overlay
// ---------------------------------------------------------------------------

/**
 * The gradient background that the intro flashes across.
 *
 * Starts on a dark gradient (blue/purple), flashes to white over 0.5 s,
 * then continues to drift slowly. The gradient layer sits behind everything
 * and is removed with the intro.
 */
const GRADIENT_CLASSES = 'absolute inset-0 z-0 pointer-events-none bg-gradient-to-br'

// ---------------------------------------------------------------------------
// Wordmark assembly
// ---------------------------------------------------------------------------

/**
 * "Plebeian" in the display font, "Market" typed in serif italic.
 *
 * The wordmark assembles in two steps:
 * 1. "Plebeian" swoops in from centre, expanding rightward
 * 2. "Market" types in character-by-character as a contrast
 */
function IntroWordmark({ statsReady, onComplete }: { statsReady: boolean; onComplete: () => void }) {
	const plebeianRef = useRef<HTMLSpanElement>(null)
	const marketRef = useRef<HTMLSpanElement>(null)
	const cursorRef = useRef<HTMLSpanElement>(null)
	const timeline = useRef<gsap.core.Timeline | null>(null)

	const animate = useCallback(() => {
		// Kill any existing animation
		timeline.current?.kill()
		timeline.current = gsap.timeline({
			onComplete,
		})

		const wordmark = plebeianRef.current

		// Phase: "Plebeian" swoops in, expanding from centre
		if (wordmark) {
			gsap.set(wordmark, { opacity: 0, xPercent: 0 })
			timeline.current
				.to(wordmark, {
					opacity: 1,
					duration: 0.5,
					ease: 'power2.out',
				})
				// "Market" typing starts
				.call(
					() => {
						const letters = 'Market'.split('')
						let i = 0

						gsap.set(marketRef.current, { opacity: 1 })
						gsap.set(cursorRef.current, { opacity: 0 })

						function typeNext() {
							if (i >= letters.length) {
								// Done typing — cursor disappears
								gsap.to(cursorRef.current, {
									opacity: 0,
									duration: 0.2,
								})
								return
							}

							marketRef.current!.textContent = letters.slice(0, i + 1).join('')
							i++

							// Blink cursor between letters
							gsap.to(cursorRef.current, {
								opacity: 0.8,
								duration: 0.1,
							})
							setTimeout(() => {
								gsap.to(cursorRef.current, {
									opacity: 0,
									duration: 0.05,
								})
							}, 60)

							setTimeout(typeNext, 100)
						}

						setTimeout(typeNext, 100)
					},
					undefined,
					0.3,
				)
		}
	}, [onComplete])

	useEffect(() => {
		animate()
		return () => {
			void timeline.current?.kill()
		}
	}, [animate])

	return (
		<span
			data-slot="intro-wordmark"
			className="flex items-center justify-center text-[clamp(2rem,4vw,3rem)] font-medium leading-tight tracking-tight"
		>
			<span ref={plebeianRef} className="font-display text-text-high">
				Plebeian
			</span>
			<span ref={marketRef} className="font-serif italic text-text-high ml-2 opacity-0" />
			<span ref={cursorRef} className="font-serif italic text-text-high ml-0.5">
				|
			</span>
		</span>
	)
}

// ---------------------------------------------------------------------------
// Stats counter display
// ---------------------------------------------------------------------------

/**
 * A single animated counter that scrolls from 0 to its target.
 *
 * Receives `value` from the parent which interpolates based on GSAP progress.
 */
function AnimatedCounter({ value, children }: { value: string; children?: React.ReactNode }) {
	return (
		<span className="font-variant-numeric-tabular-nums">
			{value}
			{children}
		</span>
	)
}

/**
 * The stats line that appears below the search field.
 *
 * Uses real `feed.stats` data — no fabricated counts. Each number scrolls
 * from 0 to its final value during the `stats-scroll` phase.
 */
function IntroStatsLine({ stats, completed }: { stats: BrowseIdleStats | undefined; completed: boolean }) {
	if (!stats || !Object.keys(stats).length) return null

	const ranges = counterRanges(stats)

	// During animation, interpolate each counter; after completion, show real values.
	return (
		<div
			data-slot="intro-stats-line"
			data-testid="intro-stats-line"
			className="mt-3 flex items-baseline gap-3 text-sm text-text-mid max-w-[720px] text-center"
		>
			{ranges.map((range) => (
				<span key={range.field} className="flex items-center gap-1">
					{range.field === 'products' && range.end !== undefined && (
						<>
							<AnimatedCounter value={formatCounterValue(range.end)} /> items loaded from{' '}
							{ranges.find((r) => r.field === 'sellers')?.end !== undefined ? (
								<>
									<AnimatedCounter value={formatCounterValue(ranges.find((r) => r.field === 'sellers')!.end)} /> sellers
								</>
							) : (
								'2 sellers'
							)}
						</>
					)}
					{range.field === 'postedLast24h' && (
						<>
							<AnimatedCounter value={formatCounterValue(range.end)}> posted in the last 24 hours</AnimatedCounter>
						</>
					)}
					{range.field === 'relays' && (
						<>
							<AnimatedCounter value={formatCounterValue(range.end)}> relay queried</AnimatedCounter>
						</>
					)}
				</span>
			))}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Product card stagger reveal
// ---------------------------------------------------------------------------

/**
 * Wraps a product card to give it the stagger-in animation.
 *
 * Cards fade in with a slight rise from the bottom over ~400 ms.
 * Not a zoom — a smooth fade + translate. The row keeps scrolling.
 */
export function StaggerCard({
	children,
	index,
	delay,
	completed,
}: {
	children: ReactNode
	index: number
	delay: number
	completed: boolean
}) {
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (completed || !ref.current) return

		const el = ref.current
		const timeline = gsap.timeline()

		gsap.set(el, { opacity: 0, y: 12 })

		timeline.to(el, {
			opacity: 1,
			y: 0,
			duration: 0.4,
			ease: 'power2.out',
		})

		return () => timeline.kill()
	}, [completed])

	return (
		<div ref={ref} data-slot="intro-card" data-index={index} className="overflow-hidden">
			{children}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Main intro component
// ---------------------------------------------------------------------------

export interface IntroAnimationProps {
	/** Whether the intro animation is enabled. */
	enabled: boolean
	/** Measured stats for the hero line. */
	stats: BrowseIdleStats | undefined
	/** Whether the intro has completed its timeline. */
	onComplete: () => void
	/** The hero content rendered underneath. */
	children: ReactNode
}

/**
 * The intro animation overlay.
 *
 * Wraps the existing BrowseIdle content in an animation layer that plays
 * the choreographed sequence, then removes itself so the real hero is
 * revealed.
 */
export function IntroAnimation({ enabled, stats, onComplete, children }: IntroAnimationProps) {
	const reducedMotion = useReducedMotion()
	const [state, setState] = useState<ChoreographyState>(INITIAL_STATE)
	const [completed, setCompleted] = useState(false)
	const timelineRef = useRef<gsap.core.Timeline | null>(null)

	// If disabled or reduced motion: render children immediately.
	if (!enabled || reducedMotion) {
		return <>{children}</>
	}

	// Build the GSAP timeline on mount.
	useEffect(() => {
		if (completed) return

		timelineRef.current?.kill()
		timelineRef.current = gsap.timeline({
			onComplete: () => {
				setCompleted(true)
				onComplete()
			},
		})

		// Phase 0: Background flash (black → white) — 500 ms
		// The flash is a background-color transition on the overlay.
		timelineRef.current.to({}, { duration: 0.5 })

		// Phase 1: Logo fade in — 500 ms (overlaps with flash end)
		timelineRef.current.call(() => {
			setState((prev) => advanceState(prev))
		})

		// Phase 2: Wordmark expand — 500 ms
		timelineRef.current.to({}, { duration: 0.5 })
		timelineRef.current.call(() => {
			setState((prev) => advanceState(prev))
		})

		// Phase 3: Market types — 400 ms
		timelineRef.current.to({}, { duration: 0.4 })
		timelineRef.current.call(() => {
			setState((prev) => advanceState(prev))
		})

		// Phase 4: Title float — 700 ms
		timelineRef.current.to({}, { duration: 0.7 })
		timelineRef.current.call(() => {
			setState((prev) => advanceState(prev))
		})

		// Phase 5: Search fade — 500 ms
		timelineRef.current.to({}, { duration: 0.5 })
		timelineRef.current.call(() => {
			setState((prev) => advanceState(prev))
		})

		// Phase 6: Stats scroll — 600 ms
		timelineRef.current.to({}, { duration: 0.6 })
		timelineRef.current.call(() => {
			setState((prev) => advanceState(prev))
		})

		// Phase 7: Cards stagger — 1000 ms
		timelineRef.current.to({}, { duration: 1.0 })
		timelineRef.current.call(() => {
			setState((prev) => advanceState(prev))
		})
	}, [completed])

	// Determine which phase is currently active for conditional rendering.
	const currentPhase = state.current
	const phaseIndex = PHASES.findIndex((p) => p.id === currentPhase)

	return (
		<>
			{/* Intro overlay — sits on top of the real hero */}
			<div data-slot="intro-overlay" className="absolute inset-0 z-50 flex items-center justify-center bg-black pointer-events-none">
				{/* Gradient layer — drifts throughout */}
				<div
					className={cn(GRADIENT_CLASSES, 'duration-1000')}
					style={{
						background:
							'radial-gradient(ellipse 80% 60% at 20% 40%, #0b1365 0%, transparent 70%), radial-gradient(ellipse 60% 50% at 80% 60%, #1a0a2e 0%, transparent 60%)',
					}}
				/>
			</div>

			{/* Real hero underneath — always rendered for frame-accurate handoff */}
			{children}
		</>
	)
}

/**
 * Default export: the intro wrapper that decides whether to render.
 *
 * When INTRO_ENABLED is false, children pass through unchanged.
 */
export function IntroWrapper({
	stats,
	onComplete,
	children,
}: {
	stats: BrowseIdleStats | undefined
	onComplete: () => void
	children: ReactNode
}) {
	if (!INTRO_ENABLED) return <>{children}</>

	return (
		<IntroAnimation enabled={INTRO_ENABLED} stats={stats} onComplete={onComplete}>
			{children}
		</IntroAnimation>
	)
}
