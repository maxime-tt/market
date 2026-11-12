# Handover — Nostr-first read path, and the validator-verdict publish path

**For:** the session working on the ChiefMonkey auctions implementation (`plebeian-arena-auctions`).
**From:** the session that owns the market web app / the `maximotodev/plebeian-auctions-poc` protocol.
**Date:** 2026-11-12.

This is a **follow-up to the relay-ingest work currently in flight** (`feat/relay-ingest`,
4 new files, ~720 lines: `relayobserve.go`, `relaysubmit.go`, `relaysubscribe.go`,
`relayingest.go`, plus `relayobserve_test.go` / `relayserializer_test.go`).
That work is the **read/ingest half**. This document specifies the **second half** —
the publish path — and the architectural ruling it comes from.

Owner's ruling, quoted exactly, because it decides the shape of everything below:

> "the read path … should be 100% nostr based. So we should read from the nostr relays in
> order to get the actual read path out of auctions. That way we can view bids and listings
> directly … and then the validator blockchain becomes only for checking what bids were, like
> the consensus layer. However, this does bring in a question, which is: how can we read this
> blockchain while avoiding pinging the validators directly — would the validators potentially
> have to publish back onto Nostr relays as well?"

**The answer this document commits to: yes. Validators publish their verdicts back to the
relay as signed regular-kind Nostr events. The front end never talks to a validator or a
node RPC. The chain stays the source of truth for ordering and validity; it stops being the
read path.**

---

## 1. The problem, stated precisely

Today there are two half-paths, and neither is complete:

| path | exists? | mechanism |
|---|---|---|
| **write** | ✅ mostly | gateway `/api/tx` publishes the signed event to the relay first (`chain/main.go:260-290`), falls back to a direct validator submit when no relay is configured. Returns `{"ok":true,"via":"relay"}`. |
| **read (ingest)** | 🔄 in flight | `feat/relay-ingest` — each validator subscribes to the relay and submits what it sees into *its own* mempool. |
| **read (client)** | ❌ missing | the app still polls a chain state document (`/api/state`) through an HTTP proxy. There is **no relay read adapter in the app at all**. |
| **verdict publish** | ❌ missing | nothing publishes what consensus *decided* back to the relay. `grep -rn "verdict\|Verdict\|KindOutcome" chain/*.go` → no matches. |

So after the ingest work lands, a client can see *listings and bids* on the relay but cannot
see *outcomes* without asking a validator. That is the gap this handover closes.

## 2. Why "publish the verdict" is the right answer, not a workaround

1. **The verdict is already an event in our protocol.** Our kinds are:
   `KindCreate=28640`, `KindBid=28641`, `KindRefund=28642`, `KindSettle=28643`,
   `KindOutcome=28645`, `KindFundingAbort=28650`
   (`internal/poc/model.go:25-40` in the POC repo). An outcome is not a query result — it is a
   signed event with a payload (`outcomeContent`: `schema`, `auction_id`, `bid_id`, `outcome`,
   `payout_token_sha256`). Publishing it to a relay is the natural transport, not a bolt-on.

2. **It makes the front end transport-blind.** One subscription delivers listings, bids and
   verdicts. That deletes: the state-document poll, the loopback HTTP proxy, and the whole
   "dual read path" idea. The owner's "both parts in one single protocol" is satisfied by
   *one* read path, not two.

3. **It removes an operational hazard.** A browser reading the chain must reach a validator
   RPC or an HTTP proxy. In our deployment the proxy exists precisely because
   `127.0.0.1:8080` in a visitor's browser is *the visitor's own machine*. Publishing verdicts
   to the relay removes that entire class of problem and means a public front end needs no
   privileged path to the consensus layer.

4. **It already half-exists on the write side.** The gateway publishes to the relay as primary
   transport and falls back only when there is no relay. Symmetry argues the verdict should
   take the same road.

## 3. The design

### 3.1 Kinds — regular range, never ephemeral

**This is not a style preference; it is a correctness requirement.** khatru refuses an EVENT
for an *ephemeral* kind (NIP-01 range 20000-29999) when no live subscription matches it, with
the error `mute: no one was listening for this`. Verified on the running demo:
publishing a kind `28641` with no observer attached → `muting: no one was listening for this`.
A verdict that only exists while somebody happens to be subscribed is not a verdict.

`plebeian-arena-auctions` already uses regular kinds — `KindCreate=1440`, `KindBid=1441`,
`KindChat=1442` (`chain/nostr.go:22-24`). **Keep everything in the regular range.** Our
ephemeral numbers must be renumbered on convergence; proposed mapping:

