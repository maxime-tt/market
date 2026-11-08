# SLICE C — positions and legs: a bidder may raise its own bid by adding a leg

Owner's ruling, after hitting the case live: a bidder who already holds a bid **must be able to add
an additional leg** without being refunded first, and a bidder **must never be able to exit its own
bid**. Minting a second full amount and double-committing (the trivial workaround) is rejected as
unintuitive. So the position model is the correct shape.

## The model

**Legs.** A bid from a bidder who already holds legs in that auction is an *additional* leg. Its
`amount` is the **delta** it locks — never the position total. So there is no new field and no new
kind: a first bid is simply a leg whose delta equals its total, which is exactly what a bid means
today.

**Position.** A bidder's position in an auction = the sum of its legs' amounts. The auction's
**high bid becomes the leading position**, and the leader is the bidder holding it.

**Admission rule (uniform).** A new leg is admitted only when the bidder's *resulting* position is
at least `leading position + min increment`. That covers both cases with one rule:

* a bidder below the leader must clear the leader by the increment;
* the leader raising its own position must raise it by at least the increment, so no dust legs.

**No exit.** There is no way to remove a leg on request. A leg leaves only by (a) the whole position
being outbid — see below — or (b) the post-locktime refund key, which is the existing escape hatch.
A bidder who raises cannot lower what it has committed.

**Outbid is all-or-nothing.** When a new leg takes the lead from another bidder, **every leg of the
previous leader becomes `refundable` at once**, not just the last one. A position is the unit that
wins, so a position is the unit that gets returned.

**Close and winner selection.** The winner is the bidder holding the leading position, and **all of
its legs are marked `winner_selected`** at close, with the reserve compared against the position
total.

**Settlement.** The winner pays the sum of its legs: the coordinator submits one pre-authorized
settle transaction **per leg**, each from that leg's deposit, and parks each leg's share for the
seller. The existing `KindOutcome` record stays per lock — one record per leg, `bid_id` naming the
leg — so no new kind is needed and the per-lock ledger stays exact. The seller's payout is the sum
of the legs' parked proofs.

**Refund.** The same in reverse: every leg of an outbid position is refunded by its own
pre-authorized refund template, and each leg's returned proofs are parked for that bidder.

**Anti-snipe.** Unchanged: any leg landing inside the window extends the end by the window's
extension. A raise is a bid, so a raise near the end extends, exactly as a new bid does.

## What this touches (the ripple list)

1. `applyBid` / `applyAcceptedBid` (`internal/poc/model.go`): the amount is a delta; compute the
   bidder's resulting position and apply the uniform admission rule; on taking the lead, mark **all**
   legs of the previous leader `refundable` (derived from committed bids, no new stored struct);
   record the leg and the position.
2. `Auction`: `HighBid` becomes the leading position; keep `LeaderBidID` pointing at a leg of the
   leading position (the last leg that established it), and have close/outcome resolve the position
   from committed bids rather than assuming one lock.
3. `applyClose`: mark **all** legs of the winning position `winner_selected`; reserve compares the
   position total.
4. `applyOutcomeRecord`: `settle` accepts any leg of the winning position (today it demands
   `bid_id == leader_bid_id`), and `refund` accepts any leg of a refundable position.
5. The coordinator sweeper: iterate legs, one swap and one outcome record per leg, with the existing
   backoff and idempotency.
6. Wallet: unchanged except that a lock is always a delta — the wallet already locks an amount and
   produces templates for that lock.
7. Lab UI: the bid box means "add this leg"; the panel shows **position total vs the amount locked
   this round**, the leader's position, and the minimum next position; the wallet error
   "all N sats are locked to a previous bid" becomes the honest, actionable case: *your position is
   X; add legs to raise it*.
8. Tests: position summing, the uniform increment rule for both leader and non-leader, all-legs
   refundable on outbid of a multi-leg position, all-legs `winner_selected` at close, per-leg
   outcome records, and a legacy `cashu_lock_v1` regression.

**Scope decision:** the accounting lives in the shared model, so both mint-backed routes get legs —
a mode-specific rule would be two mechanisms for one behaviour. The dense page keeps working; the
lab is where the new flow is exposed.

## Acceptance (the demo case that failed, now proven live)

1. bidder A bids 128 (leg 1) — leader, position 128
2. A adds a leg of 128 (position 256) **without any refund and without minting twice the total**
3. A cannot exit: nothing on the API or the lab lets A remove a leg
4. B outbids with 300 → **both** of A's legs go `refundable` and both are returned, park-and-import,
   and A can spend the returned value at the mint
5. a two-leg winner settles at close with no browser open: both legs settle, the seller imports the
   sum and spends it at the mint
6. a raise below `position + increment` is refused, with the rule named
