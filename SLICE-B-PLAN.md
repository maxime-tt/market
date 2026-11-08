# SLICE B — the SIG_ALL route: the coordinator may only submit one of two pre-authorized outcomes

Owner's choice: instead of a single-key P2PK lock where the committee's *witness* is unrestricted
(a free spend at the mint, constrained only by coordinator code), the lock requires the bidder and
the committee to sign **the whole transaction**. The signature then pins the outputs, so the
coordinator's power is exactly "submit one of the two outcomes the bidder pre-authorized", and
FROST later replaces the committee half behind a port rather than changing the protocol.

## What the live route does today (the thing B replaces)

`cashu_lock_v1`: NUT-11 P2PK to the single committee key, refund key for the bidder after locktime.
Verified facts that shape B:

* The committee key is a *witness*, not custody: the locked secret carries a 32-byte nonce, so the
  coordinator cannot derive it from the `Y` it is given (probed and confirmed), and it never sees
  the locked proofs at all today.
* Therefore neither party alone can move money during the window, and the bidder's browser must
  hand over the proofs (`secret` + `C`) at outcome time — that request is the only moment the
  coordinator holds spendable material.
* The cost of "bidder offline": the coordinator must hold the locked proofs between bid and
  outcome. That is unavoidable in any shape; SIG_ALL is what makes holding them *safe* — with a
  single-key lock the holder can spend anywhere, with SIG_ALL it can only submit the exact
  pre-signed transaction.

## Target design

**Lock (bid time).** main pubkeys `[bidder, committee]`, `n_sigs=2`, `sigflag=SIG_ALL`; refund
`[bidder]`, `n_sigs=1`; `locktime = original_end + max_extension + recovery`. New funding mode name
`cashu_sigall_v1` so the demo can run both shapes side by side.

**Templates (bid time, in the bid content).** The wallet builds the two exact outcome transactions
and signs both:
* `settle`: inputs = the locked proofs; outputs = blinded messages locked to the **auction's
  committed seller payout key**, conserving the locked amount.
* `refund`: inputs = the same; outputs = blinded messages locked to the **bidder's refund key**.
* The bidder constructs the outputs, so the destinations are provably right rather than asserted,
  and hands over the openings so the coordinator can unblind.
* The bidder deposits the locked proofs (`secret` + `C`) with the templates.
* Admission verifies, with no change to any existing state transition: amount conservation, settle
  destination == the create event's committed key, refund destination == the receipt's wallet key,
  both signatures over Nutshell's `SIG_ALL` message, and the input refs == the receipt's refs.

**Outcome (coordinator).** It submits the pre-authorized transaction for the committed outcome and
nothing else; its half of the signature comes through the committee port. It never constructs a
transaction. Then it parks the recipient's proofs durably (already built) and posts `KindOutcome`
(already built).

**The FROST seam.** One interface, one place:

```go
// CommitteeSigner is the only place the committee's half of a spend is produced.
// Today: one local secp256k1 key. Later: a 3-of-4 FROST aggregate behind the same
// method, with the same 33-byte public key, so the lock, the wallet and the mint
// see no difference. Nothing outside this port may touch committee key material.
type CommitteeSigner interface {
    PublicKey() string
    SignDigest(digest []byte) (signature []byte, err error)
}
```

## Slices

| # | Slice | Gate |
|---|-------|------|
| B0 | **Capability probe** (running): create and spend a 2-of-2 SIG_ALL lock on the live mint; one signature refused; destination pinned; accepted digest recorded | Must pass before B1 starts |
| B1 | Lock shape `cashu_sigall_v1` + committee port: wallet builds the 2-of-2 SIG_ALL lock, Go gains `CommitteeSigner` with the single-key implementation, receipt records the mode and both keys | B0 |
| B2 | Templates at bid time: build/sign/publish the two exact transactions, deposit the proofs, admission verification with refusals | B1 |
| B3 | Coordinator submits the pre-authorized transaction through the port, parks the payout, posts `KindOutcome`; refuses to construct anything | B2 |
| B4 | Lab wiring + honesty + live end-to-end: no browser open at close; seller fetches and spends; displaced refund likewise; one-signature and redirected-transaction refusals proven live | B3 |

## Honesty changes B forces (must ship with B4)

* `/api/config`'s `wallet_authority` and the lab page both currently claim the server never holds a
  bearer proof. Under B the coordinator holds the locked proofs from bid to outcome. The claim
  becomes: the bidder holds the funds until it bids, the coordinator holds them until the outcome,
  and under SIG_ALL it can only send them where the bidder pre-authorized.
* B also closes a limitation this repo has carried as unresolved
  (`LIMITATIONS.md`: "Exact browser construction of Nutshell's SIG_ALL digest necessarily handles
  the input proof secrets ... has not been activated or owner-approved"). The owner has now chosen
  this shape, so that line gets a dated note rather than staying open.

## Non-goals

* FROST itself: B1 only creates the seam and keeps the single key behind it.
* The relay/durability backlog (`PRODUCTION-DURABILITY-BACKLOG.md`) stays separate.
