# SLICE B wave 2 FIX — break the deposit/admission cycle (the deposit must carry the lock receipt)

## The defect, found by the first live end-to-end attempt

`sigall_e2e_live.ts` (live demo, 2026-11-08, exit 1) got as far as a signed `cashu_sigall_v1`
lock receipt and then died:

```
PASS  3. SIG_ALL lock built and a sigall lock receipt signed (mint-lock)  [HTTP 200 funding_mode=cashu_sigall_v1]
FAIL  4. bidder deposited outcome_templates (POST /api/demo/sigall-deposit)
        [HTTP 422 {"error":"sigall deposit: no lock receipt for this auction and bidder"}]
FAIL  5. bid carrying outcome_templates + sigall_deposit admitted
        [lock-only bid is refused: 422 sigall bid must publish outcome_templates with the PlebeianAuctionsPOCSigAllTemplatesV1 schema]
```

It is a hard cycle, and it makes the whole route unreachable on a live network:

* `sigAllDepositCandidates` (`internal/poc/demo_sigall_deposit.go:217`) finds the caller's receipt
  **only by walking committed `state.Locks`** -> `state.Bids[...]` -> `state.CashuLocks[...]`.
  No committed lock => 422 "no lock receipt for this auction and bidder".
* A `Lock` exists only after a bid is admitted (`model.go:1350`).
* For a `cashu_sigall_v1` auction, admission calls `verifySigAllBidAdmission`
  (`sigall.go:385`), which requires the bid to already carry the coordinator's signed
  `sigall_deposit` receipt. A bid without it is refused.
* `POST /api/demo/mint-lock` signs the receipt and returns it (`demo_mint_lock.go:260`) but
  **never stores it**, so nothing else can read it before the bid commits.

The wave-2 brief assumed "the receipt store `demo_mint_lock.go` already keeps" — it does not exist.
Every Go test built the receipt by hand, so no unit test ever exercised the live ordering.

## The fix: the request carries the receipt the bidder already holds

The receipt is public, non-bearer material (it carries NUT-07 `Y` references, not proofs), and the
bidder's wallet holds it in hand from `mint-lock`. The coordinator therefore verifies **its own
signature** over the receipt instead of trusting a lookup.

1. `sigAllDepositRequest` (`internal/poc/sigall.go:122`) gains
   `Receipt *CashuLockReceipt \`json:"receipt,omitempty"\``.
2. `demoSigAllDeposit` (`demo_sigall_deposit.go`):
   * when `body.Receipt != nil`, use it as the receipt and **verify it before use**:
     the application-authority signature over `cashuReceiptDigest` verifies (reuse the helper the
     admission path already uses — do not write a second signature check), the schema is the
     expected one, `FundingMode == cashu_sigall_v1`, and `AuctionID`/`Bidder` equal the request's.
     A receipt that names another auction or bidder is refused, naming the rule.
   * when `body.Receipt == nil`, keep today's committed-lock candidate lookup as the fallback
     (a retry after the bid committed). Its "no lock receipt for this auction and bidder" refusal
     stays for that path.
   * everything else is unchanged: the auction must be open, it must have committed a seller payout
     key, `verifySigAllDeposit` runs the five rules, the store is durable, and the signed deposit
     receipt is returned.
3. `internal/poc/webwallet/src/wallet.ts`: `depositOutcomeTemplates(...)` must put the receipt the
   wallet got from `mint-lock` into that POST body. Nothing else in the wallet changes.
4. Add to the wave-2 test file: a test that pins the **live ordering** — an empty
   `state.Locks`/`state.Bids` (no lock for this auction+bidder at all), an authority-signed
   `cashu_sigall_v1` receipt posted in the body -> the deposit is accepted and stored; then the bid
   that carries `outcome_templates` + `sigall_deposit` passes the **real admission path** the live
   node uses and commits, and the sweeper then resolves the lock. Plus refusals: a receipt for
   another bidder, for another auction, with a bad signature, and a `cashu_lock_v1` receipt.

## Ground rules

* Repo `/home/admin_maxime/work/auctions-simplify`, branch `maxime/auctions-mvp-simplify`.
* `export PATH=/home/admin_maxime/.local/go/bin:$PATH`, `GOWORK=off GOTOOLCHAIN=local`,
  `GOCACHE=/home/admin_maxime/.hermes/profiles/maxime/cache/scratch/gocache`,
  `TMPDIR=/home/admin_maxime/.hermes/profiles/maxime/cache/scratch`.
* `go build ./...`, `go vet ./internal/poc/`, `go test ./internal/poc/ -count=1` all green, and if
  `wallet.ts` changes `bun build src/browser.ts` must still bundle.
* Do not restart services, do not touch the demo network root, do not commit, do not push.
