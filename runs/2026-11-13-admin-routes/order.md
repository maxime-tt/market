# Work order — builder run 1: admin-managed custom routes

Frozen 2026-11-13 by the orchestrator, acting for the maintainer (Maxime). **Bounded: change it or
reject it, but do not widen it inside a run.** A run that finds the bound wrong reports that; it does
not fix it by scope creep.

> **Every factual premise stated in this file is itself a claim to test.** Where a child's measurement
> contradicts a sentence here, the measurement wins and the contradiction is a finding — say so
> explicitly rather than conforming to the brief. The citations below were verified by the orchestrator
> at the base commit named below; re-resolve them and report any drift.

## What this run is

The maintainer asked for an unblocker: **a dashboard page where an admin/editor manages custom
routes** — add, remove and modify route names and what they point at — so that a page can be
**published to a named route** instead of only to the editor's own profile address.

"He asks for an unblocker to publish to a custom route, as an admin/editor user … a page in the
dashboard to manage custom routes, add/remove/modify the names and to where they point."

**Why this is the unblocker and not a nice-to-have.** Verified at the base: the home page reads the
**app key's** kind-30024 document at `d = 'home'` (`platform/web/routes/index.tsx:57`), while the CMS
editor publishes kind-30024 at `d = 'storefront-page'` signed as the **logged-in user**
(`platform/web/storefront/storefrontPublish.ts:60`). The addresses do not meet and the signer is not
the app key, so **nothing in the UI can author the home**; it renders only its inline fallback — a
`Search` block, one `ProductRow` holding a single hardcoded d-tag, and three category links. This is
recorded at `notes/DECISION-home-composition.md` §7.

**Done** means a proposal the maintainer can accept with one word, plus increment 1 specified
precisely enough to execute without re-deriving anything.

## The base

- Specimen: `/home/admin_maxime/work/market`, branch `master`, pinned at **`2326938b3`**
  (chosen because it carries the app's routes, storefront and CMS code, plus the decision documents
  this run answers).
