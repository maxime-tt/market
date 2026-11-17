# PLAN — closing the three arena escrow gaps (settlement, instant refund, time extension)

**Written:** 2026-11-17, from the session that landed `eea6456b2` (the coco-keyring auction spend key).
**Status:** plan only, nothing implemented. Each numbered increment below is a dispatchable brief.

---

## 0. What "closed" means — the acceptance this plan targets

On the live instance, with the local mint, using nothing but the app UI plus `nak`/curl for
observation, a tester can do all five of these and see the named artifact:

| # | action | artifact that proves it |
|---|---|---|
| 1 | fund a bid | the kind-1441 carries a NUT-11 `n_sigs:2` lock to the committee; the wallet shows a pending send |
| 2 | bid | the bid **commits on the chain** (it appears in committed state, not only on the relay) |
| 3 | bid inside the anti-snipe window | committed `end_time` moves past `original_end_time`; the app shows the moved end |
| 4 | be out-bid (a higher bid lands) | the previous leader's escrow is **refunded at once** by the validators — not left locked till close; a 1443 records it; their balance returns |
| 4b | bid after the end (a late bid) | the chain voids it and refunds it at once — the same push-refund mechanism, a different trigger; a 1443 records it |
| 5 | let a lot close with a winner | a 1445 verdict is published; the validators move the escrow; a 1444 records it; the **seller's** balance rises |

Today only (1) and (2)'s publish half work. Verified live on 2026-11-17 (details in
`references/arena-e2e-flow-reachability.md` in the engineering skill).

---

## 1. The authority, and what already exists — do not re-derive any of this

**The authority is `MERGED-PROTOCOL-SPEC.md`** (owner-ruled 2026-11-13, 361 lines; the copy this plan
was checked against is `/home/admin_maxime/work/auctions-simplify/MERGED-PROTOCOL-SPEC.md`, with the
app-side handover at `notes/HANDOVER-merged-protocol-spec.md` in this repo). It "supersedes his v0.5.x
re-lock, the expiring/Expired no-sale close, the two-mode locktime floors and the settler's authority
to build outputs", and it keeps "push settlement, the two modes, no maximum auction time and the 1440
series". Where this plan and that document disagree, the document wins.

**Owner rulings recorded against it (2026-11-17):** the anti-snipe reset is **uncapped**, and
**re-bidding (raising your own leading bid) is available**. Both of my earlier "disagreements" were
legacy surface, not open questions — see the two deviations below.

### Spec conformance of the two sides, as measured

| spec rule | chain ref (`arena-merged-ref`) | app (`unite/1420-all`) |
|---|---|---|
| §3 `antisnipe`: `EndAt = max(EndAt, now + WindowSec)`, **no cap, no hard end**; `MaxTotalExtension` **removed** (§10, §11) | **conformant** — `applyBid`: "No cap: the lot ends when the bidding stops" | **legacy leftover** — the config type carries `maxTotalExtensionSeconds` and the running backend's records carry `max_total_extension_seconds` |
| §3 "every `EndAt` mover becomes the leader" — nothing authorises refusing a leader's raise; §1.4's refusal list has no such rule | **non-conformant** — `lateBid{"you are already the highest bidder"}` | conformant in copy ("Bids add to your position") |
| §4(a) instant refund fires **the moment** a bid becomes `outbid`, `void` or `lost` | **non-conformant** — it only sets `Status: "outbid"` and refunds nothing; `closeDue` marks `"lost"` and still refunds nothing | no reader for it yet (increment 4) |
| §2.2 the lock check runs against the end **the bid itself establishes** (after the extension) | **non-conformant, named in the spec** — "His code checks **before** the extension (`checkLock` at `app.go:494` precedes the extension block at `:537`) … the post-end safety margin **collapses from 900 s to as little as 15 s**" | n/a (the chain owns the lock floor) |
| §12 the state-shape change requires **chain format 6 and a wipe** | verify at dispatch | n/a |

The two I raised are therefore: **one app-side legacy carry-over (the cap) and one chain-side legacy
refusal (own-raise)** — plus a third, the check-order bug, which the spec calls out in the chain's own
code and which is the real defect in this area.

The escalation is **not** design work; both sides exist as branches. Reconciled against the running
system today:

