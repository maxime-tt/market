---
module: nwc-wrapper
kind: module
schema: architecture
applies: core@0.1
inherits: [core, funds-contract]
implements: []
opt-out: []
test-support: ["ts/*.test.ts", "ts/memory.ts"]
landing:
  path: sdk/core/nwc-wrapper
  reason: it is a protocol rail that implements funds-contract's port, a sibling of wallet, and its imports of `../../funds-contract/ts/index` resolve unchanged here; it is a library the app composes, not an app-facing commerce module
levels:
  objective: present
  technical-spec: present — the NIP-47 session rail: the injected session port, the durable reference, the fallback order, the injected clock and the deadline, the budget ceiling and the error taxonomy
  implementation: present — the contract's port implemented over the injected session; the concrete `@getalby/sdk` adapter sits behind the injected interface, and the module itself opens no network
  tests: present — the module's conformance suite, run by `cd sdk/core/nwc-wrapper/ts && bun test`
contract:
  entry: ts/index.ts
  operations: [obtain, submit, reconcile]
  exports: [NwcWrapper, GetalbyNwcSession, MemoryNwcLegStore, NwcWrapperError, classifyNwcFailure, NWC_ERROR_RECOVERABLE]
  types: [NwcLegKind, NwcFallbackStep, NwcSessionStatus, NwcOutcome, NwcPaymentBody, NwcTransactionBody, NwcErrorCode, NwcSession, NwcInvoiceCodec, NwcLegKey, NwcLegRecord, NwcLegStore, NwcLegCommand, NwcWrapperOptions, GetalbyNwcSessionOptions]
implementations:
  - id: ts
    lang: typescript
    dir: ts
    entry: ts/index.ts
    package: null
    install: [bun, install]   # every action is a token array, never a shell string
    build: []
    test: [bun, test]
    typecheck: [bun, run, typecheck]
    needs: [funds-contract]   # CODE dependency (module name): the port's types are obtained from the ancestor
access:
  group: m_nwc-wrapper
  read: [self]
  write: [self]
  exec: [self]
consumers:
  - the aggregator, which inherits this wrapper, reads its registration and executes the acceptance gate
  - the app's checkout and orders, which compose it to obtain the durable reference, submit the request and reconcile the leg
naming:
  reserves: the NIP-47 rail's own vocabulary — the session port and its seam outcomes, the fallback order, the error taxonomy and a leg store keyed per wrapper and leg
  does_not: no other rail's vocabulary appears here (the bolt11 invoice-and-preimage rail and the Coco local authority are other modules); the connection URI's secret is bearer material and lives nowhere in this tree; the reserved mount names (core, market) are untouched
  rename: a one-word answer substitutes the directory, the module key, the MD filename, the access group and every command or path that names the module, and nothing else — every declaring line, its identity and every citation of it stays byte-identical
source:
  repo: https://github.com/PlebeianApp/market
  commit: 56258b55e2805895c941eb879f7a3ea1308bc0c5 — the assembly's pinned specimen, where the rail's real surface is read
  paths: [src/lib/utils/payment.utils.ts, src/components/lightning/LightningPaymentProcessor.tsx]
---

# nwc-wrapper — the NIP-47 session rail, under the funds contract

**The job, in one sentence** — implement the contract's port (`#de8ec0`) over the NIP-47 session rail: obtain the
leg's durable reference (the request event id and the invoice's payment hash) and write it before any money
moves, submit the one irreversible request to a remote wallet, and reconcile by re-reading an authority — never
re-submitting — so a leg of this rail settles only on a validated preimage and a silence is never a settlement.

**What it is.** The rail whose authority is a remote NIP-47 wallet over Nostr relays: the app publishes a
`pay_invoice` request and awaits the wallet's reply. The wrapper owns everything the client library
does not: the session lifecycle and its reconnect policy, the wait and its abort, the
resolution of the ambiguous outcome when the request was published and no reply came, the budget ceiling, the
connection URI's secret custody, the error taxonomy and the deadline. The request-to-reply correlation is
**not** among them where the installed library does not expose it: the module owns the id it assigns only as a
durable local reference, and the adapter cannot correlate the reply to it because `payInvoice` gives a caller no
event id (`#7af452`). The library — `@getalby/sdk` — is taken as
an **injected port**: the wrapper talks only to the `NwcSession` interface, and one concrete adapter
(`GetalbyNwcSession`) implements it over the SDK, so no test needs a relay, a wallet or a network.

