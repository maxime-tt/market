---
module: state
kind: module
schema: architecture
applies: core@0.1
inherits: [core]
implements: []
opt-out: []
test-support: ['ts/state.test.ts']
levels:
  objective: present
  technical-spec: present — the observable container, its referential equality, its listener isolation and the storage seam
  implementation: present — dependency-free TypeScript in ts/, framework-free and domain-free
  tests: present — the get/set, subscribe, equality, persistence and refusal suites, run by `bun test sdk/core/state/`
contract:
  entry: ts/index.ts
  operations: [createStateStore]
  exports: [createStateStore, StateError]
  types: [StateStore, StateStoreOptions, PersistentStateStore]
implementations:
  - id: ts
    lang: typescript
    dir: ts
    entry: ts/index.ts
    package: null
    install: [bun, install]
    build: []
    test: [bun, test]
    typecheck: [bunx, tsc, --noEmit]
    needs: [core]
access:
  group: m_state
  read: [self]
  write: [self]
  exec: [self]
consumers:
  - every store that hand-rolls "hold a value, hand it out, notify on change, keep a copy in storage" —
    the first being `sdk/config/blacklist`, which the src/ retirement moves onto this primitive
naming:
  reserves: the mechanism's own vocabulary — the state container, get/set, the subscription, and the
    serialize/persist/restore storage seam
  does_not: no domain name appears anywhere here — no blacklist, auction, UI flag or settings; `T` is the
    host's own state shape and the storage key is the host's own
  was: it is the generic form of what each app store hand-rolls (`src/lib/stores/blacklist.ts` is the first);
    it generalises only the container, not any one store's domain
source:
  decision: owner ruling 2026-10-25 — the src/ drain needs one framework-free state primitive, so the stores
    can move to `sdk/` behind a host-supplied storage port; the mechanism lives in `sdk/core/`, the state and
    the port stay with the host
---

# state — the generic observable container the drain's stores are built on

**The job, in one sentence** — own the general state mechanism: hold a `T`, hand it out with `get`, replace it
with `set` (a value or a functional updater), notify `subscribe`rs on every effective change, and — when a
`KeyValueStoragePort` is injected under a host-chosen key — keep a serialised copy in step with an explicit
`persist`/`restore` seam.

**What it is.** The one node whose job is a fact about _state_ — not about a blacklist, an auction or a UI
flag. It is the generic form of what each app store hand-rolls: `get`/`set`/`subscribe` plus optional
write-through persistence. `sdk/config/blacklist` is the first instance; every other migration that replaces a
hand-rolled store with a `sdk/` module is the same shape layered on top.

**What it is not.** It names no domain: `T` is the host's own shape, the storage key is the host's, and no
feature name appears here. It owns no key, no encryption and no storage policy — the storage port's own doc
gives all three to the host — so it never reads a global and never decides where state lives. It imports no
React and no `@tanstack/*`: the host bridges `subscribe` to its own reactivity (see
`platform/web/config/blacklistBinding.ts`, which mirrors the notifications binding).

**The files this module owns.** `state/state.md` (this document); `state/index.ts` (the entry);
`state/ts/index.ts` (the module's own entry), `state/ts/types.ts` (the container, the options and the
persistent surface), `state/ts/errors.ts` (the closed configuration refusal), `state/ts/state.ts` (the
factory), and `state/ts/state.test.ts` (the suite, declared in the front-matter's `test-support:` and out of
contract).

## The statements

### The container

`StateStore<T>` is `get()` (the current state, by reference), `set(next)` (a value or a functional updater)
and `subscribe(listener)` (returns an unsubscribe). `createStateStore` returns the container augmented with
`persist()` and `restore()`. Subscribing does not fire immediately; the listener is handed the state by
reference on every change.

### Referential equality

`set` is a no-op — no listener runs and nothing is written — when the resolved next state is **referentially
identical** (`Object.is`) to the current one. So the functional form no-ops when the updater returns its own
argument, and a value form no-ops only when the same reference is passed again. A value-equal but distinct
object (a fresh `{ ...state }`) is **not** a no-op and does notify. The container never clones `T`, so a host
that mutates in place will not notify — a mutation that must be observed must be expressed as a new value.

### Listener isolation

A listener that throws is caught and **isolated**: the remaining listeners still run. One broken subscriber
cannot stop the others. The error is swallowed, matching the house degrade-don't-tear-down pattern for
non-critical paths; a host that needs to observe listener failures wraps its listener itself.

### The storage seam

Persistence is optional and plain. With no port the primitive works entirely in memory and `persist`/`restore`
are no-ops. With a `KeyValueStoragePort` injected and a `storageKey` supplied, every effective change is
serialised (a failed auto-write is swallowed, never surfaced to a caller), `persist()` writes explicitly, and
`restore()` reads back — leaving in-memory state untouched when the payload is absent or does not parse. The
primitive owns no key of its own, so a storage port without a key is refused fail-closed (`StateError`).
`serialize`/`deserialize` default to JSON and can be overridden for a host's own encoding.

## What this module deliberately does not contain

**Any domain state or action.** A blacklist's three regexes, an auction queue, a UI flag: those are the host's
state, and this primitive only carries a `T` it never inspects. The first host, `sdk/config/blacklist`, keeps
its own shape and its own actions and merely holds its state here.

**Any storage key, policy or encryption.** The core is handed a `storageKey` and a port; it neither chooses
the key nor decides what is durable — the port's own doc gives the key, the encryption and the policy to the
host.

**Any reactivity.** No React, no `@tanstack/*`, no `@/`, `@ui/`, `@platform/`. The host bridges the plain
`subscribe` to its own store (the notifications binding is the template) and the core stays framework-free.
