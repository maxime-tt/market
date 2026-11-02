# AGENTS.md — sdk

`sdk/` is the portable, host-agnostic layer. This is the placement doctrine for
it. It was missing, and its absence is why the tree drifted; the drift is now
recorded as dated debt rows, not reshuffled in this pass.

## Placement rule

Place a module by what it _is_, not by which feature first needed it:

| directory     | holds                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`       | protocol capability, mechanism, or shared type with **no marketplace noun**: media, relays, signer, event-store, notifications, state, ports, utils. |
| `commerce/`   | seller/buyer flows involving listings, money, orders, capacity, or settlement.                                                                       |
| `extensions/` | optional capability contracts and adapters.                                                                                                          |
| `config/`     | instance/app configuration values and schemas.                                                                                                       |

If a module carries a marketplace noun it is not `core/`. If it carries no
seller/buyer flow it is not `commerce/`. If it is optional rather than required
by the protocol surface it is `extensions/`.

`D3.h2.media` (`sdk/core/media/`) is the first module placed by this rule and
sets the precedent: media is a protocol capability with no marketplace noun, so
it belongs in `core/`.

## Recorded debt (not moved now)

The tree drifted without this rule. These are dated debt rows, not a plan to
reshuffle in this commit:

- `sdk/commerce/curation`
- the social-vs-order split inside `sdk/commerce/messaging`
- `sdk/config/{wallet,cashu}.ts`
- the three wallet homes

Place new modules by the table above; leave the debt rows for their own slices.

## Read API doctrine — stream-first

Reads are **stream-first** (contract rev 2.21/2.22; rationale `notes/ADR-READ-SEAM-STREAMS.md`).

- **`EventReadContext.stream(filters)` is the default read path.** Opening it is synchronous; events are
  delivered asynchronously (already-stored matches replay first, live arrivals follow), ending in a
  `{ type: 'caught-up' }` marker. The stream is the single admission point: emitted events are merged into
  the store, so replace/delete semantics apply once.
- **Use `stream` for anything list-based or live** — browse/home, search results, category rows, bids and
  auction activity, comments, reactions, social feeds, order messages, notifications, live chat.
- **`EventReadContext.fetch(filters)` is a bounded stream**, implemented _over_ `stream` (open → collect to
  the caught-up marker → close). It is **not** a second read route and must not be the default shape. It is
  justified **only** for a single-entity/detail read where holding a stream is not warranted — own profile,
  seller/author profile, product or auction detail, one-off lookup by id/coordinate (fewer refresh
  consequences, manually triggerable, avoids a held stream per entity). `fetch` does **not** admit events to
  the store (`admit: false`), so a detail read cannot pollute a list feed.
- **Every `fetch` carries a one-line justification comment naming the case**; reviewers flag `fetch` in any
  list/live context.
- **`EventStorePort` is deliberately mixed sync/async**: `add`/`get`/`getReplaceable`/`query` are async
  (the backing database may be async — applesauce `IAsyncEventDatabase`/IndexedDB), while `isDeleted` and
  the local-only `subscribe` fan-out are sync (adapter-owned in-memory state, no I/O).
- **`sdk/` stays rxjs-free**: the platform adapter maps applesauce's RxJS streams to `AsyncIterable`; the
  seam type is `AsyncIterable<EventStreamItem<E>>`. `event-access` (`createEventAccess`) composes the port
  and the read context and owns no transport.
