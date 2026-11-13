# Item 3, read half — the 1440-series auction surfaces (card, detail, verdict panel)

Branch `d7s2/auction-surfaces`, cut from `d7s2/auction-block` @ `9b37ef09d`.
Report written by the implementing slice; the parent verifies and pushes.

## What was built

Three props-only views and one platform adapter. The **presentation** is ported
from the retired 30408 surfaces; the **data** is the verified 1440-series read.

| file | what it is | side of the seam |
| --- | --- | --- |
| `ui/auction/arena/model.ts` | read-models + pure formatters (`phaseLabel`, `priceLine`, `shortKey`, the quorum disclaimer) | `ui/` |
| `ui/auction/arena/auction-card.tsx` | `ArenaAuctionCard` + `readStateMessage`, `bidCountLabel`, `priceLine` | `ui/` |
| `ui/auction/arena/auction-detail.tsx` | `ArenaAuctionDetail` | `ui/` |
| `ui/auction/arena/verdict-panel.tsx` | `ArenaVerdictPanel` | `ui/` |
| `platform/web/auctions/relay/auctionSurfacesRead.ts` | projections + `collectArenaSurfacesRead` + `useArenaSurfacesRead` | `platform/` |
| `platform/web/auctions/relay/auctionSurfacesRead.test.ts` | adapter tests (29) | — |
| `ui/auction/arena/auction-surfaces.test.tsx` | view tests (28) | — |

Why the split, quoting the rules rather than paraphrasing them:

- `ui/AGENTS.md:18-28` — `ui/boundary.test.ts` fails on any `@platform/…`,
  `nostr-tools` or `applesauce-*` import from `ui/`; a relay read cannot live there.
- `ui/AGENTS.md:120` — "No data fetching. No `fetch`, no `useQuery`, no `useStore`."
- `ui/AGENTS.md:38-41` — "Data adapters … are invoked by the platform/assembler
  and passed down as props." `auctionSurfacesRead.ts` is that adapter.

It **adds no read logic**: every function is a projection of `ArenaAuctionView`,
the shape `arenaAuctionRead.ts` already produces. No second subscription, no
re-parse, no second canonical-version rule. `arenaSurfaceStatus` is
`auctionListStatus` re-exported (`auctionSurfacesRead.ts:76-78`) so one read has
one honesty rule rather than two that can drift.

Nothing is written to `ui/auction/*` (the 30408 surface) and nothing is deleted:
stage 5's deletion is not this slice's.

## The states that had to render truthfully

| state | where it is decided | what the surface says |
| --- | --- | --- |
| no relay reachable | `health.noRelaysReachable` → `no-relays` | "No relay answered, so this auction could not be read. This is not the same as the auction not existing." |
| partial read (some relays timed out/errored) | `health.pending.length > 0` → `incomplete` | "The read stopped before every relay answered… not the whole picture", plus "N of M relays answered" |
| read still running, nothing delivered | `status === 'loading'` | "Reading this auction from relays… Nothing has arrived yet", explicitly *not* "not found" |
| settled and genuinely absent | `status === 'settled'` | "No such auction was read. Every relay answered and none of them carried it." — the only state allowed to say it |
| ended vs open vs unknown end | `auctionEndsAt`/`auctionPhase`; no duration (or `duration <= 0`) → `null` → `unknown` | "End time unknown", never a made-up deadline |
| verdict known | `view.verdicts[0]` (read orders by height desc) | "Outcome: winner (relay-reported)" |
| verdict never published | `verdict === null` | ended → "Outcome not verified yet"; detail → "no verdict has been read … Unknown is not 'no outcome'"; panel → "an absence, not a verdict of 'no outcome'" |
| two relays disagree | `snapshot.verdictDivergence` → `divergenceFor` | card badge + detail badge + panel block naming each relay and the outcomes it reports, labelled "a signal, not proof" |
| validators publish different outcomes | `panel.outcomes.length > 1` | "The published verdicts disagree … No quorum is applied here, so this panel does not pick one." |
| bids with no readable amount | `view.bidsWithoutAmount` | total renders "total unknown" with the count, never `0 sats`; positions labelled a partial sum |
| unstated terms | `content.* === null` | "not stated", with the reserve and duration cases spelling out why (`null` ≠ none ≠ 0) |
| count on an unfinished read | `status !== 'settled'` | "N bids so far", "N verdicts so far" |

**Quorum is not implemented, and the panel says so in every state** — including
with exactly one verdict on screen (`ARENA_QUORUM_DISCLAIMER`, rendered
unconditionally at `verdict-panel.tsx:139`). Nothing anywhere infers a winner
from a tally.

