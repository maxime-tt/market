# Item 3, write half — the 1441 bid flow

Branch `d7s2/auction-bid`, cut from the verified chain `d7s2/auction-surfaces` @ `9ef53eea8`.
**Commit `df68b6f26`** (`GIT_AUTHOR_NAME=t …` as instructed). **Not pushed** — the parent verifies and pushes.

## What was built

| file | what it is | side of the seam |
| --- | --- | --- |
| `ui/auction/arena/bid-rules.ts` | pure bid validation: amount parse, floor, blocking states, copy | `ui/` |
| `ui/auction/arena/bid-panel.tsx` | props-only entry surface + the six submission states | `ui/` |
| `ui/auction/arena/auction-detail.tsx` | **modified** (additive): a `bidPanel` slot between terms and bids | `ui/` |
| `platform/web/auctions/relay/arenaBidPublish.ts` | builds + signs + publishes the 1441; fail-closed reporting | `platform/` |
| `platform/web/auctions/relay/AuctionBidHost.tsx` | the platform binding: identity, clock, signer, publish, read-back | `platform/` |
| `ui/auction/arena/bid-rules.test.ts` | 34 tests | — |
| `ui/auction/arena/bid-panel.test.tsx` | 30 tests | — |
| `platform/web/auctions/relay/arenaBidPublish.test.ts` | 22 tests, incl. round-trip through the real read gate | — |

Nothing in `ui/auction/*` (the 30408 surface) was changed or deleted; `sdk/commerce/auctions/constants.ts`
is untouched. No new numbers: the bid kind is `ARENA_AUCTION_BID_KIND` (1441) imported from the frozen map.

## The decisions, and why

**Money.** Integer sats end to end. `parseBidAmountSats` accepts `/^\d+$/` on the trimmed string plus a
safe-integer check — `Number('')`, `Number('1e3')`, `parseInt('10.9')` all silently produce a different
amount than the one displayed, so none of them is used. A decimal is refused with its own reason
(`not-integer-sats`) rather than rounded. The input shows `sats` inline and no fiat anywhere; there is no
rate source in this path and none may be invented.

**Bids are deltas.** The read adapter sums bid amounts per bidder into positions
(`arenaAuctionRead.ts:895-899`) and the protocol says "A DELTA added to the bidder's existing position"
(`protocol/client.ts:62-63`). So the validation compares the *resulting* position (`ownPosition + amount`)
against the floor, and the copy says "bids add to your position". A test pins it: a bidder holding 1000
who types `100` on a 1000 floor is allowed because their position reaches 1100.

**The floor comes from the create, never a guess.** No bids → `starting_bid`; a top → `top + min_increment`;
an **unstated** `min_increment` is *not* zero — the floor is one sat above the top, said out loud in the
UI; an unstated `starting_bid` → no floor and bidding is refused as unstated (`no-starting-bid`), not
offered against an invented 0; bids whose amount could not be read → floor `unknown`, bid disabled.

**The 1441 binds to the ROOT create.** Decision §4.2 (`notes/DECISION-auction-kinds-and-editable-allowlist.md:100-104`):
`e = <auction_root_event_id>`. The publish path uses `model.rootEventId` and a test proves it refuses to
use `canonicalEventId` when they differ. Tags are `[["e", root], ["a", "1440:<seller>:<d>"]]`, content is
`{"auction_id": <d>, "amount": <integer>}` — the shape `arenaAuctionRead.ts:485-501` reads.

**Honest reporting, six states, not two.** `idle | publishing | presumed | seen | unpublished | failed`.
`presumed` says "Bid presumed placed — N of M relays acknowledged it … not 'won', and no money has moved";
`seen` (the read delivered it back) says "storage, not an outcome". `settleSubmissionFromRead` performs the
presumed → seen upgrade off the read's own bid list — the app never assumes acceptance.

**Zero ACKs fails closed.** `publishArenaBid` counts `acks.filter(a => a.accepted)` from the SDK seam's own
per-relay answer and throws `ArenaBidPublishError` with an `unpublished` state when the count is 0 — the
contract `publishRequired` enforces on the 30408 path (`auctionPublishIo.ts:34-52`). A test asserts the
event *was* signed and sent (the dangerous case) and that the state says published nowhere.

**The publish path re-checks.** `publishArenaBid` calls the *same* `checkArenaBid` the button does — a
disabled button is presentation; the money rule holds at publish. It also recomputes `getEventHash` from
the validated template and refuses a signer that returns a different event (`bid.signature-mismatch`).

## Evidence — measured

Typecheck, same worktree and `node_modules` (`bun install --frozen-lockfile` first), never
`node_modules/.bin/tsc`:

```
NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bun bunx tsc --noEmit
```

- before (clean tree at `9ef53eea8`): **205** `error TS` lines
- after (branch tip): **205** `error TS` lines — none in `ui/auction/arena/*`,
  `arenaBidPublish*` or `AuctionBidHost.tsx` (`grep -E 'auction/arena|arenaBidPublish|AuctionBidHost'`: empty)

