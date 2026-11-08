import { useState } from 'react'

import { THEME_PRESETS } from '@ui/theme/presets'
import { ThemeCustomizer } from '@ui/theme/theme-customizer'
import { ThemeMigrationWrapper } from '@ui/theme/theme-migration-wrapper'
import { tuneTokens } from '@ui/theme/tune'

import type { WidgetLibrary } from '../libraries'

/**
 * `ui/theme/` — the in-app theme customizer. The demo owns a local value and a
 * nested `ThemeMigrationWrapper`, so picking a preset or moving a slider visibly
 * restyles the sample without touching the catalogue's own theme.
 *
 * The customizer's default position is fixed bottom-right (its app placement);
 * the demo overrides it to `relative` so the entry stays in the widget grid.
 */
function ThemeCustomizerDemo() {
	const [value, setValue] = useState({ presetIndex: 0, tune: THEME_PRESETS[0].tune })
	const preset = THEME_PRESETS[value.presetIndex]
	const theme = { ...preset.tokens, ...tuneTokens(value.tune) }

	return (
		<ThemeMigrationWrapper
			theme={theme}
			className="rounded-xl border border-border-default bg-bg p-6 text-text-high"
			data-testid="theme-customizer-demo"
		>
			<p className="text-sm text-text-mid">Pick a preset and nudge the six controls; the sample below restyles in place.</p>
			<div className="mt-4 flex flex-wrap items-center gap-3">
				<button type="button" className="rounded-md bg-fill-ink px-3 py-2 text-sm font-medium text-on-fill-ink">
					Primary action
				</button>
				<span className="rounded-full border border-border-default bg-surface-raised px-2 py-1 text-xs text-text-mid">Sample badge</span>
			</div>
			<ThemeCustomizer presets={THEME_PRESETS} value={value} onChange={setValue} className="relative bottom-auto right-auto mt-4" />
		</ThemeMigrationWrapper>
	)
}

export const theme: WidgetLibrary = {
	name: 'theme',
	entries: [
		{
			name: 'ThemeCustomizer',
			render: () => <ThemeCustomizerDemo />,
		},
	],
}
