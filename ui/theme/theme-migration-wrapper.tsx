import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type HTMLAttributes, type Ref } from 'react'

import { cn } from '../utils/cn'

/**
 * Dynamic theme tokens. Keys must be CSS custom properties (`--primary`,
 * `--card`, …); values are any valid CSS value (preferably `oklch`).
 *
 * Per ADR-0007 §1a-bis, tokens are the only supported theme input. The wrapper
 * never reads theme files, fetches CSS, or knows about a particular instance.
 */
export type ThemeTokens = Record<`--${string}`, string>

interface ThemeMigrationContextValue {
	/** The baseline token-scope class applied to the wrapper. */
	className: string
	/** Hidden element inside `document.body` carrying the scope, for Radix portals. */
	portalContainer: HTMLElement | null
}

const ThemeMigrationContext = createContext<ThemeMigrationContextValue | null>(null)

/** Tracks the custom properties this module applied to an element. */
const appliedThemeKeys = new WeakMap<HTMLElement, Set<string>>()

/**
 * Applies theme tokens as inline CSS custom properties, removing any property
 * this helper applied previously and that is no longer present.
 *
 * Exported for imperative runtime theme switching (for example, a CMS applying
 * a fetched theme to its root element). Prefer the `theme` prop when the tokens
 * live in React state.
 */
export function applyThemeTokens(element: HTMLElement | null | undefined, tokens: ThemeTokens | undefined): void {
	if (!element) return

	const previous = appliedThemeKeys.get(element) ?? new Set<string>()
	for (const key of previous) {
		if (!tokens || !(key in tokens)) element.style.removeProperty(key)
	}

	const next = new Set<string>()
	if (tokens) {
		for (const [key, value] of Object.entries(tokens)) {
			if (!key.startsWith('--') || value == null) continue
			element.style.setProperty(key, value)
			next.add(key)
		}
	}

	appliedThemeKeys.set(element, next)
}

/**
 * Returns the theme migration context when inside a `ThemeMigrationWrapper`,
 * or `null` when outside.
 */
export function useThemeMigration(): ThemeMigrationContextValue | null {
	return useContext(ThemeMigrationContext)
}

/**
 * Returns a DOM element suitable as a Radix `Portal` `container` prop, or
 * `undefined` when not inside a `ThemeMigrationWrapper`.
 *
 * When inside a migrated subtree, the returned element carries the theme scope
 * (and any dynamic token overrides) so portalled content inherits them.
 */
export function useThemePortal(): HTMLElement | undefined {
	return useContext(ThemeMigrationContext)?.portalContainer ?? undefined
}

export interface ThemeMigrationWrapperProps extends HTMLAttributes<HTMLDivElement> {
	/**
	 * Optional dynamic token overrides for this subtree. Applied to the wrapper
	 * and mirrored onto the portal host so dialogs and popovers resolve the same
	 * tokens.
	 */
	theme?: ThemeTokens
	ref?: Ref<HTMLDivElement>
}

function toStyleObject(tokens: ThemeTokens | undefined): CSSProperties | undefined {
	if (!tokens) return undefined

	const style: Record<string, string> = {}
	for (const [key, value] of Object.entries(tokens)) {
		if (!key.startsWith('--') || value == null) continue
		style[key] = value
	}
	return style as CSSProperties
}

/**
 * `ThemeMigrationWrapper` opts a subtree into the shared token scope and,
 * optionally, applies dynamic theme tokens.
 *
 * ## Migration
 *
 * The wrapper applies the `theme-new` class, which redefines the design tokens
 * for that subtree only. This enables slice-by-slice migration: migrated UI
 * uses the new token system while unmigrated UI continues using the legacy
 * `:root` tokens from `globals.css`.
 *
 * When the entire app is migrated, the wrapper moves to the app root and the
 * legacy `:root` block is removed.
 *
 * ## Dynamic themes (ADR-0007 §1a-bis)
 *
 * ```tsx
 * <ThemeMigrationWrapper theme={{ '--primary': 'oklch(0.6 0.2 250)' }}>
 *   <Page />
 * </ThemeMigrationWrapper>
 * ```
 *
 * Tokens are written as inline custom properties and cascade to descendants.
 *
 * ## Portal handling
 *
 * Radix portals render to `document.body`, outside the scoped subtree. The
 * wrapper mounts a hidden portal host carrying the scope, and mirrors the
 * dynamic tokens onto it. Portalled components use `useThemePortal()`:
 *
 * ```tsx
 * const portalContainer = useThemePortal()
 * <DialogPortal container={portalContainer}>
 * ```
 *
 * Mirroring the tokens (not just the class) is required: otherwise portalled
 * content would resolve baseline tokens while its subtree resolves overridden
 * ones.
 */
export function ThemeMigrationWrapper({ theme, className, children, ref, style, ...props }: ThemeMigrationWrapperProps) {
	const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)

	const tokenStyle = useMemo(() => toStyleObject(theme), [theme])

	useEffect(() => {
		const container = document.createElement('div')
		container.className = 'theme-new'
		container.setAttribute('data-theme-portal-host', '')
		container.style.position = 'absolute'
		container.style.width = '0'
		container.style.height = '0'
		container.style.overflow = 'hidden'
		document.body.appendChild(container)
		setPortalContainer(container)

		return () => {
			document.body.removeChild(container)
		}
	}, [])

	// Mirror dynamic tokens onto the portal host. The wrapper itself receives
	// them through React's `style` prop, which also handles removal.
	useEffect(() => {
		applyThemeTokens(portalContainer, theme)
		return () => applyThemeTokens(portalContainer, undefined)
	}, [theme, portalContainer])

	return (
		<ThemeMigrationContext.Provider value={{ className: 'theme-new', portalContainer }}>
			<div ref={ref} className={cn('theme-new', className)} style={{ ...tokenStyle, ...style }} {...props}>
				{children}
			</div>
		</ThemeMigrationContext.Provider>
	)
}