| role | ours (ephemeral) | proposed (regular) |
|---|---|---|
| auction create | 28640 | **1440** (already theirs) |
| bid | 28641 | **1441** (already theirs) |
| refund | 28642 | **1442** — *conflict:* theirs uses 1442 for chat. Pick a free number. |
| settle | 28643 | free regular number |
| **outcome / verdict** | 28645 | **free regular number** |
| funding abort | 28650 | free regular number |

✅ **DECIDED (owner, 2026-11-12) — see `DECISION-auction-kinds-and-editable-allowlist.md` for
the full ruling.** The allocation is fixed: **1440** create / **1441** bid / **1442** chat
(leave it — ours) / **1443** refund / **1444** settle / **1445** outcome-verdict / **1446**
funding-abort. The 1440 series was verified free three ways: absent from the NIPs registry
(highest claimed 1xxx kind is 1987), absent from all 1,898 NIPs PR branches, and **0 events**
on four public relays while the control query returned results. Record these in one exported
map — `RelayKinds` (`chain/relayobserve.go:37`) is the natural home on this side.

### 3.2 What each validator publishes

One validator **must not** be the only publisher, or the relay becomes a single point of
authority and a forged verdict is indistinguishable from a real one. Two event classes:

**(a) Verdict events — one per validator, per decision.**
Each validator, having committed the block that decided an auction, publishes a signed event
under **its own validator key** carrying:
- the auction id and the bid id(s) it judged,
- the decided outcome (`winner` / `reserve_not_met` / `cancelled` / …),
- the **block height and block hash** the decision was taken at (the anchor — see §3.4),
- the validator's own identity so a client can roster-check it.

Determinism is what makes the quorum meaningful: two honest validators given the same
committed state must derive the same verdict. Our `outcomeContent` already carries
`auction_id` / `bid_id` / `outcome` / `payout_token_sha256`; the anchor fields are the addition.

**(b) State commitments — periodic, from every validator.**
A signed `(height, state_hash, timestamp)` every N blocks (or on change). This is what lets a
client confirm it is seeing a consistent view, and detect a validator that has stalled or
forked, **without ever calling a node**. This mirrors the existing
"first event after an idle stream carries the current height" behaviour (v0.4.1).

### 3.3 How a client reads

Client-side, in priority order:
1. Subscribe to the relay for create / bid / verdict (+ chat).
2. Treat a bid as *real for ranking* only when enough roster-valid verdicts for it are
   present (quorum), deduped to the newest verdict per validator.
3. Treat the highest **state commitment** it has seen as the view it is anchored to, and show
   the height, so a stalled or lagging relay is visible rather than silently wrong.

The client needs the **validator roster** (which pubkeys count). A static config list is
acceptable for the demo; an admission event is the better long-term shape.

### 3.4 The caveat that must not be skipped

**A relay is not durable and not ordered.** The chain remains the only authority for
*ordering, time and validity*. Publishing verdicts must not turn the relay into the source of
truth. Therefore:
- every verdict **must** carry its block height + hash anchor, or it is unverifiable;
- a client must be able to tell "no verdict yet" from "verdict rejected" — hence the periodic
  state commitments from §3.2(b);
- **the `outcome` must be deterministically derivable from committed state.** If two validators
  could disagree, the relay is carrying opinions, not consensus. Establish this property
  explicitly and test it (see §5, task 4).
- the verdict is a **claim signed by a validator**, so the client verifies *signature +
  roster membership*, and trusts the quorum for the rest. Client-side full state verification
  is a later hardening step, not this increment.

### 3.5 What is explicitly NOT in scope

- Removing `/api/state`. It becomes a **test and ops tool**, not the product read path. Useful
  for the e2e suite and for debugging when the relay is down; just not what the browser uses.
- Client-side re-derivation of chain state. Out of scope for this increment.
- Changing the FROST / shared-key custody model. Separate axis, deliberately untouched.
- Migrating the web app. That is our side; this handover's §4 says what we will consume.

## 4. The interface contract we need from you

The market web app will switch its auctions read path to **relay-only**. To do that we need
these fixed, and we would rather you choose them than we guess:

1. **The kind numbers** for refund / settle / verdict / funding-abort (§3.1), in the regular
   range, recorded in one exported place.
2. **The verdict event's exact tag and content schema** — which tags carry auction id, bid id,
   height, hash; what the content JSON is. We will consume it verbatim.
3. **The roster format** — how a client learns which pubkeys are validators.
4. **The state-commitment cadence and schema** (§3.2b).
5. **Confirmation of the anchor fields** — height + hash on every verdict.

Once those are fixed we will build our side against them; nothing in our app should have to
change again when your implementation details move.

## 5. Suggested task order (smallest first)

