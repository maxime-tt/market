import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'

import '../styles/index.css'
import { TooltipProvider } from '@ui/primitives/tooltip'
import { ThemeMigrationWrapper } from '@ui/theme/theme-migration-wrapper'

import { resolveLibraries } from './libraries'

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

	return (
		<ThemeMigrationWrapper className="min-h-screen bg-background text-foreground">
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
				</header>

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
