# SLICE B1+B2 (wave 1, bid time) — the SIG_ALL lock, the templates, and the committee port

Read `SLICE-B-PLAN.md` and `SLICE-B0-SIGALL-PROBE-BRIEF.md` first. B0 is proving the mint
mechanics in parallel; build to the interfaces below, and if B0's evidence (it lands as
`~/.hermes/profiles/maxime/cache/scratch/audit-parent/sigall-probe.md`) contradicts the digest
convention, change the ONE function named in §3 and say so in your report.

## 1. New funding mode

`FundingModeCashuSigAll = "cashu_sigall_v1"` in `internal/poc/model.go`, next to
`FundingModeCashuLock`. It is **not** the Friday `threshold_sigall_v1` and must not touch the
`ApplicationAuthorityFrostCashu` gate or the FROST/Comet pipeline. Everything that
`cashu_lock_v1` gets (mint-backed admission, the cooperative endpoints, the outcome records)
applies to it too, plus the checks in §4.

## 2. Lock shape (wallet + receipt)

`internal/poc/webwallet/src/wallet.ts`, new method `lockForBidSigAll(amount, committeePublicKey, locktime)`:

* main key set: `[bidderSpendPublicKey, committeePublicKey]`, `n_sigs = 2`, `sigflag = SIG_ALL`
* refund key set: `[bidderSpendPublicKey]`, `n_sigs = 1`
* `locktime` exactly as `lockForBid` computes it today

Return the same `BidFunding` shape as `lockForBid` (so the existing lock receipt, refs, DLEQ and
locked-proofs plumbing is reused unchanged), plus the locked proofs for the template step.

The Go receipt (`internal/poc/demo_mint_lock.go`) gains the funding mode it was given. Keep the
existing `cashu_lock_v1` path byte-identical — this is additive.

## 3. The SIG_ALL digest — one function

Define it once in `internal/poc/webwallet/src/sigall.ts` (TypeScript) and once in Go (new file
`internal/poc/sigall.go`), with a comment naming each other, and a shared golden vector:

```
sha256( concat(input proof secrets, in the order the mint receives them) || concat(output B_ hex, same order) )
```

This is Nutshell's convention per `LIMITATIONS.md` ("the working fake-mint route uses Nutshell's
input-secret plus output-`B_` message"); cashu-ts derives a different one, so **do not use
cashu-ts's own SIG_ALL helper**. One function per language, one place to change.

## 4. Templates (bid time) — what the bidder publishes and what it hands over

The wallet builds the two exact outcome transactions for the locked proofs:

* `settle`: outputs locked to the **auction's committed seller payout key** (`seller_coco_payment_public_key` from the create event), conserving the locked amount.
* `refund`: outputs locked to the **bidder's refund key**, conserving the same amount.

For each, the wallet computes the digest (§3) and signs it with the bidder's spend key.

**On chain (bid content), public and compact:**

```json
"outcome_templates": {
  "schema": "PlebeianAuctionsPOCSigAllTemplatesV1",
  "deposit_id": "<the deposit receipt id>",
  "settle": { "digest": "<64-byte hex>", "bidder_signature": "<64-byte hex>" },
  "refund": { "digest": "<64-byte hex>", "bidder_signature": "<64-byte hex>" }
}
```

**Off chain (the deposit), because it carries the bearer `C` values:** the full template — inputs
(`amount`, `id`, `secret`, `C`), outputs (`amount`, `secret`, `r`), for both outcomes. The
coordinator stores it under `deposit_id` and can recompute both digests from it, which is what
makes the on-chain digests checkable.

Wallet API: `buildOutcomeTemplates(auction, funding)` → the deposit payload, and
`outcomeTemplateCommitment(...)` → the four field values above.

## 5. Deposit contract (wave 2 implements the endpoint; wave 1 produces and posts the payload)

```
POST /api/demo/sigall-deposit
{ "auction_id": "...", "bidder": "<nostr pubkey>", "templates": { "settle": {...}, "refund": {...} } }
  → 200 { "deposit_id": "...", "settle_digest": "...", "refund_digest": "...", "signer": "<application authority pubkey>", "signature": "<hex>" }
```

The coordinator verifies before storing, and refuses (422, naming the rule) when:

* either template's outputs do not conserve the locked amount
* the settle outputs are not all locked to the auction's committed seller payout key
* the refund outputs are not all locked to the receipt's wallet spend key
* either bidder signature does not verify over that template's digest
* the templates' input refs are not the receipt's refs

Admission (`ValidateForMempool`) then requires, for `cashu_sigall_v1` only:

* the bid carries `outcome_templates` with the right schema
* both digests match the stored deposit the `deposit_id` names, and the deposit's receipt
  signature verifies
* the deposit names this auction and this bidder

## 6. Committee port — the FROST seam

New file `internal/poc/committee_signer.go`:

```go
// CommitteeSigner is the only place a committee spend signature is produced.
// Today: one local secp256k1 key. Later: a 3-of-4 FROST aggregate behind the
// same method and the same 33-byte public key, so the mint, the lock and the
// wallet see no difference. Nothing outside this port may touch the key.
type CommitteeSigner interface {
    PublicKey() string
    SignDigest(digest []byte) (signature []byte, error)
}
```

Single-key implementation reads the existing committee key. Route the **spend** signature in
`internal/poc/demo_mint_spend.go` through the port (that is the one that becomes a FROST
threshold signature). Leave the lock-receipt signing as it is for now and note it in your report
as a later unification.

## 7. Tests (Go, in `internal/poc/`)

* the SIG_ALL digest function matches the shared golden vector
* a `cashu_sigall_v1` receipt commits with the two-key condition and the mode recorded
* admission refuses a `cashu_sigall_v1` bid with no templates, with a mismatched digest, with a
  deposit that names another auction, and with a deposit whose signature does not verify
* the deposit endpoint refuses each of the five rules in §5, naming the rule
* a `cashu_lock_v1` bid is unaffected (regression)

## Ground rules

* Repo `/home/admin_maxime/work/auctions-simplify`, branch `maxime/auctions-mvp-simplify`.
* Go: `export PATH=/home/admin_maxime/.local/go/bin:$PATH`,
  `export GOCACHE=/home/admin_maxime/.hermes/profiles/maxime/cache/scratch/gocache`.
  `go build ./...` clean and `go test ./internal/poc/ -count=1` green before you report.
* Do not restart services, do not touch the demo network root, do not wipe or re-init, do not
  push, do not commit. Wave 2 owns the coordinator-side files (`demo_outcome_sweeper.go`,
  `demo_sigall_deposit.go` route, swap submission) — do not edit them.
* Report: files touched, exact commands, raw output, and anything you could not verify.
