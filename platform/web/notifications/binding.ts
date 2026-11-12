/**
 * platform/web/notifications/binding.ts — the React binding: bridge the instance's `subscribe()` into the house
 * reactivity (`@tanstack/react-store`) so components read the snapshot reactively.
 *
 * The core's `subscribe` hands a fresh snapshot to a plain listener and returns a plain unsubscribe function.
 * `@tanstack/react-store`'s `useStore` wants a source with a stable `get()` and a `subscribe` returning
 * `{ unsubscribe }`. A `Store` bridges the two: it holds the latest snapshot, the instance pushes each new one
 * into it, and `useStore(store)` re-renders on change. This is the same `useStore`/`Store` pair the existing
 * platform hooks use (`useDocumentIdentity`, `useRootRedirects`, `_dashboard-layout`), not `useSyncExternalStore`
 * — which appears nowhere in the repo.
 *
 * A `Store` (rather than handing `useStore` the instance directly) is deliberate: the instance's `snapshot()`
 * returns a fresh object each call, so a source whose `get()` is `snapshot()` would look changed on every read
 * and re-render forever. The `Store`'s state only changes when the instance emits.
 */
import { Store, useStore } from '@tanstack/react-store'
import type { Notifications, NotificationsSnapshot } from '@sdk/core'
import type { AppNotificationPayload, AppNotificationType } from './types'
import { appNotifications } from './instance'

/** A live view of one notifications instance: its reactive store, the instance itself, and teardown. */
export interface NotificationsBinding<TType extends string = string, TPayload = unknown> {
	/** The reactive store the hook reads. Its state is the latest snapshot. */
	readonly store: Store<NotificationsSnapshot<TType, TPayload>>
	/** The underlying instance, for imperative queue/ledger writes the app still drives. */
	readonly notifications: Notifications<TType, TPayload>
	/** The latest snapshot, without subscribing. */
	snapshot(): NotificationsSnapshot<TType, TPayload>
	/** Stop mirroring the instance into the store. */
	dispose(): void
}

/**
 * Mirror an instance into a reactive store. The store starts at the instance's current snapshot and is updated
 * on every change; `dispose` unhooks the mirror.
 */
export function createNotificationsBinding<TType extends string, TPayload>(
	notifications: Notifications<TType, TPayload>,
): NotificationsBinding<TType, TPayload> {
	const store = new Store<NotificationsSnapshot<TType, TPayload>>(notifications.snapshot())
	const unsubscribe = notifications.subscribe((snapshot) => store.setState(() => snapshot))
	return {
		store,
		notifications,
		snapshot: () => store.state,
		dispose: unsubscribe,
	}
}

/**
 * Subscribe a component to a binding. Re-renders whenever the instance emits. Pass a `selector` to narrow the
 * re-render to the part of the snapshot the component reads.
 */
export function useNotifications<TType extends string, TPayload>(
	binding: NotificationsBinding<TType, TPayload>,
): NotificationsSnapshot<TType, TPayload> {
	return useStore(binding.store)
}

/** The app's binding over the singleton instance. */
export const appNotificationsBinding: NotificationsBinding<AppNotificationType, AppNotificationPayload> =
	createNotificationsBinding(appNotifications)

/** Read the app's notification snapshot reactively. The hook components will use. */
export function useAppNotifications(): NotificationsSnapshot<AppNotificationType, AppNotificationPayload> {
	return useNotifications(appNotificationsBinding)
}
