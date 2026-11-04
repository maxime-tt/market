/**
 * browse/art.tsx — product art materials and SVG sprite (verbatim from frames).
 *
 * The eight CSS-gradient materials (.m1–.m8) and the inline SVG sprite
 * (symbols p-bowl … p-jar, viewBox 0 0 188 176) are ported directly from
 * the doop frames. They are the *only* product art — no grey placeholders.
 */

import type { CSSProperties, FC, Ref } from 'react'
import { cn } from '../utils/cn'

// ---------------------------------------------------------------------------
// Materials — verbatim from the frames
// ---------------------------------------------------------------------------

export const MATERIAL_CLASSES = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'] as const
export type MaterialClass = (typeof MATERIAL_CLASSES)[number]

/** The eight material CSS classes — copy-pasted verbatim from the frames. */
export const MATERIAL_CSS = `
.m1{ --obj:oklch(0.42 0.12 345); --obj2:oklch(0.62 0.1 350);
     background:linear-gradient(180deg, oklch(0.95 0.022 350), oklch(0.92 0.032 345) 72%, oklch(0.87 0.038 340) 78%, oklch(0.93 0.026 350)); }
.m2{ --obj:oklch(0.42 0.11 20); --obj2:oklch(0.62 0.09 10);
     background:linear-gradient(180deg, oklch(0.95 0.022 20), oklch(0.92 0.032 10) 72%, oklch(0.87 0.038 5) 78%, oklch(0.93 0.026 15)); }
.m3{ --obj:oklch(0.44 0.1 320); --obj2:oklch(0.63 0.08 315);
     background:linear-gradient(180deg, oklch(0.95 0.022 320), oklch(0.92 0.032 315) 72%, oklch(0.87 0.038 310) 78%, oklch(0.93 0.026 320)); }
.m4{ --obj:oklch(0.42 0.07 300); --obj2:oklch(0.61 0.06 295);
     background:linear-gradient(180deg, oklch(0.95 0.022 300), oklch(0.92 0.032 295) 72%, oklch(0.87 0.038 290) 78%, oklch(0.93 0.026 300)); }
.m5{ --obj:oklch(0.42 0.12 345); --obj2:oklch(0.62 0.1 350);
     background:linear-gradient(180deg, oklch(0.95 0.022 350), oklch(0.92 0.032 345) 72%, oklch(0.87 0.038 340) 78%, oklch(0.93 0.026 350)); }
.m6{ --obj:oklch(0.42 0.11 20); --obj2:oklch(0.62 0.09 10);
     background:linear-gradient(180deg, oklch(0.95 0.022 20), oklch(0.92 0.032 10) 72%, oklch(0.87 0.038 5) 78%, oklch(0.93 0.026 15)); }
.m7{ --obj:oklch(0.44 0.1 320); --obj2:oklch(0.63 0.08 315);
     background:linear-gradient(180deg, oklch(0.95 0.022 320), oklch(0.92 0.032 315) 72%, oklch(0.87 0.038 310) 78%, oklch(0.93 0.026 320)); }
.m8{ --obj:oklch(0.42 0.07 300); --obj2:oklch(0.61 0.06 295);
     background:linear-gradient(180deg, oklch(0.95 0.022 300), oklch(0.92 0.032 295) 72%, oklch(0.87 0.038 290) 78%, oklch(0.93 0.026 300)); }
`
/**
 * Seller avatar tint classes — deterministic hues derived from seller pubkey.
 * Three hues rotate per seller; matches the per-seller tinting pattern from
 * the frames. Documented here as CSS rather than inline style (AGENTS.md §6).
 */
export const AVATAR_TINT_CSS = `
.avatar-tint-0 { --tint: oklch(0.7 0.06 345); background: var(--tint); }
.avatar-tint-1 { --tint: oklch(0.7 0.06 20); background: var(--tint); }
.avatar-tint-2 { --tint: oklch(0.7 0.06 320); background: var(--tint); }
`

// ---------------------------------------------------------------------------
// SVG sprite symbols — verbatim from the frames
// ---------------------------------------------------------------------------

