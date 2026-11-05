# Batch 0 Classification — `platform/server` NDK usage

**Base:** `unite/1420-all` @ `5c98fbc9` (D7 complete). **Worktree:** `wt-wavek` (branch `d7s2/wavek`).
**Re-derived guard:** `platform/server production 14 bridge` (CUR=14, BASE=14, undeclared=14, declared=1). M9=14.

---

## Per-file classification

| #   | File                                    | NDK symbols used                                                               | Class          | SDK target (if BRIDGE/RETIRE-NOW)                                                        | Ledger row                                                                         |
| --- | --------------------------------------- | ------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------- | ----------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | `platform/server/types.ts`              | `type NDKEvent, type NostrEvent` (type-only)                                   | **RETIRE-NOW** | `@sdk/core/nostr/eventLike` (`NostrEventLike`)                                           | _already in ledger: `platform/server/appSettings.ts` covers the shared event type_ |
| 2   | `platform/server/ndk.ts`                | `NDK, NDKPrivateKeySigner` (runtime)                                           | **BRIDGE**     | `sdk/core/nostr-io` (`PoolPort`)                                                         | `platform/server/ndk.ts                                                            | wave-k      | sdk/core/nostr-io             | creates NDK instance for relay connect; injects sdk PoolPort for transport                         | client-NDK-removal (ADR-0002; post-Wave-J)` |
| 3   | `platform/server/NDKService.ts`         | `NDK, type NDKSubscription` (runtime + type)                                   | **BRIDGE**     | `sdk/core/nostr-io` (`NostrIo.subscription`, `NostrIo.query`)                            | `platform/server/NDKService.ts                                                     | wave-k      | sdk/core/nostr-io             | manages long-lived admin/editor subscriptions; injects sdk subscription API                        | client-NDK-removal (ADR-0002; post-Wave-J)` |
| 4   | `platform/server/EventSigner.ts`        | `type NostrEvent` (type-only)                                                  | **BLOCKED**    | _ADR decides: server app-key signer is not user-signer; SDK signer is for user sessions_ | _(pending ADR ruling)_                                                             |
| 5   | `platform/server/EventValidator.ts`     | `type NostrEvent` (type-only)                                                  | **RETIRE-NOW** | `@sdk/core/nostr/eventLike` (`NostrEventLike`)                                           | _depends on types.ts retirement — same batch_                                      |
| 6   | `platform/server/AdminManager.ts`       | `type NDKEvent, type NostrEvent` (type-only)                                   | **RETIRE-NOW** | `@sdk/core/nostr/eventLike` (`NostrEventLike`)                                           | _depends on types.ts retirement — same batch_                                      |
| 7   | `platform/server/BlacklistManager.ts`   | `type NostrEvent` (type-only), `NDK` (runtime: `setNDK()`, `fetchEvents`)      | **BRIDGE**     | `sdk/core/nostr-io` (`NostrIo.query`/`fetchEvents`)                                      | `platform/server/BlacklistManager.ts                                               | wave-k      | sdk/core/nostr-io             | loads existing blacklist from relay; injects sdk query API                                         | client-NDK-removal (ADR-0002; post-Wave-J)` |
| 8   | `platform/server/BootstrapManager.ts`   | `type NostrEvent` (type-only)                                                  | **RETIRE-NOW** | `@sdk/core/nostr/eventLike` (`NostrEventLike`)                                           | _type-only — same batch as types.ts_                                               |
| 9   | `platform/server/EditorManager.ts`      | `type NDKEvent, type NostrEvent` (type-only)                                   | **RETIRE-NOW** | `@sdk/core/nostr/eventLike` (`NostrEventLike`)                                           | _type-only — same batch as types.ts_                                               |
| 10  | `platform/server/EventHandler.ts`       | `type NostrEvent`, `NDK` (runtime: `new NDK`, `connect()`, `subscribe()`)      | **BRIDGE**     | `sdk/core/nostr-io` (`NostrIo`, `NostrIo.subscription`)                                  | `platform/server/EventHandler.ts                                                   | wave-k      | sdk/core/nostr-io             | core event dispatcher; creates NDK clients for app relay + zap relay; injects sdk subscription API | client-NDK-removal (ADR-0002; post-Wave-J)` |
| 11  | `platform/server/Nip05Manager.ts`       | `type NostrEvent` (type-only)                                                  | **BRIDGE**     | `sdk/core/nostr-io` (via ZapPurchaseManager base)                                        | _merged with ZapPurchaseManager row_                                               |
| 12  | `platform/server/VanityManager.ts`      | `type NostrEvent` (type-only)                                                  | **BRIDGE**     | `sdk/core/nostr-io` (via ZapPurchaseManager base)                                        | _merged with ZapPurchaseManager row_                                               |
| 13  | `platform/server/ZapPurchaseManager.ts` | `type NostrEvent`, `NDKEvent` (runtime: `new NDKEvent(this.ndk)`, `publish()`) | **BRIDGE**     | `sdk/core/nostr-io` + a new **event publish adapter**                                    | `platform/server/ZapPurchaseManager.ts                                             | wave-k      | sdk/core/nostr-io             | publishes registry events to relay; needs NostrIo.publish + NDKEvent wrapper for signed events     | client-NDK-removal (ADR-0002; post-Wave-J)` |
| 14  | `platform/server/appSettings.ts`        | `type NDK, type NDKFilter, type NDKEvent` (type-only, already declared)        | **RETIRE-NOW** | `@sdk/core/nostr-io` (`NostrIo.query`)                                                   | \*already declared in ledger: `platform/server/appSettings.ts                      | b3-relocate | sdk/config/app-settings.ts`\* |
| 15  | `platform/server/http/config.ts`        | `type NostrEvent` (type-only)                                                  | **RETIRE-NOW** | `@sdk/core/nostr/eventLike` (`NostrEventLike`)                                           | _type-only — same batch as types.ts_                                               |

