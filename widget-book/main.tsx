import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import '../styles/index.css'
import { TooltipProvider } from '@ui/primitives/tooltip'
import { ThemeMigrationWrapper } from '@ui/theme/theme-migration-wrapper'
import { surpriseTune, tuneTokens, type TuneSettings } from '@ui/theme/tune'
import { TunePanel } from '@ui/theme/tune-panel'

import { resolveLibraries } from './libraries'
import { THEME_PRESETS } from './theme-presets'

/**
 * Selection precedence: `?library=` in the URL, then the server's launch-time
 * `LIBRARY` value (served by `/config.json`), then `*` for every library.
 */
async function resolveSelection(): Promise<string> {
	const fromQuery = new URLSearchParams(window.location.search).get('library')
	if (fromQuery) return fromQuery

	try {
		const response = await fetch('/config.json')
		if (response.ok) {
			const config = (await response.json()) as { library?: string }
			if (config.library) return config.library
		}
	} catch {
		// The catalogue still renders; fall through to the default.
	}

	return '*'
}

function WidgetBook({ selection }: { selection: string }) {
	const selected = useMemo(() => resolveLibraries(selection), [selection])
	const [presetIndex, setPresetIndex] = useState(0)
	const [tune, setTune] = useState<TuneSettings>(THEME_PRESETS[0].tune)
	const [exported, setExported] = useState<string | null>(null)

	const preset = THEME_PRESETS[presetIndex]
	const theme = useMemo(() => ({ ...preset.tokens, ...tuneTokens(tune) }), [preset, tune])

	const cyclePreset = () => {
		const nextIndex = (presetIndex + 1) % THEME_PRESETS.length
		setPresetIndex(nextIndex)
		setTune(THEME_PRESETS[nextIndex].tune)
		setExported(null)
	}

	const resetTune = () => {
		setTune(preset.tune)
		setExported(null)
	}

	const surprise = () => {
		setTune(surpriseTune(preset.tune))
		setExported(null)
	}

	const exportTheme = () => {
		setExported(
			JSON.stringify(
				{
					kind: 'plebeian.ui-theme',
					version: 1,
					preset: preset.name,
					tune,
					tokens: theme,
				},
				null,
				2,
			),
		)
	}

	return (
		<ThemeMigrationWrapper theme={theme} className="grain min-h-screen bg-background text-foreground">
			<div className="mx-auto max-w-5xl p-8">
				<header className="mb-8 border-b pb-4">
					<h1 className="font-header text-2xl font-semibold" data-testid="widget-book-title">
						Plebeian UI Widget Book
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Library: <span data-testid="widget-book-selection">{selection}</span> ·{' '}
						{selected.reduce((total, library) => total + library.entries.length, 0)} widgets
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Switch with <code>?library=atoms</code> or launch with <code>LIBRARY=atoms</code>.
					</p>
					<div className="mt-4 flex flex-wrap items-center gap-3">
						<button
							type="button"
							data-testid="theme-switcher"
							onClick={cyclePreset}
							className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
						>
							Switch theme
						</button>
						<span className="text-sm text-muted-foreground">
							Theme: <strong data-testid="theme-name">{preset.name}</strong>
						</span>
						<span className="text-xs text-muted-foreground" data-testid="theme-blurb">
							{preset.blurb}
						</span>
					</div>
				</header>

				<TunePanel value={tune} onChange={setTune} onReset={resetTune} onSurprise={surprise} onExport={exportTheme} className="mb-8" />

				{exported && (
					<pre data-testid="theme-json" className="mb-8 overflow-auto rounded-md border bg-muted p-4 text-xs text-muted-foreground">
						{exported}
					</pre>
				)}

				{selected.map((library) => (
					<section key={library.name} className="mb-12" data-testid={`library-${library.name}`}>
						<h2 className="mb-4 font-header text-lg font-semibold">{library.name}</h2>
						<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
							{library.entries.map((entry) => (
								<article key={entry.name} className="rounded-lg border bg-card p-4">
									<h3 className="mb-3 text-sm font-medium">{entry.name}</h3>
									<div data-testid={`widget-${entry.name}`}>{entry.render()}</div>
								</article>
							))}
						</div>
					</section>
				))}
			</div>
		</ThemeMigrationWrapper>
	)
}

const root = document.getElementById('widget-book-root')
if (!root) throw new Error('widget-book root element is missing')

const selection = await resolveSelection()

createRoot(root).render(
	<StrictMode>
		<TooltipProvider>
			<WidgetBook selection={selection} />
		</TooltipProvider>
	</StrictMode>,
)