Two errors my first draft introduced and fixed (not hidden): `AuctionBidHost.tsx(127,68)` — `bidder.pubkey`
narrowed to `string | null` inside the `useCallback` closure (fixed by capturing it in a local); and
`Cannot find name 'arenaBidBlock'` — the re-export listed a name that was never imported (fixed by adding
it to the import, since `verbatimModuleSyntax` keeps the re-export live).

Tests, real output:

```
bun test --isolate ui/auction/arena/ platform/web/auctions/relay/ ui/boundary.test.ts
→ 190 pass, 0 fail, 532 expect() calls, 8 files
```

Broken down: `bid-rules.test.ts` 34/0, `bid-panel.test.tsx` 30/0, `arenaBidPublish.test.ts` 22/0, the read
adapter 31/0, `auctionSurfacesRead.test.ts` 29/0, `arenaAnchor.test.ts` 43/0 (pre-existing),
`auction-surfaces.test.tsx` 28/0 (pre-existing, still passes with the new additive slot), `ui/boundary.test.ts` 1/0.

Adjacent suites, to show nothing regressed:

```
bun test --isolate ui/auction/          → 213 pass, 0 fail, 20 files
bun test --isolate platform/web/auctions/ → 410 pass, 1 skip, 0 fail, 23 files
bun test --isolate platform/web/browse/   → 168 pass, 0 fail, 11 files
bun test platform/web/browse/             → 153 pass, 15 fail
```

The browse pair matches the order's own measured numbers (168/0 isolated vs 153/15 without) and is quoted
only for conservation — no file in `platform/web/browse/` is touched by this slice.

The strongest test is the **round-trip**: a bid produced by the real `publishArenaBid` is decoded by the real
`decodeArenaEvent` and projected by the real `projectArenaEvents`, then asserted to be counted, attributed
to the bidder and surfaced as `topBid.total === 1100`, with `snapshot.refusals` empty and
`auction.bids[0].eventId === result.eventId`. A bid that names no auction is projected out and counted as
`arena.unbound_bid`. So the event this slice publishes is proven to be the event the 31-test read adapter
binds — not merely JSON that looks right.

## Findings — measured, and NOT changed

1. **The read adapter binds a bid by `a` (coordinate) first, then `e` (root), then `auction_id` when
   unambiguous** (`arenaAuctionRead.ts:825-840`). Consequence: a 1441 carrying the right `a` but the
   **wrong `e`** is still bound to the auction. The root binding is therefore not enforced by the read — a
   deviation from DECISION §4.2 ("bids bind to the root"). My first test asserted the opposite and failed;
   I corrected the test to assert the observed behaviour and recorded this rather than papering over it.
   The publish path itself binds the root correctly; closing the gap belongs in the read module, which this
   slice was told not to modify.
2. **The web transport turns an unknown error string into a `getEventHash` throw.** `getEventHash` from
   the package root rejects any `pubkey` not matching hex (e.g. `'A'×64`). Production never hits this (a
   real signer yields hex); it cost one test-fixture fix. Worth knowing for anyone else writing a fake
   signer: use `nostr-tools/pure` and a hex pubkey.

## What I deliberately did not do

- **No settlement, no two-of-two lock, no escrow, no refunds, no verdict publication** — separate slices
  on 1443/1444/1445/1446. The bid carries **no funding payload** (`reservation`, `cashu_lock`,
  `outcome_templates`, `sigall_deposit` are the retired bidder-held path's), and the panel says no funds move.
- **No route wiring.** The host exists; mounting it in the 30408 route hosts (`AuctionDisplayHost`) would
  replace the old bidder panel before stage 4 decides the route, and the detail view takes the panel as a
  slot precisely so that wiring stays an additive call-site change.
- **No widget-book entry.** `ui/AGENTS.md:156-159` requires one per component in a cluster. The read half
  (`arena/*`) shipped without entries too, and adding three new entries to the gallery for this slice would
  be a separate, larger change than the order asks for. Recorded as a gap, not claimed as done.
- **No change to `ui/auction/*`, `sdk/commerce/auctions/constants.ts`, or the read module.**
- **No `runs/` commit in the worktree**: this report is written into the main checkout's
  `runs/2026-11-13-auctions-ui/`, which is the parent's to commit.

## What I could not verify

- **No live relay publish.** No relay was running and none was started (the order forbids restarting
  anything). The publish evidence is the real `publishArenaBid` against a stub `ArenaBidPublisher` that
  returns ACK sets, plus the real read gate/projection over the resulting event. The transport edge
  (`createWebNostrIo().publish`) is not exercised here.
- **No browser render.** Views are asserted through `renderToStaticMarkup`; markup and copy are verified,
  pixels are not. The input's disabled/aria-invalid behaviour is asserted in markup only.
- **No wallet/signer integration test.** `AuctionBidHost` is typechecked but not rendered: it reads the
  auth store and the signer capability, which need a logged-in session. The mapping from
  `getActiveSignerCapability() !== null` to `wallet: 'ready'` is a *readiness* claim — it says a signer
  exists, not that any amount is funded (this bid funds nothing).