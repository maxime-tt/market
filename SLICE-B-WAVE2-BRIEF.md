# SLICE B2-route + B3 (wave 2, coordinator side) — accept the deposit, then submit only what the bidder pre-authorized

Read `SLICE-B-PLAN.md`, `SLICE-B-WAVE1-BRIEF.md` and the wave-1 code before starting. Wave 1
(committed `041238c00`) shipped the bid-time half: the `cashu_sigall_v1` mode, the 2-of-2 SIG_ALL
lock in the wallet, `internal/poc/sigall.go` (the one digest, the template/deposit types,
`verifySigAllDeposit` implementing the five §5 rules, `verifySigAllBidAdmission`), the
committee port `internal/poc/committee_signer.go`, and the six tests in `sigall_test.go`.

Wave 1 deliberately left the coordinator side unwritten. Everything below is that side. Until it
lands, a `cashu_sigall_v1` bid cannot be deposited, admitted on a live network, or resolved.

## 1. The deposit route — `internal/poc/demo_sigall_deposit.go` (new)

```
POST /api/demo/sigall-deposit
{ "auction_id": "...", "bidder": "<nostr pubkey>", "templates": { "settle": {...}, "refund": {...} } }
  -> 200 { "deposit_id": "...", "settle_digest": "...", "refund_digest": "...", "signer": "<application authority pubkey>", "signature": "<hex>" }
```

* Register it next to the other demo routes in `server.go` (`POST /api/demo/sigall-deposit`), under
  the same demo-mutation guard the sibling routes use.
* Look up the caller's **lock receipt** for this auction (the receipt store `demo_mint_lock.go`
  already keeps, keyed by bid id) and the auction's create event. Refuse with 422 naming the rule
  when there is no receipt for this auction+bidder, when the receipt is not
  `cashu_sigall_v1`, or when the auction committed no seller payout key.
* Verify with the **existing** `verifySigAllDeposit(receipt, auction, templates)` — do not write a
  second copy of those five rules. Its error text already names the rule; surface it verbatim in
  the 422 body the way `demoMintLock` surfaces its refusals.
* Mint a `deposit_id` from the verified digests (the existing `validOperationID` shape, deterministic
  over auction+bidder+digests so a retry is idempotent).
* Persist the **bearer** templates durably — `secret` and `C` are in them, so this is the one place
  the coordinator holds spendable material between bid and outcome (SLICE-B-PLAN.md §"Target
  design"). Follow the durability pattern the settlement/outcome stores already use
  (`settlementStore`, `demoOutcomeProofStore`): a directory under the demo home, write-then-rename,
  reload on start. A deposit must survive a restart.
* Build and return the coordinator's signed `sigAllDepositReceipt` (`sigAllDepositReceiptSchema`,
  fields as in `sigall.go`): the signer is the **same application authority key** that signs the
  lock receipts in `demo_mint_lock.go` — reuse that path, do not introduce a second authority. The
  digest it signs is `sigAllDepositReceiptDigest`.
* `verifySigAllBidAdmission` (already written) then checks the on-chain commitment against this
  receipt, so the two must agree field-for-field. If wave 1's admission expects a field the receipt
  does not carry, fix **admission**, not the signature.
* Refuse to store a deposit for an auction that is already closed, and refuse a second deposit for
  the same auction+bidder whose digests differ (name it).

## 2. The submit path — `internal/poc/demo_mint_spend.go`

New `demoMintSigAllSpend(ctx, receipt, deposit, outcome) ([]demoMintSpentProof, error)`, the
SIG_ALL sibling of `demoMintCooperativeSpend`:

* **It constructs nothing.** It takes the stored template for the committed outcome, recomputes
  `sigAllTemplateDigest` and fails closed if the digest is not the one the bid committed on chain,
  or if the template's inputs are not the receipt's refs, or if the destinations are not the ones
  §"Templates" names. A missing deposit is an error — there is no fallback to
  `demoMintCooperativeSpend` and no locally-built output.
