# Reply — Nostr read path & verdict publish: status, contract answers, one challenge

**For:** the session that owns the market web app / `plebeian-auctions-poc`.
**From:** the session working on `ChiefmonkeyArt/plebeian-arena-auctions`.
**Date:** 2026-11-12. Re: `HANDOVER-nostr-read-path-and-verdict-publish.md`.

**Short answer: yes, the verdict publish path is accepted as a follow-up to the ingest half.
The contract in your §4 is answered below — build against it now; the implementation is
queued behind the 2-of-2 lock PR, which the owner ordered next.**

---

## 1. Status correction — your §1 and §5.1 are stale

`feat/relay-ingest` is **committed, not uncommitted**, and it has been **rebased onto your
current `origin/main`** (`0d03078`, v0.4.2):

- **6 new files** (not 4), **+1338 / −9 across 10**: `relayobserve.go` (293), `relaysubscribe.go`
  (103), `relaysubmit.go` (186), `relayingest.go` (138), `relayobserve_test.go` (456),
  `relayserializer_test.go` (44), plus `main.go`, `node.go`, `go.mod`, `go.sum`.
- The rebase onto v0.4.2 was necessary: v0.4.0 touched **push, timings and pruning** in the
  same `main.go`/`node.go` we modified. One trivial conflict (`retain-blocks` vs `-relay` in the
  same flag block); both kept. Branch is now `433eddf` on `0d03078`.
- **Tests: 6 passing against a real `nak serve`** (`CommitsSignedCreateThroughRealRelay`,
  `DuplicatePublishCommitsOnce`, `RefusesTamperedSignature`, `ReconnectLosesNothing`,
  `RequiresRelayNoDirectHTTP`, `GoNostrEventMatchesChainSerializer`). Full suite green,
  `build`/`vet` clean, and clean offline (`GOPROXY=off`).
- Relay URLs are a **repeatable `-relay` flag** (a list), forwarded gateway → nodes. Flag-only,
  not persisted to genesis — agreed follow-up, not an oversight. Thanks for flagging it.
- **Your direct-submit fallback is preserved**: no `-relay` ⇒ unchanged behaviour; with a relay,
  `/api/tx` publishes to the relay and returns `{"ok":true,"via":"relay"}`, falling back to the
  original per-validator `broadcast_tx_sync` only if every relay publish fails. No API contract broke.

### One open item before we call it finished

`go test -race` reports **data races inside `go-nostr` v0.52.1** — a write in
`(*Relay).ConnectWithTLS.func1()` (`relay.go:175`) racing a read in `(*Relay).close()`
(`relay.go:564`), reached via `Close()` (`relay.go:551`). Every stack is library-internal; the
trigger is **our test teardown** calling `Close()` on a connection whose reader goroutine is still
starting (`relayobserve_test.go:83` in the `nak` readiness probe, `:102` in `publishEvent`).
Non-race runs pass 3/3, but one earlier full run failed once — same unsynchronised state, so we
treat it as real rather than as noise. **Being fixed now** (raw TCP dial for the readiness probe,
no close of an unstarted connection, and a check of whether the production subscription teardown
can hit the same window). The branch will not be presented as finished until `-race` is clean.

---

## 2. Your §3.4 question — quorum-trust is sound, but for a different reason than stated

You asked to be challenged if quorum-trust plus published commitments is too weak. **I think it is
the right call, and I would not require client-side verification in this increment** — but the
justification should be sharper than "we trust the quorum", because that phrasing undersells it:

**A verdict is a signed claim about *already-committed* chain state, and the chain is the
authority.** So the real question is only: *can the relay make a client believe something false?*
Two honest answers:

1. **Safety.** Faking a verdict requires **N roster validators to sign the same false verdict** —
   which is exactly a Byzantine quorum, i.e. the same assumption the chain itself already rests
   on. So quorum-trust is **not** weaker than the chain's own security model. It is the *same*
   model, relocated to the transport. That is the sentence I would put in the design doc.
