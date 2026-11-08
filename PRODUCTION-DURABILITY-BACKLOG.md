# Production durability — what is still unbuilt, and where the line is

The demo makes a real money path work (mint, bid, outbid refund, close, settle, seller payout,
all verified live). What it does **not** have is the durability discipline a production
deployment needs. That is a deliberate line, not an oversight, and this file is the backlog for
it so nothing is forgotten or smuggled into a smaller change.

## The line

**In this slice (small, contained):** the settlement payout is written to
`<network root>/settlements/<auction_id>.json` (mode 0600, atomic temp+rename) instead of living
only in a process map. Those proofs are P2PK-locked to the *seller's* key, so storing them is not
custody — it is survivability. This narrows "any restart loses the payout" to "a crash in the
window between the mint's response and the rename".

**Not in this slice (the backlog below):** everything that needs a journal, a cursor, or a
recovery protocol. Crucially, the file-backing does **not** close the window completely, and
cannot: cashu swaps have no restore primitive for the output side (NUT-09 restores mint quotes,
not swaps), so the only true fixes are write-ahead intent plus detection, which is item 1 below.

## Backlog

1. **Crash-safe money operations.** Persist the swap *intent* (inputs, blinded outputs, blinding
   factors) before calling the mint. On startup, detect an in-flight swap by querying the inputs'
   proof states: inputs SPENT with no recorded payout means the outputs were lost — flag it loudly
   as a loss with the exact amounts, never a silent success. A production system should be able to
   say "we lost X sats in an operation that died at step N", not just hope.
2. **Durable relay and real catch-up.** Today the observer subscribes with `since=beginning` against
   an **in-memory** relay: a relay restart is a silent gap, and a bid that never reached the app was
   never committed anywhere. Needs relay storage that survives restart, a persisted per-validator
   subscription cursor, gap detection, and dedupe by event id. The chain is the durable record, but
   the relay is how bids *become* durable, so its gaps are lost bids, not just lost history.
3. **Persisted browser wallet state.** Half-signed and in-flight operations: pending mints (quote id
   + blinding factors), pending locks, pending swaps. Today the lab persists identities and locked
   bids under a versioned namespace (this slice); in-flight operation recovery is not there.
4. **Coordinator restart mid-operation.** Every mutating endpoint should take an operation id and be
   idempotent, with explicit resume-or-abandon rules, so a retry after a crash cannot double-swap or
   double-record.
5. **Key management.** The committee key is a file in the network root. Production wants it held
   where a file read does not grant spend authority. This is where FROST and FIPS belong.
6. **FROST.** 3-of-4 threshold committee replacing the single key. Contained at the seam — the
   mint-facing object is a 33-byte pubkey and the signatures are byte-identical — but it still needs
   a DKG, share custody, a signing coordinator, and liveness rules for share holders.
7. **Real payment backend.** The mint is real Nutshell but FakeWallet-backed: no Lightning. A real
   backend needs BOLT11 lifecycle (expiry, retry, partial payment), and refund-on-failure semantics.
8. **Reconciliation.** The chain and the mint drift today: a mint-backed refund swaps the money and
   commits nothing, so committed state can read `refundable` for proofs the mint has already spent
   (the new `KindOutcome` record fixes the mechanism; reconciliation would *detect* the drift, not
   just prevent it). A periodic report comparing chain lock status against mint proof states is the
   cheap version of this.
9. **Relay policy and fan-out.** Anyone can publish to the relay today; the chain refuses what is
   invalid at admission, which is the honest backstop, but production wants authenticated publishing
   and multiple relays with failover and per-relay cursors.
10. **Validator operations.** Four validators on one host, one operator, no FIPS transport. Real
    deployment wants separate hosts, independent keys, monitoring, and an upgrade path that does not
    stop the network.
11. **Retention.** Blockstore retention is 24h for the demo; the intended window is 30 to 90 days.
    The 1s block interval stays — fine-grained ordering is the point.

## Why this order

Items 1 and 2 are the ones that can lose or silently drop *money* and *bids*, so they come first
when durability work starts. Item 6 (FROST) is the one that changes the trust story, and it is
independent of durability: it changes who signs, not who consents, and not what survives a crash.