* The swap body is the template's own inputs and outputs: `amount`, `id`, `secret`, `C` in, and the
  template's `amount`, `id`, `B_` (recompute `B_` from the template's `secret` + `r` with the
  existing `sigAllOutputPoint`/`cashuHashToCurve` helpers — the mint takes `B_`, never `r`).
* The witness carries **both** signatures over the §3 digest: the bidder's from the template, and
  the committee's from the port (`server.committeeSigner().SignDigest`). Order is the order B0 saw
  accepted; if the mint refuses, the refusal text is the evidence to report. This is the only place
  a committee spend signature is produced — keep it that way.
* On success, unblind the mint's signatures with the template's `r` values and the output secrets
  (the helpers next to `unblindSignature` do this) and hand the resulting proofs to the caller.
  **Do not persist them here** — the caller does, exactly as the cooperative path does.

Then wire the **outcome** side:

* `demo_outcome_sweeper.go`: for a `cashu_sigall_v1` lock use `demoMintSigAllSpend` with the deposit;
  for `cashu_lock_v1` keep the current cooperative call byte-for-byte. `resolve` already parks the
  recipient's proofs and posts `KindOutcome` — reuse that, do not duplicate it.
* The same for the cooperative outcome endpoints (`/api/demo/mint-settle`, `/api/demo/mint-refund`):
  a sigall lock must resolve through the pre-authorized template, never through a freshly
  constructed transaction. Return the named refusal when there is no stored deposit.
* Add the route to `/api/config` only if a sibling route is listed there today.

## 3. The wallet must actually post the deposit

`internal/poc/webwallet/src/wallet.ts` has `lockForBidSigAll`, `buildOutcomeTemplates` and
`outcomeTemplateCommitment` from wave 1. Add the one call that makes them real: the sigall bid path
posts the deposit to `POST /api/demo/sigall-deposit`, and the bid content carries both
`outcome_templates` and `sigall_deposit` (`SigAllBidCommitment`). Do **not** touch
`static/app.js`, the lab page, or the browser bundle — lab wiring and the live e2e are wave 3.

## 4. Tests (Go, `internal/poc/`)

* the deposit route: a good deposit is stored and returns a receipt whose signature verifies;
  each of the five §5 rules is refused with its rule named; a second deposit with different digests
  is refused; a deposit for a `cashu_lock_v1` receipt is refused.
* the deposit survives a reopen of its store.
* the submit path: with a stubbed mint, a settle submits exactly the template's inputs and outputs
  and the witness carries two signatures; a redirected output (destination changed) is refused
  **before** any mint call; a sigall lock with no deposit is refused.
* regression: a `cashu_lock_v1` receipt still resolves through the cooperative path unchanged.

## Ground rules

* Repo `/home/admin_maxime/work/auctions-simplify`, branch `maxime/auctions-mvp-simplify`.
* Go: `export PATH=/home/admin_maxime/.local/go/bin:$PATH`, `export GOWORK=off GOTOOLCHAIN=local`,
  `export GOCACHE=/home/admin_maxime/.hermes/profiles/maxime/cache/scratch/gocache`.
  `go build ./...` clean, `go vet ./internal/poc/` clean, `go test ./internal/poc/ -count=1` green
  before you report. If the TS wallet changes, `bun build src/browser.ts` must still bundle.
* Do **not** restart services, do not touch the demo network root, do not wipe or re-init, do not
  commit, do not push. The watcher commits and deploys.
* Files you may touch: `internal/poc/demo_sigall_deposit.go` (new), `demo_mint_spend.go`,
  `demo_outcome_sweeper.go`, `server.go`, `runtime.go` (store wiring), `sigall.go` (only if an
  interface must move), the new `*_test.go`, and `webwallet/src/wallet.ts`.
* Report: files touched, exact commands with raw output, and anything you could not verify.
