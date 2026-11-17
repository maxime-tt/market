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

## 1. What already exists — do not re-derive any of this

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

**D1 — Which backend is authoritative on the instance?** The live instance currently proxies
`/api/auctions/{state,config,event}` to `http://127.0.0.1:8080`, which is the **MVP demo**
(`auctions-mvp-demo.service`, `poc`, 4 validators, `funding_mode: custodial_reservation_v1`). Its
records are its own API's (`settle-probe-…`, `proof-…`, field names like
`seller_coco_payment_public_key`), and it does not ingest the app's kinds. Options:
  - **(a) Deploy the arena chain** from the integration ref as the backend, keep the MVP beside it on
    a different port (recommended: it is the protocol the app's kinds belong to, and it is already
    written).
  - **(b) Teach the MVP demo to ingest 1440/1441** (a second observer beside its own kinds) — smaller
    deploy, but it means maintaining two protocols in one backend, which the kind-map decision
    already rejected.
  - **(c) Point the app at the arena chain only for the 1440 flow and leave the MVP for everything
    else** — rejected unless you say otherwise: two backends behind one proxy path is the
    "two create surfaces" trap in transport form.

**D2 — Is the arena chain repo in scope for me to land branches in?** The handover calls it another
session's (`ChiefmonkeyArt`). This plan assumes I may branch and commit there (never force-push
`origin/main`) and that the *running* backend on this box is ours to stand up. If not, increments
1–5 stop at patches handed to that session, and only 6–8 land here.

Neither decision blocks increment 6 or 7 — start those immediately if you want work moving now.

---

## 3. The increments

Ordering: **6 → 7 → 1 → 2 → 3 → 4 → 5 → 8**. 6 and 7 are independent and land today. 1 must precede
2 (there is nothing to ingest into otherwise). 2 must precede 3/4/5 (a lot the chain never sees can
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
- **Chain half.** Confirm the extension rule the chain applies against the app's create fields
  (`mode: antisnipe`, `windowSec`, `durationSec`) and the committed record's
  `original_end_time` / `late_bid_extension_seconds` / `max_total_extension_seconds` — the increment
  in `app.go` exists; prove it fires from an *ingested* late bid inside the window, and that the cap
  is honoured. If the cap is not enforced, that is the defect to fix here.
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
  **committed settle template** plus the committee's signature, submitted to the mint, and the new
  ecash published P2PK-locked to the seller (`settled: "payout"`, `out: [...]`), recorded by a 1444.
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

1. **D1 / D2 above** (backend authority; whether I may land in the arena repo).
2. **Do we keep the MVP demo running at all** once the arena chain serves the instance? Keeping it
   leaves a second, custodial funding mode reachable behind a different path; stopping it is a
   one-way door for anything still pointed at it.
3. **Should the app keep the HTTP proxy read at all**, or move the config/committee/mint read to the
   relay too? The ingest handover's direction was one transport, and the state document is what the
   verdict note calls the transport the front end should stop needing. Not required to close the
   three gaps, but the plan should not bake in a dependency we intend to delete.
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