- **App side (this repo, `unite/1420-all` @ `eea6456b2`)** — the arena client publishes the wire
  format the chain's parser is written against. Confirmed field by field:
  - create: chain `CreateContent` json tags are `title, description, image, category, startPrice,
    minIncrement, durationSec, mode, windowSec, sellerWallet, name, v4vSplit` — byte-for-byte the
    fields the app's `arenaAuctionCreate.ts` publishes (the app's extra `auction_id` is tolerated;
    `DisallowUnknownFields` is used only in `chain/settle.go`).
  - bid: chain `BidContent` wants `auction, amount, wallet, name, proofs, outcome_templates`; the app
    publishes `auction, auction_id, amount, wallet, proofs, outcome_templates`. Chain `Proof`
    (`id,amount,secret,C?,dleq?`) matches what the app commits.
  - the frozen kind map in `sdk/commerce/auctions/constants.ts` matches `chain/nostr.go` exactly:
    1440 create / 1441 bid / 1442 chat / 1443 refund / 1444 settle / 1445 verdict / 1446 funding
    abort / 1447 state commitment.
- **Chain side (`/home/admin_maxime/work/arena-publish`, clone of `ChiefmonkeyArt/plebeian-arena-auctions`)**
  — three feature branches at `feat/relay-ingest`, `feat/verdict-publish`, `feat/two-of-two-lock`
  (all dated 2026-11-12, based on `origin/main` `0d03078`), and an **integration ref** at
  `/home/admin_maxime/work/arena-merged-ref` whose log is: `3c7a55e ingest auction events from a
  Nostr relay` → `af3b319 the 1440-series kind map` → `d0ee9ca 2-of-2 [bidder, committee] SIG_ALL
  escrow with pre-signed outcomes` → `bef7d65 V4V payout splits` → `949c0c1 integrate: reconcile the
  increments against each other and v0.5.x` → `3379305 per-validator verdicts and state commitments
  on the relay`.
- **The mechanisms already implemented in the chain ref** (read today, `chain/app.go`):
  - `decodeTx` accepts **only** KindCreate and KindBid — so refunds/settles/verdicts are *validator
    outputs*, never client txs. The client's job is to read them.
  - the close is the **validators' own** tx: `close:<auction id>:<endAt>:<unix sent>` (`closePrefix`),
    explicitly not submittable through `/api/tx`.
  - **push settlement (ADR-0009)**: the `Auction` record carries `settled: "refund" | "payout"` plus
    `out []Proof` — "the validators moved the escrow themselves … that ecash, P2PK-locked to the
    recipient". Both settlement and refund are this one mechanism, aimed at the seller or the bidder.
  - **"instant refund" — owner's ruling (2026-11-17): it is the OUT-BID case.** When a higher bid
    lands, the previous leader's bid is refunded at once by the validators. **This is not implemented
    on either side today.** Measured in `chain/app.go` `applyBid`: on an accepted higher bid the chain
    does exactly one thing to the previous leader — `s.Bids[au.HighBid].Status = "outbid"` — and
    refunds nothing; at close, `closeDue` marks every non-winner `"lost"`. The only "refundable now"
    case in the code is the *late* bid ("Then it is late: recorded as void, refundable now"), capped at
    `maxVoids = 256`. The out-bid refund is therefore **new behaviour**, not a wiring gap.
  - **Why it fits the existing design cleanly:** the outbid bidder signed a **refund template at funding
    time** (it is the `refund` half of `outcome_templates`, locked to its own wallet key). Refunding it
    on being outbid needs **no new client signature** — the validators simply execute, early, an
    authorization the bidder already committed, through the same push-settlement machinery
    (`settled: "refund"`, `out: [...]`). The custody change it implies is real though: only the current
    leader's sats stay locked, so an outbid bidder is not tying up funds for the auction's life.
  - late-bid extension bookkeeping already exists on a committed record (`Auction.Extensions`,
    incremented in `app.go` when a late bid lands inside the window) — but see the cap disagreement
    below.

**Two measured disagreements between the ref and the app, both surfaced while planning:**

