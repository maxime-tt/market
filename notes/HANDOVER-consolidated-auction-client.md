# Handover: the auction client against the consolidated protocol

For the session working on the front end. Everything here is the *client's*
side of a protocol whose implementation lives in the auction repo, not yours.
You do not need to read that repo to build the client, but every shape below is
enforced there, so a client that deviates is refused rather than tolerated.

## What changed, in one paragraph

The auction protocol is now: **a Nostr relay carries the events, the chain
decides, and an anchor proves what was decided.** The validator accepts an
auction create and a bid from a relay, escrows the bidder's money under a
**2-of-2 `[bidder, committee]` lock** whose destinations were fixed by the
bidder when it bid, settles or refunds automatically once the block that
decides is committed, and publishes a **per-validator verdict** back to the
relay. So the client talks to a relay and to a mint, and never needs a
validator's IP address.

## Where the code is

- Branch `feat/auctions-merged-protocol` on the fork `maxime-tt/plebeian-arena-auctions`,
  built on `3b83d33` (his v0.5.2). Six commits, one per increment.
- The client reference implementation is `web/src/lib/arena.js` in that branch.
  It is the closest thing to a spec that compiles; when this doc and that file
  disagree, the file is right and this doc is stale.
- The full protocol spec is `MERGED-PROTOCOL-SPEC.md` in
  `/home/admin_maxime/work/auctions-simplify/`. Sections §1 (escrow), §5
  (release), §6 (V4V), §7 (kinds), §8 (identity and supersession), §9
  (verdicts), §10 (timing).

## The one rule that governs everything

**The Nostr identity is the authorization layer; the wallet owns value and
holds its own spend key. Never derive one key from the other.** The seller
signs the listing with its Nostr key and names its wallet separately; the
bidder moves money with its wallet key and signs its bid with its Nostr key.
Conflating them is the failure mode this design exists to avoid.

## Kinds

- `1440` create — the listing, and its supersessions.
- `1441` bid.
- `1445` outcome — a validator's verdict. **You read these; you never write them.**
- `1447` state commitment — a validator's periodic anchor.
- All are **regular** kinds, not ephemeral. An ephemeral event is dropped by a
  relay with no live subscription, which would silently lose it.

## What the client does

### 1. Read config, once

`GET /api/config` gives `committee_public_key`, the mint URL, the keyset, and
the timing params. Everything below is derived from it — do not hardcode a
committee key or a locktime margin.

### 2. Post a create (1440)

- The auction's identity is **`(seller, d)`**, not the event id. Pick a `d` that
  matches `[A-Za-z0-9_-]{1,64}`; a `d` with a space in it is refused.
- The **first** `1440` for that `(seller, d)` is the **root**. It must not carry
  an `e` tag.
- A later `1440` is a **supersession** and **must carry `e = the root's event
  id`**. Only these fields may change: `title`, `description`, `image`. A change
  to `startPrice`, `minIncrement`, `mode`, `windowSec`, `durationSec`,
  `sellerWallet` or the V4V split is refused with
  `immutable_field_changed <field>` and ignored — the client should not offer
  the edit at all, rather than let the user make a change that will not apply.
- It needs a `mode` (`fixed` or `antisnipe`) and a `durationSec`; an antisnipe
  lot also needs `windowSec` (60–900 s today, and the floor is 60 s).
- Optional `v4vSplit`: rows of `{role, recipientPubkey, allocationBps}`. When
  present it is strict and immutable. **It must be fixed at create time** —
  see §5 for why.

### 3. Post a bid (1441)

This is the part with the most ways to get it wrong.

- The bid carries **`e = the auction ROOT`** (not the latest version id). That
  is what keeps an existing bid attached across a later edit. A bid without it
  is refused.
