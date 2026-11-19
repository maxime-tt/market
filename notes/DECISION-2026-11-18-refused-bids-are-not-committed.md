# DECISION — refused bids are not committed; the app diagnoses, and never invents a reason

**Owner ruling, 2026-11-18.** Recorded by the app-side session; the chain-side session implements
nothing from this.

## The rule

**A bid refused at admission is never committed to the chain.** Bid admission stays strict: a bid that
fails `CheckTx` is discarded there and leaves no state. The chain's block space must not be purchasable
by spamming bids, and the cheapest attack — many low-value or fake bids — is exactly what strict
admission refuses for free.

**The boundary, measured on the live relay (2026-11-18, 36 kind-1450 events): 24 name a kind-1441.** The
chain *does* record a bid it refuses **at delivery** — the late family, the block-time locktime floor
(`locktime below the floor for this lot: 1794924019 is under 1794924021`), a duplicate
(`bid already recorded`). What it never records is a bid refused at **admission**, where the dry run
rejects before a block exists and there is no committed state to anchor a refusal to. So:

- a refusal the chain **recorded** is committed state, and the app **must** state it, with the chain's
  own words verbatim (kind 1450 naming the bid);
- an **absent** refusal is *no refusal read* — never "accepted", and never a reason the app supplies.
  That is not a gap to close; it is the ruling.

## Why (the taxonomy the ruling rests on)

The failures a bid can hit fall into two groups, and the dangerous ones and the informative ones do
**not** overlap:

1. **Stateless failures** — decided from the bid alone, no committed state: DLEQ missing or forged
   (no proof of funds), proofs not signed by the mint, proofs that do not total the amount, a proof
   reused, a bad SIG_ALL template, a locktime below the floor, a stale committee key, mixed keysets.
   These are the attack surface, and they are cheap to reject at admission. An honest client cannot
   produce them — they are version skew or malice.
2. **State-dependent failures** — decided against committed state: below the current minimum, lot
   closed, seller bidding, already the highest, the block-time locktime floor, a duplicate bid, and the
   race case (published a second before the end, so it lands under the minimum). These are legitimate
   bids whose funds are real and locked, and they are admitted as `late: …` or decided at delivery, so
   they **are** recorded in committed state and published as kind-1450 — the app states the chain's
   reason verbatim.

So the cases a user needs explained are recorded and shown, and the cases that are not recorded are the
ones no honest client can reach.

## What the app does instead (option C, with the diagnosis made explicit)

Both the client and the validators watch the same relay, so the client can distinguish three states
from what it already reads — no new chain mechanism:

- **Committed** — the bid is in committed state (or a receipt names it): the bid is live. Nothing to
  say.
- **Refused and recorded** — a kind-1450 names the bid's event id: the app states the chain's reason
  verbatim, with the escrow's locktime and the reclaim affordance.
- **On the relay, not committed, and the chain is advancing** (fresh kind-1447 commitments across
  several blocks): the chain saw it and did not accept it, and recorded no refusal. That is **not** a
  network problem, and the app must say so — "the chain did not accept this bid" — while stating that it
  does not know why and will not invent a reason, with the escrow's locktime and the existing reclaim
  affordance, because the funds are locked until then and the bidder can take them back.
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
so a refused lot can be named, and so is a **bid** refusal the chain decided at delivery. For a bid with
no recorded refusal the app implements the three-state diagnosis above and states no reason it cannot
see.
