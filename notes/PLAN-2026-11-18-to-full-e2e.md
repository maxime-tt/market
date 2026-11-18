# PLAN — from here to a working auction in the app, order management included

**Written** 2026-11-18 by the app-side session. **Base:** `unite/1420-all` @ `7f6759a86`
(app read + Layout A + relay params + live funded bid), chain at
`fix/params-cadence-edge` (`9d08340`, deployed) on top of `feat/validator-workstreams`.

Everything below was measured against the running system before it was written; the two things I did
not measure are marked as such.

---

## 1. Does the chain still need work? Yes — three things, and they are the whole gap

What the chain does today (deployed, verified): create 1440, ingest tentatively via the relay, bid
1441 with the NUT-11 `n_sigs:2` escrow committed to the FROST group key, anti-snipe extension (no cap),
close on the committed end, per-validator kind-1445 verdicts with a mandatory anchor, push settlement
at close through the **pre-signed** settle/refund templates (`settler.go` + `settle.go`), kind-1447
commitments on a 10 s wall-clock bound, kind-1448 params anchored to the same `(height, app_hash)`.

**A. The money facts are invisible.** Kind 1443 (refund) and 1444 (settle) exist in the kind map and
nowhere else — `grep -rn "BuildRefund\|BuildSettle"` finds nothing but the map's own test. So the
settler moves sats at the mint and no client can see that it happened: the app can show a **verdict**
(a claim) but never a **receipt** (the ecash that was minted to whom). Every "paid / refunded" surface
in the app is blocked on this one thing.

**B. The outbid refund does not exist.** `chain/app.go` `applyBid`: on an accepted higher bid the
previous leader gets exactly `s.Bids[au.HighBid].Status = "outbid"`. Nothing is refunded, no record is
written; `closeDue` marks non-winners `"lost"` and still refunds nothing until locktime. The owner's
ruling (§4a of the spec, "the fast path and the intended one") is that `outbid | void | lost` all
trigger the same push-refund **the moment** the status changes. The late-bid sibling (`void`) is the
same mechanism with a different trigger and must go through **one** routine so the two cannot drift.

**C. Two checks that need to be pinned rather than assumed.** `minLocktime` now derives the *established*
end itself (`chain/app.go:615-625`), which is the fix for the §2.2 check-order bug — but nothing pins
that an extending bid's floor comes from `now + WindowSec` at block time, and nothing pins that the
anti-snipe extension is **uncapped** (the app no longer carries `maxTotalExtensionSeconds`; the chain
must be shown not to either).

**Not missing on the chain, contrary to what the plan assumed:** the close-time push settlement works
(the validator suite settles every escrow at the mint, "nothing stranded"), and the verdict publisher
is live (179 verdicts on the relay).

---

## 2. Does the app still need work? Yes — and it is the larger half

Measured on the current tip:

- Nothing reads kind 1443/1444. `sdk/commerce/auctions/constants.ts` names them; no decoder, no view.
- No wallet claim path. When the validators mint ecash to a recipient's wallet key, nothing puts it into
  coco. That is the plan's increment 8 and it is the seam **both** refund and settlement end in.
- The order screens exist but are 30408: `platform/web/orders/*` (OrderDataTable, OrderDetailComponent,
  ordersQuery), `platform/web/orders/orderClaimsBinding.ts`, `platform/web/auctions/AuctionClaimDialog.tsx`.
  An arena win creates **no order event**, so a buyer who wins never sees a purchase, and
  `AuctionClaimDialog` still publishes the retired claim **order**.
- `platform/web/dashboard/AuctionFulfilmentHost.tsx` already reads the arena view (winning verdict →
  winning bidder → delivery details) and is mounted by `SellerAuctionLotHost`. So the seller's "who won
  and where does it ship" half exists; it is fed by the private claim message, not by the protocol.

---

## 3. The plan

Ordering is **A → B → C/E**, with D parallel to A. The chain half is the gate: nothing in B, C or E is
honest until the receipts exist.

### Phase A — the chain publishes what it did (owner: a chain workstream)

1. **A1 · 1443/1444 receipts.** `BuildRefundEvent` / `BuildSettleEvent`, signed per validator and
   anchored exactly like a verdict, published by the settler on **every** execution: which auction,
   which bid, `outcome: refund | payout`, the minted outputs' amounts and recipients (the proof
   secrets stay out of the event — recipients prove ownership by spending), and the `(height, hash)`
   anchor. Idempotent: one event per execution, never one per pass.
2. **A2 · the outbid push-refund.** In `applyBid`, on leader change, execute the previous leader's
   **committed** refund template through the same settler path, then publish A1's 1443. Failure
   posture, stated and tested: if the spend cannot complete in that block, the obligation stays
   **visible and retried** (a `refundDue` list on the lot) rather than being dropped — a leader change
   must never lose someone's sats.
