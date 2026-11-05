# ADR-023: Server Nostr I/O — Port Shape and Applesauce-Relay Adapter

## Status

Accepted

## Date

2026-11-05

## Related

- ADR-0002: NDK → Applesauce Nostr I/O Migration (Wave E)
- ADR-022: Server App-Key Signer Stays Its Own Trust Boundary
- `platform/server/ndk-adapter.ts`: concrete adapter (applesauce-relay)
- `sdk/core/nostr-io/ts/types.ts`: PoolPort port definition

## Context

The browser (`platform/web`) speaks the `sdk/core/nostr-io` port via the applesauce-relay concrete
adapter (`sdk/core/nostr-io/ts/relay-adapter.ts`). The server (`platform/server`) also speaks the
same `sdk/core/nostr-io` port. This ADR records the concrete library underneath the server adapter
and every place the server's implementation legitimately differs from the browser's.

## Original Decision (superseded)

The original decision (ADR-0009, superseded) was to keep `@nostr-dev-kit/ndk` as the transport
library behind the port. This is now overruled per the owner's ruling: **the server speaks the
port with the same wire the browser uses**.

## Decision

The server speaks `sdk/core/nostr-io`'s `PoolPort` with **applesauce-relay** as the concrete
library underneath — identical to the browser's wire.

The server's adapter lives in a **separate file** (`platform/server/ndk-adapter.ts`) from the
browser's (`sdk/core/nostr-io/ts/relay-adapter.ts`). Both implement the same `PoolPort` interface,
using the same library (`applesauce-relay`). The separate file allows each side to carry its own
pool singleton.

## Port Shape

```typescript
// sdk/core/nostr-io/ts/types.ts — the port
interface PoolPort {
	request(relays: RelayUrl[], filters: FilterIn[], opts?: { signal?: AbortSignal }): Observable<Event>
	subscribe(relays: RelayUrl[], filters: FilterIn[]): PoolSubscription
	publish(relays: RelayUrl[], event: Event): Promise<RelayAck[]>
	count(relays: RelayUrl[], filters: FilterIn[]): Promise<CountResult>
	status(relays: RelayUrl[]): RelayStatus[]
	close(): void
}

interface PoolSubscription {
	events: Observable<Event>
	failures: Observable<RelayFailure>
	eose: Observable<void>
	unsubscribe: Unsub
}
```

Both adapters implement this port using `applesauce-relay`'s `RelayPool`. The browser adapter
(`sdk/core/nostr-io/ts/relay-adapter.ts`) uses `new RelayPool()` by default; the server adapter
(`platform/server/ndk-adapter.ts`) accepts a `RelayPool` parameter.

## Where the server adapter differs from the browser's

| Aspect        | Server adapter (`ndk-adapter.ts`)             | Browser adapter (relay-adapter.ts)           |
| ------------- | --------------------------------------------- | -------------------------------------------- |
| Library       | `applesauce-relay`                            | `applesauce-relay` (identical)               |
| `request()`   | `pool.req(relays, filters)` + EOSE tracking   | Identical                                    |
| `publish()`   | `pool.publish(relays, event)`                 | Identical                                    |
| `subscribe()` | `pool.req(relays, filters)` + split streams   | Identical                                    |
| `count()`     | `firstValueFrom(pool.count(relays, filters))` | Identical                                    |
| `status()`    | Iterates `pool.relays` map                    | Iterates `pool.relays` map (identical)       |
| `close()`     | `pool.close()`                                | Identical                                    |
| Event shape   | `applesauce-core`'s `NostrEvent`              | `applesauce-core`'s `NostrEvent` (identical) |

The server adapter is now functionally identical to the browser adapter. The only difference is
the pool singleton lifecycle (managed separately in `platform/server/ndk.ts`).

## What was changed to reach this state

1. **`ndk-adapter.ts`**: Replaced NDK wrapper (`NdkAdapter`) with applesauce-relay wrapper
   (`RelayPoolAdapter`). All `PoolPort` methods now delegate to `RelayPool` APIs.
2. **`ndk.ts`**: Replaced `NDK` singleton with `RelayPool` singleton. `ensureInvoiceNdkConnected`
   renamed to `ensureInvoicePoolConnected` and returns `RelayPool` instead of `NDK`.
3. **`lightning.ts`**: Replaced `ndk.getUser()` / `ndk.fetchProfile()` with `PoolPort.query()`
   calling a kind-0 filter for the app pubkey and parsing the profile from the returned event.
4. **All bridge files** (`EventHandler.ts`, `NDKService.ts`, `BlacklistManager.ts`,
   `ZapPurchaseManager.ts`, `appSettings.ts`, `VanityManager.ts`, `Nip05Manager.ts`,
   `http/config.ts`): Already spoke `PoolPort` in batch 2; no further changes needed.

## Consequences

### Positive

- **Zero library divergence**: Server and browser both use `applesauce-relay`. A fix in one
  adapter propagates to the other.
- **`lightning.ts` now speaks the port**: No NDK-specific methods (`getUser`, `fetchProfile`).
- **Minimal migration surface**: All NDK knowledge confined to `ndk-adapter.ts` and `ndk.ts`.

### Negative / tradeoffs

- The server adapter is a separate file from the browser's — if they diverge in future, each
  side must be fixed independently.
- The pool singleton in `ndk.ts` is not shared across `getPoolPort()` and `createPoolPort()` calls
  (zap relays get their own pool).

## Supersedes

ADR-0009: Server Nostr I/O — Port Shape and NDK Adapter (decision to keep NDK overruled).

## Ledger row

```
platform/server/ndk-adapter.ts|wave-k|sdk/core/nostr-io/ts/types.ts|PoolPort impl via applesauce-relay; identical to browser relay-adapter.ts|wave-k-server-ndk
```