1. **The extension cap.** The chain ref applies the anti-snipe reset **uncapped** ("No cap: the lot ends
   when the bidding stops", `chain/app.go` `applyBid`), while the app's config exposes
   `max_total_extension_seconds: 1800` and the running backend's records carry
   `max_total_extension_seconds` / `late_bid_extension_seconds`. One of the two is wrong; decide which
   in increment 3 rather than letting the app display a cap the chain ignores.
2. **Re-bidding as the leader.** The chain **refuses** a bid from the current highest bidder
   (`lateBid{"you are already the highest bidder"}`), while the app tells the bidder "Bids add to your
   position. Yours is 1,000 sats; your position must reach at least 1,000 sats." Those cannot both be
   true, and increment 4's refund-on-outbid makes the read-side "position" model load-bearing: if an
   outbid position is refunded at once, a "position" is *locked sats*, not a cumulative claim.

**Consequence for this plan:** three of the increments are *land + verify against the running app*,
not *build*. The genuinely new code is on the app side (surfacing the chain's time and money, and
claiming the ecash the validators minted for you) plus two defects found during today's test run.

---

## 2. Decisions needed before dispatch (owner)

**D1 — RESOLVED (owner, 2026-11-17): the validators watch the test relay; the app only reads and
publishes to that relay; and no HTTP traffic ever crosses directly from client to validator.** The
protocol is the migrated one — kind-1440 with real sats from our test mint. So: the arena chain is
the backend, the MVP is not a fallback, and the app's HTTP paths to the backend are to be **deleted,
not repointed** (the MVP needs no port to sit on).

**Verification against the live deployment (2026-11-17) — the ruling is NOT satisfied yet.** Three
findings, each measured:

1. **Two client→backend HTTP call sites exist today**, both through the app's own proxy
   (`platform/server/http/auctionsProtocol.ts`, which forwards `/api/auctions/{state,config,event}`
   and the MVP's `/api/demo/reservation` to `http://127.0.0.1:8080`):
   - `platform/web/auctions/relay/AuctionBidHost.tsx:110` —
     `createHttpPorts({ apiBase: '/api/auctions' }).getConfig()`: **the escrow's terms**. The
     committee key and mint URL arrive over HTTP, and `arenaBidFunding` locks to the key it is handed.
   - `platform/web/auctions/catalogue/catalogueQuery.ts:25` — `fetch('/api/auctions/state')`: the
     **Catalogue surface** reads committed state over HTTP.
   Everything else already reads or writes the relay (lots 1440, bids 1441, verdicts 1445). The
   client's `reserve()` (`/api/demo/reservation`, the MVP's custodial mode) has **no app caller** —
   it is test-only — so it deletes with the proxy.
2. **Nothing publishes the escrow's terms to the relay, so a relay-only client is currently
   impossible.** The chain holds them: `chain/app.go` `Params` carries `MintURL`, `KeysetID`, `Keys`,
   `GroupKey` (the FROST 3-of-4 escrow key), `FrostPublic`, `ValidatorNames`, `MinWindowSec`,
   `MaxWindowSec`, `SettlementSafetySec`, `BidToConsensusLatencySec`, `MinDurationSec`,
   `MaxDurationSec`, `MaxProofs`, `Threshold` and the validator roster — and the comment says the
   roster lives in `Params` so it is inside the AppHash. But the only thing published to the relay is
   the kind-1447 **state commitment**, whose content is `schema, height, appHash, time` — a hash, not
   the params. So the committee key has no relay source today. **This is a gap the plan did not have:
   it is increment 9 below.**
3. **The deployed backend is not the arena chain.** `/api/auctions/config` currently answers from the
   MVP demo — `schema: PlebeianAuctionsPOCStateV8`, `application_authority: legacy_ed25519_v1`,
   `funding_mode: custodial_reservation_v1`, `profile: FAKE_MONEY_ONLY` — whose auction records are
   its own API's (`settle-probe-…`, `proof-…`). The app *speaks* 1440/1441 (verified on the relay:
   creates and bids carrying the NUT-11 `n_sigs:2` escrow), but the backend never ingests them and
   publishes no verdict.

**The mint is right already:** the app's escrow locks proofs from `https://mint.playday.it`
(`cashu_mint_url` in that config), the box's Nutshell + FakeWallet test mint — not the MVP's internal
`mint_url: http://127.0.0.1:8080/test-mint`, which belongs to the MVP's own note-based funding and
which the arena path never touches.

**A stranding hazard this check exposed.** The escrow key is `s.Params.GroupKey` — a **FROST 3-of-4
group key** "no single validator holds" (`chain/app.go:637` → `checkSigAllLock(..., s.Params.GroupKey,
...)`). The app currently locks to whatever `committee_public_key` its HTTP config gives it, from a
*different* network. Unless the app reads the arena chain's own published group key, every escrow it
creates is locked to a key the validators cannot sign for — unspendable by anyone, exactly the
"wrong derived value, nothing raises" class. Increment 9 is what removes it.

**D2 — Is the arena chain repo in scope for me to land branches in?** The handover calls it another
session's (`ChiefmonkeyArt`). This plan assumes I may branch and commit there (never force-push
`origin/main`) and that the *running* backend on this box is ours to stand up. If not, increments
1–5 stop at patches handed to that session, and only 6–8 land here.

