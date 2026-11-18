# DECISION — refused bids are not committed; the app diagnoses, and never invents a reason

**Owner ruling, 2026-11-18.** Recorded by the app-side session; the chain-side session implements
nothing from this.

## The rule

**No refused bid is ever committed to the chain.** Bid admission stays strict: a bid that fails
`CheckTx` is discarded there and leaves no state. The chain's block space must not be purchasable by
spamming bids, and the cheapest attack — many low-value or fake bids — is exactly what strict
admission refuses for free.

The chain therefore publishes **no** kind-1450 for a refused bid, and the app must never present one.
This is deliberate, not a gap to close.

## Why (the taxonomy the ruling rests on)

The failures a bid can hit fall into two groups, and the dangerous ones and the informative ones do
**not** overlap:

1. **Stateless failures** — decided from the bid alone, no committed state: DLEQ missing or forged
   (no proof of funds), proofs not signed by the mint, proofs that do not total the amount, a proof
   reused, a bad SIG_ALL template, a locktime below the floor, a stale committee key, mixed keysets.
   These are the attack surface, and they are cheap to reject at admission. An honest client cannot
   produce them — they are version skew or malice.
2. **State-dependent failures** — decided against committed state: below the current minimum, lot
   closed, seller bidding, already the highest, and the race case (published a second before the
   end, so it lands under the minimum). These are legitimate bids whose funds are real and locked.
   **This class already has a home:** it is the late-bid family, admitted as `late: …`, recorded in
   committed state, and refunded through the receipts (`1443`).

So the cases a user needs explained are already recorded, and the cases that are not recorded are the
ones no honest client can reach.

## What the app does instead (option C, with the diagnosis made explicit)

Both the client and the validators watch the same relay, so the client can distinguish three states
from what it already reads — no new chain mechanism:

- **Committed** — the bid is in committed state (or a receipt names it): the bid is live. Nothing to
  say.
- **On the relay, not committed, and the chain is advancing** (fresh kind-1447 commitments across
  several blocks): the chain saw it and did not accept it. That is **not** a network problem, and the
  app must say so — "the chain has not accepted this bid" — with the escrow's locktime and the
  existing reclaim affordance, because the funds are locked until then and the bidder can take them
  back.
- **The chain is not advancing** — no fresh commitments: that **is** an infrastructure problem, and
  the honest statement is that, not a claim about the bid.

The app never invents a reason it cannot verify.

## Deferred, not rejected: the observer note

If naming the reason itself is ever wanted, the shape to design is an observer note published by the
validator that ingested and refused the event — **not** a signed claim from the publisher (which could
tell a winning bidder their bid was refused, and would need a side channel from `CheckTx` to a
publisher that reads committed snapshots only, by design).

Two constraints are recorded with it so they are not discovered later:

- **It cannot be ephemeral on this deployment.** Measured twice: `nak req -k 21447 wss://relay.playday.it`
  for 20-25 s receives nothing while the publisher emits ~4/s, a deliberate publish of an ephemeral
  event with a live subscriber connected is answered `mute: no one was listening for this`, and the
  relay stores zero of them. A stored note is the only workable form — small, but not free.
- **It must be an observation, never an authority.** The client checks committed state first and uses
  the note only to explain an absence, and any per-pubkey volume of notes needs a bound so the
  explanation channel cannot itself become the spam channel.

## What this changes for the app lane

Phase F (reading kinds 1449/1450) proceeds unchanged: a **create** refusal is committed and published,
so a refused lot can be named. For **bids**, the app implements the three-state diagnosis above and
says nothing about a reason it cannot see.
