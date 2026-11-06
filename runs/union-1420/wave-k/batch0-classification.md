# Batch 0 Classification — `platform/server` NDK usage

**Base:** `unite/1420-all` @ `5c98fbc9` (D7 complete). **Worktree:** `wt-wavek` (branch `d7s2/wavek`).
**Re-derived guard:** `platform/server production 14 bridge` (CUR=14, BASE=14, undeclared=14, declared=1). M9=14.

---

## Per-file classification

| #   | File                    | NDK symbols used                                                          | Class                           | SDK target                                           | Ledger row                                             |
| --- | ----------------------- | ------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ | ----------- | --------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | `types.ts`              | `type NDKEvent, type NostrEvent`                                          | **RETIRE-NOW**                  | `@sdk/core/nostr/eventLike` (`NostrEventLike`)       | —                                                      |
| 2   | `ndk.ts`                | `NDK, NDKPrivateKeySigner` (runtime)                                      | **BRIDGE**                      | `sdk/core/signer`                                    | `platform/server/ndk.ts                                | wave-k      | sdk/core/signer             | creates NDK client + signer; injects sdk signer capability                                         | client-NDK-removal (ADR-0002; post-Wave-J)` |
| 3   | `NDKService.ts`         | `NDK, type NDKSubscription` (runtime + type)                              | **BRIDGE**                      | `sdk/core/nostr-io`                                  | `platform/server/NDKService.ts                         | wave-k      | sdk/core/nostr-io           | manages long-lived admin/editor subscriptions; injects sdk subscription API                        | client-NDK-removal (ADR-0002; post-Wave-J)` |
| 4   | `EventSigner.ts`        | `type NostrEvent` (type-only)                                             | **RETIRE-NOW**                  | `@sdk/core/nostr/eventLike` (`NostrEventLike`)       | —                                                      |
| 5   | `EventValidator.ts`     | `type NostrEvent` (type-only)                                             | **RETIRE-NOW**                  | `@sdk/core/nostr/eventLike` (`NostrEventLike`)       | —                                                      |
| 6   | `AdminManager.ts`       | `type NDKEvent, type NostrEvent` (type-only)                              | **RETIRE-NOW**                  | `@sdk/core/nostr/eventLike` (`NostrEventLike`)       | —                                                      |
| 7   | `BlacklistManager.ts`   | `type NostrEvent`, `NDK` (runtime: `setNDK()`, `fetchEvents`)             | **BRIDGE**                      | `sdk/core/nostr-io`                                  | `platform/server/BlacklistManager.ts                   | wave-k      | sdk/core/nostr-io           | loads existing blacklist from relay; injects sdk query API                                         | client-NDK-removal (ADR-0002; post-Wave-J)` |
| 8   | `BootstrapManager.ts`   | `type NostrEvent` (type-only)                                             | **RETIRE-NOW**                  | `@sdk/core/nostr/eventLike` (`NostrEventLike`)       | —                                                      |
| 9   | `EditorManager.ts`      | `type NDKEvent, type NostrEvent` (type-only)                              | **RETIRE-NOW**                  | `@sdk/core/nostr/eventLike` (`NostrEventLike`)       | —                                                      |
| 10  | `EventHandler.ts`       | `type NostrEvent`, `NDK` (runtime: `new NDK`, `connect()`, `subscribe()`) | **BRIDGE**                      | `sdk/core/nostr-io`                                  | `platform/server/EventHandler.ts                       | wave-k      | sdk/core/nostr-io           | core event dispatcher; creates NDK clients for app relay + zap relay; injects sdk subscription API | client-NDK-removal (ADR-0002; post-Wave-J)` |
| 11  | `Nip05Manager.ts`       | `type NostrEvent` (type-only, unused)                                     | **RETIRE-NOW**                  | `@sdk/core/nostr/eventLike` (`NostrEventLike`)       | —                                                      |
| 12  | `VanityManager.ts`      | `type NostrEvent` (type-only, unused)                                     | **RETIRE-NOW**                  | `@sdk/core/nostr/eventLike` (`NostrEventLike`)       | —                                                      |
| 13  | `ZapPurchaseManager.ts` | `type NostrEvent`, `NDKEvent` (runtime: `new NDKEvent`), `NDK` (runtime)  | **BRIDGE**                      | `sdk/core/nostr-io` + event publish adapter          | `platform/server/ZapPurchaseManager.ts                 | wave-k      | sdk/core/nostr-io           | publishes registry events to relay; needs NostrIo.publish + NDKEvent wrapper for signed events     | client-NDK-removal (ADR-0002; post-Wave-J)` |
| 14  | `appSettings.ts`        | `type NDK, type NDKFilter, type NDKEvent` (type-only, already declared)   | **RETIRE-NOW** (type-only part) | `@sdk/core/nostr-io` (`NostrIo.query`/`fetchEvents`) | **Already in ledger:** `platform/server/appSettings.ts | b3-relocate | sdk/config/app-settings.ts` |
| 15  | `http/config.ts`        | `type NostrEvent` (type-only)                                             | **RETIRE-NOW**                  | `@sdk/core/nostr/eventLike` (`NostrEventLike`)       | —                                                      |

