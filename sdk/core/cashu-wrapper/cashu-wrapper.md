---
module: cashu-wrapper
kind: module
schema: architecture
applies: core@0.1
inherits: [core, funds-contract]
implements: ['#15e8ab', '#465561', '#edcc32']
opt-out: []
test-support: ['ts/*.test.ts']
landing:
  path: sdk/core/cashu-wrapper
  reason: it is a protocol rail that implements funds-contract's port, a sibling of wallet, and its imports of `../../funds-contract/ts/index` resolve unchanged here; the app-facing cashu wire primitives already live in sdk/commerce/payments/cashu and this module must not be conflated with them
levels:
  objective: present
  technical-spec: present — the host boundary, lifecycle, application adapter, durable command store and account-scoped runtime ownership
  implementation: present — TypeScript in ts/; the host is dependency-free and the module stays compatible with an injected Coco v2 manager/runtime adapter
  tests: present — the module's own contract suite, run by `cd sdk/core/cashu-wrapper/ts && bun test`
contract:
  entry: ts/index.ts
  operations: [balance, run, advance, get, list, recover, resume, cancel, disposeAccount, dispose]
  exports:
    [
      CocoWalletHost,
      CocoWalletPortAdapter,
      CocoPortAdapterError,
      MemoryWalletOperationStore,
      defineWalletApplicationAdapter,
      WalletHostError,
      WalletConfigurationError,
      WalletAdapterNotFoundError,
      WalletCommandConflictError,
      WalletInvalidTransitionError,
      WalletStaleWriterError,
      WalletRecoveryRequiredError,
      WalletStepExecutionError,
    ]
  types:
    [
      WalletStep,
      WalletOperationState,
      WalletAccount,
      WalletMoney,
      WalletOperationCommand,
      WalletOperationRecord,
      WalletOperationSnapshot,
      WalletBalance,
      WalletBalanceQuery,
      WalletStepResult,
      WalletRecoveryResult,
      CocoEngineOperationState,
      CocoEngineOperation,
      CocoOperationPort,
      CocoReconcilerStatus,
      CocoWalletRuntime,
      CocoWalletRuntimeFactory,
      WalletAdapterContext,
      WalletApplicationAdapter,
      WalletOperationStore,
      WalletHostOptions,
      WalletRunOptions,
      CocoLegKind,
      CocoLegOperationsDeclaration,
      CocoLegKey,
      CocoLegCommand,
      CocoMeltQuote,
      CocoMeltResult,
      CocoMeltRail,
      CocoLegRecord,
      CocoLegStore,
      CocoPortAdapterOptions,
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
    typecheck: [bun, run, typecheck]
    needs: []
access:
  group: m_cashu-wrapper
  read: [self]
  write: [self]
  exec: [self]
consumers:
  - Plebeian Auctions, through adapters for bid locks, winner release/receive and loser refund
  - Plebeian Market, through adapters for checkout, receive, mint and melt workflows
  - Torii Quest, through adapters for rewards and paid game actions
  - Continuum, through adapters for paid access and value-transfer workflows
naming:
  decided: cashu-wrapper
  decided_by: the maintainer's naming correction of 2026-10-07, applied in the swap below
  reason: this module is the local Cashu authority — the Coco wallet host — so, like the bolt11 and NWC rails, it is named for the protocol it wraps
  rename: a one-word answer substitutes the directory, the module key, the MD filename, the access group and every command or path that names the module, and nothing else — every declaring line, its identity and every citation of it stays byte-identical
  was: wallet — renamed to cashu-wrapper on 2026-10-07, in the one unit of work that then gave the name wallet to the payment aggregator; this module keeps its edge to the Coco authority (declared against the `core` ancestor, the parent this tree actually has) and every statement it declares, and only its directory, key, MD filename and access group moved
source:
  repo: https://github.com/PlebeianApp/market
  commit: 8b27db4adb404d2a0373621c3aba6244e5380086 — on the branch `feat/coco-v2-wallet-auction-lifecycle`, not an ancestor of this project's market pin, so the mounted specimen does not contain it
  coco-candidate: 60b7b070393eaad8746cb74a03c42017186da647 — named by the accepted Coco candidate, and absent from the pinned clone, so the reference cannot be checked out here
  paths: [docs/adr/ADR-0010-cashu-wallet-deps-recovery-sync.md, src/lib/coco/runtime.ts, src/lib/coco/auctions/]
---

# cashu-wrapper — Coco Wallet Host v2 as an app-neutral module

This module is the host boundary around Coco v2. It does not copy Auctions into a package and it does not
make a generic “payments helper”. Coco remains the only monetary authority; the host coordinates durable
application commands around it, and each Plebeian app supplies the small adapter that translates its domain
operation into Coco calls and its own business acknowledgements.

The TypeScript implementation deliberately depends on no UI, browser storage, Nostr library or application.
The composing app injects a runtime factory backed by its pinned Coco v2 manager, its seed custody and its
repository implementation. That preserves the accepted Coco candidate while allowing web, CLI, worker and
future non-TypeScript hosts to implement the same contract.

The implementation inventory is explicit: `ts/types.ts` is the port and record contract, `ts/errors.ts` is
the closed host error surface, `ts/memory.ts` is the reference atomic store, `ts/host.ts` is the coordinator,
`ts/port.ts` is the adapter that carries the host onto the funds contract's port, `ts/host.test.ts` is the
app-composition and safety suite, and `ts/port.test.ts` is the adapter's conformance suite.

**What did not travel into this tree.** The module's standalone Cashu NUT-00/03/04/11 client (`ts/nut-client.ts`)
and its unit suite stayed behind. It is deliberately not on the host's contract, nothing in this module imports
it, its only purpose was to duplicate cashu wire primitives this tree already carries under
`sdk/commerce/payments/cashu/`, and importing it would have forced a second dependency (`@noble/curves`) for
code no consumer reaches. The `evidence/` record and the per-module toolchain files (`ts/package.json`,
`ts/tsconfig.json`, `ts/bun.lock`) are not part of the library either: this tree has one root install and no
nested manifests.

## The statements

One statement per behaviour, each with a content-hash identity assigned by
`python3 core/checks/check.py --root . --assign`.

## `#f55a54` — The host is a composition boundary, never an application singleton

The host imports no app, UI, Nostr transport, storage backend or browser global. Runtime creation, durable
storage, time and every application operation are injected ports. A host instance is explicitly constructed
and disposed; the module does not publish a process-global configured host.

## `#269648` — Runtime ownership uses the complete account and environment identity

The host opens at most one runtime per `{ accountId, environmentId }` pair and never truncates either value.
The injected runtime is the only route to the Coco manager and is responsible for Coco's durable wallet
authority/fencing. Account switch and logout dispose that exact runtime; disposal is refused while one of its
commands is executing.

## `#18e1c3` — A durable command exists before an irreversible boundary

Every command is claimed in the injected store before an adapter can request a payable invoice, submit a
monetary attempt, acknowledge a business side effect, settle or refund. The command id, application,
operation kind, full account identity, money binding, intent fingerprint and step plan are immutable. Store
updates use a revision compare-and-set, so a stale host cannot overwrite a newer command revision.

## `#f4028b` — Request, attempt, acknowledgement, settlement and refund remain different states

The lifecycle is explicit: each step has an in-progress and completed state, and `unresolved` is a separate,
nonterminal state. A failed remote-boundary step becomes unresolved and cannot be retried as a new spend;
the adapter must reconcile it through `recover`. Balance is likewise a projection over available, reserved,
locked, pending and unresolved value rather than an authority or a boolean.

## `#485435` — Adapters are app-specific; the host contract is not

An adapter is selected by `{ applicationId, operationKind }`, declares an immutable step plan, and receives
only the exact account-scoped runtime plus the durable command snapshot. Auctions, Market, Torii Quest and
Continuum can register different adapters against one host without the host adding branches for their names
or importing their domain types.

## `#315796` — Domain revalidation happens immediately before each named step

An adapter may re-read its canonical domain state in `revalidate` immediately before the host marks a step
in progress. A rejected revalidation leaves the last durable wallet state unchanged. This is the seam used by
Auctions to re-check the auction and bid before Coco crosses the monetary boundary.

## `#7654d1` — Bearer material never crosses the host record or result boundary

The host persists and returns only operation identity, lifecycle, money binding, fee and failure code. It has
no field for a seed, private key, proof, token, witness or bearer secret. An adapter may use such material only
inside its injected Coco/domain callback; app-specific durable recovery material remains in the app's own
protected repository and is linked by the stable command id.

## `#417d51` — Same-command retries are idempotent and conflicts fail closed

Concurrent calls for the same command and intent join one in-process execution. Later calls resume the stored
plan and skip completed steps. Reusing a command id with a different fingerprint, account, money binding,
adapter or plan throws a conflict; an in-progress, failed or unresolved record requires recovery rather than
blind replay.

## `#2f50be` — Recovery is adapter-owned reconciliation over host-owned lifecycle

`recover` asks the registered adapter to inspect Coco and its application repository, then atomically records
only an ordered prefix of the original step plan. It may resolve the command to a known completed prefix or
leave it unresolved; only a resolved record can resume. This keeps Coco's operation record authoritative for
money while the host owns the reusable coordination contract.

## `#7889e5` — Cancellation is terminal and recovery refuses a cancelled command

`cancel` is the application deliberately releasing a prepared reservation through its adapter, so a cancelled
command is terminal rather than unresolved. `recover` reconciles an interrupted or unresolved command; it
refuses a cancelled one with `WalletInvalidTransitionError` instead of rewriting it to a recoverable state.
The record keeps its state and completed steps, and a later `run` cannot cross a monetary boundary the
cancellation already released.

## `#16113f` — The Coco wallet exposes the contract's port for its own leg (`#de8ec0`)

The cashu-wrapper is the payment layer's Coco wrapper — the local Cashu authority — and this edge is what joins it
to the funds contract: under the contract it exposes the contract's port for its own leg. The statement cites
the port's identity and joins it rather than restating it; the port's operations, the rung vocabulary, the
authority rule, the conservation rule and the terminal rule are the contract's, and this leg adds to them
without copying them. What the cashu-wrapper does under the contract is the behaviour its statements above already
declare, unchanged; the adapter that carries this host onto the port is a later increment, not this one.

**Amended 2026-10-07 — the later increment landed.** The adapter that carries this host onto the port is
`#7a7f2d` (the Coco leg's port adapter); the facts above are unchanged.

## `#7a7f2d` — The Coco leg's port adapter maps the contract's port onto the host's own lifecycle (`#de8ec0`)

The cashu-wrapper's Coco leg — the melt — is carried onto the contract's port by `CocoWalletPortAdapter`, an
adapter that wraps `CocoWalletHost` and adds no lifecycle of its own. `obtain` drives the host's pre-boundary
step (`host.run` through `prepare`) and only then obtains and retains the leg's durable reference; `submit`
drives the step that crosses the monetary boundary and performs the melt; and `reconcile` is the host's own
`recover` (`#2f50be`), the idempotent read that never submits. The Coco leg's durable reference is the
**engine's operation id**, retained before the proofs are spent and kept with the **melt quote id** where the
engine exposes one; it lives in a wrapper-owned leg record, on the same store interface the other rails use,
keyed per wrapper and leg and linked to the host's command record by the stable command id (`#7654d1`); no
field is added to the host's record, and the adapter consumes only the host's public snapshot and results, so
it opens no path by which a store value can carry a seed, proof, token or witness out of the host. The melt's
authority is the mint, and the engine is that authority's local proxy: a preimage validated against the
invoice's own payment hash is cryptographic and settles, and a **settled state read from the engine's own
operation record is the authority's own word read at its source**, so a settled melt may reach
`witnessed-settled` (the contract's cryptographic `mint_quote_state`, `#6f9f08`) — it is not a wrapper's
declaration. The boundary is precise: a local read proves the engine's view of the mint's state, including
after a crash, and cannot prove the mint will not later disagree unless the refresh is actually performed, so
the reconcile reads the operation and, while it is still `executing`, refreshes it. A settle out of that
authority is refused — the leg stays unresolved, never reported settled — when the app has left the engine's
own reconcilers off (the proof-state watcher, the melt-quote watcher and the melt-settlement processor,
`#09f049`); where nothing can be proven the leg reaches the non-settlement terminal rather than a settlement.
The clock is injected and the quote's expiry is absolute on the leg record.

## `#b8ce55` — The Coco leg's engine is a declared operation port a composing app supplies

The runtime seam's engine is no longer opaque. `CocoWalletRuntime` carries an engine whose type is bounded by
`CocoOperationPort` — the operations a Coco leg actually requires: read an operation by id (`get`), enumerate
what is prepared and what is in flight (`listPrepared`, `listInFlight`), refresh an operation whose state is
still `executing` (`refresh`), and reclaim one that must be rolled back (`reclaim`). The module still imports
nothing and the composing app still supplies the engine; what changed is that the requirement is **typed and
checkable**, so an app that hands the host an engine it cannot read or refresh fails to compile rather than at
the mint. The runtime additionally declares whether the engine's own reconcilers are enabled
(`proofStateWatcher`, `meltQuoteWatcher`, `meltSettlementProcessor`), which the reconcile reads before it may
settle (the statement below).

## `#badc9a` — The leg's durable reference is the engine's operation, and recovery reads and refreshes it

The leg record's durable reference is the **engine's operation id**, retained before the melt crosses the
boundary, with the **melt quote id** kept beside it where the engine exposes one. So `recover` — the reconcile
the port's `reconcile` maps onto — is a **read plus a refresh** against the engine (`engine.get`, then
`engine.refresh` while the operation is still `executing`), and the app-supplied quote read is a complement,
never the only path. A crash at each operation state leaves the leg resolvable rather than lost: a `prepared`
operation is unresolved (nothing crossed the boundary); an `executing` one is refreshed and judged on the
authority's answer; a `pending` one is unresolved; a `finalized` one is the authority's own word read at its
source and may reach `witnessed-settled`; a `rolled_back` one reaches the non-settlement terminal `abandoned`.
A local read proves the engine's view of the mint's state — including after a crash — and cannot prove the
mint will not later disagree unless the refresh is actually performed, so a settle is written only from an
operation the engine reports settled with its reconcilers enabled.

## What this module does not decide

It does not choose a mint, seed derivation, IndexedDB schema, signer, relay, UI, Nostr event kind or product
policy. It does not expose a fallback NIP-60 authority and it does not make real-value readiness claims for
the conditional Coco candidate. Those decisions belong to the composing app and the pinned Coco runtime;
the host makes their boundary explicit and testable.
