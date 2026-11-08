# SLICE C WAVE 1 — the position model in the shared state machine

Read `SLICE-C-POSITIONS-PLAN.md` first; it fixes the rules. This wave is **model only**:
`internal/poc/model.go` plus tests. Wave 2 (the coordinator's per-leg sweeper) and wave 3 (the lab)
follow separately, because they share no files with this one.

## What to implement

1. **A bid's `amount` is a delta.** A first bid is a leg whose delta is its total; a bid from a
   bidder that already holds legs in the auction is an additional leg. No new content field.
2. **Position** = the sum of a bidder's legs in that auction, derived from committed state
   (`state.Bids` + `state.Locks`) — do **not** add a stored position struct.
3. **Admission (uniform rule).** Accept a leg only when the bidder's resulting position is at least
   `leading position + auction.MinIncrement`, where "leading position" is the highest position in the
   auction at that moment (which is the bidder's own position when it is the leader). Name the rule
   in the refusal, e.g. `"bid does not satisfy the minimum increment over the leading position"`.
   Keep the existing rules intact: not open, seller cannot bid, late, and the integrated/V4
   `stale_leader` path must keep working unchanged.
4. **`Auction.HighBid` becomes the leading position.** Keep `LeaderBidID` naming a leg of the leading
   position. Resolve the position from committed bids wherever it is needed; do not assume one lock.
5. **Outbid returns the whole position.** When a leg takes the lead from another bidder, mark **all**
   legs of the previous leader `refundable` — not just `LeaderBidID`'s lock. A leg of the *same*
   bidder must never be marked refundable by that bidder's own raise.
6. **Close.** The winner is the bidder holding the leading position; mark **all** of its legs
   `winner_selected`; compare the reserve against the position total.
7. **`applyOutcomeRecord`.** `settle` accepts any leg of the winning position (instead of demanding
   `bid_id == leader_bid_id`); `refund` accepts any leg of a refundable position. One record per leg,
   unchanged shape, no new kind.
8. **Nothing else moves.** Do not change the semantics of `applyRefund`/`applyClose` beyond what the
   above requires, do not touch the treasury/note paths, and do not add new committed kinds.

## Tests (Go, `internal/poc/`)

* a second bid from the same bidder is admitted as a leg when it clears `position + increment`, and
  the auction's `HighBid` is the position total
* a raise below that is refused, with the rule named in the error
* a non-leader's leg that does not clear the leader is refused
* when another bidder takes the lead, **every** leg of the previous leader is `refundable` and the
  raiser's own earlier legs are not
* at close, **every** leg of the winning position is `winner_selected`, and the reserve compares the
  position total
* `applyOutcomeRecord` settles a *second* leg of the winning position (the case that failed under the
  one-lock assumption) and refuses a leg that belongs to nobody's position
* a single-leg auction behaves exactly as before (regression), for both `cashu_lock_v1` and
  `cashu_sigall_v1`

## Ground rules

* Repo `/home/admin_maxime/work/auctions-simplify`, branch `maxime/auctions-mvp-simplify`.
* `export PATH=/home/admin_maxime/.local/go/bin:$PATH`,
  `export GOCACHE=/home/admin_maxime/.hermes/profiles/maxime/cache/scratch/gocache`;
  `go build ./...` clean and `go test ./internal/poc/ -count=1` green before reporting.
* Do not edit the coordinator's sweeper, the deposit route, the static JS or the wallet — later waves
  own those. Do not restart services, do not deploy, do not touch the demo network root, do not wipe,
  do not push, do not commit.
* Report: files touched, exact commands, raw output, anything unverified.
