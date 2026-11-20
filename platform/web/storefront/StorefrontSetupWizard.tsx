import type { StorefrontPage, StorefrontThemeId, StorefrontThemeTune } from '@sdk/commerce/storefront/storefrontPage'
import { createEmptyStorefrontPage } from '@sdk/commerce/storefront/storefrontPage'
import { getStorefrontTheme, normalizeStorefrontTune } from '@sdk/config/storefront/storefrontThemes'
import {
	STOREFRONT_TEMPLATES,
	getStorefrontTemplate,
	instantiateStorefrontTemplate,
	type StorefrontTemplateId,
} from '@sdk/config/storefront/storefrontTemplates'
import { StorefrontBlockView, StorefrontProvider, StorefrontRoot } from '@ui/storefront'
import { Button } from '@ui/primitives/button'
import { cn } from '@ui/utils/cn'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { storefrontBlockSlots } from './StorefrontBlockSlots'
import { ThemeColourList, ThemeTunePanel } from './fields/ThemePickerField'

/**
 * The three-step page setup wizard: choose a layout, choose colours, make it yours.
 *
 * Both steps render **real** previews through `StorefrontBlockView` /
 * `StorefrontRoot` — the same components the published page and the Puck
 * canvas use — scaled down inside an `overflow-hidden` frame rather than drawn
 * as mockup art. A template preview showing `ProductGrid` therefore shows the
 * author's actual listings, not a stock photo standing in for them. This is
 * the same "the canvas is the renderer, not a preview of it" principle
 * `storefrontCms.tsx` documents, extended one step earlier.
 *
 * The wizard produces a `StorefrontPage` and hands it to `onComplete` — it
 * does not publish anything itself. Everything it picks (template, theme)
 * stays fully editable afterward in the normal builder; this only decides
 * what the author starts from.
 */

const STEPS = ['template', 'colours', 'tune'] as const
type WizardStep = (typeof STEPS)[number]

const STEP_LABEL: Record<WizardStep, string> = {
	template: 'Choose layout',
	colours: 'Choose colours',
	tune: 'Make it yours',
}

/** The width the preview lays out at before it is scaled to fit: a desktop page. */
const PREVIEW_WIDTH = 1280

export interface StorefrontSetupWizardProps {
	pubkey: string
	/** Pre-selects a starting point — used when "Change template" reopens the wizard over an existing page. */
	initialTemplateId?: StorefrontTemplateId
	initialThemeId?: StorefrontThemeId
	/**
	 * Reopening over a page that already has a look carries its colourway and
	 * fine-tuning back in, so step 2 starts from what the author chose rather
	 * than from the layout's defaults.
	 */
	initialPaletteKey?: string
	initialTune?: StorefrontThemeTune
	onComplete: (page: StorefrontPage) => void
	/** Omitted on first-time setup, where there is nothing yet to cancel back to. */
	onCancel?: () => void
}

