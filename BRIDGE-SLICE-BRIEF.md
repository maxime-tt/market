# SLICE BRIEF — bidder-published outcome authorizations (the "bridge"), FROST placeholder unchanged

## Why

Today the coordinator demands a live signature from the bidder's wallet spend key before it
will settle (`demoMintVerifySettleClaim`, `internal/poc/demo_mint_spend.go:682`) and a signed
`KindRefund` event before it will refund. That is a **consent gate in the coordinator**, not a
mint rule: the mint enforces only the NUT-11 lock keys. So the bidder must keep a browser open
at close, or the money sits locked.

Both consent messages are **fully computable at bid time**, so the bidder can publish them with
the bid and then go offline. The committee key holder (single key today, FROST later) then signs
over on its own. **This slice removes liveness, not trust** — the committee key can already spend
the lock alone during the window. Removing trust is FROST's job. Do not change the lock.

## Frozen interfaces (do not deviate; Go and TypeScript must agree byte for byte)

### 1. Consent messages

Settle (unchanged, exists today):

```
PlebeianAuctionsCashuSettleClaimV1\nauction_id=<id>\nproofs=<refs sorted, joined by ,>
```

Refund (NEW — V2). The old V1 bound `bid_id`, which is the **bid event id** and therefore
unknowable when the bid is being signed (circular). V2 binds what is known at bid time:

```
PlebeianAuctionsCashuRefundClaimV2\nauction_id=<id>\nproofs=<refs sorted, joined by ,>\noutputs=<refund key repeated once per proof, sorted, joined by ,>
```

`refs` = the lock's proof-state references, i.e. the same values the bidder already sends to the
coordinator as `proof_state_refs`. Both the **live** refund claim and the **pre-authorized** refund
use V2 — one message format, one verification function, two callers.

### 2. Bid content addition (`internal/poc/model.go`)

```json
"outcome_authorizations": {
  "schema": "PlebeianAuctionsPOCBidOutcomesV1",
  "settle_spend_signature": "<64-byte lowercase hex BIP-340>",
  "refund_spend_signature": "<64-byte lowercase hex BIP-340>"
}
```

Signatures are by the bidder's **wallet spend key** (the key already committed as
`receipt.RefundPublicKey`). **Mandatory** on every `cashu_lock_v1` bid: without them the bid
re-introduces the liveness requirement, so admission refuses a mint-backed bid that lacks them.

Verify in local admission (CheckTx) next to the existing receipt checks. Store on the lock:

```go
SettleAuthorization string `json:"settle_authorization,omitempty"`
RefundAuthorization string `json:"refund_authorization,omitempty"`
```

No existing state transition changes semantics. The new field is set during `applyBid`.

### 3. New committed outcome record

```go
KindOutcome = 1445
```

```json
{"schema":"PlebeianAuctionsPOCOutcomeV1","auction_id":"…","bid_id":"…","outcome":"settle"|"refund","payout_token_sha256":"<hex>"}
```

* Posted by the **application authority** only (the coordinator's own key), never by a browser.
* New transition `applyOutcomeRecord` (new op key `outcome:<bid_id>:<outcome>`; replay-safe because
  no historical block contains this kind):
  * `settle`: requires the auction closed, funding mode `cashu_lock_v1`, `bid_id == leader_bid_id`,
    lock status `winner_selected`, and a stored `SettleAuthorization`; sets lock `paid`,
    records `CashuPayoutTokenSHA256`. Issues no note, moves no value.
  * `refund`: requires lock status `refundable` and a stored `RefundAuthorization`; sets lock
    `refunded`, records the payout digest. Issues **no IOU note** (the mint swap is the money).
* Admission refuses the kind from any signer that is not the application authority, and refuses
  it when the named lock holds no matching authorization.

## Work split

### Agent A — consent at bid time (owns `internal/poc/model.go`, `internal/poc/webwallet/src/wallet.ts`, `internal/poc/static/lab.js` bid path, plus `app.js` bid path if it carries the same content)

1. `wallet.ts`: `preauthorizeOutcome(auctionId, proofStateRefs, lockedProofs)` → both signatures.
   Reuse the existing signing helpers and hashing discipline (BIP-340 hashes internally; the
   wallet already hashes once for the settle message — keep that exact behaviour).
2. Bid event content carries `outcome_authorizations` in both lab and main demo paths.
3. `model.go`: `bidContent` field + `Lock` fields + admission verification (mandatory) + the
   `KindOutcome` constant and `applyOutcomeRecord` transition with its admission rule.
4. Tests: a valid bid with both authorizations is admitted; a bid missing either is refused;
   an authorization signed by a foreign key is refused; `applyOutcomeRecord` transitions
   `winner_selected → paid` and `refundable → refunded`, refuses a wrong outcome, a wrong signer
   (non-application-authority) and a missing authorization, and is idempotent by op key.

### Agent B — the coordinator acts alone (owns `internal/poc/demo_mint_spend.go`, a new `internal/poc/demo_outcome_sweeper.go`, routes in `internal/poc/server.go`)

1. Refund verification moves to the V2 message (shared function used by the live endpoint and the
   sweeper). Keep the existing `/api/demo/mint-refund` and `/api/demo/mint-settle` endpoints
   working for the manual/lab path.
2. Sweeper: a background loop in the coordinator process (model it on `internal/poc/r20_close_trigger.go`,
   **outside** consensus — never block or perform network I/O inside DeliverTx/BeginBlock):
   * closed `cashu_lock_v1` auction, winning lock `winner_selected`, bid holds
     `SettleAuthorization` → perform the swap with the existing in-process settle core, then post
     the `KindOutcome` (outcome `settle`) signed by the application authority;
   * lock `refundable` and the bid holds `RefundAuthorization` → refund swap, then post the
     `KindOutcome` (outcome `refund`).
   * Idempotent, retried with the same backoff shape the close trigger uses, and never acts on a
     lock whose stored authorization does not match the outcome.
3. Durable payout store: the settlement payout (proofs P2PK-locked to the **seller's** key, so not
   custody of value) is written to `<network root>/settlements/<auction_id>.json` mode 0600 and read
   back on import; keep the in-memory map as a cache. A restart between the swap and the seller's
   fetch must no longer lose the payout.
4. Tests: sweeper settles a closed auction with a stored authorization and posts the record; it
   refunds a displaced lock likewise; it does nothing when the authorization is absent; it does not
   double-act across two ticks; the payout survives a store reload from disk.

## Ground rules for both agents

* Working tree: `/home/admin_maxime/work/auctions-simplify`, branch `maxime/auctions-mvp-simplify`.
* Go is **not** on PATH: `export PATH=/home/admin_maxime/.local/go/bin:$PATH`,
  `export GOCACHE=/home/admin_maxime/.hermes/profiles/maxime/cache/scratch/gocache`.
* `go build ./...` must pass and `go test ./internal/poc/` must stay green.
* **Do not** restart `auctions-mvp-demo.service`, do not touch the demo network root, do not wipe or
  re-init anything, do not push to any remote, and never push to `PlebeianApp/market`. Commit
  nothing: report and let the parent commit.
* No backwards compatibility. The demo chain will be wiped and re-initialised, so a format change is
  free; refusing at admission is preferred over changing an existing transition.
* Report: files touched, the exact test command you ran and its output, and anything you could not
  verify. Claim nothing you did not run.
