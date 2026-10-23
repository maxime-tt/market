import type { WidgetLibrary } from '../libraries'

/**
 * Zap, V4V and wallet views drained into ui/lightning.
 *
 * Stub: registered in `../libraries.ts` so the catalogue always resolves, filled
 * in by the T6.2 widget-book pass. One entry per component, plus an extra entry
 * per state worth reviewing (variants, empty, error, loading, disabled).
 */
export const lightning: WidgetLibrary = {
	name: 'lightning',
	entries: [],
}