Neither decision blocks increment 6 or 7 — start those immediately if you want work moving now.

---

## 3. The increments

Ordering: **6 → 7 → 1 → 9 → 10 → 2 → 3 → 4 → 5 → 8**, where **10 is the pplx Catalogue port**
(`notes/HANDOVER-2026-11-17-catalogue-pplx-port.md`; its review and crossovers are in
`notes/REVIEW-catalogue-pplx-port-against-the-plan.md`). 6 and 7 are independent and land today. 1 must
precede 9 (the params must come from the arena chain, not the MVP). 1 precedes 2 (there is nothing to
ingest into otherwise). 2 must precede 3/4/5 (a lot the chain never sees can
never be extended, refunded or settled). 8 is the app-side claim path that 4 and 5 both need, and it
is deliberately **its own increment** because it is the seam both of them would otherwise assume the
other owns.

---

### Increment 6 — the deposit claim stalls (defect; blocks all funded testing)

**Goal.** A deposit on a fresh identity completes on the first try, every time.

**Observed.** Mint reported the quote `PAID` (`amount_paid: 10000`, `amount_issued: 0`) while the
app's local canonical quote stayed `UNPAID`, no `coco_cashu_mint_operations` row was ever created, no
ecash was claimed, and the app's own **RETRY CONFIRMATION** did not recover it. A first identity's
deposit had worked minutes earlier (quote `01a1e93c-…` → `ISSUED`), so this is a race/state bug in
the claim, not configuration. Workaround used during the run (must not be needed afterwards): mint
the paid quote out-of-band, take the token in through RECEIVE ECASH.

**Files.** `sdk/commerce/payments/state/cashu.ts` (the deposit session, `getOrCreateSeed`,
`initializeCoco` wiring, the mint-operation watcher), `sdk/commerce/payments/wallet/depositQuote.ts`
(the quote-port adapter), `platform/web/wallet/DepositLightningModalHost.tsx` (the 15 s confirmation
window and its phases), plus whatever coco quote state is written by
`platform/web/wallet/cocoWalletHost.ts`.

**Hypothesis to test first (measure, do not assume).** The quote is marked paid by the FakeWallet
*at creation*; if the app's first read already sees `PAID`, the normal waiting→claim transition may
never run, and the app's own 15 s window then lands the session in `unconfirmed` without a claim
operation. Pin it with: create a quote, read it within ~200 ms, and check whether the claim operation
is ever enqueued.

**Seam owned.** deposit session ↔ coco quote watcher/mint-operation processor.

**Tests.** A unit test at the port seam: a quote source that answers `PAID` on the very first read
must still produce a claim; a source answering `UNPAID` then `PAID` must claim exactly once; a
refusal must leave no partial state. Plus one manual acceptance: a fresh identity deposits 10,000
sats first try, in the browser.

**Acceptance.** Fresh identity → DEPOSIT → "eCash minted" → balance 10,000, first attempt.

---

### Increment 7 — the auctions list's label read is rejected by the relay (defect; tiny)

**Goal.** The list's test-label fetch stops building a filter the relay refuses.

**Observed.** Console, on every list load:
`AI_GUARDRAILS ERROR: Filter[0].#a[0] uses non-addressable kind 1440: "1440:<seller>:<d>". #a filters
are only for addressable events (kinds 30000-39999) … For regular events (kind 1440), use: #e filter
for specific event IDs, kinds + authors filters for event queries.`

**Files.** whichever module builds the label filter for the auctions list (`sdk/config/testLabelFilters.ts`
is the registry the list consults; trace the caller that assembles the `#a` filter).

**Fix shape.** Query by `kinds + authors` (or `#e` with the root event ids), then match locally —
never `#a` with a regular kind. Keep the refusal honest if the read genuinely cannot be scoped.

**Seam owned.** the label read's filter builder.

**Acceptance.** No such console error on the auctions list; the labels a seller set still resolve.

---

### Increment 1 — deploy the arena chain as the instance's auctions backend

**Goal.** The app's `/api/auctions/*` is served by the arena chain from the integration ref, with the
relay as the transport, running as a durable unit.

