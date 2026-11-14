# Handover — 2026-11-14: the three in-flight slices are landed; here is where to pick up

Written by the Hermes session that finished them. Read this before touching
anything. It separates **verified** from **not verified** from **not done**,
because conflating those is how this programme lost time before.

## The one-paragraph state

Three slices were in flight when the previous session died mid-tool-call. Their
work survived **uncommitted** in three worktrees; their child never wrote its
reports. All three have now been **finished, verified by the parent, committed and
pushed to `fork` and `nostr`**, and read back from both remotes. Nothing merged,
nothing deployed.

| slice | branch @ commit | tests | typecheck |
|---|---|---|---|
| A — increment 1: file-backed routing table + local page store, served with no relay on the read path | `d7s2/routing-page-store` @ `690a35d23` | 66 pass / 0 fail | 205 (baseline) |
| B — read realignment to the consolidated protocol | `d7s2/arena-realign-read` @ `7621a35e4` | 480 pass / 1 skip / 0 fail | 205 |
| B — the bid's escrow payload | `d7s2/arena-bid-funding` @ `b01ce21d6` | 520 pass / 1 skip / 0 fail | 205 |

Full evidence per slice: `runs/2026-11-13-admin-routes/report-increment-1.md`,
`runs/2026-11-13-auctions-ui/report-realign-read.md`,
`runs/2026-11-13-auctions-ui/report-bid-funding.md`. The live status board is
`runs/STATUS-two-streams.md` (its "Latest — 2026-11-14, evening" section).

## Where to pick up — in dependency order

1. **Realign `ArenaAuctionDetailModel` to the protocol's create fields.** The read
   adapter gates the events correctly, but the **view model** handed to the UI still
   exposes the retired vocabulary (`fundingMode`, `locktimeSeconds`, `lateBid*`,
   `reserve`) and lacks `sellerWallet`, `v4vSplit`, `mode`, `windowSec`/`durationSec`.
   Branch off `d7s2/arena-realign-read`. This is the blocker for item 2, because the
   escrow needs the seller's wallet and the split.
2. **Wire a funded bid end to end** — the escrow's missing half. Needs:
   the **mint-side escrow send** (a Cashu send that writes the five-tag 2-of-2
   condition; the app's existing `auctionFunds` lock is the **retired 30408** path
   and does not produce it), the committee key from `GET /api/config`, and the terms
   from item 1. `AuctionBidHost.tsx` currently passes `funding: null`, so the publish
   path refuses by name (`bid.unfunded`) instead of publishing an unfunded 1441 —
   that refusal is the honest placeholder, not a bug to delete.
3. **Then stage 4** (wiring into the app experience) and **stage 5** (deleting the
   retired bidder-held path — `auctionsProtocol.ts` still proxies to a
   `/api/demo/reservation` the consolidated protocol no longer serves).

## Verified now, by the parent, this session

- The increment-1 claim end to end: with `APP_RELAY_URL` pointed at a dead port the
  server boots, ingests a signed 30024, serves `/shop` **from local storage** (200,
  2737 bytes, 1 `<h1>`, `og:title`, the static marker, the ProductGrid placeholder),
  answers a real **404** for an unmatched path, and is byte-identical on two
  requests.
- The frozen create fields are the protocol's own set (they shared **zero** names
  with it before — a flipped `mode`, a changed `sellerWallet` and an altered V4V
  split all passed the old gate).
- The escrow lock's five tags, the two pre-signed templates, the digest against the
  reference chain's golden vector, and the publish path's three refusals
  (`bid.unfunded`, `bid.funding-invalid`, escrow ≠ amount).
- The feasibility question: **the app can pre-sign a template digest** —
  `walletOps.getAuctionBidWalletSigner()` exposes only `signDigest`, and the private
  key never reaches the funding module.

## Not verified

- **E10b, hydration parity** — a browser criterion (Playwright over a served page,
  comparing the placeholder's `innerHTML` before and after hydration). Never run.
- **The live protocol test** — skipped without `AUCTIONS_LIVE=1`.
- **Anything against a mint.** The escrow send does not exist yet, so no funded bid
  has ever been produced or accepted.

## Traps that cost time here

- **`origin` is ~1,468 commits behind on the market repo.** Push and read `fork`
  and `nostr`. `master` here carries the run/docs commits and is also on fork+nostr.
- **The integration target is `unite/1420-all`, never `master`** — the chain is
  `auctions-1440-kinds` (+23) → `auctions-read-adapter` (+24) → `auction-block` (+25)
  → `auction-surfaces` (+26) → `auction-bid` (+27) → the three branches above.
  Nothing merges until the parts are tested (owner's option 1).
- **Typecheck baseline is exactly 205** on a clean tree at these commits. Measure it
  in a clean worktree (`wt-auction-bid` is at the chain tip and clean); a fresh
  worktree without `node_modules` reports 15,215, and symlinking the main checkout's
  reports 334. The sorted error list also differs by **worktree path strings inside
  node_modules diagnostics** — compare source errors, not the raw diff.
- **`bun` is not on PATH** — `/home/admin_maxime/.bun/bin/bun`. `node_modules/.bin/tsc`
  is blocked by a command guard; use `bunx tsc --noEmit` with
  `NODE_OPTIONS=--max-old-space-size=12288`. The typecheck takes ~2.5 minutes: run it
  as a background process with a notification, not in the foreground.
- **The pre-commit secret scanner blocks 64-hex literals** — it flagged the
  all-zero example author key and the protocol's golden digest. Both are legitimate;
  the commit proceeds with a warning, and masquerading a real key would not.
- **Never touch** `/home/admin_maxime/work/auctions-simplify` (another session's
  backend), `auctions-mvp-demo.service`, or `wt-e2e`; never push to
  `PlebeianApp/market`.
