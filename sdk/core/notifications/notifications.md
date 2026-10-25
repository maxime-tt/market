---
module: notifications
kind: module
schema: architecture
applies: core@0.1
inherits: [core]
implements: []
opt-out: []
test-support: ['ts/*.test.ts', 'ts/persistence.ts#createMemoryStorage']
levels:
  objective: present
  technical-spec: present — the record, the active queue, the passive ledger, the rule seam, the subscription and the storage seam
  implementation: present — dependency-free TypeScript in ts/, framework-free and domain-free
  tests: present — the queue, ledger, subscription, rule seam and persistence suites, run by `bun test sdk/core/notifications/`
contract:
  entry: ts/index.ts
  operations: [createNotifications, createNotification, deriveFromRules, serializeNotifications, restoreNotifications, createMemoryStorage]
  exports:
    [
      createNotifications,
      createNotification,
      deriveFromRules,
      serializeNotifications,
      restoreNotifications,
      createMemoryStorage,
      NotificationsError,
    ]
  types:
    [
      Notification,
      NotificationInput,
      NotificationRule,
      NotificationsSnapshot,
      LedgerSnapshot,
      NotificationQueue,
      PassiveLedger,
      NotificationsOptions,
      Notifications,
      PersistedNotifications,
    ]
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
  group: m_notifications
  read: [self]
  write: [self]
  exec: [self]
consumers:
  - the platform's notification wiring, which registers rules (what counts as a notification) and renders one
    kind as a modal — the auction-win case is one such rule, not a mechanism
  - the app's conversation and order surfaces, which read the passive ledger's per-scope unseen counts and
    last-seen marks
naming:
  reserves: the mechanism's own vocabulary — the notification record, the active queue and its actions, the
    passive ledger and its scoped counts, the rule seam, the snapshot and the storage seam
  does_not: no domain name appears anywhere here — no auction, order, message or modal; `TType` is an open
    string the host supplies and `TPayload` is the host's own shape
  was: it replaces two app stores at once — `src/lib/stores/notifications.ts` (the passive, scoped counts) and
    the artificial `src/lib/stores/auctionWon.ts` (the active, queued modal) — because an auction win is one
    instance of a general notification, not a special case with its own store
source:
  decision: owner ruling 2026-10-25 — the platform's notifications are an instance of a notifications core
    module; the mechanism lives in `sdk/core/`, the configuration (the type union, the localStorage keys, the
    modal policy) stays in the platform
---

# notifications — the mechanism the platform's notifications are an instance of

**The job, in one sentence** — own the general notification mechanism: an **active queue** of notifications
demanding attention (enqueue with de-duplication, dismiss-active, remove-by-predicate, clear,
retain-matching), a **passive ledger** of scoped unseen counts and last-seen marks, a **rule seam** the host
registers rules against, a **subscription** the host bridges to its own reactivity, and a plain
**serialise/restore** seam over an injected storage port.

**What it is.** The one node whose job is a fact about a _notification_ — not about an auction, an order or a
message. The owner's reframe is the whole design: there is nothing special about an "auction win"; it is one
instance of a general notification concept. The platform _actively_ notifies (a model drives it — the auction
win) and _passively_ notifies (someone reacts, buys or messages you). Both are the same concept with a
host-supplied `type` and `payload`; the mechanism is here, the configuration is in the platform.

**What it is not.** It names no domain. `TType` is an open string, `TPayload` is the host's own shape, and
`scope` is an opaque counting key — so the core can carry an auction-win notification and a conversation
unread-count without ever learning the words. It owns no rule: a rule is the host's (`{ id, derive }`), and
`deriveFromRules` only dispatches them. It owns no key, no encryption and no storage policy — the storage
port's own doc gives all three to the host — so it never reads a global and never decides where state lives.

**The files this module owns.** `notifications/notifications.md` (this document); `notifications/index.ts`
(the entry); `notifications/ts/index.ts` (the module's own entry), `notifications/ts/types.ts` (the record,
the rule seam, the queue, the ledger and the options), `notifications/ts/errors.ts` (the closed configuration
refusal), `notifications/ts/notifications.ts` (the factory), `notifications/ts/rules.ts` (the seam's
dispatch), `notifications/ts/persistence.ts` (the storage seam and a reference in-memory port),
`notifications/ts/notifications.test.ts` (the mechanism suite) and `notifications/ts/persistence.test.ts`
(the storage-seam suite). The reference in-memory port and the test files are **test support**, declared in
the front-matter's `test-support:` and out of contract.