**Scope.**
- Choose the base: the integration ref as-is, or re-integrate the three `feat/*` branches onto a
  tagged `origin/main` (do whichever the repo's history makes cleaner; record which).
- Stand it up per the repo's own `scripts.sh` / `serve.sh`, with the relay flag(s) pointing at
  `wss://relay.playday.it`, as a **systemd user unit with linger** (a bare process dies with the
  session — the standing rule on this box), on its own data directory, recording height/auction-count
  before and after any restart.
- Repoint the app's proxy: `AUCTIONS_PROTOCOL_UPSTREAM_URL` (see
  `platform/server/http/auctionsProtocol.ts`) at the new backend; keep the MVP demo running,
  untouched, on its current port until this is verified, then decide whether to stop it.
- Document the runbook (start/stop/verify, the relay it expects, where its data lives).

**Depends on.** D1, D2.

**Seam owned.** relay URL ↔ chain node ↔ the app's proxy path and the config/state document shape.

**Tests / acceptance.** `go build ./...`, `go vet ./...`, the repo's suite green (its relay-backed
tests need a local `nak serve`); `go test -race` clean or the known races named; then: the app's
`/api/auctions/config` comes from the chain, chain height advances, and the app's lot list still
renders. **No app-side behaviour may regress** — every read the app does today must still answer.

**Risks.** The chain's state document shape differs from the MVP's in any field the app reads
(`seller`, `end_time`, `starting_bid`, `status`, `high_bid`, `original_end_time`,
`late_bid_extension_seconds`, `max_total_extension_seconds`, `required_locktime`, `winner`) — diff the
two shapes **before** repointing, and say in the report which fields differ.

---

### Increment 9 — publish the chain's params to the relay (the escrow's terms source)

**Why this exists.** The ruling "no HTTP ever crosses from client to validator" cannot hold today: the
escrow's committee key and mint URL are only available over HTTP (increment D1's finding 1), and the
chain publishes only `schema, height, appHash, time` in its 1447 state commitment. Without this
increment, deleting the app's config read leaves the escrow with **no** source for the key it must lock
to — so this increment gates the HTTP removal, and it gates increment 4/5's settlement actually being
possible for locks the app creates.

**Goal.** The app learns every term the escrow needs from relay events alone, and the key it locks to
is the **same key the validators settle with**.

**Scope (chain side).**
- Publish the escrow-relevant `Params` to the relay, per validator, signed, anchored — either as a new
  `schema` inside the existing 1447 commitment, or as its own kind if we prefer the commitment to stay
  a pure `(height, app_hash, time)` anchor. Decide, and say which, because the app's reader is written
  against the choice.
- What it must carry at minimum: `GroupKey` (the FROST escrow key), `MintURL`, `KeysetID`, `Keys`,
  `SettlementSafetySec`, `BidToConsensusLatencySec`, `MinWindowSec`, `MaxWindowSec`,
  `MinDurationSec`, `MaxDurationSec`, `MaxProofs`, `Threshold`, and the validator roster.
- **Consistency rule (state it, or the app will trust a stale term):** the params in the event must be
  the ones committed in the app hash it names — a client that reads params and a height can then tell
  they belong together.
- **The FROST group key must be the published one.** `checkSigAllLock` uses `s.Params.GroupKey`; the
  app must lock to exactly that value. A test must pin a create-and-bid fixture against the published
  params and assert the lock's `pubkeys` equals `GroupKey` x-only — the seam that otherwise strands
  every escrow silently.

**Scope (app side).**
- Replace `createHttpPorts({ apiBase: '/api/auctions' }).getConfig()` in
  `platform/web/auctions/relay/AuctionBidHost.tsx` with a relay read of the published params, verified
  the same way verdicts already are (signature, schema, mandatory anchor, roster check —
  `sdk/commerce/auctions/verdictQuorum.ts` / `arenaAnchor.ts` are the existing patterns to reuse).
- Replace `fetch('/api/auctions/state')` in `platform/web/auctions/catalogue/catalogueQuery.ts` with
  the relay read of lots/bids/verdicts the arena client already has, or change that surface if it
  genuinely needed the state document.
- **Delete** the proxy (`platform/server/http/auctionsProtocol.ts`, its routes and
  `AUCTIONS_PROTOCOL_UPSTREAM_URL`) and the client's `reserve` path in the same increment as the last
  reader moves — not before, and not left as a fallback. A fallback HTTP path is how "no HTTP ever"
  quietly stops being true.

**Depends on.** 1. Blocks the deletion half of this increment; 2, 3, 4, 5 depend on its app half for a
correct lock key.

**Seam owned.** chain params → relay event → app's escrow terms.