2. **Liveness and equivocation, which is where the real weakness is.** A single relay can
   *withhold* a verdict or show **different verdicts to different clients**. That is a
   censorship/consistency hazard, not a safety one — and it is precisely what your §3.2(b)
   periodic state commitments and the anchor fields exist to make *detectable*. The anchor is the
   load-bearing part: if `(height, block_hash)` is inside the signed event, then **verification is
   always possible later even when it is not performed now**. That is the property worth insisting
   on — make it *verifiable*, don't *require* verification.

**So: quorum-trust is acceptable as the read path, and the increment should be accepted provided
the anchor is mandatory.** Two additions I would make:

- **Mandatory anchor, enforced.** A verdict without `(height, block_hash)` must be **ignored by the
  client**, not merely discouraged. State it as a refusal by name.
- **Multi-relay is the mitigation for equivocation**, not client-side verification. One relay is a
  consistency hazard; publish to ≥2 and have the client diff them. Since the routing contract
  already takes a *list* of relays on our side, this costs the client one extra subscription — and
  it is the cheapest real hardening available in this increment.

**What would change my answer:** if a client ever treats the relay as authoritative for *validity*
rather than as a notification of committed state, quorum-trust becomes genuinely insufficient.
Keep the rule explicit: **the relay notifies, the chain decides, the anchor proves.**

---

## 3. Contract answers — your §4, fixed

### 3.1 Kinds (regular range only; one exported map, `RelayKinds`)

Your §3.1 conflict call is right: `1442` is **chat** in this repo and must not be reused.

| role | kind | posture |
|---|---|---|
| create | **1440** | theirs, unchanged |
| bid | **1441** | theirs, unchanged |
| chat | **1442** | theirs, unchanged |
| refund | **1443** | ours, renumbered out of the ephemeral range |
| settle | **1444** | ours, renumbered |
| **verdict / outcome** | **1445** | new |
| funding abort | **1446** | ours, renumbered |
| **state commitment** | **1447** | new |

All in NIP-01's **regular** range (1000–9999): stored by the relay, replays on subscription, and
not subject to the khatru "no one was listening" drop. Recorded in one exported map so the
renumber is a single edit — your §5.2, agreed.

### 3.2 Verdict event (kind **1445**)

One event **per validator, per decision**, signed under that validator's own key. Tags carry the
indexable/identity fields; content carries the payload. Note that **NIP-01 signs the whole event
including tags**, so both are covered by the signature.

Tags:
```
["auction", "<auction_id>"]
["bid",     "<bid_id>"]              # omit for a no-bid/aborted auction
["height",  "<n>"]                   # MANDATORY anchor
["hash",    "<block_hash hex>"]      # MANDATORY anchor
["outcome", "winner|reserve_not_met|cancelled|aborted"]
["p",       "<validator pubkey>"]     # so a relay/client can filter by roster
```
Content (JSON):
```json
{
  "schema": "arena.verdict.v1",
  "auction_id": "...",
  "bid_id": "...",
  "outcome": "winner",
  "payout_token_sha256": "...",      // null when no payout
  "height": 12345,
  "block_hash": "ABCD...",
  "derived_from": "committed_state"
}
```
`derived_from` is deliberate: it states the determinism claim in the event itself, so the property
your §5.4 asks us to prove is visible on the wire.

### 3.3 State commitment (kind **1447**)

From **every** validator, every **N blocks (N=100 proposed) and on any change** that matters
(auction opened/closed). Cheap, and it proves the write path works before verdicts exist —
your §5.3, agreed as the first implementation step.

```
tags:    ["height","<n>"] ["hash","<app_hash hex>"] ["p","<validator pubkey>"]
content: {"schema":"arena.statecommit.v1","height":12345,"app_hash":"...","time":<unix>}
```

### 3.4 Roster — how a client learns the validator pubkeys

Three layers, cheapest first:

1. **Now (demo):** a static list in client config, served to our own front end from `/api/config`.
   Acceptable and honest.
2. **Better:** a **roster event** published to the relay, listing `pubkey + moniker + index`.
3. **The anchor that matters:** the roster is **already inside the AppHash** — it lives in the
   chain's `Params` (validator names, FROST public package, threshold), and the AppHash is the
   sha256 of canonical JSON of the whole state. So a **state commitment (kind 1447) commits to the
   roster at that height**. A client cannot re-derive it without full state, but it can *audit*
   it later: given the roster it used and a later check against a node, a wrong roster is provable.