export function StorefrontSetupWizard({
	pubkey,
	initialTemplateId = 'shop',
	initialThemeId,
	initialPaletteKey,
	initialTune,
	onComplete,
	onCancel,
}: StorefrontSetupWizardProps) {
	const startingThemeId = initialThemeId ?? getStorefrontTemplate(initialTemplateId).defaultThemeId
	const startingTheme = getStorefrontTheme(startingThemeId)
	const [step, setStep] = useState<WizardStep>('template')
	const [templateId, setTemplateId] = useState<StorefrontTemplateId>(initialTemplateId)
	const [themeId, setThemeId] = useState<StorefrontThemeId>(startingThemeId)
	const [paletteKey, setPaletteKey] = useState<string>(initialPaletteKey || startingTheme.palettes[0].key)
	const [tune, setTune] = useState<StorefrontThemeTune>(normalizeStorefrontTune(initialTune, startingTheme.tune))

	const stepIndex = STEPS.indexOf(step)
	const template = getStorefrontTemplate(templateId)
	const theme = getStorefrontTheme(themeId)

	// A fresh instantiation per template/step change, not per keystroke — there
	// are none here, only button clicks, so recomputing this is cheap and keeps
	// the preview blocks' ids stable while the author lingers on one step.
	const previewBlocks = useMemo(() => instantiateStorefrontTemplate(template), [template])

	/**
	 * Switching layout resets the colourway and the tuning to that layout's own
	 * defaults, matching the studio: a palette key belongs to one layout, and
	 * carrying the numbers across would describe a look nobody chose.
	 */
	const applyTheme = (id: StorefrontThemeId) => {
		const next = getStorefrontTheme(id)
		setThemeId(id)
		setPaletteKey(next.palettes[0].key)
		setTune({ ...next.tune })
	}

	const selectTemplate = (id: StorefrontTemplateId) => {
		setTemplateId(id)
		// Carry the newly-picked template's suggested theme into step 2 as the
		// starting point — the author can still override it there.
		applyTheme(getStorefrontTemplate(id).defaultThemeId)
	}

	const finish = () => {
		const page: StorefrontPage = {
			...createEmptyStorefrontPage(),
			root: { props: { title: '', theme: themeId, palette: paletteKey, tune } },
			content: instantiateStorefrontTemplate(template),
		}
		onComplete(page)
	}

	return (
		<StorefrontProvider value={{ pubkey, isEditing: true }}>
			<div className="mx-auto flex min-h-[70vh] w-full max-w-7xl flex-col gap-6 p-4 sm:p-6" data-testid="storefront-wizard">
				<ol className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground" aria-label="Setup steps">
					{STEPS.map((s, i) => (
						<li key={s} className="flex items-center gap-2">
							<span
								className={cn(
									'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
									i === stepIndex
										? 'border-primary bg-primary text-primary-foreground'
										: i < stepIndex
											? 'border-primary text-primary'
											: 'border-border',
								)}
								aria-hidden
							>
								{i < stepIndex ? <Check className="size-3.5" /> : i + 1}
							</span>
							<span className={i === stepIndex ? 'text-foreground' : undefined}>{STEP_LABEL[s]}</span>
							{i < STEPS.length - 1 && <span className="h-px w-6 bg-border sm:w-10" aria-hidden />}
						</li>
					))}
				</ol>

				{step === 'template' && (
					<div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2" role="radiogroup" aria-label="Template">
						{STOREFRONT_TEMPLATES.map((candidate) => (
							<TemplateCard
								key={candidate.id}
								id={candidate.id}
								label={candidate.label}
								description={candidate.description}
								themeId={getStorefrontTemplate(candidate.id).defaultThemeId}
								selected={candidate.id === templateId}
								onSelect={() => selectTemplate(candidate.id)}
							/>
						))}
					</div>
				)}

				{step !== 'template' && (
					<div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
						{/* Each column scrolls on its own, so the preview stays in view
						    while the author runs down a long colour list. */}
						<div className="flex min-w-0 flex-col gap-2 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
							{step === 'colours' ? (
								<ThemeColourList
									themeId={themeId}
									paletteKey={paletteKey}
									columns={2}
									onChange={({ themeId: nextTheme, paletteKey: nextPalette }) => {
										// A new look brings its own tuning; another colourway of
										// the same look keeps what the author already set.
										if (nextTheme !== themeId) setTune({ ...getStorefrontTheme(nextTheme).tune })
										setThemeId(nextTheme)
										setPaletteKey(nextPalette)
									}}
								/>
							) : (
								<ThemeTunePanel themeId={themeId} value={tune} onChange={setTune} />
							)}
						</div>

						<div className="flex min-w-0 flex-col gap-2">
							<p className="text-sm text-muted-foreground">
								<span className="font-medium text-foreground">{template.label}</span> · {theme.label}
								{theme.palettes.length > 1 && <> · {theme.palettes.find((p) => p.key === paletteKey)?.label ?? theme.palettes[0].label}</>}
							</p>
							{previewBlocks.length > 0 ? (
								<DesktopPreview>
									<StorefrontRoot props={{ title: '', theme: themeId, palette: paletteKey, tune }} fullHeight={false}>
										{previewBlocks.map((block) => (
											<StorefrontBlockView key={block.props.id} block={block} slots={storefrontBlockSlots} />
										))}
									</StorefrontRoot>
								</DesktopPreview>
							) : (
								<p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
									A blank page has nothing to preview yet. Your colours still apply once you add blocks.
								</p>
							)}
						</div>
					</div>
				)}

				<div className="flex items-center justify-between border-t border-border pt-4">
					<div>
						{stepIndex > 0 ? (
							<Button variant="ghost" onClick={() => setStep(STEPS[stepIndex - 1])} data-testid="storefront-wizard-back">
								<ArrowLeft className="mr-1.5 size-4" /> Back
							</Button>
						) : (
							onCancel && (
								<Button variant="ghost" onClick={onCancel} data-testid="storefront-wizard-cancel">
									Cancel
								</Button>
							)
						)}
					</div>
					{stepIndex < STEPS.length - 1 ? (
						<Button onClick={() => setStep(STEPS[stepIndex + 1])} data-testid="storefront-wizard-next">
							Continue <ArrowRight className="ml-1.5 size-4" />
						</Button>
					) : (
						<Button onClick={finish} data-testid="storefront-wizard-finish">
							Use this page
						</Button>
					)}
				</div>
			</div>
		</StorefrontProvider>
	)
}

