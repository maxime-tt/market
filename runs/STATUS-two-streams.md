# Two streams — live status (managed from this session)

Owner's standing instruction, 2026-11-13: **stay on custom routes (A) and the auctions front end (B).**
Everything else — the union runs, the catalogue branches, the preserved work, the intro — is parked,
recorded only so it is not lost. Not to be opened, verified or tidied by either stream.

## A — the custom-route unblocker

`runs/2026-11-13-admin-routes/`

- [x] **Bound frozen** — `order.md` (`aaab6ef51`). Every premise in it is a claim to test.
- [x] **ACL recorded** — `ruling-acl.md` (`1eecebd4b`). Three tiers: admin full control of the app and
      its pages; editor per-path grants; premium/paid reserves a path as part of their store. This
      closed the run's expiry question — `validUntil` is a reservation's term, so admin and editor
      routes are permanent.
- [x] **Research axis 1 complete** — `research/01-current-surface.md`. No premise drift at the base.
      Three findings that change the work's weight: the app key is a **server-side secret** (so the
      server is the ACL's enforcement point); the paid tier is **largely already built** as a zap
      purchase path; a **vanity dashboard surface already exists**.
- [x] **Research axes 2 and 3 complete** — `research/02-target-and-gaps.md` (36 KB) and
      `research/03-consumers-and-acceptance.md` (43 KB), each with a committed evidence generator.
- [x] **Composer brief written** — `composer-brief.md`. One writer, so the design stays coherent
      rather than becoming a committee.
- [ ] **Next:** dispatch the composer to write `proposal.md` + `order-increment-1.md`. That proposal is
      the owner's redirection point. Then increment 1 on its own branch, then the adversarial pass.

**Carried forward, awaiting the owner:** who *signs* a self-service reservation; self-service vs
admin-approved; what proves entitlement and whether it fails closed or open; precedence between an
admin route, an editor grant and a reservation on the same path; lapse and renewal; whether "domain"
means a route name or real DNS; naming rules. Plus five negative paths the acceptance must assert.

## B — the auctions front end

`runs/2026-11-13-auctions-ui/`

- [x] **Bound frozen** — `order.md` (`6a9f9118b`). The owner's own 8-item list plus the binding rulings
      (read path 100% Nostr; the chain is the consensus layer only; validators publish signed verdicts
      to the relay; the front end never contacts a validator; regular 1xxx kinds; the frozen
      1440-series allocation; retire rather than migrate).
- [x] **Increment 1, B1 — COMPLETE, verified, pushed.** `d7s2/auctions-read-adapter` @ `7f8e1275d`
      (fork + nostr, read back from both). Two files, 1,971 insertions:
      `platform/web/auctions/relay/arenaAuctionRead.ts` + its test. **The orchestrator re-ran the tests
      itself: 31 pass, 0 fail, 94 expect() calls.** Read-only — no UI, no publish, no validator.
      One independent subscription per relay, so relays can be **diffed for equivocation** instead of
      pooled blind; the diff is exposed (`verdictDivergence`, `commitmentForks`, per-event `relays[]`
      provenance). 1440 "latest wins" is explicit: root = earliest for `(seller, d)`; a later version
      counts only if its `e` names that root; accepted only if all eleven frozen fields are unchanged;
      a rejected update surfaces with the field that moved. Also proven against **real local relays**
      (two live + one dead port): four events, a 45 ms bounded read, correct partial results and
      health. Its report names what it could not verify: no browser, no hostile relay with real
      signatures, no quorum (that is stage 3's business).
- [x] **Increment 1, B2 — COMPLETE, and the premise was wrong in an instructive way.**
      `d7s2/home-test-dep-fix` @ `8ad4127c5` (fork + nostr). **The cause was not a repo defect:**
      `@getalby/sdk` is declared (`package.json:50`) and locked, but was simply **never installed in
      the local tree** — a stale/incomplete install. So that branch carries **documentation and
      evidence only, with no code change to merge.** The orchestrator then ran the frozen install in
      the **main checkout**, where the net actually matters, and confirmed `BrowseIndexHost.test.tsx`
      runs: **42 pass, 0 fail**.
- [x] **Scope fence added** — the intro and every earlier-work branch are marked parked; a child
      wandering there is a scope violation.
- [ ] **Next:** item 2, the auction block (auctions placeable inside a page), then stage 3 — the
      auction surfaces reading the adapter.

## Premise corrections the children found, and the orchestrator verified

- **The typecheck baseline is 205 on a clean tree, not 522.** The 522 in both orders was an artifact of
  the **dirty main checkout**, which typechecks untracked scratch files and stale packages. B1 measured
  205, B2 independently reported the same drop, and the orchestrator confirmed 205 with **0 errors in
  the new files**. Corrected in both orders. Two related traps are recorded there: a fresh worktree with
  no `node_modules` makes `bunx` fetch typescript@latest and report **15215** errors; symlinking the
  main checkout's `node_modules` reports **334** because `@cashu/cashu-ts`'s `.d.ts` relative imports
  break through the symlink. Always `bun install --frozen-lockfile` in a fresh worktree first.
- **The browse suite needs `--isolate`.** Measured by the orchestrator: `bun test --isolate
  platform/web/browse/` → **168 pass, 0 fail**; without it → **153 pass, 15 fail**, all in
  `BrowseIndexHost` and `useBrowseIndexFeed`. Pre-existing cross-file state bleed, not a regression from
  this run — and neither number may be quoted alone.
- **`AGENTS.md` does not state the "read seam" or a `ui`/`platform` split by those names.** B1 said so
  rather than inventing a rule, and cited the rules that do exist (`sdk/AGENTS.md:38-53`, the
  stream-first read doctrine; `ui/AGENTS.md:18-28`, the enforced hard boundary via
  `ui/boundary.test.ts`) to justify the placement it chose.

## The integration target — corrected

**`unite/1420-all`, never `master`.** The repo's own notes name it the integration branch
(`notes/MERGE-NDK-STRUCTURAL.md:4`, `notes/HANDOVER-CMS-INTEGRATION.md:6-7`), every `d7s2/*` feature
branch is cut off it, and `notes/POST-D7-BACKLOG.md:51` records "PR #1420 has never seen D7" — PR #1420
is the union PR. The `wt-union-1420` worktree already holds `unite/1420-all` clean, and the tip is
`d4aba3db6` on fork, nostr and origin alike.

Measured ancestry, which is the reassuring part: **every line of this work sits on top of that tip** —
`d7s2/auctions-1440-kinds` = union + 23, `d7s2/auctions-read-adapter` = union + 24,
`d7s2/home-test-dep-fix` = union + 31, `master` = union + 33 (all run/docs commits). Union-ahead-of-any-
of-them = 0. **So nothing needs rebasing; only the merge target was ever wrong.** Merging into `master`
would never have reached the PR, because `master` is itself just a line sitting on top of the union.

`gh` is unauthenticated in this checkout, so the PR's own head and base could not be queried; the
identification rests on the repo's notes, the branch name and the measured ancestry.

## Boundary between the two

- Item 4 of B's list — the home's addressing gap — **belongs to A**, and is in flight there.
  A child in either stream that starts solving it is duplicating the other.
- Neither stream deploys. No live unit is restarted by either.

## How to check either stream without interrupting it

```sh
tail -f /home/admin_maxime/.hermes/profiles/maxime/cache/delegation/live/<delegation-id>/task-N.log
```

The streams' artifacts live under `runs/2026-11-13-admin-routes/` and `runs/2026-11-13-auctions-ui/`;
their evidence files are regenerated by committed scripts, never hand-edited.
