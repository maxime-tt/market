# SLICE-E-BRIEF — the escrow synthesis: bidder consent *and* consensus-verified backing

Owner decision: take BOTH properties. The bidder stays a co-signer inside the
mint-enforced lock (destination constrained cryptographically, pre-signed at bid
time, nobody online at close), AND every validator verifies DLEQ and the proof
sum inside consensus (no single party attests that a bid is funded).

The two are orthogonal. The 2-of-2 lock constrains WHERE value may go; consensus
DLEQ proves THAT it exists. Neither blocks the other.

## Why it works at all

B can verify DLEQ inside consensus because **the proofs are in the transaction**.
Ours is not, which is the sole reason one party ends up attesting the backing.
So the enabling change is: the bid event carries the proofs; consensus verifies
them. The lock is untouched.

## The stacked condition

- Mint-facing lock: NUT-11 **2-of-2 SIG_ALL over `[bidder, committee]`**, refund
  `[bidder]` after the locktime. Unchanged from `cashu_sigall_v1`.
- The committee key is the FROST 3-of-4 group key behind the `CommitteeSigner`
  port. Unchanged shape; a single key today.
- Spending therefore needs the bidder's pre-signature **and** the committee's
  signature. The requirements multiply.

## ACCEPTED RESIDUAL — state it, do not bury it

With the destination constrained, a committee majority can no longer drain to an
arbitrary address. The residual is:

> **Committee majority PLUS a victim that bids on the attacker's own auction.**
> The victim pre-signs a settle template paying *that auction's* seller. A
> malicious supermajority submits that settle even though the victim did not win,
> and the escrowed value goes to the attacker's seller key. This is theft, not
> delay: once the settle spends the proof the victim's post-locktime refund path
> is dead, because the value is gone.

Bounded by: the auction's own committed seller payout key, and the bid amount.
Owner has accepted this risk explicitly. It is recorded here so the design states
its own worst case rather than leaving it for an auditor.

Two things that keep it honest:
- On THIS implementation the committee is still a single key, so today the
  residual is "one key plus the bidder's pre-signature", not "3-of-4". Say which
  is deployed; never imply threshold custody while `CommitteeSigner` holds one key.
- Timing cannot close it. The lock's `locktime` bounds only the *refund* branch;
  the main branch has no expiry, so a committee can settle late as easily as
  early. Do not propose a "refund-first window" against this lock shape.

## Frozen interfaces

`Params` / network manifest gains the pinned mint identity, at genesis:

| field | json | meaning |
|---|---|---|
| Mint keyset id | `keyset_id` | the keyset every proof must name |
| Mint keys | `keyset_keys` | amount (decimal string) → mint public key (compressed hex) |

Derived convenience: `keysetKeyForAmount(amount) (string, bool)`.

`bidContent` gains:

| field | json | meaning |
|---|---|---|
| Proofs | `proofs` | the bearer proofs backing this bid: `amount`, `id`, `secret`, `C`, `dleq` |

A bid that carries `proofs` MUST be admitted only when all of the following hold,
checked in `ApplyTransaction` so every validator agrees:

1. the auction is open and the bidder is not the seller;
2. every proof's `id` equals the pinned `keyset_id` — else refuse `proof from unpinned keyset`;
3. every proof has a pinned key for its amount — else refuse `bad proof amount`;
4. every proof's DLEQ verifies against that pinned key — else refuse naming the rule;
5. the proof amounts sum to the bid's `amount` — else refuse naming both totals;
6. no proof reference has already been committed by another bid, across every
   auction (the existing reuse guard, unchanged);
7. the lock parses as EXACTLY the 2-of-2 SIG_ALL shape: main pubkeys exactly
   `[bidder, committee]` in that order, `n_sigs = 2`, `sigflag = SIG_ALL`, refund
   pubkey exactly `[bidder]`, locktime at or above the auction's `required_locktime`,
   no extra keys, no duplicate keys, no escapes, lowercase hex. Anything else is
   refused by name.

The lock parser must be **strict and differential**: accept the one shape and
reject every near-miss, because a validator and the mint reading the same secret
differently is the bug class that cost the peer repo a fix (their A1). Port the
*shape* of their parser tests (crafted secrets, uppercase hex, duplicated keys,
tag order) rather than only the happy path.

## Waves, with exclusive file lists

- **E1 — the consensus core.** `internal/poc/model.go` (Params/manifest fields,
  `bidContent.Proofs`, admission rules 1-6, `keysetKeyForAmount`),
  `internal/poc/dleq.go` (reuse the existing verifier; no new crypto),
  `internal/poc/demo_mint_lock.go` (the strict 2-of-2 parser, rule 7),
  manifest plumbing in `internal/poc/network.go` + `runtime.go` if the pinned
  keyset must be written at init, and their `_test.go` files. Tests must cover
  every rule 1-7 by name, plus the differential lock-parser set.
- **E2 — the deposit excision.** Remove `POST /api/demo/sigall-deposit`, the
  bearer deposit store, and the coordinator's template reads that exist only
  because consensus lacked the material. `demo_sigall_deposit.go`,
  `demo_sigall_deposit_test.go`, the caller in `demo_outcome_sweeper.go`, and the
  page's deposit step. E1 must land first: nothing may be deleted before the
  proofs are actually in the committed state.
- **E3 — the page and the wallet.** `internal/poc/static/lab.html`, `lab.js`, the
  create form's keyset/params surface if any, the bid path (send proofs instead of
  a deposit), and the rebuilt `static/wallet.js` via the project's own build script.
- **E4 — the release check.** Each validator re-checks policy and authorization
  against its own committed state before contributing a signature, behind the
  `CommitteeSigner` port. Say plainly in the code that this catches non-colluding
  faults and does NOT stop a hacked majority.

Rules for every wave: build with `go build ./...` from the repo root, `go test ./...`
green, never restart or stop `auctions-mvp-demo.service`, never run `poc init` or
`start-demo.sh`, never commit — the parent verifies and deploys. A State or
manifest shape change means the next deploy is a **wipe and re-init**, which the
owner has already approved; do not write any migration path.

## Definition of done

Every rule pinned by a named test; the deposit machinery gone; the live e2e run
green: create → bid whose proofs are verified in consensus → outbid with the whole
position returned → collect → re-bid → close with the bidder offline and the
coordinator settling to the seller, who spends the payout at the mint. Plus one
refusal test driven through the API for a bid whose proofs do not sum to its
claimed amount, and one for a lock that is not exactly the 2-of-2 shape.
