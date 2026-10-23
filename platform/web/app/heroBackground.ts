import type { CSSProperties } from 'react'

/**
 * Style for a hero band whose background image the host supplies.
 *
 * Replaces the former `useHeroBackground` hook, which injected a per-page
 * `<style>` rule into `document.head` and tore it down on navigation. The band
 * now carries the image as a CSS custom property that `.bg-hero-image`
 * (`styles/globals.css`) consumes, so there is no runtime stylesheet, no
 * per-page class name, and no cleanup race on route changes.
 *
 * Returns `undefined` when there is no image, so the caller keeps whatever
 * fallback class it chose (`bg-gray-700` / `bg-black`).
 */
export function heroBackgroundStyle(imageUrl: string | null | undefined): CSSProperties | undefined {
	if (!imageUrl) return undefined
	return { '--hero-image': `url("${imageUrl}")` } as CSSProperties
}