- The money is a set of Cashu proofs locked with the **2-of-2 lock**: a NUT-11
  `P2PK` condition whose `data` is the bidder's wallet key, `pubkeys` is
  `[committee]`, `n_sigs` is `2`, one `refund` = the bidder's wallet key,
  `sigflag` = `SIG_ALL`, and a `locktime`. Exactly **five** tags, in canonical
  order. A one-of-one lock, an `n_sigs` of 1, a lock with no `pubkeys`, or a
  six-tag lock are each refused by name.
- The `nonce` must be **32 bytes of lowercase hex** (64 characters). A readable
  nonce like `"v1"` is refused.
- The bid content carries **`outcome_templates`**: a `settle` and a `refund`
  template, **pre-signed by the bidder** with its wallet key over each
  template's digest. This is the whole point of the design: those two templates
  are the only two places the money can go, and the committee cannot move it
  alone. If the bidder does not pre-sign, the bid is refused.
- `locktime` must be at least the end the bid itself establishes, plus the
  settlement safety and the bid-to-consensus latency. For a bid that does not
  extend, that end is the lot's current `EndAt`; for an antisnipe bid arriving
  with less than `windowSec` left, it is `now + windowSec`. Below that floor the
  bid is refused — this is deliberate: it is what guarantees the settlement has
  room to happen.

### 4. Do not build a refund path

- **Refunds are automatic.** The moment a bid is outbid, or the lot closes
  without a winner, the validators push the refund from the bid's own committed
  template. There is no request to make, no endpoint to call, and no
  authorisation for the client to supply.
- The last-resort path is the `locktime` itself: if the validators never move
  the money, it expires and the bidder can spend it back. That is the safety net,
  not the primary path.
- **`/api/release` does not exist any more.** If you find a call to it in older
  code, delete it; it 404s. The ops fallback is `POST /api/settle` with
  `{bid, outcome}`, and it is not the product path: it names a bid and an
  outcome and cannot name a destination.

### 5. Why the V4V split is at create, not at settlement

The split rides the bidder's pre-signed `settle` template. The bidder can only
pre-sign outputs that are already known when it bids, so the split has to be
committed before any bid exists. A split-less auction pays the seller alone.

### 6. Read outcomes from the relay

- Subscribe to kind `1445` and `1447`. Each verdict is signed by **that
  validator's own key**, and carries its roster pubkey in a `p` tag — so a
  client can tell which validator said what, and a forged verdict is
  distinguishable from a real one.
- **Ignore any verdict without an anchor** (`height` and `block_hash`). A
  verdict with no anchor is not evidence of anything; the client must not show
  it.
- Verdicts are **append-only**: a later one does not replace an earlier one, it
  is a new statement. Resolve the latest per validator for display.
- The content is `{"schema":"arena.verdict.v1", ...}` with `auction_id`,
  `bid_id`, `outcome` (`winner` / `reserve_not_met` / `cancelled` / `aborted`),
  `height`, `block_hash` and `derived_from`.
- A client reading only the relay can reconstruct the outcome with **no node
  call**. That is tested end to end. `/api/state` still exists, but it is an
  ops/debug path, not what the product should depend on.

## Endpoints that exist

- `GET /api/config` — committee key, mint, keyset, params.
- `GET /api/state` — the committed state (ops/debug).
- `GET /api/bid?id=` — a single bid with its proofs.
- `POST /api/tx` — submit a signed event (used when there is no relay configured).
- `POST /api/settle` — the ops fallback described above.
- `GET /api/network`, `GET|POST /api/chat`.

There is no `/api/release`, and no `/api/demo/*`.

## Wipe, not migrate

This changes the state shape (`chainFormat "6"`). Nothing committed is worth
preserving by the owner's rule, so a running chain is **wiped and re-initialised**,
not migrated. If the client has cached state from an older run, discard it.

## Reading the tests as the contract

The named tests in the auction repo are the enforceable statement of each rule
above. If you want to know whether a shape is legal, search for the refusal by
name — `create needs a valid d tag`, `bid must reference the auction root`,
`the condition nonce is not 32 bytes of lowercase hex`, `locktime below the
floor for this lot`, `must publish outcome_templates`,
`immutable_field_changed V4VSplit`.
