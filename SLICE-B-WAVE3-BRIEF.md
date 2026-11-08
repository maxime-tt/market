# SLICE B WAVE 3 (B4) — lab wiring, honesty, and the end-to-end proof

Waves 1 and 2 are committed and green (`041238c00`, `7c511b9e5` + three fixes), B0 proved the mint
mechanics live, and the binary is deployed. What is missing is that **no user-facing path uses the
new route**: `lab.js` still creates `cashu_lock_v1` auctions and the honesty text still describes
the old custody story.

Read `SLICE-B-PLAN.md`, `SLICE-B-WAVE1-BRIEF.md` and the wave-2 code first
(`internal/poc/sigall.go`, `internal/poc/demo_outcome_sweeper.go`, the deposit route) so the UI
drives what actually exists rather than what you would have designed.

## 1. Lab wiring (the UI update)

`internal/poc/static/lab.js` + `lab.html`:

* the create form lists the new mode `cashu_sigall_v1` and the lab defaults to it
* the bidder flow becomes: `wallet.lockForBidSigAll(...)` → `wallet.buildOutcomeTemplates(...)` →
  `POST /api/demo/sigall-deposit` → the bid event carries `outcome_templates` (the deposit id, both
  digests, both bidder signatures) → `POST /api/event`
* the bidder panel says plainly what is now true: **the authorizations are published, so this tab
  may be closed; the coordinator will act on the outcome you pre-authorized**
* the seller panel keeps its import, and its copy stops implying the payout depends on anyone being
  online
* `internal/poc/static/app.js` (the dense page) may keep `cashu_lock_v1` — say so in your report if
  you leave it, rather than silently diverging

## 2. Honesty pass B forces

Ship these together with the code, in the same commit:

* `internal/poc/server.go`'s `wallet_authority` string: the server now holds the locked proofs from
  the bid to the outcome. The honest sentence is that the bidder holds the funds until it bids, the
  coordinator holds them until the outcome, and under SIG_ALL it can only send them to the
  destination the bidder pre-authorized — the digest commitment is what makes that checkable.
* `lab.html`'s "What is real here?" panel: same change, in the lab's voice, plus one line that the
  coordinator's half of the spend comes through a port that FROST will sit behind.
* `index.html` if it repeats the old claim.
* `LIMITATIONS.md`: add a dated note that the unresolved line "Exact browser construction of
  Nutshell's SIG_ALL digest necessarily handles the input proof secrets ... has not been activated
  or owner-approved" is now **resolved by owner decision** (the owner chose this shape), and that the
  accepted digest form is Nutshell's `secret + B_` — cashu-ts's own SIG_ALL builder is refused by
  our mint, per the B0 probe evidence.

## 3. The end-to-end proof (the point of the whole slice)

Write it as a runnable script next to the existing probes
(`~/.hermes/profiles/maxime/cache/scratch/audit-parent/`) and run it against the live demo, with
**no browser open at close**:

1. create a `cashu_sigall_v1` auction with the seller's committed payout key
2. a bidder wallet locks, builds both templates, deposits, and bids — then the wallet object is
   **discarded** (nothing of it is used again)
3. the auction closes; the coordinator settles from the deposit alone, and the outcome record
   commits
4. a **freshly constructed** seller wallet fetches the payout and **spends it at the mint** (the only
   step that proves money moved)
5. the same for a displaced bidder's refund, with the displaced bidder's wallet discarded
6. the refusals, live: a one-signature spend is refused by the mint; the coordinator refuses a
   redirected output; a bid with no deposit is refused at admission

Record raw output per step with PASS/FAIL, like the B0 evidence file.

## 4. Verify and deploy

* `go build ./...`, `go vet ./internal/poc/`, `go test ./internal/poc/ -count=1` (and `./...`)
* the bun bundle rebuild for `static/wallet.js` if `wallet.ts` changed
* deploy: copy the running binary aside as `poc.bak-pre-wave3`, build from the **clean committed
  tree**, install, restart `auctions-mvp-demo.service`, then verify the served `/lab.html` is
  byte-identical to the committed one and the demo is healthy (validators 4/4, `/api/state` 200)
* tell the parent **before** restarting the demo service, or leave the deploy to the parent and say so

## Ground rules

* Repo `/home/admin_maxime/work/auctions-simplify`, branch `maxime/auctions-mvp-simplify`.
* Go is not on PATH: `export PATH=/home/admin_maxime/.local/go/bin:$PATH`,
  `export GOCACHE=/home/admin_maxime/.hermes/profiles/maxime/cache/scratch/gocache`.
* Do not touch the demo network root, do not wipe or re-init, do not use the real committee key in
  a probe, do not push (the parent commits and pushes).
* No backwards compatibility is owed: this is a demo whose chain gets wiped. Refuse at admission
  rather than changing an existing transition.
* Report: files touched, exact commands, raw output, and anything you could not verify.