function TemplateCard({
	id,
	label,
	description,
	themeId,
	selected,
	onSelect,
}: {
	id: StorefrontTemplateId
	label: string
	description: string
	themeId: StorefrontThemeId
	selected: boolean
	onSelect: () => void
}) {
	// Recomputed per card on every render rather than lifted out: cheap (at
	// most 3 blocks), and keeps each card's preview ids independent of
	// whichever template is currently selected.
	const preview = instantiateStorefrontTemplate(getStorefrontTemplate(id)).slice(0, 2)

	return (
		<button
			type="button"
			onClick={onSelect}
			aria-pressed={selected}
			data-testid={`storefront-template-${id}`}
			className={cn(
				'flex flex-col overflow-hidden rounded-lg border text-left transition-colors',
				selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50',
			)}
		>
			<div className="relative h-36 overflow-hidden bg-muted/40 sm:h-44">
				{preview.length > 0 ? (
					// The preview is the full-size page scaled down with a CSS
					// transform, not a smaller render — `w-[333%]` compensates for
					// `scale-[0.3]` so the content still lays out at (roughly) its
					// normal width before shrinking, rather than reflowing narrow.
					<div className="pointer-events-none absolute left-0 top-0 w-[333%] origin-top-left scale-[0.3]" aria-hidden>
						<StorefrontRoot props={{ title: '', theme: themeId, palette: '', tune: getStorefrontTheme(themeId).tune }} fullHeight={false}>
							{preview.map((block) => (
								<StorefrontBlockView key={block.props.id} block={block} slots={storefrontBlockSlots} />
							))}
						</StorefrontRoot>
					</div>
				) : (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Empty canvas</div>
				)}
			</div>
			<div className="flex flex-1 flex-col gap-1 p-4">
				<span className="flex items-center gap-2 font-semibold text-foreground">
					{label}
					{selected && <Check className="size-4 text-primary" aria-hidden />}
				</span>
				<span className="text-sm text-muted-foreground">{description}</span>
			</div>
		</button>
	)
}

/**
 * The page laid out at desktop width, then scaled down to fit the column, so
 * the preview shows the layout visitors on a computer will see rather than
 * the phone layout a narrow column would produce. Container queries inside the
 * blocks see the full {@link PREVIEW_WIDTH}. The frame scrolls when the page
 * is taller than the screen.
 */
function DesktopPreview({ children }: { children: ReactNode }) {
	const frameRef = useRef<HTMLDivElement>(null)
	const pageRef = useRef<HTMLDivElement>(null)
	const [size, setSize] = useState({ scale: 0.5, height: 0 })

	useLayoutEffect(() => {
		const frame = frameRef.current
		const page = pageRef.current
		if (!frame || !page) return
		const measure = () => {
			const scale = Math.min(1, frame.clientWidth / PREVIEW_WIDTH)
			setSize({ scale, height: page.offsetHeight * scale })
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(frame)
		observer.observe(page)
		return () => observer.disconnect()
	}, [])

	return (
		<div
			ref={frameRef}
			className="max-h-[70vh] overflow-y-auto overflow-x-hidden rounded-lg border border-border"
			data-testid="storefront-wizard-preview"
		>
			<div style={{ height: size.height }} className="relative">
				<div
					ref={pageRef}
					className="pointer-events-none absolute left-0 top-0 origin-top-left"
					style={{ width: PREVIEW_WIDTH, transform: `scale(${size.scale})` }}
					aria-hidden
				>
					{children}
				</div>
			</div>
		</div>
	)
}
