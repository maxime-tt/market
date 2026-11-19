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
 * The search pill is not a stub: at the search beat it is measured onto the
 * page's own mounted field (`positionHandoffPill`), re-measured whenever the
 * page's field mounts during a slow read, and once more as the fade begins — so
 * the fade reveals the identical element in place. The page's field is preferred
 * over the nav band's. If nothing is mounted at the beat the pill stays hidden
 * rather than promising a field that is not there.
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

// ---------------------------------------------------------------------------
// Handoff: meet the page's real field, don't float a stub
// ---------------------------------------------------------------------------

/** The one search pill's own slot, whichever size the page asked for. */
export const SEARCH_FIELD_SELECTOR = '[data-slot="search-field"]'

/** The nav band, whose field is the fallback — not the page's own. */
export const APP_BAR_SELECTOR = '[data-slot="app-bar"]'

/** A field's viewport box, in the coordinates `position: fixed` consumes. */
export interface HandoffRect {
	top: number
	left: number
	width: number
	height: number
}

/**
 * The least a candidate field must expose: where it is, and whether it is the
 * nav band's. Stated as a shape (not `HTMLElement`) so the choice can be tested
 * without a DOM.
 */
export interface HandoffCandidate {
	getBoundingClientRect(): { top: number; left: number; width: number; height: number }
	closest(selector: string): unknown
}

/** The pill element the handoff moves; just the style it needs to write. */
export interface HandoffPill {
	style: { position: string; top: string; left: string; width: string; height: string }
}

/**
 * The field the intro hands off to: the page's own if one is mounted, else the
 * nav band's. A route can render two (the CMS `Search` block and the bar's
 * field); the page's is the one the overlay is fading into, so it wins.
 */
export function pickHandoffField<T extends HandoffCandidate>(fields: readonly T[]): T | null {
	if (fields.length === 0) return null
	const page = fields.find((field) => field.closest(APP_BAR_SELECTOR) === null)
	return page ?? fields[0] ?? null
}

/**
 * A field's viewport box, or `null` when there is nothing to line up with — a
 * field that is not mounted, or is measured at zero size (hidden, e.g. the nav
 * field on a page that renders its own).
 */
export function rectFromField(field: HandoffCandidate | null | undefined): HandoffRect | null {
	if (!field) return null
	const box = field.getBoundingClientRect()
	if (!(box.width > 0) || !(box.height > 0)) return null
	return { top: box.top, left: box.left, width: box.width, height: box.height }
}

/** Look the field up in the live document; `null` when nothing is mounted yet. */
export function findHandoffField(doc: Document | null | undefined): HandoffCandidate | null {
	if (!doc) return null
	return pickHandoffField(Array.from(doc.querySelectorAll<HTMLElement>(SEARCH_FIELD_SELECTOR)))
}

/**
 * Move the pill exactly onto the page's real field, so the overlay's fade
 * reveals the identical element rather than a second, dead pill.
 *
 * Returns the rect it aligned to, or `null` when there is no field to meet —
 * the caller then keeps the pill hidden instead of promising a bar the page
 * cannot hand back. Positioned `fixed`: the coordinates are viewport ones, and
 * the pill's ancestors carry no transform, so they are the field's own.
 */
export function positionHandoffPill(
	pill: HandoffPill | null | undefined,
	doc: Document | null | undefined = typeof document === 'undefined' ? null : document,
): HandoffRect | null {
	if (!pill) return null
	const rect = rectFromField(findHandoffField(doc))
	if (!rect) return null
	pill.style.position = 'fixed'
	pill.style.top = `${rect.top}px`
	pill.style.left = `${rect.left}px`
	pill.style.width = `${rect.width}px`
	pill.style.height = `${rect.height}px`
	return rect
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

		/*
		 * The page's own field does not exist yet in a slow read — the home page is
		 * read from relays while the intro plays, so the bar's field is the only one
		 * mounted at the start. Align on the beat that shows the pill, keep watching
		 * for the page's field to mount, and take a final measurement as the fade
		 * begins. `fadeStarted` closes the window: moving the pill once the fade is
		 * running would flicker it, so the fade's own start is the last alignment.
		 */
		let fadeStarted = false
		let observer: MutationObserver | null = null
		let searchTween: gsap.core.Tween | null = null

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

		// The search beat. Align to whatever is mounted *now* — the page's field if
		// it has arrived, else the bar's — and reveal only if there is a real field
		// to meet. The no-op tween holds the beat's 0.4s so the later beats keep
		// their place whether or not the pill appears.
		timeline.call(() => {
			const pill = searchRef.current
			if (!pill) return
			if (positionHandoffPill(pill)) {
				searchTween = gsap.fromTo(pill, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' })
			} else {
				// Nothing to meet: keep the pill out rather than faking a field.
				gsap.set(pill, { opacity: 0 })
			}
		})
		timeline.to({}, { duration: 0.4 })

		timeline.fromTo(statsRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3 })

		// The fade. Take the last honest measurement — the page's field may have
		// mounted a moment ago — then stop following.
		timeline.to(root, {
			opacity: 0,
			duration: 0.45,
			delay: 0.25,
			onStart: () => {
				fadeStarted = true
				observer?.disconnect()
				positionHandoffPill(searchRef.current)
			},
		})

		/*
		 * Follow the page's field as it mounts (and the bar's as it unmounts). A
		 * field's arrival/removal is a child-list change; the styles gsap writes are
		 * attributes, which this observer does not watch, so there is no feedback
		 * loop. Bounded: it only ever writes the pill's box once per change and is
		 * disconnected the instant the fade starts.
		 */
		if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
			observer = new MutationObserver(() => {
				if (!fadeStarted) positionHandoffPill(searchRef.current)
			})
			observer.observe(document.body, { childList: true, subtree: true })
		}

		return () => {
			observer?.disconnect()
			searchTween?.kill()
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
			/*
			 * `z-[60]` clears the nav band (`sticky top-0 z-50`), so the intro owns
			 * the whole screen for its duration instead of the band painting over it.
			 * Safe because the overlay is `pointer-events-none` and unmounts on
			 * `done`: the band is covered for the 2.4s, then reachable again — never
			 * unreachable, never covering the page after it ends.
			 */
			className="fixed inset-0 z-[60] grid place-items-center bg-background pointer-events-none"
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
				{/*
				 * The handoff slot keeps the column's rhythm (the wordmark and stats
				 * do not move when the pill leaves the flow); the pill inside is moved
				 * onto the page's real field by `positionHandoffPill`, so the fade
				 * reveals the identical element underneath.
				 */}
				<div data-slot="intro-search-slot" className="h-[54px] w-[min(560px,80vw)]">
					<div
						ref={searchRef}
						data-slot="intro-search"
						className="h-full w-full rounded-full border border-border-strong bg-surface-raised opacity-0"
					/>
				</div>
				{stats ? (
					<p ref={statsRef} className="text-sm text-text-mid opacity-0 font-variant-numeric-tabular-nums">
						{counted.toLocaleString('en-US')} products from {sellers.toLocaleString('en-US')} sellers · {relays.toLocaleString('en-US')}{' '}
						relays
					</p>
				) : null}
			</div>
		</div>
	)
}
