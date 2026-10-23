import type { WidgetLibrary } from '../libraries'

/**
 * Order-detail views drained into ui/orders.
 *
 * Stub: registered in `../libraries.ts` so the catalogue always resolves, filled
 * in by the T6.2 widget-book pass. One entry per component, plus an extra entry
 * per state worth reviewing (variants, empty, error, loading, disabled).
 */
export const orders: WidgetLibrary = {
	name: 'orders',
	entries: [],
}
