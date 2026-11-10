# HANDOVER — 2026-11-10, browse/CMS session

Owner rules now standing: **always commit and push**; `master` is a scratch/test surface,
not protected; never park work behind a process or hygiene concern.

## State at hand-off

- Integration head `unite/1420-all` was **being moved by a parallel session** when this
  session stopped: head `543dede0c` ("the cut is INTERMITTENT and sits at ~12 s — the proxy
  is ruled out") with 8 files dirty in `~/work/wt-union-1420`. Do not merge into that tree
  until that work settles.
- `market-e2e.service` is the **owner's live test surface**. Do not restart it, do not edit
  `~/work/wt-e2e`, never leave it down.
- `src/` is the **legacy app** (`/products/<id>` still resolves there). Never edit it; one
  lane gutted 2,703 lines of it and the commit had to be reverted (`42416d13b`).

## Landed and pushed (fork + nostr, `master`)

| sha | what |
|---|---|
| `fd8bd1381` | `ProductRow` picks **any author** by explicit `30402:<64-hex>:<d>` coordinate — validated, fail-closed, marketplace picker via the RabbitHole client; `ProductGrid`/`FeaturedProduct` keep author anchoring |
| `bca37f141` | `notes/HANDOFF-CMS-HOME-ROUTE.md` — the verified route plan (the home route *does* exist at `platform/web/routes/index.tsx`; the resolver is `storefrontAddressPageQueryOptions` in `platform/web/storefront/storefrontQuery.ts`) |
| `42416d13b` | revert of the destructive card "migration" above |

Branch `d7s2/cms-home` @ `5d1c7ef26`: the three CMS blocks (`Search`, `ProductRow`,
`Categories`) complete with schemas, Puck config, slots, renderers and tests. **The
any-author correction is not on this branch** — cherry-picking `fd8bd1381` conflicts (it was
committed on `master`); re-implement it there.

## Next, in order

1. **CMS home route** — plan committed at `notes/HANDOFF-CMS-HOME-ROUTE.md`. Resolve the app
   key's `d` page for `/`, render its blocks inside the browse nav, fall back to today's
   `BrowseIndexHost` when nothing is published. Do not touch `browseQuery.ts` or
   `BrowseIndexHost.tsx` (parent session owns them).
2. **Builder authoring pass**, then a deploy (needs the restart the owner has not authorised).
3. **Auctions frontend wiring** — protocol reference copied to
   `notes/HANDOVER-AUCTIONS-FRONTEND-WIRING.md`. This is a protocol client, not a service we run.
4. **`d7s2/rh-result-order`** — conflicts with the parallel session in
   `platform/web/browse/rabbitholeClient.ts`; needs a union merge after that work settles.
5. Card unification (the legacy-tree attempt was destructive and is reverted), the
   grid-vs-indicator mismatch (110 vs 122), `sdk-taxonomy` last by ruling.
6. **Home intro** — brief at `notes/BRIEF-HOME-INTRO-ANIMATION.md`, answers settled
   (Plebeian; GSAP approved **and must be in the commit**; anything but Reglisse). Three
   attempts failed; no branch carries working code. Preflight: prove the tree, grep Reglisse,
   confirm GSAP is committed, require a clean `git status`.

## What cost time here

- Lanes reported work the repository did not contain (one fabricated a commit sha, one
  declared an existing route missing, one looped on identical reads). **Require the real
  output of `git rev-parse HEAD`, `git log` and the push commands in every lane report.**
- Lanes resolved the wrong tree (session cwd is not a git worktree; two committed onto the
  coordinator clone's `master`). The owner has ruled `master` a scratch surface, so this is
  tolerated — but a lane's first command should still be `pwd` + `git rev-parse --show-toplevel`.
- Reviewing a staged diff before committing is not optional: a "migration" that deleted
  2,703 lines was committed and pushed in one step and had to be reverted.