**Acceptance.** With the proxy route removed from the build: create a lot and place a funded bid in the
browser with the network panel showing **zero** requests to `/api/auctions/*`; the resulting lock's
`pubkeys` equals the published `GroupKey`; and a bid assembled from the relay-read params is accepted
by consensus.

---

### Increment 2 — the ingest seam, pinned with the app's real events

**Goal.** A lot and a bid created **through the app UI** appear in the chain's committed state — the
acceptance I could not reach today, because the chain the instance talks to never ingested them.

**Scope.**
- Pin the app's exact bytes as **Go test fixtures**: the create event id
  `626ef552e331ba51c909736c0c55cec0d2ef3eb5f4988ca31f186d4d8639eaeb` and the bid
  `3483667ad2b801e15cbe81c56b94e7cf04ba9d6fa34f27781d98dcef52a051ad` (both published today, both
  retrievable from `wss://relay.playday.it` by id). The test asserts the chain accepts both and
  commits the expected record — so a future field rename on either side fails a test instead of
  silently voiding every bid.
- Verify the one field group not yet diffed: the app's `outcome_templates` (settle/refund) against
  the chain's `sigAllOutcomeTemplates`. A mismatch here means "the chain refuses a bid without them",
  which is the loudest possible failure — check it first, with the real bid as the fixture.
- Fix whichever side is wrong; if the app is wrong, that fix lands here with its own test.

**Depends on.** 1.

**Seam owned.** **this increment owns the app↔chain wire boundary** — the one place where both sides
can be green and the feature still dead.

**Acceptance.** Create in the UI → the coordinate appears in committed state with `end_time`, the
create's fields resolved. Bid in the UI → the bid appears in committed state with the committed
amount, and the chain's own ledger line for it is `ok` (not `void`, not `rejected`).

---

### Increment 3 — time extension, end to end

**Goal.** A bid inside the anti-snipe window moves the committed end, and the app shows the moved end.

**Scope.**
- **Chain half.** The rule itself is **spec-correct and uncapped** (§3): prove it fires from an
  *ingested* accepted bid inside the window. **The defect here is the check order** (§2.2): the lock
  must be validated against the end *the bid itself establishes* — after the extension — and today
  `checkLock` runs before the extension block, which collapses the post-end safety margin from 900 s to
  as little as 15 s and can lose a sale to a ~15 s settler stall. Fix the order, and add a test pinning
  that an extending bid's locktime floor is derived from `now + WindowSec`, not the old `EndAt`.
  Also verify §12's format bump (v6) is in place, since the refund/extension fields changed the state
  shape and the rule is **bump and wipe, no migration**.
- **App half.** The lot's displayed end must come from committed time, not from the create event
  alone: read the committed `end_time` (state doc or a validator-published commitment, whichever
  increment 1 settles on), show the moved end and the countdown from it, and use it as the basis for
  a new bid's locktime floor. Today the arena detail renders the create-derived end and never moves.

**Depends on.** 2 (a lot must commit first).

**Seam owned.** committed end → app display and the locktime floor.

**Tests / acceptance.** A late bid inside the window: committed `end_time` > `original_end_time`,
`extensions` ≥ 1, and the app's lot page shows the new end. A bid after the window (past the end)
must not extend, and must produce increment 4's outcome instead. A bid inside the window that would
exceed the cap must not exceed it.

---

### Increment 4 — refund on out-bid (the "instant refund"), and the late-bid sibling

**Owner's ruling (2026-11-17).** "The instant refund scenario is actually meant to be the out-bid
scenario, such that when a higher bid comes in, your bid gets refunded via the validators."

**Spec (§4a, verbatim):** "The bidder pre-signed the refund at bid time. The moment the bid becomes
`outbid`, `void` or `lost`, that template plus the **committee's FROST co-signature** is a complete
spend. The settler (§5) collects the co-signature and submits it. **This is the fast path and the
intended one.**" So the trigger set is **`outbid` | `void` | `lost`** — three triggers, one routine —
and the executor is the settler, holding no key, collecting one FROST co-signature per move (§5).
**Neither side implements this today**: the chain only flips the status and defers every refund to
locktime, which is exactly the "instant" the owner is asking for. And §4 forbids the mirror-image
mistake: **a refund of a *winning* bid before its locktime.**

**Goal.** When a higher bid is committed, the previous leader's escrow is refunded **at once** — the
validators execute it, a 1443 records it, and the outbid bidder's balance returns without waiting for
close, settlement, or locktime. The late bid (below) is the same mechanism with a different trigger.

