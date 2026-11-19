/**
 * useAdminPortalTheme — pop-ups opened from the console wear the console theme.
 *
 * Dialogs, popovers, menus and selects render through portals straight into
 * `<body>`, outside `.admin-console`, so they used to keep the public tokens
 * (ADR-0022, "known limitation"). While the dashboard is mounted this hook tags
 * each new top-level portal node with `.admin-portal` and the admin's
 * `data-admin-*` attributes, which `styles/admin-theme.css` gives the same
 * tokens as the console.
 *
 * Only pop-ups that were OPENED FROM INSIDE the console are tagged. The header's
 * account menu and wallet popup (ADR-0022: the wallet follows the public theme)
 * and anything opened from the editor's live preview keep the public theme.
 * The opener is the trigger Radix links by `aria-controls`, or, for dialogs
 * opened in code, the element that had focus just before the pop-up appeared.
 */
import { useEffect } from 'react'
import type { AdminAppearance } from '@ui/admin-theme/admin-appearance'

const POPUP_ROLES = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]'

/** Is this opener inside the console and outside the storefront preview? */
export function openerIsConsole(opener: Element | null): boolean {
	if (!opener) return false
	return !!opener.closest('.admin-console') && !opener.closest('[data-storefront-theme]')
}

export function useAdminPortalTheme(appearance: AdminAppearance, resolvedMode: 'light' | 'dark'): void {
	useEffect(() => {
		if (typeof document === 'undefined') return
		const apply = (node: HTMLElement) => {
			node.classList.add('admin-portal')
			node.dataset.adminStyle = appearance.style
			node.dataset.adminColor = appearance.color
			node.dataset.adminMode = resolvedMode
		}

		// The last element focused in the app shell (header or console): the opener of a dialog
		// that was opened in code rather than by a Radix trigger.
		let lastFocused: Element | null = document.activeElement
		const onFocus = (event: FocusEvent) => {
			const target = event.target as Element | null
			// Only the app shell counts: focus that lands inside a pop-up never
			// becomes the opener of the next one.
			if (target?.closest('[data-slot="app-bar"], .admin-console')) lastFocused = target
		}
		document.addEventListener('focusin', onFocus, true)

		const consider = (node: Node) => {
			if (!(node instanceof HTMLElement) || node.parentElement !== document.body) return
			if (node.classList.contains('admin-console') || node.id === 'root' || node.id === 'app') return
			const popup = node.matches(POPUP_ROLES) ? node : node.querySelector(POPUP_ROLES)
			if (!popup) return
			const content = popup.matches('[data-radix-popper-content-wrapper]') ? (popup.firstElementChild ?? popup) : popup
			const id = content.id
			const trigger = id ? document.querySelector(`[aria-controls="${CSS.escape(id)}"]`) : null
			if (openerIsConsole(trigger ?? lastFocused)) apply(node)
		}

		// Re-tag what is already open (appearance changed while a pop-up is up).
		for (const node of document.querySelectorAll<HTMLElement>('body > .admin-portal')) apply(node)

		const observer = new MutationObserver((records) => {
			for (const record of records) for (const node of record.addedNodes) consider(node)
		})
		observer.observe(document.body, { childList: true })
		return () => {
			observer.disconnect()
			document.removeEventListener('focusin', onFocus, true)
		}
	}, [appearance.style, appearance.color, resolvedMode])
}
