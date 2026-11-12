/**
 * platform/web/notifications/reads.ts — the app's typed reads over the shared ledger.
 *
 * The ledger is generic: `unseenCount(scope)` takes an opaque string. These helpers bind the app's scope
 * builders to the counts a surface actually asks for, so a component never hand-builds a scope key and can
 * never read the wrong one.
 *
 * They exist because a ruling made one count's grain explicit (see `productCommentRule`).
 */
import type { AppNotifications } from './instance'
import { notificationScopes } from './types'

/**
 * The product-comment badge count for ONE product.
 *
 * RULED 2026-10-25 (owner): the count is per product, matching the per-product last-seen mark it is paired
 * with. Today the two disagree — `unseenProductComments` in the legacy store is a single global counter while
 * its last-seen mark is per product — and the ruling makes the pair consistent at the finer grain.
 *
 * This is a deliberate behaviour change: a surface that used to show one global number shows the current
 * product's number instead. Do NOT sum this with `totalUnseen()` to reproduce the old badge.
 */
export function unseenProductCommentsFor(notifications: AppNotifications, productKey: string): number {
	return notifications.ledger.unseenCount(notificationScopes.productComments(productKey))
}
