import { useEffect } from 'react'

/**
 * Injects a one-rule stylesheet that sets a hero band's background image.
 *
 * This previously existed as seven byte-identical copies, one per hero route,
 * differing only in the indentation *inside* the injected CSS string. It lives
 * in the assembler layer rather than `ui/` because it touches `document.head`,
 * and `ui/`'s utils are pure with no I/O.
 *
 * Tracked improvement, deliberately NOT done here: injecting a rule into
 * `document.head` at runtime is what the discovery flagged (a per-page class
 * name plus a global style element, torn down on navigation). The intended
 * replacement is a CSS custom property on the hero band itself, which removes
 * this hook entirely — but that changes how the background is applied, so it
 * needs a browser check first. This change is a pure de-duplication and does
 * not alter what is rendered.
 */
export function useHeroBackground(imageUrl: string, className: string) {
	useEffect(() => {
		if (!imageUrl) return

		const style = document.createElement('style')
		style.textContent = `
			.${className} {
				background-image: url(${imageUrl}) !important;
			}
		`
		document.head.appendChild(style)

		return () => {
			document.head.removeChild(style)
		}
	}, [imageUrl, className])
}
