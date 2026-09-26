# ADR-0013: NUT-7 spend attribution — judge a spent proof by its witness, not by timing

## Status

Proposed

## Date

2026-09-26

## Context

Two facts about a bid's collateral were being conflated, and the code said so out loud:

- **A NUT-11 P2PK proof can be spent by two different parties.** Its `data`/`pubkeys` keys (the
  intended recipient — the seller, per the auction's `p2pk_xpub` path) can always spend it; once
  `locktime` has passed, its `refund` keys (the bidder) are **additionally** spendable — NUT-11:
  refund keys are _"additionally spendable"_ and the lock conditions _"continue to apply"_. So it is
  a race after a deadline, not a cutoff.
- **The mint reports only `SPENT`.** NUT-07's `checkstate` says spent / pending / unspent — never
  who spent.

`settlementDescriptor.ts` therefore inferred the spender from **when** the spend was first seen, and
named it: _"Settlement-aware NUT-7 spend masking (#11): `spent` is fraud before the seller settles,
but 'seller already redeemed' after a valid `settled` settlement exists."_ `bidValidation.ts` marks a
bid `invalid` on a spent leg with the same heuristic and a _"narrow post-settlement exception"_. And
`buildExpectedSettlementPayouts()` constructs its expected payout entries with `status: 'redeemed'`,
so redemption is asserted in the expectation before anything observes it.

Read together, the failure modes are:

1. **After a settlement exists, any spend is benign** — including a bidder's refund-path reclaim of a
   leg the settlement declares as redeemed;
2. **Before it, any spend is fraud** — including a redemption that legitimately happened first;
3. **Redemption is never observed**, only compared against the seller's own declaration.

The evidence that decides the question was arriving all along and being discarded: NUT-07 returns the
**`witness`** — _"the serialized witness data that was used to spend the Proof"_ — which for a NUT-10/11
proof is the signature data the mint accepted. Verified against the proof's own key sets, it answers
"who spent it" exactly.

Two limits are part of the decision, not caveats to it:

- **The NUT-07 response is not signed by the mint**, so no claim about _who answered_ or _when_ can be
  proven from it. What is verifiable is the claim _inside_ it: a signature over `sha256(secret)` by a
  key the mint would accept. Timestamping an observation is a separate concern.
- **Attribution needs the proof's secret**, and only the holder of the proofs has it. A third-party
  viewer reading a bid sees `proof_y` values (published precisely so state can be checked without the
  proof); the secret arrives with the release's token. So attribution is available to the bidder for
  their own bids, and to the seller (and any reader of the release) afterwards — and **absent**
  elsewhere, which is why the fallback below must be exact.

## Decision

**1. Keep the witness.** The NUT-07 client reads `witness` alongside the state
(`checkProofStateDetails` / `checkProofStateDetailsBatch`), attaching the caller's secrets so the two
travel together. The state-only helpers stay and delegate, so there is one request path and no
behaviour change for existing callers.

**2. Attribute the spend.** A pure module (`src/lib/cashu/spendAttribution.ts`) verifies the witness
signatures against the secret's own key sets and returns one verdict:

- `redeemed` — a signature verifies against a lock key (`data`/`pubkeys`): the intended recipient spent it;
- `reclaimed` — a signature verifies against a `refund` key: the payer took it back;
- `unattributed` — spent, but the evidence does not decide: no witness, an unreadable secret, a
  signature matching neither set, **or one matching both** (ambiguous, so never guessed);
- `unspent`, `pending`, `unknown` — the state, unchanged.

A refund-path signature is only treated as a reclaim when the locktime has passed (the path did not
exist before it) when the caller supplies the observation time.

**3. Judge by attribution where it exists, and by the old rule where it does not.** Consumers accept an
optional attribution map keyed like the existing state map:

- `reclaimed` **is never benign**: it disqualifies a bid and is not masked by the post-settlement
  exception, and a settlement whose winning chain contains a reclaimed leg is not `valid`;
- `redeemed` **is not fraud**: a leg spent by its lock key is the intended flow, and does not
  invalidate a settlement;
- `unattributed` (and the absent case) keep today's behaviour **exactly** — the disqualifying/masking
  behaviour a bare `spent` has today, because the evidence does not decide. Attribution only refines
  what it can decide; it never widens what counts as harmless.

**4. State the expectation as an expectation.** The expected-payout construction keeps its shape but is
documented as the expectation, with redemption decided by the observation.

## Consequences

- The spend-masking heuristic stops being the mechanism: the two facts (who, and when) are no longer
  inferred from one another.
- **No behaviour change where attribution is absent**, which is every mint that returns no witness and
  every viewer that holds only `proof_y`. This is deliberate: the change can only sharpen a decision it
  can make, never relax one it cannot.
- A reclaimed leg becomes a _named_ state rather than a benign one, which is the input any later
  "the recipient was not paid" surface needs.
- `unattributed` remains a first-class answer. Folding it into either side would recreate the bug this
  ADR removes — in the opposite direction.
- The first consumer that _produces_ attributions is the party holding the proofs: the bidder's own
  polling (given secrets) and, once released, the seller's. Validator and payout-observation work reuse
  the same verdict rather than inventing a second rule.

## Known limitations

- Attribution cannot identify _which_ bid a proof belonged to beyond the leg it was locked for; the
  verdict is per-proof, and the aggregate is per leg.
- Multi-mint legs are outside this decision (unchanged: single-mint by construction).
- Nothing here proves the _time_ of an observation, and nothing here makes a mint's answer
  self-authenticating. Both remain open by design.

## Amendments to other documents

- `ADR-0004` — the settlement descriptor's NUT-7 spend masking (§11) is superseded **where attribution
  is available**; the masking remains the fallback.
- `docs/adr/proposals/auction-v4v-participation.md` and the settlement packet
  (`docs/protocol/auction-multiparty-settlement-v1.md`) reference this ADR as the evidence rule for
  redemption, instead of defining their own.

Related: issues #1397 (keep the witness), #1398 (attribute a spend), #1399 (judge by attribution, not
timing), #1400 (the validator carries the same verdict).
