# B — the read realignment to the consolidated protocol

Branch: `d7s2/arena-realign-read`, off `df68b6f26` (the chain tip, union + 27).
Commit: **`7621a35e4ceb80d4bd3418ecbd1e1acb55c7f8ec`** — pushed to **`fork` and `nostr`**, read back from both.
Worktree: `/home/admin_maxime/work/wt-arena-realign`.

Answers `FINDING-protocol-drift.md` **break 1**, and closes three of the four
items the finding left "to verify". Built by a child that died mid-run without
writing a report; **every number below was re-measured by the parent** on
2026-11-14, and the one type error the slice carried was fixed here.

## Files

```
platform/web/auctions/relay/arenaAuctionRead.ts        (+466/-…)
platform/web/auctions/relay/arenaAuctionRead.test.ts   (+315)
platform/web/auctions/relay/arenaAnchor.ts             (+96)
platform/web/auctions/relay/arenaAnchor.test.ts        (+68)
platform/web/auctions/relay/auctionSurfacesRead.ts     (+57/-…)
platform/web/auctions/relay/auctionSurfacesRead.test.ts
platform/web/storefront/auctionListRead.ts
platform/web/storefront/auctionListRead.test.ts
```

8 files, **921 insertions**, 199 deletions.

## The frozen field set — the finding's security-relevant break

`ARENA_CREATE_IMMUTABLE_FIELDS` is now the protocol's own list:

```
startPrice, minIncrement, mode, windowSec, durationSec, sellerWallet, v4vSplit
```

with `title`, `description`, `image` the mutable ones. The previous list
(`starting_bid`, `min_increment`, `reserve`, `duration_seconds`,
`late_bid_window_seconds`, `locktime_seconds`, `funding_mode`,
`seller_coco_payment_public_key`) shared **zero** names with it, so the gate was a
no-op: a flipped `mode`, a changed `sellerWallet`, or an altered V4V split was
accepted by our reader while the protocol refuses it. Two of those three change
where the money goes.

- Numeric fields are compared **as integers**, so `"1000"` for `1000` is not a
  change — the chain compares integers and so does this gate.
- The **`(seller, d)` supersession rule** is explicit: the root is the earliest
  `1440` for the coordinate; a later version counts only if its `e` names that
  root; a root carrying an `e` is refused by name (`arena.root_carries_e`).
- A rejected update surfaces the **field that moved**
  (`arena.immutable_field_changed`), so a client shows why rather than silently
  ignoring a version.

## The verdict reader — the three delegated questions, answered

- **Anchored-only.** A verdict without `height` and `block_hash` is not evidence
  and is never shown (`arena.unanchored`).
- **The roster `p` tag** carries the validator's own pubkey, so a client can tell
  which validator said what and a forged verdict is distinguishable.
- **Append-only, latest-per-validator.** A later verdict does not replace an
  earlier one; the fold takes each validator's newest anchored statement as the
  display truth, and **divergence between validators is surfaced, not resolved**
  (`verdictDivergence`). No winner is inferred — quorum is not implemented, and
  the panel must not pretend otherwise.
- The `arena.verdict.v1` schema string and the outcome vocabulary
  (`winner` / `reserve_not_met` / `cancelled` / `aborted`) are enforced by name.

## Evidence

| command | result |
|---|---|
| `bun test --isolate platform/web/auctions/ platform/web/storefront/` | **480 pass, 1 skip, 0 fail**, 1225 expect() calls, 27 files |
| `tsc --noEmit` | **205**, the baseline at `df68b6f26` (measured in the clean `wt-auction-bid` worktree) |

The skip is the live-demo protocol test (`AUCTIONS_LIVE=1`), untouched here.

**Fixed in review:** the slice carried one type error of its own —
`arenaAuctionRead.test.ts:436` typed the frozen-field list's names as `string`
instead of the field union, so the assertion was not checked against the union at
all. Now annotated `ArenaCreateImmutableField`; 206 → 205.

## Still open on this path

- **Break 2** (the bid's missing funding payload) is a separate slice — see
  `report-bid-funding.md`.
- **The detail model still exposes retired field names.** `ArenaAuctionDetailModel`
  carries `fundingMode`, `locktimeSeconds`, `lateBidWindowSeconds`,
  `lateBidExtensionSeconds`, `maxTotalExtensionSeconds` and `reserve` — the 30408
  vocabulary — and does **not** carry the protocol's `sellerWallet`, `v4vSplit`,
  `mode`, `windowSec`/`durationSec`. The events are read and gated correctly; the
  view model handed to the UI is not yet realigned. This is the gap that blocks
  wiring a funded bid (the escrow needs the seller's wallet and the split), and it
  is the next increment on this path.
