# ADR: Server App-Key Signer

**Status:** DRAFT — awaiting owner ruling.
**Owner-gated:** per HANDOVER-WAVE-K-SERVER-NDK.md §1, this lane may not mutate server code until (a) go and (b) ADR acceptance.

---

## 1. Context

`platform/server/EventSigner.ts` signs Nostr events using the **server's application private key** (`APP_PRIVATE_KEY`), not a user's private key. This is the identity that publishes admin lists (kind 30000 d=admin/editors), blacklists (kind 10000), registry events (kind 30000 d=vanity/nip05), and bootstrap setup events (kind 31990). It is the **server process identity**, not a user session.

Currently `EventSigner` imports `type NostrEvent from '@nostr-dev-kit/ndk'` and signs using `nostr-tools` (`getPublicKey`, `finalizeEvent`), returning a signed event object that matches the NDK `NostrEvent` shape.

The SDK signer module (`sdk/core/signer`) is designed for **user session management** — NIP-46 bunker lanes, NIP-07 browser extension, NIP-46 nosec/ncryptsec, vault encryption, session state machine. It is not designed for a server process signing with its own app key.

## 2. Decision: Keep a server-side signer port separate from `sdk/core/signer`

**The server app-key signer does NOT adopt `sdk/core/signer`.** The two identities serve different trust boundaries:

|                    | SDK signer (`sdk/core/signer`)             | Server signer (`platform/server/EventSigner`) |
| ------------------ | ------------------------------------------ | --------------------------------------------- |
| **Identity**       | User session (browser key, bunker, NIP-07) | Server process (`APP_PRIVATE_KEY`)            |
| **Lifecycle**      | Per-user session state machine             | Singleton per server process                  |
| **Storage**        | Encrypted vault (PBKDF2, AES-GCM)          | Environment variable (`APP_PRIVATE_KEY`)      |
| **Signing**        | Through session capability gates           | Direct `finalizeEvent`                        |
| **Trust boundary** | User-consented, per-RPC authorization      | Server-administrated                          |

**The server keeps its own signer.** This is not a deficiency — it is a deliberate architectural separation. The server signs events _on behalf of the application_ as a process identity. A user signer signs _on behalf of a user_ with consent. Blurring these would weaken security.

## 3. The port shape

The server-side signer stays in `platform/server/EventSigner.ts` with the same interface but **wides event types to SDK port types** rather than NDK types:

```typescript
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import type { EventTemplate } from '@sdk/core/signer'

export interface ServerSigner {
	signEvent(template: EventTemplate): NostrEventLike
	getAppPubkey(): string
}
```

Key points:

- **`signEvent` takes `EventTemplate`** (unsigned event shape from SDK signer types) — this is what the server actually constructs before signing.
- **Returns `NostrEventLike`** (the shared event shape from `@sdk/core/nostr/eventLike`) — this is the protocol-level event shape that all ports speak.
- The implementation remains unchanged: `finalizeEvent(unsignedEvent, this.privateBytes)`. The only change is the _type annotations_ widening from NDK to SDK port types.
- `getAppPubkey()` stays as-is.

## 4. Why this satisfies the port/interface rule

The contract states: _"The server reuses the sdk modules — nostr (in place of NDK), payments, signer — behind the same library-agnostic port interfaces."_ and _"a server-side concrete adapter may use a different underlying library, but the port/module interface must stay identical."_

This ADR preserves the port by:

1. **Using SDK port types** (`NostrEventLike`, `EventTemplate`) instead of NDK types — the interface is library-agnostic.
2. **Keeping the signing mechanism** (nostr-tools `finalizeEvent`) — this is the concrete adapter choice, permitted by the contract.
3. **Not folding into `sdk/core/signer`** — the session-based signer is a different trust domain; the server signer is its own concrete adapter.

## 5. Secret handling

- `APP_PRIVATE_KEY` is loaded from environment (never logged, never in error messages).
- The private key bytes are stored in memory only as `Uint8Array`.
- `getAppPubkey()` is derived once at construction from `getPublicKey(privateBytes)` and cached.
- The `appPrivateKey` constructor parameter is stored as `string` for internal use but **never** included in log output or error strings.

## 6. Integration with batches

### Batch 1 (type-only):

`EventSigner.ts` changes:

```typescript
// Before:
import type { NostrEvent } from '@nostr-dev-kit/ndk'
signEvent(event: NostrEvent): NostrEvent

// After:
import type { NostrEventLike, EventTemplate } from '@sdk/core/nostr/eventLike'
signEvent(template: EventTemplate): NostrEventLike
```

`EventHandler.ts` call sites update: the `event` passed to `signEvent()` is already a template-like object with `kind`, `created_at`, `tags`, `content` — it matches `EventTemplate` structurally.

### Batch 3 (ZapPurchaseManager):

`ZapPurchaseManager.publishRegistry()` uses `this.eventSigner.signEvent(event.rawEvent())` where `event` is a `NDKEvent`. The `rawEvent()` method returns a raw event object matching `EventTemplate` shape. The signature change is compatible — `rawEvent()` output is an `EventTemplate` and `signEvent` now accepts it.

### Ledger row:

```
platform/server/EventSigner.ts|wave-k|sdk/core/signer|server app-key signer; signs on behalf of process identity (not user session); uses SDK event types for port compatibility|client-NDK-removal (ADR-0002; post-Wave-J)
```

## 7. Risks

1. **`rawEvent()` return shape:** `ZapPurchaseManager.publishRegistry()` calls `eventSigner.signEvent(event.rawEvent())`. `NDKEvent.rawEvent()` returns a `NostrEvent` (signed event with `id`, `pubkey`, `sig`). The server signer's `signEvent` strips the old signature and re-signs with the app key — this behavior is preserved because `EventTemplate` omits `id`/`sig`/`pubkey` and the signer sets `pubkey`. The old `sig`/`id` on the input are ignored by `finalizeEvent` which computes them fresh.

2. **EventValidator compatibility:** `EventValidator.validateEvent(event: NostrEvent)` — if widened to `NostrEventLike`, the `event.pubkey` and `event.kind` accesses still work identically. No behavior change.

3. **EventHandler.handleEvent:** Takes `NostrEvent`, calls `eventValidator.validateEvent(event)`, then `eventSigner.signEvent(event)`. The `event` passed to signEvent is the _input_ event (unsigned or externally-signed). The handler does not pass a signed event to signEvent — it passes the validated input event template. This behavior is unchanged.

## 8. Conclusion

The server-side signer is a **different trust boundary** from the SDK user-signer. It keeps its own implementation in `platform/server/EventSigner.ts` but adopts SDK port types (`NostrEventLike`, `EventTemplate`) for library-agnostic compatibility. This is the minimal, correct path: no behavior change, no trust-boundary widening, no dependency on NDK types, and no conflation of server process identity with user session identity.
