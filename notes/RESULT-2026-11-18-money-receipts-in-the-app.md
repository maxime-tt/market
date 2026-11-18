# RESULT — the app reads the chain's money receipts, live (Phase B)

**Written** 2026-11-18 by the app-side session. **Base:** `unite/1420-all` @ `deb3dcb80`.
**Chain side:** `MONEY-RECEIPTS-2026-11-18-RESULT.md` (kind 1443/1444 receipt events, deployed).

---

## 1. What landed

- `platform/web/auctions/relay/arenaReceiptsRead.ts` (+ tests): parses kind **1443** (`arena.refund.v1`)
  and **1444** (`arena.settle.v1`) with the app's verdict discipline — signature, schema, mandatory
  anchor whose tag `height`/`hash` agree with the content `height`/`block_hash`, roster membership —
  refusing each failure by a named sentinel (`bad_kind`, `bad_signature`, `bad_schema`, `bad_content`,
  `unanchored`, `bad_anchor`, `anchor_mismatch`, `signer_not_in_roster`). Dedupes by `(bid_id, outcome)`
  at the **earliest** anchored height. `params_version` is recorded and flagged on mismatch, never a
  refusal: the signature, the roster and the anchor are the gate.
- Both kinds wired into the read (`ARENA_READ_KINDS`, `arenaAuctionFilters()`) and attached to the
  auction views; refusals counted in relay health like every other kind.
- Display as **receipts, distinct from claims**: per position `refunded at height N`, per lot
  `paid <sum> sats to <n> destinations at height N`, and **`no receipt read`** when none arrived — never
  "not paid". `bidGroupStatus` reports `refund_received` off a refund receipt, with no reclaim offered
  for money already returned.

## 2. Two defects found by verification, both fixed here

**2.1 A create that states its identity only in the `d` tag was refused.** The app required
`content.auction_id` on every kind-1440. The chain's own client writes the identity once, in the tag, so
**21 of 25 creates on the live relay were refused** and every lot created by that client — including the
two that carry the first receipts — could not be opened. `MERGED-PROTOCOL-SPEC.md` §8 settles the
meaning: `auction_id` **is** the `d` value, and 1440 is a regular kind, so the `d` is the only stable
address for later versions. A create may now state it once (tag) or twice (must agree, still refused
otherwise); a create that states no `d` at all is still refused. `4702c9e6e`.

**2.2 The read asked for all six kinds in ONE filter, and the commitment heartbeat filled it.** A relay
caps a filter's response (khatru: 500 events). With a kind-1447 commitment every ~10 s from each of four
validators, the newest 500 events were **all commitments**: the list rendered **one** cached lot while
the relay held 36 creates. The filters are now one per kind group with their own bounds — creates and
bids 500, receipts 200, verdicts 200, commitments **60** (the clock needs the newest readings, not the
history) — pinned by a test so a future "simplification" back to one filter fails instead of silently
emptying the list. `deb3dcb80`.

## 3. Verified live (measured, not claimed)

- The app's own decoder, run over every 1443/1444 event pulled from `wss://relay.playday.it`
  (12 events at the time): **12/12 parsed**, deduping to **3 moves** — one refund (100 sats, 3 outputs,
  height 1276) and two settles (100 sats at height 1283, 110 sats at height 1296) — totals correct,
  `params_version` matching, the chain's uppercase `block_hash` accepted and normalised.
- The deployed page now lists **37 lots** (was 1) with the honest incomplete-read banner, and the two
  receipt-bearing lots render the money facts:
  - `instant-settle-1794997171425` → **"paid 100 sats to 3 destinations at height 1283"**;
  - `instant-refund-1794997165950` → **"refunded at height 1276"**, plus its later settle
    **"paid 110 sats to 5 destinations at height 1296"**.
  A verdict still reads as a claim ("outcome: winner (relay-reported)"), a receipt as money that moved.
- Zero `/api/auctions/*` requests on either page.

## 4. Gates

Unit **4844 pass / 1 skip / 2 fail** (the two pre-existing failures: `Platform dependency boundary`
and the `F4` deferred-fix record), `bun test ui` 992 pass / 1 fail (same F4), `tsc` **185** (unchanged),
ui-assembler 132 (baseline 138), src-boundary and auctions-ndk-surface OK. Nothing weakened.

## 5. What is still open

- **Phase C** — the wallet claiming the `out[]` proofs from these receipts (increment 8). The proofs are
  now on the relay, P2PK-locked to the recipient, which is exactly what that increment needs.
- **Phase D** — the order-management surfaces: a win projected into the existing orders table, and
  `AuctionClaimDialog` publishing only the private claim message for arena lots. Needs the owner's nod on
  that shape (recorded in `PLAN-2026-11-18-to-full-e2e.md` §D4).
- **Phase E** — the full lifecycle e2e (outbid → refund → close → settle → claim → seller sees the
  address). Every link now exists; the remaining work is the claim watcher and the order screens.
- **The 27 settlements that predate `SettledHeight`** cannot be receipted (the chain never recorded their
  block time) — the chain refuses them by name rather than inventing an anchor, which is the right call.