const SVG_SYMBOLS: { id: string; d: React.ReactNode }[] = [
	{
		id: 'p-bowl',
		d: (
			<>
				<ellipse cx="94" cy="133" rx="50" ry="7" fill="currentColor" opacity=".15" />
				<path d="M52 106a42 26 0 0 0 84 0z" fill="currentColor" />
				<ellipse cx="94" cy="106" rx="42" ry="9" fill="var(--obj2)" />
			</>
		),
	},
	{
		id: 'p-bottle',
		d: (
			<>
				<ellipse cx="94" cy="133" rx="34" ry="6" fill="currentColor" opacity=".15" />
				<rect x="88" y="52" width="13" height="34" rx="4" fill="currentColor" />
				<rect x="74" y="82" width="41" height="51" rx="9" fill="currentColor" />
				<rect x="74" y="82" width="41" height="16" rx="8" fill="var(--obj2)" />
			</>
		),
	},
	{
		id: 'p-mug',
		d: (
			<>
				<ellipse cx="92" cy="133" rx="42" ry="6" fill="currentColor" opacity=".15" />
				<path d="M113 96h7a13 13 0 0 1 0 26h-7" fill="none" stroke="currentColor" strokeWidth="7" />
				<rect x="66" y="78" width="48" height="55" rx="6" fill="currentColor" />
				<rect x="66" y="78" width="48" height="13" rx="6" fill="var(--obj2)" />
			</>
		),
	},
	{
		id: 'p-lamp',
		d: (
			<>
				<ellipse cx="94" cy="134" rx="34" ry="6" fill="currentColor" opacity=".15" />
				<path d="M72 86 116 86 104 54 84 54Z" fill="currentColor" />
				<rect x="91" y="86" width="5" height="40" fill="var(--obj2)" />
				<rect x="78" y="126" width="32" height="7" rx="3.5" fill="currentColor" />
			</>
		),
	},
	{
		id: 'p-books',
		d: (
			<>
				<ellipse cx="94" cy="133" rx="44" ry="6" fill="currentColor" opacity=".15" />
				<rect x="60" y="112" width="68" height="15" rx="2" fill="currentColor" />
				<rect x="63" y="96" width="62" height="15" rx="2" fill="var(--obj2)" />
				<rect x="58" y="80" width="70" height="15" rx="2" fill="currentColor" />
			</>
		),
	},
	{
		id: 'p-crate',
		d: (
			<>
				<ellipse cx="94" cy="139" rx="44" ry="6" fill="currentColor" opacity=".15" />
				<path d="M94 66 132 86 132 124 94 144 56 124 56 86Z" fill="currentColor" />
				<path d="M94 66 132 86 94 106 56 86Z" fill="var(--obj2)" />
			</>
		),
	},
	{
		id: 'p-candle',
		d: (
			<>
				<ellipse cx="94" cy="133" rx="30" ry="6" fill="currentColor" opacity=".15" />
				<rect x="76" y="88" width="36" height="45" rx="4" fill="currentColor" />
				<path d="M94 58c9 9 9 18 0 25-9-7-9-16 0-25z" fill="var(--obj2)" />
			</>
		),
	},
	{
		id: 'p-jar',
		d: (
			<>
				<ellipse cx="94" cy="133" rx="36" ry="6" fill="currentColor" opacity=".15" />
				<rect x="70" y="80" width="48" height="53" rx="8" fill="currentColor" />
				<rect x="66" y="68" width="56" height="13" rx="5" fill="var(--obj2)" />
			</>
		),
	},
]

// ---------------------------------------------------------------------------
// Sprite component
// ---------------------------------------------------------------------------

/**
 * Inline SVG sprite container. Place this once at the top of the page or
 * in a layout shell — the sprite itself is absolute/0,0 overflow-hidden.
 */
export function ProductSprite({ className }: { className?: string }) {
	return (
		<svg className={cn('sprite', 'absolute', 'left-0', 'top-0', 'overflow-hidden', className)} aria-hidden="true" width="0" height="0">
			{SVG_SYMBOLS.map((sym) => (
				<symbol key={sym.id} id={sym.id} viewBox="0 0 188 176">
					{sym.d}
				</symbol>
			))}
		</svg>
	)
}

// ---------------------------------------------------------------------------
// Product art icon — renders a single material tile with the named product icon
// ---------------------------------------------------------------------------

export interface ProductArtProps {
	/** Which material gradient (.m1–.m8). */
	material: MaterialClass
	/** Which product icon (p-bowl … p-jar). Defaults to a random pick. */
	symbolId?: 'p-bowl' | 'p-bottle' | 'p-mug' | 'p-lamp' | 'p-books' | 'p-crate' | 'p-candle' | 'p-jar'
	/** Aspect ratio: 3/2 for product-card shot, 1/1 for strips. */
	ratio?: '3/2' | '1/1'
	/** Extra classes. */
	className?: string
	ref?: React.Ref<HTMLDivElement>
}

/**
 * Renders a product-art tile: material gradient + SVG icon silhouette.
 * The icon uses `currentColor` for the object tone and `--obj2` for accents,
 * both set by the material class.
 */
export const ProductArt: FC<ProductArtProps> = ({ material, symbolId, ratio = '3/2', className, ref, ...props }) => {
	// Deterministic symbol selection from material index
	const materialIdx = MATERIAL_CLASSES.indexOf(material)
	const defaultSymbol = SVG_SYMBOLS[materialIdx % SVG_SYMBOLS.length].id

	return (
		<div
			ref={ref}
			data-testid={`widget-product-art-${material}`}
			className={cn(
				MATERIAL_CLASSES[materialIdx],
				'relative',
				'overflow-hidden',
				ratio === '3/2' ? 'aspect-[3/2]' : 'aspect-square',
				'rounded-[6px]',
				'border',
				'border-border-default',
				'text-on-media',
				className,
			)}
			{...props}
		>
			<svg className="absolute inset-0 size-full" viewBox="0 0 188 176" aria-hidden="true">
				<use href={`#${symbolId ?? defaultSymbol}`} />
			</svg>
		</div>
	)
}
