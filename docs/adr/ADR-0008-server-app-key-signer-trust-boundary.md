# ADR-008: Server App-Key Signer Stays Its Own Trust Boundary

## Status

Accepted

## Date

2026-11-05

## Related

- ADR-0002: NDK → Applesauce Nostr I/O Migration (Wave E covers server runtime migration)
- `notes/ADR-server-signer.md`: author draft
- HANDOVER-WAVE-K-SERVER-NDK.md: lane contract

## Context

`platform/server/EventSigner.ts` signs Nostr events using the server's application private
key (`APP_PRIVATE_KEY`), not a user's private key. It is the identity that publishes admin
lists (kind 30000 d=admin/editors), blacklists (kind 10000), registry events (kind 30000
d=vanity/nip05), and bootstrap setup events (kind 31990). It is the **server process
identity**, not a user session.

The SDK signer module (`sdk/core/signer`) is designed for user session management — NIP-46
bunker lanes, NIP-07 browser extension, vault encryption, session state machine. It is not
designed for a server process signing with its own app key.

## Decision

The server keeps its own app-key signer. It **does not** adopt `sdk/core/signer`, because the
two are different trust boundaries:

|                | SDK signer (`sdk/core/signer`)             | Server signer (`platform/server/EventSigner`) |
| -------------- | ------------------------------------------ | --------------------------------------------- |
| Identity       | User session (browser key, bunker, NIP-07) | Server process (`APP_PRIVATE_KEY`)            |
| Lifecycle      | Per-user session state machine             | Singleton per server process                  |
| Storage        | Encrypted vault (PBKDF2, AES-GCM)          | Environment variable (`APP_PRIVATE_KEY`)      |
| Signing        | Through session capability gates           | Direct `finalizeEvent`                        |
| Trust boundary | User-consented, per-RPC authorization      | Server-administrated                          |

The server signer adopts **SDK port types** (`NostrEventLike` from `@sdk/core/nostr/eventLike`,
`EventTemplate` from `@sdk/core/signer/types`) for library-agnostic compatibility, but the
implementation stays as a server-only concrete adapter using `nostr-tools` directly.

## Port Shape

```typescript
import type { NostrEventLike, EventTemplate } from '@sdk/core/nostr/eventLike'

export interface ServerSigner {
	signEvent(template: EventTemplate): NostrEventLike
	getAppPubkey(): string
}
```

- `signEvent` takes `EventTemplate` (unsigned event shape).
- Returns `NostrEventLike` (the shared protocol event shape).
- Implementation unchanged: `finalizeEvent(unsignedEvent, this.privateBytes)`.
- `getAppPubkey()` stays as-is.

## Consequences

Positive:

- Clear trust boundary: server process identity is never conflated with user session identity.
- Secret handling stays out of logs and error messages (`APP_PRIVATE_KEY` never logged).
- No behavior change to any signing, validation, or event dispatch path.

Negative / tradeoffs:

- `EventSigner.ts` remains in `platform/server/` with a custom adapter — it is not removed by
  the generic NDK→sdk migration.
- The server signer is not covered by the SDK signer's test harness.