## The statements

### The model

A `Notification` carries an `id`, a host-supplied `type` (an open `string`, never a fixed union), a
host-supplied `payload`, a `scope` for passive counting, a `createdAt`, and its own `read`/`dismissed` state.
The record's own state travels with it, so a host that persists and rehydrates a notification round-trips
those flags rather than reconstructing them. `createNotification` fills `read` and `dismissed` to false when
the host omits them. The core holds no `NotificationType` union: that union is the platform's policy.

### The active queue

`enqueue` appends unless a notification with the same `id` is already queued, so **de-duplication is by
`id`** and the host encodes whatever composite identity it needs into that field (for an auction win, the
bidder pubkey and the auction root event id, joined). `dismissActive` removes and returns the head — the
notification currently demanding attention — generalising the auction queue's `dismissActive`. `remove` and
`retain` take a predicate, generalising the auction queue's per-auction and per-bidder filters. `clear`
empties the queue, and `markRead` flips one record's `read` flag. Every action returns enough to branch on
(added / how many removed / the dismissed record), and stores a shallow copy of the record — the payload is
the host's own object, held by reference, since an opaque generic cannot be deep-copied.

### The passive ledger

The ledger holds per-scope unseen counts and last-seen marks plus one **global last-seen floor**.
`increment(scope, by?)` raises a scope's count (a non-positive `by` is ignored); `markSeen(scope, at?)` zeroes
one scope's count and stamps its last-seen; `markAllSeen(at?)` clears every count and advances the global
floor. The property that matters is **scoping**: marking one scope seen never touches another scope's count or
last-seen. `lastSeen(scope)` returns the maximum of the global floor and the scope's own mark — the
`getScopedLastSeen` rule from the app store, generalised — and `totalUnseen()` sums every scope's count.

### The rule seam

`NotificationRule<TInput, TType, TPayload>` is the seam: `{ id, derive(input) => Notification[] }`. A rule is
the host's — the platform declares what counts as a notification — and the core implements none.
`deriveFromRules(rules, input)` runs every rule over one input and concatenates what they derive, in order.
This is the seam the owner asked for: the app subscribes specific logic (its rules) to the notification
system, which carries them and knows nothing of their content.

### The subscription

`subscribe(listener)` returns an unsubscribe function, matching the event store's `subscribe` style so the
host can bridge it to React (or anything else) without the core importing React. The listener is handed a
copied `NotificationsSnapshot` (`{ active, ledger }`) on **every** change; subscribing does not fire
immediately, and a snapshot is a copy so a subscriber cannot mutate the queue through it.

### The storage seam

Persistence is optional and plain. With no storage port the module works entirely in memory. With a
`KeyValueStoragePort` injected and a `storageKey` supplied, every change is serialised (a failed auto-write is
swallowed, never surfaced to a caller), `persist()` writes explicitly, and `restore()` reads back — leaving
in-memory state untouched when the payload is absent or does not parse. The module owns no key of its own, so
a storage port without a key is refused fail-closed (`NotificationsError`). `serializeNotifications` /
`restoreNotifications` are the pure halves of the seam, and `createMemoryStorage` is a reference port for
tests and for a host that wants the seam wired but stores nothing durably.

## What this module deliberately does not contain

**The app's type union.** `NotificationType = 'order' | 'message' | 'order-update'` is the platform's policy,
not the mechanism. It belongs in the platform's notification configuration — the place that registers rules
and decides which `TType`s exist — and never in core, which takes `TType` as an open string. Likewise the
app's `NotificationState` shape (its eleven counters and its nested timestamp maps) is configuration: the core
offers one ledger with scoped counts, and the platform decides which scopes it keeps.

**The app's localStorage keys.** `'nostr-market:notifications'` and the exact subset that is persisted
(notifications.ts saves only `lastSeenTimestamps`) are the host's storage policy. The core is handed a
`storageKey` and a port; it neither chooses the key nor decides what is durable. The platform keeps the key
and the "what to save" decision.

**The modal policy.** Which notification type renders as a modal, when the modal opens, and how the queue is
drained into it are product decisions. The core exposes the active queue and a subscription; the platform
decides that an auction win opens a modal and that a message does not.

**Any domain knowledge at all.** No auction, order, message, bidder, conversation or product name appears in
the mechanism, and no concrete rule is implemented. The mechanism is general; every instance of it — including
the auction win — is the platform's configuration layered on top.