- **Do not read or write** `/home/admin_maxime/work/wt-e2e` (serves a live instance),
  `/home/admin_maxime/work/auctions-simplify`, or `/home/admin_maxime/work/compare/plebeian-arena-auctions`
  (another session's, mid-rebase).
- Verified by the orchestrator at that commit — the four facts the run turns on:
  - `sdk/core/curation/vanityRead.ts:5` — `export const VANITY_REGISTRY = { kind: 30000, dTag: 'vanity-urls' }`
  - `sdk/core/curation/vanityRead.ts:7-11` — `VanityEntry { vanityName, pubkey, validUntil }`
  - `platform/web/routes/index.tsx:57` — `useStorefrontAddressPage(APP_PUBKEY, 'home')`
  - `platform/web/storefront/storefrontPublish.ts:60` — `const tags: string[][] = [['d', STOREFRONT_PAGE_D_TAG]]`

## Read first, in this order

1. `notes/DECISION-home-composition.md` — especially §7, the blocker this run exists to clear.
2. `sdk/core/curation/vanityRead.ts` and `platform/web/config/vanityBinding.ts` — the route mechanism
   that **already exists**. This run extends it; it does not invent a parallel one.
3. `platform/web/routes/$vanityName.tsx` and `platform/web/storefront/StorefrontAddressPage.tsx` —
   how a name resolves today, and what a target has to be for that path to work.
4. `platform/web/storefront/StorefrontBuilder.tsx` + `storefrontPublish.ts` + `storefrontQuery.ts` —
   the editor, the publish path, and the address query.
5. `platform/web/storefront/storefrontCms.tsx` — the block registry (twelve blocks), for what a page
   can contain.
6. `AGENTS.md` at the repo root — the read-seam and boundary doctrine the change must not violate.

## Bound

**In:**

- A **route table**: named routes, each with a **typed target**. The existing registry maps
  `name → pubkey` only; the question this run must answer is what the *complete* target set is
  (profile, storefront page/address, listing, external URL …), how an unknown target type must fail,
  and how the existing `validUntil` expiry interacts with a route that has no owner to expire.
- **A default/home flag on a route.** The maintainer's own example: *"we would be registering a route
  such as `/home` and marking it as the default/home route."* So a route carries, besides its name
  and target, a marker that makes it **the site's default** — the route that `/` renders.
  **Consequences the proposal must settle, not assume:** exactly one default may exist at a time (what
  happens on a second one — refuse, or move the marker?); what the site does when the default is
  removed, switched off, or its target fails to resolve (fail back to the current inline composition,
  or an honest empty state?); whether a *deleted-name* default is recoverable; and whether the default
  may point at a target type other than a storefront page.
- **Resolution**: a named route resolving to its target, and the **home becoming a route** so it can
  be authored. Whether the home should render a page authored by an *admin's* key (indirection) or
  remain bound to the app key's own document is a **decision for the proposal, with a lean and the
  consequence stated** — do not assume either. Note the default flag above is the mechanism that
  replaces today's hardwired `useStorefrontAddressPage(APP_PUBKEY, 'home')`.
- **The dashboard management surface**: where it mounts, how it is gated to admins/editors, and how
  add/remove/modify maps onto the existing app-settings and curation write paths. Note: the existing
  registry is authored by the **app key**; an admin acting on the app's behalf is a different trust
  question from an admin editing their own page, and the proposal must address it.
- The **acceptance plan** for the change, including the negative paths (a route naming an
  unparseable, switched-off or empty document must not blank the site).

**Out, deliberately:**

- The auctions protocol work, the auction block, and the retired bidder-held-path implementation —
  separate increments, separate runs.
- The intro animation.
- **Deployment.** Nothing is deployed and no live unit is restarted by this run; the acceptance is
  specified, not executed against the live instance.
- Any change to another session's trees.

## Deliverables, and where they go

Everything lands under `/home/admin_maxime/work/market/runs/2026-11-13-admin-routes/` — **nothing is
written into the base's source tree**:

- `research/01-current-surface.md` + `research/evidence/01-current-surface.txt` — the route/vanity
  mechanism **as measured**: kind, d-tag, tag shape, author, expiry semantics, every reader and every
  writer, the dashboard surfaces that exist today, and the admin/editor gating as it is now.
- `research/02-target-and-gaps.md` + `research/evidence/02-target-and-gaps.txt` — what a managed
  route table needs versus what exists, **grading each requirement** SPECIFIED (quoting the document
  and line) / SUGGESTED / COMMON PRACTICE-OUR CHOICE. Include what the storefront address and the
  kind-30024 semantics allow, and what the existing expiry does to a route.
- `research/03-consumers-and-acceptance.md` + `research/evidence/03-consumers-and-acceptance.txt` —
  every consumer of a resolved route, the acceptance surface, and the negative paths that must be
  asserted. Name the test files that would have to change.
- `proposal.md` — the artifact the maintainer agrees: the target model, the resolution rule, the
  management surface, the trust/permission answer, the build order, the acceptance plan, and the open
  decisions each with a lean and its consequence.
- `order-increment-1.md` — increment 1 as steps precise enough to execute: exact files, exact import
  re-pointings, the evidence commands, the counts to quote before and after, and the exit criteria.

## Evidence discipline

- Every claim about code carries `file:line`; every number carries the command that produced it.
- Separate **measured** from **read from source** from **judged**. `UNVERIFIED` is a legitimate answer.
- Evidence files are generated by a committed script, never hand-edited.
- The typecheck baseline on this base is **exactly 522** errors
  (`NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bun bunx tsc --noEmit`);
  a change that adds any is not acceptable. `node_modules/.bin/tsc` is blocked by a command guard —
  use `bunx`.
- Conservation, never green: quote counts before and after any move.
- No secrets, no keys — describe identity material, never reproduce it.
- **Evidence capture hazard, met once already.** The pre-commit secret scanner blocks a staged file
  containing `Key = '<64-hex>'`, which cannot distinguish a **public** key from a private one — it
  blocked the first evidence files on `const APP_PUBKEY = '…'`, a value already committed on master
  at `platform/web/routes/index.tsx:48`. Generators should **mask key-shaped literals** in captured
  output (keep the surrounding text, replace the hex with a placeholder and say so) so the hook keeps
  meaning something. Do not reach for `--no-verify` as a habit: if a real secret is ever captured,
  the blocked file must be regenerated with it absent, not bypassed.

## Stop conditions

- **The gate is a redirection point, not a halt.** The maintainer asked for a planning **and
  implementation and review** flow, so: the proposal lands in the repo for him to read, and
  **increment 1 proceeds on its own branch** without waiting. He can redirect at the proposal — that
  is what the gate is for — but the run does not idle there.
- **Nothing is deployed.** The acceptance is specified and run locally; no live unit is restarted.
- Stop and report if the chunk cannot be specified without deciding an adjacent module's shape.
- Stop and report if the working tree disagrees with the four verified facts above at `2326938b3` —
  that is a finding about the base, not something to work around.
- Stop and report if the trust question (who may author a route, §Bound) cannot be answered without a
  ruling from the maintainer — it is the one decision that changes the shapes rather than the details.
