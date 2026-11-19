/**
 * appbar/use-nav-fit.ts — does the nav list fit beside the brand?
 *
 * From `xl` the bar has three equal tracks, so the left lane is a third of the
 * bar. Whether the brand and the whole nav list fit inside it depends on the
 * instance name, the font the current theme gives the wordmark, and the
 * operator's pinned pages — none of which a breakpoint knows. Measured on
 * reckless at 1440px: the lane is 451px, the public wordmark + list need 445px,
 * the dashboard's wider wordmark needs 478px. A breakpoint alone truncated the
 * name and wrapped "Community" onto a second line.
 *
 * So the bar measures: the list sits inline only when it fits whole; otherwise
 * the host's menu button carries it (as below `xl`). DOM measurement only — no
 * router, store or query (see `ui/AGENTS.md`).
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Pure rule: the brand, the lane gap and the whole list must fit the lane. */
export function navFits(laneWidth: number, brandWidth: number, gap: number, navWidth: number): boolean {
	if (navWidth <= 0) return true
	return brandWidth + gap + navWidth <= laneWidth
}

/** The width an element wants with no lane constraint (a hidden max-content clone). */
function naturalWidth(el: HTMLElement): number {
	const clone = el.cloneNode(true) as HTMLElement
	clone.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:max-content;max-width:none;left:0;top:0'
	clone.setAttribute('aria-hidden', 'true')
	el.parentElement?.appendChild(clone)
	const width = clone.getBoundingClientRect().width
	clone.remove()
	return Math.ceil(width)
}

/**
 * `undefined` until measured (server render and first paint keep the plain
 * `xl` behaviour), then whether the list fits.
 */
export function useNavFit(): {
	laneRef: RefObject<HTMLDivElement | null>
	brandRef: RefObject<HTMLDivElement | null>
	navRef: RefObject<HTMLElement | null>
	fits: boolean | undefined
} {
	const laneRef = useRef<HTMLDivElement | null>(null)
	const brandRef = useRef<HTMLDivElement | null>(null)
	const navRef = useRef<HTMLElement | null>(null)
	const [fits, setFits] = useState<boolean | undefined>(undefined)

	useLayoutEffect(() => {
		const lane = laneRef.current
		const brand = brandRef.current
		const nav = navRef.current
		if (!lane || !brand || !nav || typeof ResizeObserver === 'undefined') return

		let frame = 0
		const measure = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				if (getComputedStyle(nav).display === 'none') return setFits(true)
				const gap = parseFloat(getComputedStyle(lane).columnGap) || 0
				setFits(navFits(lane.clientWidth, naturalWidth(brand), gap, naturalWidth(nav)))
			})
		}

		// The bar's height, published for layouts that sit under the sticky bar
		// (the dashboard's sticky title and full-height panes). It changes with
		// the phone's search row, so a fixed offset drifts.
		const bar = lane.closest('header')
		const publishHeight = () => {
			if (bar) document.documentElement.style.setProperty('--app-bar-h', `${Math.round(bar.getBoundingClientRect().height)}px`)
		}
		publishHeight()

		measure()
		const observer = new ResizeObserver(() => {
			publishHeight()
			measure()
		})
		if (bar) observer.observe(bar)
		observer.observe(lane)
		observer.observe(brand)
		const mutations = new MutationObserver(measure)
		mutations.observe(brand, { subtree: true, childList: true, characterData: true })
		mutations.observe(nav, { subtree: true, childList: true, characterData: true })
		window.addEventListener('resize', measure)
		// The wordmark's width changes when the bundled display font arrives.
		document.fonts?.ready.then(measure).catch(() => {})
		return () => {
			cancelAnimationFrame(frame)
			observer.disconnect()
			mutations.disconnect()
			window.removeEventListener('resize', measure)
		}
	}, [])

	return { laneRef, brandRef, navRef, fits }
}