**Summary counts:**

- RETIRE-NOW (type-only): 9 files (#1, #4, #5, #6, #8, #9, #11, #12, #15)
- BRIDGE (runtime transport): 6 files (#2, #3, #7, #10, #13, #14)
- BLOCKED: 0

**Net undeclared after full conversion:**

- Current: 14 undeclared (14 production, 1 declared: appSettings.ts)
- Target: 0 undeclared (all bridges declared, no BLOCKED files)
- Delta: **−14**

---

## Batch plan

### Batch 1 — Type-only retirement (9 files, zero behavior change)

**Scope:** `types.ts`, `EventSigner.ts`, `EventValidator.ts`, `AdminManager.ts`, `BootstrapManager.ts`, `EditorManager.ts`, `Nip05Manager.ts`, `VanityManager.ts`, `http/config.ts`
**Change:** Replace `type { NDKEvent, NostrEvent } from '@nostr-dev-kit/ndk'` with `type { NostrEventLike } from '@sdk/core/nostr/eventLike'`. Update interface signatures in `types.ts` to use `NostrEventLike`.
**Gate:** 6 (platform boundary), 7 (unit), 9 (tsc ≤204).
**Expected undeclared delta:** −9 (all 9 files lose their `@nostr-dev-kit` import; remaining NDK files = 6, of which 1 is already declared).

### Batch 2 — Transport bridges (6 files, declared-as-you-touch)

**Scope:** `ndk.ts`, `NDKService.ts`, `BlacklistManager.ts`, `EventHandler.ts`, `ZapPurchaseManager.ts`, `appSettings.ts`
**Change:**

- `ndk.ts`: Create `PoolPort` adapter wrapping `new NDK()`, `ndk.connect()`, `ndk.disconnect()`. File becomes the NDK→sdk transport bridge.
- `NDKService.ts`: Replace `NDKSubscription` usage with `NostrIo.subscription()`. Uses PoolPort from ndk.ts.
- `EventHandler.ts`: Replace direct `new NDK()`/`ndk.subscribe()` calls with NostrIo from sdk.
- `BlacklistManager.ts`: Replace `ndk.fetchEvents()` with `NostrIo.query()`.
- `ZapPurchaseManager.ts`: Replace `new NDKEvent(this.ndk)` with a lightweight `PublishEvent` wrapper.
- `appSettings.ts`: Already declared; type imports can be retired (no runtime NDK in this file).
  **Gate:** 4b (ndk-direction), 6, 7, 9.
  **Expected undeclared delta:** −5 (appSettings.ts already declared).

### Batch 3 — Ledger declarations (gate 4b only)

**Scope:** `scripts/ndk-bridge-ledger.txt` additions for all batch 2 bridges.
**Gate:** 4b only. No code changes.

---

## Uncertainties

1. **`NostrEventLike` vs `NDKEvent` compatibility:** AdminManager/EditorManager's `updateFromEvent(event: NostrEvent | NDKEvent)` signature changes. The `event.tags` extraction logic works identically on both types — structural compatibility verified.
2. **`ZapPurchaseManager.publishRegistry()`:** `new NDKEvent(this.ndk)` binds the event to a specific NDK instance for relay publication. The SDK `NostrIo.publish()` needs the event + relay target. An adapter is needed — see ADR.
3. **`EventHandler.subscribeToZapPurchases()`:** Uses `NDKSubscription` with `.on('event', cb)`. The SDK stream uses `AsyncIterable` or RxJS Observable. A mapper adapter is needed.
4. **`ndk.ts` exports:** `ensureInvoiceNdkConnected()` returns `NDK` type. Needs to return `PoolPort | NostrIo`.

---

## What is NOT converted and why

| Item                   | Reason                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `auction-validator/**` | No NDK imports found (verified: `grep -rln @nostr-dev-kit platform/server/auction-validator/` returns nothing). Not in scope. |
| `sdk/core/*` modules   | Adopt-only — never edited by this lane per handover contract §6.2.                                                            |