## Evidence — measured

Typecheck (never `node_modules/.bin/tsc`; `bun install --frozen-lockfile` run in
this worktree first, so `bunx` resolves the repo's typescript 5.9.3):

```
cd /home/admin_maxime/work/wt-auction-surfaces
NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bun bunx tsc --noEmit
```

- before (detached at `9b37ef09d`, same worktree, same `node_modules`): **205** `error TS` lines
- after (branch tip): **205** `error TS` lines
- none of them in `ui/auction/arena/*` or `platform/web/auctions/relay/auctionSurfacesRead*`
  (`grep -E 'auction/arena|auctionSurfacesRead'` on the output: empty)

Two errors my first draft introduced and that are now gone (the honest trail):
`ui/auction/arena/model.ts(1,33)` imported `../shared/status-badge` (one level
short) and three `Ref<HTMLElement>` vs `Ref<HTMLDivElement>` mismatches where the
state card's root was a `div` under an `article`-typed ref. The state card's root
is now an `article` and the detail's ref is `HTMLDivElement`.

Tests, real output:

```
bun test ui/auction/arena/ platform/web/auctions/relay/auctionSurfacesRead.test.ts ui/boundary.test.ts
→ 58 pass, 0 fail, 165 expect() calls, 3 files
```

Broken down: `auctionSurfacesRead.test.ts` 29 pass / 0 fail; `auction-surfaces.test.tsx`
28 pass / 0 fail; `ui/boundary.test.ts` 1 pass / 0 fail.

Two test failures during development, both **my** wrong expectation, not the
code: I asserted a top position of 450 where the deltas sum to 300
(`bidder-one` 100+200), and I asserted the `ENDED` badge text where the ported
presentation renders `Ended`. Both fixed in the tests, with the correct values
verified against the read module's own semantics.

The browse suite was not touched and not run — no file in `platform/web/browse/`
or `ui/storefront/` is modified by this slice, so the `--isolate` bleed
(168 pass isolated vs 153/15 without) is not in play here.

## What I deliberately did not do

- **No route wiring.** The three surfaces are the route-level equivalents; the
  platform seam (`useArenaSurfacesRead` + `findAuction` + the three projectors)
  is what a route composes. Wiring `/auctions` and `/auctions/:id` means
  replacing the 30408 hosts (`AuctionCardHost`, `AuctionDisplayHost`) and their
  bidder/claim/settlement panels, which is stage 3's **write** half plus stage 4.
  Doing it here would have deleted the bid flow before the replacement exists.
- **No bidding, no publish, no settlement, no validator call.** Read-only, by
  the ruling: the front end never contacts a validator.
- **No quorum, no counting rule, no tie-break.** There is no rule to implement,
  so the panel states the absence.
- **No commit of `runs/`** in this worktree: this report is written into the
  main checkout's `runs/2026-11-13-auctions-ui/`, which is the parent's file to
  commit, and touching that checkout's index is not this slice's business.

## What I could not verify

- **No live relay read.** No relay was running for this slice, and none was
  started (the order forbids deploying/restarting anything). All read evidence
  is the fake-relay `AsyncIterable` over the **real** `createArenaAuctionRead`,
  which is the same technique `auctionListRead.test.ts` uses. The transport
  edge (`createWebRelayReadContext`) is exercised by the adapter's own 31 tests,
  not re-tested here.
- **No browser render.** The views are asserted through
  `renderToStaticMarkup`, so markup and copy are verified and *pixels are not*.
  No dev server was started. Tailwind classes are the same role tokens the
  neighbouring surfaces use, but no one has looked at them.
- **Divergence attribution across duplicate `d` values.** `verdictDivergence[].auctionId`
  is the raw `auction_id` a verdict carried, so it can be a bare `d`. `divergenceFor`
  matches the full coordinate or that bare `d` and nothing else. If two sellers
  publish the same `d`, a bare-`d` divergence could be attributed to both. The
  read adapter does not currently carry provenance into `view.verdicts`, so this
  could not be narrowed without changing the verified module — recorded here
  rather than papered over.

## One finding about the read module (not changed)

`ArenaAuctionView.verdicts` is `ParsedArenaVerdict[]`: the per-event relay
provenance (`relays[]`) that the read keeps on every decoded event is **dropped**
for verdicts when they are projected into a view. The panel therefore shows
relay disagreement only through `snapshot.verdictDivergence`, not per row. Adding
`relays` to the view's verdict entries would be a small additive change to the
verified module; I did not make it, because this slice must not touch a 31-test
verified module without the parent's say-so.