**Why this is new code, not wiring.** Measured today: the chain marks the previous leader
`Status: "outbid"` and refunds nothing; only the *late* bid is "refundable now" in the code. So this
increment implements the trigger. It needs **no new client signature**: the outbid bidder's refund
template was signed and committed *at funding time* (the `refund` half of `outcome_templates`, locked
to its own wallet key), so the validators execute an authorization the bidder already gave —
`settled: "refund"` + `out: [...]`, P2PK-locked to that bidder, via the push-settlement path.

**Scope.**
- **Chain half (the work).** In `applyBid`, the moment a bid becomes the new leader, push the
  *previous* leader's committed refund: spend its locked proofs to its own refund key and publish the
  resulting ecash + the record. Decide and document the failure posture: if the refund spend cannot be
  completed in that block, the previous leader's bid must stay a **visible, refundable obligation**
  (retried on the next block or at close) rather than being silently dropped — a leader change must
  never lose someone's sats. Keep the late-bid path (`void` → refund at once, `maxVoids` cap) as the
  sibling case, and make both go through one refund routine so they cannot drift.
- **App half.** Read the refund record and show the truth: `sdk/commerce/auctions/bidGroupStatus.ts`
  already distinguishes `refund_received` / `reclaimed` / `reclaim_available` / `outbid` / `locked`, so
  the outbid-and-refunded case must land on `refund_received` (money back) rather than staying `locked`
  or `outbid` until close. The bidder's dashboard and the lot's bid list must say "outbid — refunded",
  and nothing may still offer a reclaim for sats already returned.
- **Product copy.** If the previous leader is refunded at once, "Bids add to your position" is no
  longer a description of custody. Fold the corrected wording into this increment.

**Depends on.** 2 (a bid must commit before it can be outbid); 8 for the sats to appear in the wallet.

**Seam owned.** the leader change → the refund spend → the 1443 record → the bidder's displayed state.

**Acceptance.**
- Out-bid: A funds and bids, B outbids → the mint shows A's locked proofs spent to A's key (NUT-07),
  a 1443 records it, A's app state reads refunded and A's balance is restored **while the lot is still
  open**. A's escrow is never left locked till close.
- Late bid: a bid after the end is voided and refunded at once (the sibling case), with the same
  evidence.
- Failure posture: with the refund spend made to fail deliberately, the previous leader's obligation
  is still visible and retried — never silently dropped.
- Not-instant: a bidder who loses at close and was *not* outbid beforehand still reclaims after
  `locktime`; that path must not be described as instant.

---

### Increment 5 — settlement (verdict → escrow moved → seller paid)

**Goal.** A closed lot with a winner pays the seller, and the app shows the outcome.

**Scope.**
- **Chain half.** Prove the close path: the validators' own `close:<auction id>:<endAt>:<sent>` tx
  fires when the committed end passes; a per-validator **1445 verdict** is published with its
  mandatory anchor (height + block hash) per the frozen verdict contract
  (`notes/REPLY-nostr-verdict-contract.md`); then the push settlement runs — the winning bid's
  **committed settle template** plus the committee's FROST co-signature, submitted to the mint, and the
  new ecash published P2PK-locked to the seller (`settled: "payout"`, `out: [...]`), recorded by a 1444.
  Per §5 the settler **is an executor, not an author**: it may only submit a pre-signed template and
  record the result — it may not build outputs, choose a destination or re-lock, and it holds no key.
  **There is no pull path** (`/api/release` is deleted): nobody requests a co-signature, so a settler
  that is down at close **loses the sale** (§5, §13.2 — accepted: the winner reclaims via the
  last-resort path, no money is lost, no escrow is stuck). Say that plainly on the surface rather than
  implying the sale is guaranteed.
- **App half.** Read the verdict and the settle, show the outcome on the lot (the verdict panel and
  the Outcome card already exist and read 1445), and show the seller's payout arriving.

**Depends on.** 2; 8 for the seller's wallet to actually hold the payout.

**Seam owned.** verdict ↔ settle spend ↔ the seller's balance.

**Acceptance.** Funded winning bid → committed end passes → 1445 published and readable, 1444
recorded → the mint shows the escrow spent to the seller's key → the seller's wallet balance rises →
the app shows the outcome. A lot with no bids must end `reserve_not_met` and refund nothing.

---

### Increment 8 — the recipient's wallet claims the ecash the validators minted (the seam 4 and 5 both need)

**Goal.** When the validators move an escrow, the recipient's wallet **notices and takes the money**
without a human pasting a token.

