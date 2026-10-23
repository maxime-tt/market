import type { WidgetLibrary } from '../libraries'

/**
 * Messaging views drained into ui/messages.
 *
 * Stub: registered in `../libraries.ts` so the catalogue always resolves, filled
 * in by the T6.2 widget-book pass. One entry per component, plus an extra entry
 * per state worth reviewing (variants, empty, error, loading, disabled).
 */
export const messages: WidgetLibrary = {
	name: 'messages',
	entries: [],
}
