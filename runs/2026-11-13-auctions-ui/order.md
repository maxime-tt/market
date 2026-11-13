# Work order — builder run 2: the auctions front-end effort

Frozen 2026-11-13 by the orchestrator, acting for the maintainer (Maxime). This is the **sibling** of
`runs/2026-11-13-admin-routes/` — the two run in parallel, both managed from this session. Bounded:
change it or reject it, but do not widen it inside a run.

> **Every factual premise here is a claim to test.** Where a measurement contradicts a sentence, the
> measurement wins and the contradiction is a finding — say so rather than conforming.

## What this run is

The maintainer's words: *"this is what I mean by the parallel effort. you should have it active in
this exact session right now."* It is the front-end iteration list from the same session, in
dependency order:

1. **Stage 2 — the relay read adapter.** One module subscribing to the auction kinds, multi-relay from
   the start. *"This is the unblocker: nothing auction-side can proceed without it."*
2. **The auction block** (Option C's fourth) — auctions becoming something an author can *place* in a
   page, rather than a route with zero inbound links.
3. **Stage 3** — rewrite the auction surfaces on `1440` reading that adapter: card, detail, bid flow,
   verdict panel.
4. **The home's addressing gap** — ⚠️ **this belongs to the sibling run** (`runs/2026-11-13-admin-routes/`).
   Do not duplicate it here; the routes run is resolving it.
5. **The intro** — ⚠️ **PARKED by the owner (2026-11-13): do not pursue.** A real implementation does
   exist on `d7s2/intro-animation` and it is recorded under *Known drift* below, but the standing
   instruction is to keep these two streams on **custom routes** and **the auctions front end** and
   not to wander into earlier work. Do not open that branch, do not verify it, do not merge it.
6. **Stage 4** — wire into the app experience; the chain-fed catalogue stays deferred.
7. **Stage 5** — delete the retired bidder-held-path implementation (101 files), only once stage 3
   covers its surfaces.
8. **The pre-existing broken home test** — `BrowseIndexHost.test.tsx` cannot run at all (missing
   `@getalby/sdk/nwc`), so the home has no regression net.

## The rulings this run implements — binding, do not relitigate

- **The read path is 100% Nostr.** The app reads auction state from relays, not from a validator API.
  The blockchain is the **consensus layer** only. Validators publish signed verdicts back to the relay
  as **regular-kind** events; **the front end never contacts a validator directly**. Any code that
  pings a validator from the browser is a defect.
- **Use regular 1xxx kinds, never ephemeral 20xxx** — khatru drops an ephemeral event with no live
  subscriber, which is the measured bug that forced the switch.
- **The frozen kind allocation:** `1440` create · `1441` bid · `1442` chat (ChiefMonkey's, untouched)
  · `1443` refund · `1444` settle · `1445` outcome/verdict · `1446` funding-abort · `1447` state
  commitment. Verified free three ways (NIPs registry, all 1,898 NIP PRs, zero live events on four
  relays) — see `notes/DECISION-auction-kinds-and-editable-allowlist.md`.
- **Retire, don't migrate.** `cashu_p2pk_bidder_path_v1` is retired; only *generic* auction semantics
  port forward. See `notes/DECISION-retire-bidder-held-path.md`.
- **1440 is regular, not addressable** — "latest version wins" must be built explicitly: canonical
  1440 is the latest by `created_at` for `(seller, d)` **that passes the immutable check**.

## The base

- Specimen: `/home/admin_maxime/work/market` at `f6e681d92` (master), plus **stage 1 already done** on
  `d7s2/auctions-1440-kinds` @ `0a65b4ce6` (the kind map + anchor parsers). Stage 2 builds on stage 1 —
  branch from it, do not re-do it.
- **Do not read or write** `/home/admin_maxime/work/wt-e2e` (serves a live instance),
  `/home/admin_maxime/work/auctions-simplify`, or
  `/home/admin_maxime/work/compare/plebeian-arena-auctions` (another session's, mid-rebase).
- The typecheck baseline on **this** base is **exactly 522** errors
  (`NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bun bunx tsc --noEmit`).
  Quote the count before and after; a change that adds any is not acceptable.

## Increment 1 — two independent slices, both now

**B1 — the relay read adapter (stage 2).** The unblocker.

- One module, one read seam, subscribing to `1440`/`1441`/`1445`/`1447` from **multiple relays from the
  start** — a single-relay adapter that has to be widened later is the failure to avoid.
- Read-only. **No UI in this slice.** The consumers come in increments 2 and 3.
- Respect the repo's boundary doctrine in `AGENTS.md` (the read seam, and the `ui/` ↔ `platform/`
  split): state which side of the seam the module lands on and why, quoting the rule.
- Dedupe by event id; order by `created_at` with the tie-break the protocol requires; survive a relay
  that is down, slow or lying (one dead relay must not stall a read).
- Evidence, not assurance: prove it against the local relay if one is running, and if none is, say so
  plainly instead of claiming a live read.

**B2 — the broken home test.** Small, independent, immediately valuable.

- `BrowseIndexHost.test.tsx` fails with `Cannot find module '@getalby/sdk/nwc'` — **pre-existing**,
  reproduces on unmodified master. Establish whether the dependency is genuinely absent, mis-declared
  or resolvable another way, and fix the real cause. Do not weaken the test to make it pass; if the
  honest fix is to add a dependency, say so and show why.

## Deliverables

Under `/home/admin_maxime/work/market/runs/2026-11-13-auctions-ui/` — **the base source tree is not
written to except as the increment requires**:

- `order.md` (this file), `research/` and `evidence/` as needed, and per increment:
- a report naming exact files changed, the typecheck count before and after, the test commands run and
  their real results, and anything that could not be verified.

## Evidence discipline

- Every claim about code carries `file:line`; every number carries the command that produced it.
- Separate **measured** / **read from source** / **judged**. `UNVERIFIED` is a legitimate answer.
- Conservation, never green: quote counts before and after.
- **Mask key-shaped literals in any captured output** — the pre-commit secret scanner blocks
  `Key = '<64-hex>'` and cannot tell a public key from a private one. It has already blocked one
  commit in the sibling run.
- No secrets, no keys.

## Known drift, corrected here rather than inherited

- **The intro is NOT a stub in the way a first reading suggests.** The claim "the intro is still a stub
  against its own storyboard" is true **of master**, but a real implementation exists on
  `d7s2/intro-animation` @ `f2dc13864` (committed and pushed): GSAP timeline, a choreography state
  machine, search-on-type, google-mode, a reduced-motion path, and unit tests. So increment 5 is
  **verify and land**, not write from scratch. Its own `DELIVERY.md` is honest that the animation
  **was never seen in a browser** — timing, the handoff frame, and the reduced-motion path are all
  unverified, and its Playwright spec was written but never run. Treat that branch's claims as claims.
- The same worktree holds **unrelated uncommitted work** (`sdk/commerce/discovery/productFamilies.ts`
  + its test, `sdk/core/event-store/read.test.ts`, `package.json`, `bun.lock`) that belongs to neither
  this increment nor the intro. **Do not commit it and do not discard it** — report it.

## Stop conditions

- **Nothing is deployed.** No live unit is restarted by this run.
- **Out of scope by the owner's standing instruction (2026-11-13): the intro** (item 5, `d7s2/intro-animation`)
  **and every other earlier-work branch** — the union runs, the catalogue branches, the preserved
  work. They are recorded in this order only so they are not lost, never to be acted on by this run.
  Do not open, verify, merge or "tidy" them. The two streams are custom routes and the auctions front
  end; anything else is a scope violation.
- Stop and report if a slice cannot be specified without deciding the sibling run's shape (the routes
  and the home addressing are the sibling's).
- Stop and report if the working tree disagrees with the premises above at the named commits.