**Why its own increment.** Both 4 and 5 end with new ecash P2PK-locked to a recipient's wallet key,
published by someone else. Neither increment owns the step where that ecash enters coco's proof
store — and a chain that settles perfectly while the seller never sees the sats is the exact
"green on both sides, dead at the boundary" failure.

**Scope.** A wallet-side watcher/claim for the arena path: find the `out` proofs addressed to this
wallet's `walletP2pk` (state doc, or the 1443/1444 events once they carry it), verify they are locked
to it, swap them into coco (the mint's NUT-11 spend by the wallet's own key — `schnorrSignDigest` via
`walletOps.getAuctionBidWalletSigner`, which is the same key the escrow was locked to), and record the
claim so a restart does not double-claim. Reuse `auctionFunds.ts`'s existing lock/reclaim patterns
rather than inventing a second money path; the at-most-once rule for a terminal spend belongs in the
auction library, not the wallet.

**Depends on.** 4 and 5 producing a record to read; can be developed against fixtures first.

**Seam owned.** **this increment owns chain-output → wallet → balance.**

**Tests / acceptance.** With a fixture record and a real mint: the wallet's balance rises by the
payout with no manual action; a second run claims nothing twice; an output locked to a *different*
key is refused rather than attempted.

---

## 4. Parallelism and dispatch order

- **Now, independent:** 6 (deposit defect), 7 (label filter defect). One agent each; no shared files.
- **After D1/D2:** 1, then 2. 1 and 2 must be sequential (2 needs a running chain).
- **After 2:** 3, 4, 5 can be *developed* in parallel (different chain areas: time / void+refund /
  close+verdict+settle) but they must be **verified in sequence** on one lot lifecycle, because they
  share the same chain instance and the same auction: extend → (late) refund → settle.
- **8** can start before 4/5 are done, against fixture records, and must be verified **after** them,
  on the real lifecycle. This is the one increment whose acceptance needs the others finished.

Every agent brief must state what it assumes the other side provides — the presumed interface,
named — because 1–5 are split across two repos and three areas.

---

## 5. Open questions for the owner

1. **D2 only, now:** may I land branches in the arena repo? (D1 is settled: the arena chain is the
   backend; the app talks to the relay only, and the HTTP proxy is deleted, not repointed.)
2. **The existing test locks and the group key.** Every escrow created so far is locked to the MVP's
   `committee_public_key`, which is not the arena chain's FROST group key — those locks can never be
   settled by the validators. Confirm a wipe of the test lots is fine (fake money), rather than any
   attempt to carry them across.
3. **Do we keep the MVP demo running at all** once the arena chain serves the instance? Keeping it
   leaves a second, custodial funding mode one env var away; stopping it is a one-way door for
   anything still pointed at it. My recommendation: stop it, and delete the app's paths to it in
   increment 9.
4. **The Catalogue surface's state read** (`catalogueQuery.ts`): does it move to the relay reads the
   arena client already has, or does that surface change shape? The ruling settles *that* it must not
   be HTTP; it does not settle what replaces it.
4. **The locktime reclaim action** (a bidder whose bid was neither outbid nor won, getting their sats
   back after `locktime`): wanted as a user-visible action, or is the validator-driven refund enough
   for now? It is the difference between increment 8 being "claim what you were paid" and "also reclaim
   what you locked".
5. **What is a "position", once outbid bids are refunded at once?** The chain refuses a re-bid from the
   current leader, while the app tells the bidder "bids add to your position". If every outbid position
   is refunded immediately, a position is *locked sats owned by the current leader* — not a cumulative
   claim a bidder keeps adding to. Confirm that reading, because it decides both the copy and how
   `computeValidatedBids` derives the next floor.

---

## 6. Verification discipline for every increment

- The standing gates in this repo: unit tests, `bunx tsc --noEmit` **against a pristine baseline**
  (a second worktree at the same commit, so the delta is real), `scripts/check-src-boundary.sh`, and
  prettier **on the files touched** (the tree-wide check is already red on this branch — do not
  reformat unrelated files).
- On the chain side: `go build ./...`, `go vet ./...`, the repo's own suite (relay-backed tests need
  `nak serve`), `go test -race`.
- **The parent verifies each claimed artifact itself**: a child's "committed and verified" is a claim,
  not a fact — check the commit exists, re-run the gate, and exercise the real path.
- Anything published to the live relay or the shared mint gets **named in the report** with its id, so
  the next session can find it or clean it up.