**What it is not.** It holds no bolt11 authority (that is `bolt11-wrapper`'s) and no Coco/Cashu authority; it
does not evaluate a set's verdict (that is the aggregator's); it writes no other wrapper's leg; and it opens no
network of its own — every library call is behind the injected `NwcSession` port, and the tests drive that port
with fakes. It carries no `engineOperationId` and no `cancelled` terminal: a published NIP-47 request cannot be
un-published, so this rail has no cancellation state.

**The files this module owns.** `sdk/core/nwc-wrapper/nwc-wrapper.md` (this document);
`sdk/core/nwc-wrapper/ts/index.ts` (the entry), `ts/types.ts` (the rail's types and its injected ports),
`ts/wrapper.ts` (the port implementation), `ts/errors.ts` (the closed error surface and
the error taxonomy), `ts/session.ts` (the concrete `@getalby/sdk` adapter behind the injected
interface), `ts/memory.ts` (the test-only in-memory leg store) and
`ts/wrapper.test.ts` (the conformance suite). The module ships as source only: the `evidence/` record and the
per-module toolchain files (`ts/package.json`, `ts/tsconfig.json`, `ts/bun.lock`) did not travel, because this
tree has one root install — `@getalby/sdk` is a root dependency — and no nested manifests. The in-memory store and the test file are **test support**, declared in
the front-matter's `test-support:` and out of contract: a statement must not be fulfilled by tooling, so the
store cites the leg-store statement as its provenance, never as a behaviour.

## The statements

One statement per behaviour, each a line of its own with its content-hash identity assigned by
`python3 -B core/checks/check.py --root . --assign` — never typed. The port's types are the contract's, cited
(`#de8ec0`) and never restated: this module adds the rail, its injected session port and its policy, not a
second vocabulary.

## `#0643db` — The wrapper implements the contract's port over the NIP-47 rail, and reconcile never submits

The wrapper implements the contract's port (`#de8ec0`) over the NIP-47 session rail: `obtain` resolves the leg's
durable reference **before** the request is published, `submit` is the one irreversible step that publishes the
request to the remote wallet, and `reconcile` re-reads an authority and **never** re-submits. A reconcile that
already holds a cryptographic settle returns it unchanged (the settlement is write-once); a reconcile that
cannot conclude leaves the leg where it was and publishes nothing.

## `#6ce62a` — The rail's leg declares the subset of the port's operations it has

The rail has one leg kind, the NIP-47 session, and it declares the subset of the port's three operations it has
as the ordered projection in the port's canonical order: `obtain`, `submit` and `reconcile`. It is a
money-mover, so it declares `submit`, and by the port's rule a rail that declares `submit` must also declare
`reconcile`; its declared plan is therefore the full canonical order. The declaration is the ordered projection
the contract requires and nothing else — it asserts which operations the rail has, never how they behave.

## `#b8c987` — The session lifecycle and its reconnect policy are the module's, not the library's

A NIP-47 connection URI is a set of relays and a keypair, and the library opens relays without owning a
lifecycle the shopping modules can observe. So the module owns it: before it submits a request it ensures the
session is live, re-attempting the connection up to the injected `reconnect.maxAttempts`; a session that cannot
be brought up is a transport failure, and the leg it was for stays `unresolved` — a silence, never a negative
settlement. The status the module acts on (`connected` / `reconnecting` / `closed`) is the module's, read from
the injected session port.

## `#568e8d` — The request-to-reply correlation and its timeout are the module's

NIP-47 replies are keyed by the request's own identity, and the library that reads them does not own the
policy. The module owns it: it assigns the request event id through the injected `newId` port, records it on the
leg, and hands it to the session so the reply is correlated to the request the module published. It computes a
remaining wait from its injected clock and passes that bound to the session; a reply that does not arrive within
the bound is a `no-reply`, which the module reads as `unresolved`, never as a failed payment.

## `#47312b` — The durable reference is written before submit, and it is the request event id plus the payment hash

The leg record binds the leg's durable reference — the NIP-47 **request event id** the module assigned and the
invoice's **payment hash** — and it is written through the injected leg store in `obtain`, **before** `submit`
publishes any request and before any money moves. (`#7af452` the installed library does not let a caller own the
event id it signs on the wire, so this id is the leg's durable **local** reference and not the wire correlation
key.) This is the contract's ordering obligation (`#1b7115`): a
late or out-of-band reply reconciles against a reference already written rather than a callback that never
comes. `submit` fails closed if the record is absent, so nothing reaches the wallet unless the reference is
durable first. The store is keyed per wrapper and leg and its writes use a revision compare-and-set, so a stale
writer cannot overwrite a newer leg revision.

## `#cd4679` — The ambiguous-outcome fallback order, and a silence is never a negative settlement

When the request was published and the socket dropped with no reply, the module does not stop: it resolves the
ambiguity by a declared **fallback order** — the payment reply, then `lookup_invoice` by payment hash, then
`list_transactions` filtered to that hash, then an explicit `unresolved`. `reconcile` walks that order and
**never submits**. The rule that governs it: an unreachable or unanswered payment is `unresolved` — a witness
may still arrive — and never a negative settlement; the module manufactures no `failed` or `expired` from a
silence, from a dropped socket, or from a wallet that answers nothing.

## `#92cbfa` — Verification at the seam: only a validated preimage settles, a declaration reaches at most `attested`, and the look-up is the authority a reply is not

The witness handling follows the contract's one ladder (`#6f9f08`). A preimage validated against the leg's own
payment hash — whether it arrives in the `pay_invoice` reply or in a look-up — is the **cryptographic** witness
that settles the leg (`witnessed-settled`), and a settlement is written once. A bare `pay_invoice` reply with no
validated preimage, or a wallet that reports a state it does not back with a validating preimage, is a
**declared** witness and moves the leg only to the weaker named rung `attested` — it settles nothing. The
look-up is the authority a bare reply is not: a `lookup_invoice` that returns a settling preimage promotes an
`attested` leg to `witnessed-settled`, because the check is cryptographic and independent of the reply that
preceded it.

## `#4e3879` — The budget ceiling is held, and a payment above it is refused before a request leaves

The module holds the intent's ceiling and refuses a payment above it in `obtain`, **before** any request is
assembled or published: `obtain` returns a fail-closed refusal naming the amount field and never echoing the
value, so a payment above the ceiling never leaves the box. (Per `#485e92`, the number the ceiling is held
against is the invoice's own decoded amount, not the caller's declaration.) The ceiling is the cart's number, held by the
wrapper and declared on its registration; the remote `get_balance` is advisory and is never the module's
authority for the ceiling.

## `#ff792b` — The clock is injected, the reconcile deadline is absolute on the leg record, and a late answer follows the contract's late-answer rule

The wrapper's clock is injected and is never a host clock global, and the reconcile deadline it computes is
written as an **absolute** instant on the leg record (from that injected clock). The deadline is a **wait
cadence and the trigger for the non-settlement terminal**, not a settleability bound: passing it neither settles
a leg nor publishes one. A **late cryptographic** answer is a fact and **does settle** a still-open leg; a late
**declared** answer moves the leg at most to `attested` and never settles; and a past-deadline reconcile that
finds no answer leaves the leg `unresolved` — the deadline settles nothing by itself.

## `#d843ee` — The error taxonomy collapses what the library throws into one small vocabulary, and says which members are recoverable

The library throws its own family of errors (`Nip47NetworkError`, `Nip47TimeoutError` and its subclasses, and a
`Nip47WalletError` carrying a NIP-47 error code). The module collapses them, through one classifier, into the
small vocabulary the rest of the system acts on — `unreachable`, `rejected`, `expired`, `insufficient_balance`
and `ambiguous` — and states, once, which members are **recoverable**: `unreachable` and `ambiguous` can make
progress on a retry or a reconcile, while `rejected`, `expired` and `insufficient_balance` cannot until
something outside the rail changes. A timeout is classified `ambiguous` and read as a no-answer, never as a
failure.

## `#006a58` — The connection URI's secret is bearer material and lives only inside the injected session

A NIP-47 connection URI embeds a private key (`secret=…`). It is bearer material: it lives **only** inside the
injected session — the concrete `@getalby/sdk` adapter holds it in a private field — and it never appears on a
leg record, on a handle, in the module's options, or in any log. The module's options carry the session, not
the URI; a record carries the request event id and the payment hash, never the key; and a returned `FundsHandle`
carries no field the secret could ride in.

## `#c90403` — The library is taken as an injected port, every call behind the injected interface, so no test needs a network

Every call to the library is behind the injected `NwcSession` interface: the session lifecycle, the pay request,
the look-up and the transaction scan are supplied by the composing app (the concrete `GetalbyNwcSession` adapter
wraps `@getalby/sdk`), and the wrapper imports the SDK only through that adapter. The module reads no host
clock, storage or window global, and the tests drive the port through fakes, so the module is provable with no
live relay, wallet or network.

## `#c997ae` — The wrapper declares its registration, and takes the port's types from the contract ancestor

The wrapper declares the registration the aggregator's gate validates (`#87e7a5`) — its stable identity, method,
port, method-derived authority kind, the operations it exposes with their ordered plan, its declared store and
the store's kind, the witness kinds it can produce, its reconcile deadline, the shape and boundary of its
journal reference, its ceiling and the contract version. It obtains the port's types from its ancestor, the
funds contract (`#d16b28`), and declares the code dependency, rather than minting its own copy. Its authority
kind is `remote-and-observable` (`#a8e2cf`), so its legs carry a verification expectation and an absolute
reconcile deadline.

## `#485e92` — The ceiling bounds the invoice's own decoded amount, not the caller's declaration

The budget ceiling (`#4e3879`) is checked against the amount the invoice itself carries, decoded through
the injected codec (`NwcInvoiceCodec.amountSat`), and never against the caller's declared `amountSat`:
`obtain` refuses `over-ceiling` when the **invoice's own amount** exceeds the ceiling, so an invoice for
more than the declared intent cannot pass the bound. An invoice whose amount the codec cannot decode is
refused (`undecodable-invoice`) and is never passed — a payment the module cannot bound is not made. A
declared amount that disagrees with the invoice's own amount is a **distinct** refusal, `amount-mismatch`,
never `over-ceiling`: an over-ceiling invoice and a declaration that does not match the artifact are
different faults, and naming them apart is what lets a caller tell a cart that overran its ceiling from a
call whose intent and artifact disagree. The refusal is symmetric — the module refuses a declaration
**smaller** than the invoice (which, trusted, would let an invoice above the declared intent through: the
exact defect this statement closes) and a declaration **larger** than the invoice (which would mean the
intent's number and the artifact's number name different amounts) — because the module treats the intent's
number and the artifact's number as a thing that must agree, not a discrepancy it silently resolves. The
refusal names the field and never echoes the value.

## `#7af452` — The correlation is bounded by the installed library: the module owns the wait, not the request event id

The module assigns a request event id through `newId` and records it as half of the leg's durable
reference (`#47312b`), but the installed `@getalby/sdk` does not let a caller own, supply or observe that
id: `NWCClient.payInvoice(request: { invoice; metadata?; amount? })` takes no event id, and the client
builds and signs the NIP-47 request event itself inside a _private_ `executeNip47Request`, subscribing to
the reply keyed by its own internal id. So the id the module assigns is a durable local reference and
**not** the wire correlation key, and the adapter cannot correlate the reply to it. **This corrects
`#568e8d`'s claim that the request event id is handed to the session so the reply is correlated to the
request the module published: that claim cannot be upheld against the installed library and does not
stand.** What the module can honestly claim is only that `payInvoice` returns the one reply to the one
request the client published for the given invoice, and the module awaits exactly that one promise. The
wait, in contrast, is the module's and it is real: the module computes the remaining wait from its injected
clock (`#ff792b`) and hands the bound, together with its own abort signal, to the session; the adapter
bounds the payment at that wait, and a payment that has not answered within it is aborted and read as
`no-reply` — `unresolved`, never a settlement and never a negative settlement (`#cd4679`). The installed
`payInvoice` exposes no abort signal and no timeout parameter of its own (its internal reply timeout is a
fixed default), so the adapter bounds the module's wait itself and cannot force the client to tear its
subscription down early — a limit this statement records rather than papers over.

## What this module deliberately does not contain

No bolt11 invoice/preimage authority and no Coco/Cashu authority; no set record or aggregate verdict; no refund
path; no `engineOperationId` and no `cancelled` terminal (a published NIP-47 request cannot be un-published); no
host clock, storage or window global; no network client of its own outside the injected session; the connection
URI's secret on no record, no handle and no log; and no second copy of the port's vocabulary — the operations,
the rungs and the exchange shapes are the contract's, cited and never restated.
