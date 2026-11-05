# ADR-009: Server Nostr I/O — Port Shape and NDK Adapter

## Status

Accepted

## Date

2026-11-05

## Related

- ADR-0002: NDK → Applesauce Nostr I/O Migration (Wave E)
- ADR-0008: Server App-Key Signer Stays Its Own Trust Boundary
- `platform/server/ndk-adapter.ts`: concrete adapter
- `sdk/core/nostr-io/ts/types.ts`: PoolPort port definition

## Context

The browser (`platform/web`) speaks the `sdk/core/nostr-io` port via the applesauce-relay concrete adapter.
The server (`platform/server`) also speaks the same `sdk/core/nostr-io` port, but its concrete adapter
(`ndk-adapter.ts`) uses `@nostr-dev-kit/ndk` as the transport library. This decision is driven by three
factors:

1. **Existing singleton patterns**: The server process owns a single NDK instance (created in `ndk.ts`)
   that is already connected and wired into the process lifecycle. Replacing it with applesauce-relay
   would require rewriting the connection management, subscription lifecycle, and the Lightning
   identifier resolver (`lightning.ts` → `getUser` / `fetchProfile` helpers).
2. **Lightning identifier path**: `platform/server/lightning.ts` calls `getUser()` and `fetchProfile()`
   on the NDK instance — methods that applesauce-relay does not implement. These are used to resolve
   NIP-05 and NIP-57 lightning addresses by fetching the author's profile from relays.
3. **Backward compatibility**: Existing deployments already run with NDK. Swapping the library underneath
   the port without changing the port is zero-risk; swapping to a new library would require changes to
   callers of NDK-specific methods.

## Decision

The server **keeps `@nostr-dev-kit/ndk` as the concrete library** underneath the `sdk/core/nostr-io`
port. The adapter (`ndk-adapter.ts`) implements `PoolPort` by delegating to the NDK instance.

The server's adapter is a **separate file** (`platform/server/ndk-adapter.ts`) from the browser's
(`sdk/core/nostr-io/src/applesauce-relay.ts`), each with its own concrete implementation, but both
implementing the same `PoolPort` interface.

## Port Shape

```typescript
// sdk/core/nostr-io/ts/types.ts — the port
interface PoolPort {
  query(filters: Filter[], options?: QueryOptions): Promise<CountResult>
  publish(relays: RelayUrl[], event: SdkEvent): Promise<RelayAck[]>
  subscribe(relays: RelayUrl[], filters: Filter[], options?: SubscribeOptions): Subscription
  status(relays: RelayUrl[]): RelayStatus[]
  close(): void
}

interface Subscription {
  on(event: string, cb: (data: unknown) => void): void
  stop(): void
  events: Observable<SdkEvent>
}
```

Both adapters implement this port. The NDK adapter (`ndk-adapter.ts`) maps each port method to the
corresponding NDK API; the applesauce adapter maps each to the applesauce-relay API.

## Where the server adapter differs from the browser's

| Aspect | Server adapter (`ndk-adapter.ts`) | Browser adapter (applesauce) |
|--------|-----------------------------------|------------------------------|
| Library | `@nostr-dev-kit/ndk` | `applesauce-relay` |
| `query()` | `ndk.publish()` + manual EOSE tracking | `pool.request()` (built-in EOSE) |
| `publish()` | `ndkEvent.publish()` → relay acks | `pool.publish()` → relay acks |
| `subscribe()` | `ndk.subscribe()` → `Observable` via RxJS | `pool.subscribe()` → built-in Observable |
| `status()` | Iterates `ndk.relays` map | `pool.status()` |
| `close()` | Closes NDK relay group | Closes pool |
| Event envelope | Wraps `NDKEvent` in `SdkEvent` shape | Uses native event shape |
| Error handling | Catches NDK exceptions, emits `ERROR` on observable | Catches pool exceptions, emits `ERROR` |
| Relay URL handling | NDK uses `explicitRelayUrls` → `getRelays()` | Pool stores URLs explicitly |

## What would change to make them identical

To make the server adapter use applesauce-relay like the browser's:

1. **Remove `ndk-adapter.ts`** and replace its usage with applesauce-relay's `RelayPool`.
2. **Rewrite `lightning.ts`**: Replace `ndk.getUser()` and `ndk.fetchProfile()` with a `query()` +
   profile extraction pattern using `PoolPort.query()` (the port already supports this; the caller
   just needs to be updated).
3. **Rewrite `ndk.ts`**: Replace the NDK singleton with an applesauce-relay `RelayPool` singleton.
4. **Update all callers**: `EventHandler.ts` creates NDK instances via `createPoolPort()` for zap
   relays. With applesauce, this becomes `new RelayPool(urls)` — functionally equivalent but a
   different API.

No `sdk/core/nostr-io` types would change — the port is already identical. The only changes are
in the concrete adapters and in callers that reach past the port to use NDK-specific methods
(`getUser`, `fetchProfile`).

## Consequences

### Positive

- **Zero risk for NDK-dependent code paths**: `lightning.ts` continues to work without modification.
- **Minimal migration surface**: The port boundary is already enforced — only `ndk-adapter.ts` and
  `ndk.ts` contain NDK knowledge. All bridge files (`EventHandler.ts`, `NDKService.ts`, etc.) speak
  only the port.
- **Future-proof**: When NDK support is deprecated (Wave J, post-D7), the swap is confined to two
  files and a few caller updates in `lightning.ts`.

### Negative / tradeoffs

- The server adapter is a separate implementation from the browser's — they diverge in error handling,
  relay management, and API mapping.
- The NDK adapter's `query()` uses `ndk.publish()` + EOSE tracking instead of the cleaner
  `pool.request()` — a consequence of NDK not exposing a REQ+EOSE-native query method.
- The Lightning identifier path (`lightning.ts`) remains NDK-dependent. Rewriting it to use the
  port's `query()` method would require changes to that file, not just the adapter.

## Integration with batches

- **Batch 1** (types): `EventSigner.ts` widened to `NostrEventLike`. No change to the port.
- **Batch 2** (ports): All bridge files in `platform/server` now call `PoolPort` methods instead of
  NDK methods directly. The adapter is the only NDK-impacted file.
- **Batch 3** (adapter migration): TBD — whether to swap NDK → applesauce-relay in the adapter.
  Wait for owner ruling.

## Ledger row

```
platform/server/ndk-adapter.ts|wave-k|sdk/core/nostr-io/ts/types.ts|PoolPort impl via @nostr-dev-kit/ndk; differs from browser applesauce in query()/subscribe()/lightning deps|wave-k-server-ndk
```