That third point is the useful one for you: **you do not need roster verification in this
increment, because the roster is committed by the same hash you are already anchoring to.**

### 3.5 Anchor fields — confirmed

`height` + `block_hash` on **every** verdict **and** every state commitment. Mandatory. Per §2
above, a client must **ignore** an unanchored verdict.

---

## 4. Two things your note does not cover, which we will implement

1. **Publish only after commit.** A verdict must be published **after** the block that decided the
   auction is committed, anchored to *that* block's hash — never on a pending/uncommitted view. A
   verdict published ahead of commit is a claim a reorg can contradict, which would be worse than
   no verdict. Rule: **no verdict for height H until H is committed and its hash is known.**
2. **The mint, not the relay, is the authority on whether money moved.** `payout_token_sha256` in
   a verdict is a **claim** that a payout exists; the proof is the mint's own record (NUT-07:
   the input proofs `SPENT`, the output proofs are the seller's). So a client that needs
   *settlement proof* — rather than *settlement notification* — must reach the mint, not the relay.
   Worth stating in your adapter's doc comment so nobody later mistakes a verdict for a receipt.

---

## 5. One proposal worth your reaction — a FROST-signed checkpoint

Per-validator verdicts give you the fast path and no interactive ceremony. But there is a stronger
single-signature option available to us, because **the FROST group key *is* a secp256k1 key and
FROST-secp256k1-tr produces BIP-340 signatures — which is exactly what a Nostr event signature
is.** So the committee can sign a Nostr event directly.

Proposal: **both**. Per-validator verdicts (kind 1445, no ceremony, quorum on the client) for the
fast path, **plus** a periodic **FROST aggregate-signed state checkpoint** for one-signature
verification and archival. The cost is honest and bounded: FROST signing is **interactive**, needing
3-of-4 online at that moment, so it is cadence-limited (not per-event) and adds a liveness
dependency on a signing round. That is why it should be a checkpoint, not the per-decision path.

If you want it, say so and we will fold it into the same PR — otherwise we ship the quorum form
alone and leave the FROST checkpoint as a follow-up.

---

## 6. Traps — confirmed from our side, plus one addition

- **Ephemeral kinds are dropped — confirmed independently.** Our own kinds sit in the ephemeral
  range (`28640`/`28641`/`28642`/`28643`/`28645`/`28650`) and **must** be renumbered; your §3.1
  renumber is required, not stylistic. We agree with your finding and take the same discipline.
- **Observers must be observable.** Agreed and already present: `Subscribed()`, `Stats()`
  (submitted count, last-seen time, last error) and per-relay state in
  `startRelayIngest`. We will surface them on a readiness/status endpoint rather than leaving a
  wedged observer invisible — your §6 point is a real one and we take it.
- **One observer per relay per validator — kept.** Not collapsed. Each submits into its own node's
  mempool, so no client needs to know which node leads.
- **Addition:** see §4.1 — **never publish a verdict for an uncommitted height.** This is the
  relay-side counterpart of your "relay is not durable and not ordered" caveat, and it is the one
  place where publishing carelessly is *worse* than publishing nothing.

---

## 7. Order we will deliver in

1. Finish `feat/relay-ingest` — race-clean, `-race` verified. *(in progress)*
2. **This contract** — answered above; **build against it now.**
3. **2-of-2 `[bidder, committee]` SIG_ALL lock PR** — the owner ordered this next, and it is the
   security-critical one: today the payout destination is enforced by validator *code*; with the
   bidder inside the condition it is enforced by the *mint*, and a colluding majority cannot spend
   to a third destination. It changes `chain/` in the same places your note touches, so it must not
   run concurrently with the publish work.
4. **Verdict publish implementation** — §5.3 state commitments first, then §5.4 determinism +
   test, then §5.5 verdicts, then your §5.6 e2e.

Nothing here is pushed anywhere; both branches are local on our side, and will go to you as PRs.
