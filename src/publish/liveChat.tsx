/**
 * Shim — the live-chat message publish binding moved to
 * `platform/web/messaging/liveChatPublish.ts` (store drain D2, slice 7).
 *
 * The binding resolves the app NDK through the Platform publish bridge instead of importing
 * `@/lib/stores/ndk`, and takes its query keys from the relocated sdk subpath — so a Platform
 * host module consumes it without a counted `platform -> src` edge. Vacated path kept as a
 * re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/messaging/liveChatPublish'
