---
module: auth
kind: module
schema: architecture
applies: core@0.1
inherits: [core]
implements: []
opt-out: []
test-support: ['machine.test.ts']
levels:
  objective: present
  technical-spec: present — the five flags, the five localStorage keys, the transitions and their ordering, the error strings and the lazy-session seam
  implementation: present — dependency-free TypeScript, framework-free and store-free: state, listeners and injected ports only
  tests: present — the transition suite, run by `bun test sdk/core/auth/machine.test.ts`
contract:
  entry: index.ts
  operations:
    [
      createAuthMachine,
      getState,
      subscribe,
      getCurrentPubkey,
      getNeedsMigration,
      getAvailableNostrExtensions,
      getAuthFromLocalStorageAndLogin,
      decryptAndLogin,
      encryptAndSavePrivateKey,
      checkAndShowTermsDialog,
      loginWithPrivateKey,
      loginWithExtension,
      loginWithNip46,
      logout,
      userHasProducts,
      migrateToEncryptedKey,
    ]
  exports: [createAuthMachine, AuthError, AuthMachineNotRegisteredError]
  types:
    [
      AuthUser,
      AuthState,
      AuthKeyValueStorage,
      AuthSessionStartInput,
      AuthSessionSnapshot,
      AuthSessionHandle,
      AuthSessionFactory,
      AuthPorts,
      Nip46LoginOptions,
      AuthMachine,
    ]
implementations:
  - id: ts
    lang: typescript
    dir: .
    entry: index.ts
    package: null
    install: [bun, install]
    build: []
    test: [bun, test]
    typecheck: [bunx, tsc, --noEmit]
    needs: [core]
access:
  group: m_auth
  read: [self]
  write: [self]
  exec: [self]
consumers:
  - '`src/lib/stores/auth.ts`, the behaviour-identical adapter that supplies the ports and re-exports the legacy surface'
  - '`platform/web/auth/authBinding.ts`, the public platform surface new hosts use'
naming:
  reserves: the state machine's own vocabulary — the five auth flags, the storage keys, the lane start input, the session handle and the port surface
  does_not: no store, query or component name appears here — every cross-store effect is an injected port; no marketplace noun appears anywhere
source:
  decision: owner ruling 2026-10-28 — I.1 splits the auth state machine out of `src/lib/stores/auth.ts` so the login/logout/migrate flow is portable; the machine lives in `sdk/core/`, the port wiring stays with the host
---

# auth — the auth state machine, ported out of the app store

**The job, in one sentence** — own the auth flow: the five flags the app renders on, the five localStorage
keys that survive a reload, the login/logout/migrate/decrypt transitions and their exact ordering, and the
error strings callers match — while every cross-store effect (NDK, notifications, wallet, cart, terms,
products, key encryption, extension probe) arrives as an injected port.

**What it is.** A dependency-free state machine. It holds an `AuthState`, hands it out with `getState`,
notifies `subscribe`rs on every change, and drives the signer session through a handle the host creates
lazily. Auth identity is a protocol capability with no marketplace noun, so it belongs in `sdk/core/` by the
`sdk/AGENTS.md` placement rule; the app wiring stays with the app.

**What it is not.** It imports no React, no `@tanstack/store`, no `@/`, no `@ui/`, no `@platform/`, no
`@nostr-dev-kit/`. It names no store and no component: the NDK guard, the notification clear, the wallet
teardown, the cart clear, the terms dialog and the key encryption are all `AuthPorts` methods. It owns no
storage policy either — the storage seam is three methods over five keys whose names are a public contract.

**The localStorage key contract.** `nostr_connect_url`, `nostr_local_signer_key`,
`nostr_local_encrypted_signer_key` (the `pubkey:ncryptsec` record), `nostr_auto_login`, `nostr_user_pubkey`.
`logout` removes the first four and deliberately keeps `nostr_user_pubkey`, exactly as the legacy store did.

**The port surface.** `isNdkReady`, `clearNotifications`, `adoptActiveSigner`, `teardownSignerAndWallet`,
`clearCart`, `hasAcceptedTerms`, `openTermsDialog`, `userHasProducts`, `encryptPrivateKey`, `isRawNsecKey`,
`getAvailableNostrExtensions`.

**The files this module owns.** `auth/auth.md` (this document); `auth/index.ts` (the entry);
`auth/types.ts` (the state, the storage keys, the session seam and the port surface), `auth/errors.ts` (the
closed refusal), `auth/machine.ts` (the factory and the ported transitions), and `auth/machine.test.ts` (the
transition suite, declared in the front-matter's `test-support:` and out of contract).

**The adapter.** `src/lib/stores/auth.ts` stays as the behaviour-identical adapter: it constructs this
machine, supplies the ports from the stores and queries it already imported, and keeps exporting the legacy
surface so its ~40 call sites do not change. The machine is the behaviour; the adapter is the wiring.

## What this module deliberately does not contain

**Any store or query.** Every effect is a port; the machine never imports one and never reads an ambient
global. A host with no NDK simply supplies an `isNdkReady` that returns false.

**Any Reactivity or framework.** No React, no `@tanstack/store`. The adapter bridges `subscribe` to the
`@tanstack/store` `Store` its consumers already use, the way `src/lib/stores/testLabels.ts` does.

**Any key encryption.** Deriving the pubkey and encrypting the raw key (NIP-49) is a port; the machine only
writes the `${pubkey}:${ncryptsec}` record and reads its second half back for the migration probe.