1. **Land the in-flight ingest.** It is uncommitted on `feat/relay-ingest` and not pushed.
   `go build ./...` and `go vet ./...` pass on the production code; the test file was being
   edited live — re-run `go test ./...` before committing.
2. **Introduce one exported kind map** and move `RelayKinds` onto it. No behaviour change.
   This is the single place the renumber happens.
3. **THE MAIN PORT — the editable-field allow-list.**
   `DECISION-auction-kinds-and-editable-allowlist.md` §3–§4 specifies it in full, and the owner
   named it *"the main piece of work we should port over"* from `upstream/auctions`
   (`AUCTIONS.md`). Three rules: the auction root is the first 1440 event for `(seller, d)` and
   its id is pinned; every bid binds to that root via `e`, so a later edit cannot orphan it;
   and an update is accepted only if every immutable field is unchanged, rejected otherwise with
   `immutable_field_changed` naming the field. Mutable: `title`, `description`, `image_url`.
   Immutable: everything deciding what is sold, for how much, until when, and to whom it
   settles (`starting_bid`, `min_increment`, `reserve`, `duration_seconds`, the three
   late-bid/extension fields, `locktime_seconds`, `funding_mode`,
   `seller_coco_payment_public_key`, and `auction_id` itself).
   **The one genuinely new piece:** `1440` is a *regular* kind, so the relay stores every
   version and replaces nothing. The previous implementation got "latest version wins" free
   from an addressable kind (`30408`); here we must add it explicitly — the canonical auction
   is the latest 1440 for `(seller, d)` by `created_at` that passes the immutable check.
   Note the allow-list was **never** enforced by the relay, even there: `AUCTIONS.md` says
   *"Updates changing immutable fields MUST be rejected by clients/indexers"*, so enforcement
   is client- and validator-side in both designs.
4. **Publish state commitments** (§3.2b). Cheapest useful publish path: it proves the
   validators can write to the relay at all, before verdicts exist.
5. **Prove outcome determinism** from committed state, with a test. This is the precondition
   for publishing verdicts honestly, and the thing a reviewer should ask for first.
6. **Publish verdict events** (§3.2a) with the anchor fields.
7. **An e2e test**: publish a create and a bid to a relay with an observer attached, let the
   chain commit, assert the verdict event appears on the relay with a valid signature, the
   correct roster key, and the right height/hash anchor — and that a client reading only the
   relay can reconstruct the outcome with no node call. Extend it to edit the auction after a
   bid: a mutable-field edit must be accepted and must not detach the bid; an immutable-field
   edit must be rejected.

## 6. Traps — verified, do not re-learn these

- **Ephemeral kinds are dropped.** `nak serve` (khatru) refuses an ephemeral EVENT with no
  matching live subscription (`mute: no one was listening for this`) and does **not** buffer it.
  This cost us real time. Regular kinds only, for anything that must survive.
- **`POC_RELAY_URL` is the switch on our side** (`internal/poc/relay_observer.go:15`); unset
  means no observer and unchanged behaviour. An observer that is configured but wedged is
  invisible — our demo ran for hours with the observer detached and nothing reported it.
  **Expose subscription state and last-seen height for readiness probes** (your in-flight work
  already has `Subscribed()` — good; surface it).
- **One observer per relay, per validator** is the right shape and is already what
  `startRelayIngest` does (`chain/relayingest.go:40-60`) — each submits into its own node's
  mempool so no client needs to know which node leads. Do not collapse it back into one.
- **Duplicate submissions are normal** — many observers see the same event. De-dupe by event
  id (already done) and make the application idempotent on retry.
- **`nostr.Tags` vs `[][]string`** — `toChainEvent` converts `*nostr.Event` → `Event`, and
  `HandleForTest` takes `*nostr.Event`. Mixing them up is a compile error we already hit.
- Do **not** push to `PlebeianApp/market`. Do **not** restart `auctions-mvp-demo.service` or
  `auctions-demo-relay.service` from the other session's side; those are ours.

## 7. What we will do in parallel (so the two halves meet)

- Keep `/api/auctions/state` working as the ops/debug path.
- Build the app's **single relay read adapter** (one interface, one implementation) so the
  front end is ready to switch the moment your kinds are fixed — replacing the dual-path idea
  with a relay-only read.
- Prepare the app-side kind map so convergence is one change, not a hunt.
- Have a harness ready that asserts the §5.6 e2e sequence end to end.

**Question back to you, if anything here is wrong:** the one thing we want challenged is §3.4 —
whether a client should *verify* verdicts against published state commitments, or simply
*trust the quorum*. We have committed to quorum-trust plus published commitments for this
increment. If you think that is too weak, say so before the kinds are frozen.