3. **A3 · the late-bid sibling.** Route `void` through the same routine as A2 (one routine, three
   triggers: `outbid | void | lost`), keeping the existing `maxVoids` cap.
4. **A4 · pin the two checks.** A test that an extending bid's locktime floor is derived from
   `now + WindowSec` at block time, and a test that the extension is uncapped.
5. **A5 · merge the cadence fix** (`fix/params-cadence-edge`, `9d08340`) into the validator branch —
   it is already deployed but lives on its own branch.

**Gate for A:** the chain suite (145 today) plus one live lifecycle probe that shows, on the relay, a
1443 for an outbid bidder while the lot is still open, and a 1444 at close naming the seller's payout.
Deploy by replacing the binary; never `arena init`.

### Phase B — the app reads the receipts (owner: me)

6. **B1 · decode 1443/1444** with the verdict discipline (signature, schema, anchor, roster) and expose
   them on the lot view: "refunded at height N", "paid 1,200 sats at height N" — a **receipt**, distinct
   from the verdict's claim.
7. **B2 · positions become custody truth.** An outbid-and-refunded position reads `refund_received`
   (`sdk/commerce/auctions/bidGroupStatus.ts` already has the vocabulary) instead of `outbid`/`locked`;
   no reclaim affordance is offered for sats already returned.
8. **B3 · the seller's lot page** shows the payout receipt beside the verdict.

**Gate for B:** unit tests with real fixtures (the live 1443/1444s from A), then the live page.

### Phase C — the money reaches the wallet (owner: me; the plan's increment 8)

9. **C1 · claim watcher.** Find 1443/1444 outputs addressed to this wallet's P2PK key, verify they are
   locked to it, swap into coco with the wallet's own key, and record the claim so a restart cannot
   double-claim. Reuse `auctionFunds.ts`'s patterns; the at-most-once rule for a terminal spend belongs
   in the auction library, not the wallet.
10. **C2 · acceptance:** with a fixture record and the real mint, the balance rises with no manual
    action; a second run claims nothing twice; an output locked to another key is refused rather than
    attempted.

### Phase D — the order management screens (owner: me; parallel to A)

11. **D1 · seller per-lot page** = verdict + settlement receipt + fulfilment panel, **read-only**;
    every 30408 action the protocol cannot honour is deleted, not left inert (WS-C already retired the
    presentation; this finishes the actions).
12. **D2 · buyer side.** A win must appear as a purchase. Either the arena win feeds the existing orders
    table (`platform/web/orders/*`) through a projection over the arena read, or the auctions list grows
    a "your wins" surface — **one mechanism**, and I would project into the existing orders table, since
    that is where the buyer already looks.
13. **D3 · the claim.** `AuctionClaimDialog` stops publishing the retired claim **order** for arena lots
    and publishes only the private claim message (NIP-59 DM: address, name, no money, no order event).
    The seller's fulfilment panel already reads that message.
14. **D4 · the one open product question, for the owner:** fulfilment has no protocol home. The claim
    message is an **app convention**; confirm that is the intended long-term shape (recommended: yes,
    with the DM as the transport and no protocol kind), or name the mechanism you want instead.

### Phase E — the lifecycle e2e (owner: me; the definition of done)

15. One opt-in live test, in the shape of `scripts/auctions/live-funded-bid.test.ts`:
    create → A funds and bids → B outbids → **A's escrow is refunded at once, a 1443 records it, A's
    balance returns while the lot is still open** → B bids inside the window → the committed end moves
    → the lot closes → a 1445 verdict names B → a 1444 records B's settlement → the seller's balance
    rises → B's claim reaches the seller → the seller's dashboard shows the winner and the address.
    Every step asserted from the relay and the mint, not from the app's own optimism.

---

## 4. Sequencing, honestly

- **A is the gate and the longest single piece.** B/C/D can be built in parallel but must stay marked
  "blocked on A" for their verification until A's receipts are on the relay.
- **D does not wait on A** for its structure (the panels exist and read the arena view today); only its
  "paid/refunded" rows do.
- **E is last** and is the thing that decides whether this is "working auctions in the app" or "several
  correct halves".
- Until A lands, the app's honest state is what it is today: it can create, fund, bid and read a
  verdict, and it says "outcome not verified yet" and shows no money — because no money fact exists on
  the wire yet. That is the correct behaviour, not a bug to paper over.

## 5. What I would do first

Start A1+A2 as one chain increment (they are the same execution path), and in parallel build B1's
decoder against a fixture shaped by A1's schema — agreed with the chain session **before** either side
writes it, because the event's content is a wire contract and the app is its other half.