**Summary counts:**

- RETIRE-NOW (type-only): 8 files (#1, #5, #6, #8, #9, #14, #15, http/config.ts partial)
- BRIDGE (runtime transport): 6 files (#2, #3, #7, #10, #11+12, #13)
- BLOCKED: 1 file (#4 — EventSigner)

**Net undeclared after full conversion:**

- Current: 14 undeclared (14 production, 1 declared: appSettings.ts)
- Target: 0 undeclared (all bridges declared, EventSigner resolved)
- Delta: **−14**

---

## Batch plan

### Batch 1 — Type-only retirement (7 files, zero behavior change)

**Scope:** `types.ts`, `EventValidator.ts`, `AdminManager.ts`, `BootstrapManager.ts`, `EditorManager.ts`, `Nip05Manager.ts`, `VanityManager.ts`, `http/config.ts`
**Change:** Replace `type { NDKEvent, NostrEvent } from '@nostr-dev-kit/ndk'` with `type { NostrEventLike } from '@sdk/core/nostr/eventLike'`. Add `NostrEventLike` type to `types.ts` re-exports (replaces NDKEvent/NostrEvent).
**Gate:** 6 (platform boundary), 7 (unit), 9 (tsc ≤204). Expected undeclared delta: **−6** (8 files but 2 are in types.ts which is shared, so ~6 distinct files lose undeclared status).
**Ledger action:** None — these are RETIRE-NOW, no ledger rows needed.

### Batch 2 — Transport bridges (4 files, declared-as-you-touch)

**Scope:** `ndk.ts`, `NDKService.ts`, `EventHandler.ts`, `BlacklistManager.ts`
**Change:**

- `ndk.ts`: Create `PoolPort` adapter wrapping `new NDK()`, `ndk.connect()`, `ndk.disconnect()`. File becomes the NDK→sdk transport bridge.
- `NDKService.ts`: Replace `NDKSubscription` usage with `NostrIo.subscription()`. Uses PoolPort from ndk.ts.
- `EventHandler.ts`: Replace direct `new NDK()`/`ndk.subscribe()` calls with NostrIo from sdk. Uses PoolPort from ndk.ts.
- `BlacklistManager.ts`: Replace `ndk.fetchEvents()` with `NostrIo.query()`.
  **Gate:** 4b (ndk-direction), 6, 7, 9. Expected undeclared delta: **−4**.
  **Ledger action:** Add 3 rows (ndk.ts, NDKService.ts, EventHandler.ts, BlacklistManager.ts). BlacklistManager row merged into ZapPurchaseManager scope or separate.

### Batch 3 — Event publish + ZapPurchaseManager (1 file + ADR)

**Scope:** `ZapPurchaseManager.ts`, `EventSigner.ts`
**Change:**

- `ZapPurchaseManager.ts`: Replace `new NDKEvent(this.ndk)` with a lightweight `PublishEvent` wrapper that holds the raw event + relay pool reference, uses `NostrIo.publish()` for transport.
- `EventSigner.ts`: ADR decides. Options: (a) widen event type to `NostrEventLike`, keep signing as-is; (b) adopt an SDK-side app-key signer port; (c) keep EventSigner as a server-only adapter with explicit ADR boundary.
  **Gate:** 4b, 6, 7, 9. Expected undeclared delta: **−1** (ZapPurchaseManager). EventSigner stays declared only if ADR provides an sdk target.
  **Ledger action:** 1 row for ZapPurchaseManager. EventSigner row pending ADR.

### Batch 4 — Ledger declarations (gate 4b only)

**Scope:** `scripts/ndk-bridge-ledger.txt` additions for all batch 2+3 bridges.
**Gate:** 4b only. No code changes.

---

## Uncertainties

1. **`NostrEventLike` vs `NDKEvent` compatibility:** AdminManager/EditorManager's `updateFromEvent(event: NostrEvent | NDKEvent)` signature changes. The `event.tags` extraction logic (`tag[0] === 'p'`, `tag[1].length === 64`) works identically on both types — structural compatibility verified.
2. **`ZapPurchaseManager.publishRegistry()`:** `new NDKEvent(this.ndk)` binds the event to a specific NDK instance for relay publication. The SDK `NostrIo.publish()` needs the event + relay target. An adapter is needed — see ADR.
3. **`EventHandler.subscribeToZapPurchases()`:** Uses `NDKSubscription` with `.on('event', cb)`. The SDK stream uses `AsyncIterable` or RxJS Observable. A mapper adapter is needed.
4. **`ndk.ts` exports:** `ensureInvoiceNdkConnected()` returns `NDK` type. Needs to return `PoolPort | NostrIo`.

---

## What is NOT converted and why

| Item                   | Reason                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EventSigner.ts`       | BLOCKED on ADR ruling — server app-key signer is a different trust boundary than user-signer. The SDK signer module (`sdk/core/signer`) is designed for user session management (NIP-46, NIP-07, bunker), not server-side app-key signing. |
| `auction-validator/**` | No NDK imports found (verified: `grep -rln @nostr-dev-kit platform/server/auction-validator/` returns nothing). Not in scope.                                                                                                              |
| `sdk/core/*` modules   | Adopt-only — never edited by this lane per handover contract §6.2.                                                                                                                                                                         |
