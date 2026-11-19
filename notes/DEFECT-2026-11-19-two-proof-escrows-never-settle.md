# CHAIN DEFECT — a 2-proof escrow never settles and never refunds (live, money-path, P0)

Measured on the live deployment 2026-11-19 ~11:23 UTC, chain height 2893, by the app-side session
while verifying Phase E. **This is the money path: real escrows are locked with a due outcome and no
settlement, and the chain retries them against the mint forever.**

## The rule, exactly

From committed state (`GET http://127.0.0.1:8090/api/state`), grouping every bid by how many proofs its
escrow holds:

- escrows that **have settled** — proof counts **1 (19 bids), 3 (13), 5 (10), 6 (1)**
- escrows with a **due outcome and no settlement** — proof counts **2 only (12 bids)**

**The sets do not overlap.** Every stuck bid is a 2-proof escrow; every settled bid is 1, 3, 5 or 6.

Quantified at that moment: **12 bids, 888 sats**, being 9 winners awaiting `settle` (only the winning bid
of a closed auction pays out) and 3 losers awaiting `refund`. Amounts were 72 (64+8) and 80 (64+16) —
the two-proof shapes. Examples:

- `a5fe7c6b27eff87d88d23f79b94e6f73cca8762c03db7e0e080b462839a778fe` — `settle`, 80 sats, lot
  `1440:ac1c0fba90816891f6a6886c755cb81bdec7c69b0c67db10d0f991f8f63fd0a6:wsl-lifecycle-mwng8kks-2zs5hw`
  (the Phase E lot: it closed, the winner is named, and the winner's escrow is stuck)
- `2d211702d2735164147c4b5014fa189018fa1e2f0005489bb7d4b88cc7ebf39d` — `refund`, 72 sats, same lot
- `0036d1cf0a69af9c444bc33b44bc5631de1966f4af61ade6bc751f7c78006090`, `7ef133f438d2…`, `8611f5a6d627…`
  — `settle`, 72 sats, other lots

## The evidence trail

- **The mint refuses.** `POST /v1/swap` answers **HTTP 400** for these attempts. The mint's journal
  (`auctions-demo-mint.service`) shows, in lockstep with the chain's attempts:
  `ERROR | Error in session trial: 1 (…): 72` then `ERROR | Exception: 72` then
  `INFO | POST /v1/swap HTTP/1.1 400`. `/v1/checkstate` answers **200** for the same proofs, so the
  escrow is unspent — the swap itself is what is refused.
- **Neither side logs the refusal.** The mint prints only the **amount** as the exception text, and the
  chain logs only `settle settle a5fe7c6b27ef: mint swap: 80` (`run/chain.log`) — no HTTP body, no
  reason. **That logging gap is itself a defect**: the single most important failure on the money path
  is undiagnosable from either log, and this took hand-forensics to localise.
- **The settler never gives up.** `run/settle-journal.jsonl` holds **732 entries**, of which only 67
  carry proofs (a completed settle). The stuck bids are journaled over and over — e.g. `a5fe7c6b…`
  attempted continuously from 11:15 to 11:20+, and `df4b4e00be58…` from 11:19 to 11:22 — every few
  seconds, forever.
- **The settled records are single-outcome and structurally fine.** A completed entry carries `sig` and
  `proofs`; a failing entry carries neither, only `outputs`, `reveal` and `bidder_sig`.

## What it is NOT (ruled out by measurement)

- **Not the FROST group key.** All 500 kind-1448 params events read carry `group_key 03be47f12cc26f63cedb617e…`
  and `params_version 71ca57eb…` — unchanged; no key regeneration, no epoch change.
- **Not the mint being down or a keyset rotation.** `/v1/info` answers (Nutshell 0.21.0, FakeWallet) and
  the keyset the escrows use, `0102b930f4dc2d6a8cb29b56e30d3e16436337859f54b77849ad1a1297be2880a1`, is
  **active**.
- **Not the locktime.** Refunds of single-proof escrows have succeeded well before their locktime, so the
  floor is not blocking spends in general.

## Not yet proven — do not assume it

- The chain service was **restarted at 10:50:19 today** (`systemctl --user restart arena-chain.service`).
  Settles did succeed before and after that restart (7 completed since 10:50), and the stuck ones span
  both sides of it, so the restart is **not** established as the cause. It is a correlation worth ruling
  out deliberately.
- The mechanism that makes **exactly two** the fatal count is unknown. The hypothesis space worth checking
  first: the SIG_ALL witness is built over the inputs (or the sorted `C` values) in an order that only
  diverges for an even, non-trivial count — e.g. a pairing/merging loop that mishandles a single pair —
  or the ideal-swap merge for two inputs produces an output set the pre-signed template does not cover.
  Since 1 is trivial and 3/5/6 work, a two-element specific path is the thing to look at.

## What to do

1. **Reproduce it deterministically**: fund an escrow with exactly two proofs, outbid it (refund due) and
   separately let one win (settle due), and watch the mint answer 400. A two-proof escrow should be the
   entire repro. Then bisect by proof count (2 works, 3 works) to find the boundary.
2. **Fix the cause.**
3. **Log the refusal detail on both sides** — the chain must log the mint's HTTP status and body for a
   failed swap, and the settler should record the named error in `settle-journal.jsonl` next to the
   attempt, not only the payload.
4. **Make a persistent failure visible.** Retrying every few seconds forever with no escalation is how
   888 sats sat locked with nobody noticing. Consider surfacing a refusal as a kind-1450-shaped fact, or
   at minimum a loud, counted health signal on the gateway.
5. **Then re-run the app-side Phase E lifecycle test** (`~/work/wt-app-e`, `d7s2/app-lifecycle`) — its
   settle step is blocked by exactly this, and everything before it (create, bid, outbid, instant refund,
   the claim, the extension asserted from kind 1449, the verdict, the create-refusal 1450) already passes
   from the wire.

## Housekeeping

The 12 stuck bids are on live lots including the throwaway `wsl-lifecycle-*` and `wsc-claim-*` app-test
lots. Whether to backfill them once the fix lands is your call; the app-side test lots can be discarded.
