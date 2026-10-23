# PR #1420 — program state, and the `inc/wave-b` increment

**Compiled:** 2026-10-23 (Friday), on `blue-zone`, by the session that ran `inc/wave-b`.
**Rewritten from:** the previous version of this file (commit `767e52df`), which covered only
`inc/wave-b` and was written without reading the program's own plan documents. The earlier
measurements stand; its _placement in the program_ was under-informed. This version fixes that.
**Status of this document:** a **report with a recommendation, not an instruction.** Where the
program's own documents disagree with it, they win — they are cited by absolute path.

---

## 0. How to use this, and how to reach this machine

The reader has SSH access to this host. Everything cited below is a real path on it.

```
ssh -p 60009 admin_maxime@185.207.81.40      # hostname: blue-zone
scp -P 60009 admin_maxime@185.207.81.40:/home/admin_maxime/work/pr1420-inc-p6/docs/handover/inc-wave-b-handover.md .
```

**Read the artifacts, not this summary.** State here moves daily; this document was written the day
after the increment it describes. Every claim carries a label:

- **[V]** — I verified it myself in this session; the command is given and re-runnable.
- **[R]** — read from a document on this machine that I did **not** reproduce. A lead, not a fact.
- **[J]** — my judgement, not a measurement.

Two rules the maintainer set for this program are carried into §3:

> **Work from this week (Mon 2026-10-19 → Fri 2026-10-23) is to be taken seriously. Work from
> before this week is material to read and mine for data — not to rebase onto.**

---

## 1. This increment, in one paragraph

`inc/wave-b` — worktree `/home/admin_maxime/work/pr1420-inc-p6`, branch `inc/wave-b`, **11 commits**,
tip `767e52df` (2026-10-23), pushed to `fork` (`github.com/maxime-tt/market`), base `fedab687`.
Its merge-base with the integration branch is `74bcde43` — the integration tip — so it is the only
line stacked **directly on the current base of record** [V — `git merge-base inc/wave-b
feat/pr1420-sdk-integration`].

It is the **cashu 2.0 stack bump** plus the **import-cycle work** that unblocks the `src/`
retirement. All four gates green at the tip (§8). **It is not the program's state of record.**

---

## 2. The program's state of record — read these four first

1. `/home/admin_maxime/work/pr1420-runs/2026-10-19-sdk-integration/order.md` — **the order of
   record**: base, scope, the maintainer's instructions restated, definitions of done, entailments,
   supersession record. _2026-10-19_
2. `/home/admin_maxime/work/pr1420-runs/2026-10-19-sdk-integration/increments.md` — **the increment
   board** (550 lines): waves W0–W3; each increment's job · touch points · contract · gate · **done**
   · falsifier, with results. _2026-10-19_
3. `/home/admin_maxime/tmp/pr1420-handover.md` — **the PR-1420 review packet**: activity, evidence,
   findings, open decisions, proposed plan. _compiled 2026-10-18_
4. `/home/admin_maxime/work/CLEANUP-PLAN-sdk-architecture.md` — **both sibling PRs** (#1420 and
   #1412) side by side, with `[V]`/`[P]`/`[X]` evidence labels. _2026-10-19_

What the board says the program is [R — read this session]:

- **Base = PR #1420.** Repo `PlebeianApp/market`; branch `feat/pr1420-sdk-integration`; worktree
  `/home/admin_maxime/work/pr1420`. Run artifacts deliberately live **outside** the worktree so the
  PR carries no process files.
- **Ladder order:** strip the tree → bring the missing modules in → repoint → gates. Do not start a
  module whose contract is still under review.
- **Baseline:** `2447 pass / 0 fail / 240 files` — and the baseline is **flaky** (one run came back
  2446/1; the flaky test was never named). Treat "0 fail" as the usual result, not a hard invariant.
- **Definition of done #6**, which states the `src/` retirement better than I did:
  > _"`src/` imports nothing from `sdk/` that the ports do not declare, and `platform/` imports
  > nothing from `src/` (the loop is cut)."_
- **Standing rule:** local branch only, stop at the gate, do not merge, never push, no GitHub write.
  (This branch's push to `maxime-tt/market` was under the maintainer's explicit instruction; nothing
  was written to `PlebeianApp/market`.)
- **Out of scope:** the market-retrofit assembly's tooling, its `core/` submodule, its ngit remote,
  its `runs/` convention.

**The packet's open decision, which outranks my §9** [R]:

> _"Both branches land incompatible `sdk/core/event-store/` implementations. Integration order must
> be decided before module-level review/migration work."_

i.e. **#1420 vs #1412 first.**

---

## 3. Every piece of work, timestamped, with its most advanced state

38 worktrees, 121 local branches [V — `git worktree list`, `git for-each-ref refs/heads`]. Grouped by
the maintainer's rule: this week first, then before.

### 3a. THIS WEEK (2026-10-19 → 2026-10-23) — take seriously

**The integration branch — the base of record and the latest state of everything landed into it.**

`feat/pr1420-sdk-integration` · tip **`74bcde43`** · **2026-10-20** · worktree
`/home/admin_maxime/work/pr1420` · 840 commits ahead of `origin/master`. [V]

Its **last six commits are this week's increments**, landed under new hashes (cherry-pick/rebase, so
the increment branches' own SHAs are not ancestors — the _work_ is):

    74bcde43  cashu: never re-melt a leg that already crossed the boundary        (inc/double-melt-guard)
    d526748c  platform: retarget the remaining pure-shim imports onto the SDK     (inc/shim-retargets-2)
    50099e1c  platform: retarget auction-validator shim imports onto the SDK      (inc/shim-retargets)
    51d3c3c2  sdk: take the three payment-rail modules in as source (W1.2)        (feat/payment-rails)
    8aefffbb  ci: guard the src/ boundary with a per-direction import census      (feat/src-boundary-guard)
    a93c5f2d  sdk: strip the methodology tooling — visuals/, BPMN, per-module packaging   (W0.2)

**This week's increment branches — all already folded in, so all are working copies, not later
states:**

- **`inc/double-melt-guard`** — `pr1420-inc-p3` · tip `1223284b` · 2026-10-20 · 838 ahead.
  **Latest state = the integration tip `74bcde43`** (same subject).
- **`inc/shim-retargets-2`** — `pr1420-inc-p5` · tip `1d2a53e9` · 2026-10-20 · 839 ahead.
  **Landed as `d526748c`.**
- **`inc/shim-retargets`** — `pr1420-inc-p4` · tip `8374538b` · 2026-10-19 · 838 ahead.
  **Landed as `50099e1c`.**
- **`feat/payment-rails`** — `pr1420-w-rails` · tip `2edca7b5` · 2026-10-19 · 836 ahead. **W1.2**:
  takes `bolt11-wrapper`, `cashu-wrapper`, `nwc-wrapper` in as source, adapted to PR-1420's
  structure. **Landed as `51d3c3c2`.** [V — `git show --stat` of `core/bolt11-rail` vs
  `feat/payment-rails`: same module files, **minus** the per-module
  `package.json`/`bun.lock`/`tsconfig.json`/`evidence/`.]
- **`feat/src-boundary-guard`** — `pr1420-w-guard` · tip `4906ada9` · 2026-10-19 · 836 ahead. Origin
  of the boundary guard and its baseline. **Landed as `8aefffbb`** — the commit my own baseline was
  measured at.

**Mine:**

- **`inc/wave-b`** — `pr1420-inc-p6` · tip `767e52df` · **2026-10-23** · 903 ahead · base
  `74bcde43` [V]. The only line stacked on the _current_ integration tip. **Not folded in.**
  Contents in §6.

**Adjacent, different axis — possibly your "UI migration":**

- **`feat/cms-theme-studio`** — `market-cms` · tip `12312ef5` · **2026-10-22** · 786 ahead.
  Storefront/CMS: colourway and layout work. Merge-base with the integration branch is `eacc4256`,
  i.e. **a different, older ancestry — not stacked on the PR-1420 line** [V]. Rebasing it onto
  `inc/wave-b` would be a cross-ancestry rebase, not a fast-forward.

### 3b. BEFORE THIS WEEK (2026-10-14 → 2026-10-16) — read and mine, do not rebase onto

**The `core/*` line — 15 branches, 2026-10-14/15, all unmerged.** Worktrees `money-p1`, `money-i0`,
`money-i2`, `money-i4`, `inc1-event-store`, `inc2-relay-config`, `inc3-event-access`,
`relay-layer`, `repoint`, `rp-dm`, `rp-events`, `val-layer`, `val-con`, `val-docs`, `mr-1412`. [V]

This is the **market-retrofit assembly's** module line: its subjects carry the assembly's
methodology (minted rule IDs, `I0`–`I4` / `V4` increments, per-module manifests, `evidence/`).

- **Most advanced tip: `core/reclaim-statement` (`0dc642cc`, 2026-10-15)** — contains **12 of its 14
  siblings** [V — pairwise `git merge-base --is-ancestor`]. Then `core/compose-bolt11` (11/14),
  `core/bolt11-rail` (10/14), `core/funds-port` (9/14).
- Four are roots (0 siblings contained): `core/relay-event-store`, `core/relay-relay-config`,
  `core/relay-event-access`, and `core/migration` (the #1412 line).
- **No `core/*` branch is an ancestor of the integration branch** [V].
- **Its module content has already been carried forward:** `feat/payment-rails` → `51d3c3c2` landed
  the bolt11/cashu/nwc modules into the integration branch _without_ the assembly ceremony.

→ **For those modules, the integration branch is the later state.** The `core/*` branches remain
the right place to read the **specs** (front-matter contracts, evidence harnesses) that the
source-import dropped. See §4 for why this corrects the earlier "core might be worth rebasing onto".

**The apps + commerce line — 12 branches, 2026-10-15/16, all unmerged.** [V] A different axis
entirely: order placement, money truth, messaging, shipping, currency, and the storefront demos.

- `commerce/*` — `money-truth`, `order-placement`, `order-messaging`, `currency-conversion`,
  `shipping-read-30406` (all 2026-10-16)
- `apps/*` — `order-page`, `order-page-routes`, `order-page-relay-shipping`,
  `integration-assumptions` (2026-10-16); `rename-platform` (ADR-0021 `platform/` → `apps/`),
  `checkout-slice-1`, `demo-shop-style-and-cart` (2026-10-15)
- Worktrees: `e2e-m1/o1/o2/o3/r1/r2`, `e2e-int`, `o3-a`, `o3-b`, `demo-1`, `demo-2`, `apps-rename`

**PR #1412** — head **`9172219e`** (2026-10-15), checked out detached in
`/home/admin_maxime/work/audit-feat-architecutre`; last subject _"core: the validation contribution
path — per-kind rules declared from inside commerce (#1418)"_. Title `feat: sdk port`, branch
`feat/architecutre`, 415 files, +75,193/−4,656 [R — CLEANUP-PLAN]. **Neither PR is an ancestor of
the other**; they share base `auctions@6be7496c` and diverge at `7ad658d4` [R].

### 3c. Other machinery on this machine (not this migration)

- **Two Hermes profiles:** `maxime` (this one; `state.db` ≈1.1 GB, active today) and `vincent`
  (`state.db` ≈226 MB, last active 2026-10-22). Separate session histories and cron.
- **Cron / PR watch:** `/home/admin_maxime/.hermes/profiles/maxime/cron/jobs.json`;
  `/home/admin_maxime/.hermes/cron/data/{pr_watch_state,pr_review_ledger,pr_review_mode,weekly_report}.json`.
- **Other repos under the home directory:** `~/repos/{doop,snipe-relay,v4v-payout-node}`,
  `~/fluid-qiosks`, `~/routstrd-auth`, `~/ditto`, `~/nips_src`, `~/snipe-relay`. Unrelated projects.

---

## 4. Recommendation — explicitly non-authoritative

**Correcting the earlier message: do not rebase onto `core/*`.** [J] On content it is the most
advanced _migration_ line, but (a) it is from before this week, (b) it is the **superseded
assembly's tree** — per-module manifests, `evidence/`, the ceremony the maintainer asked to
simplify — and (c) its module content has **already** been carried into the integration branch by
W1.2. Read it for specs; do not base on it. My earlier phrasing ("core might be worth rebasing
onto") over-read its date-blind content advantage and under-read `order.md`.

**What I would base on, in order:** [J]

1. **`feat/pr1420-sdk-integration` @ `74bcde43`** — the base of record, and already the latest state
   of this week's five landed increments plus the board's first two waves.
2. **`inc/wave-b` @ `767e52df`** on top, **only if** you want the cashu 2.0 stack and the
   import-cycle work with it. It is the one line stacked directly on the current integration tip, so
   it is a clean rebase rather than a cross-ancestry one. §6 lists every public-surface change.
3. **`feat/cms-theme-studio`** only if your UI work _is_ the storefront/CMS line — and then note it
   is on a different ancestry (`eacc4256`): a merge, not a rebase-onto.

**Before any module-level migration work, settle #1412 vs #1420** [R — the packet's words]. My §9
decision below is _second_ to that: raising the frozen boundary line is pointless if the tree being
migrated into is about to be replaced by the other PR's `event-store`.

**For anything from before this week: mine it, don't continue it.** [J] The `apps/*`/`commerce/*`
line has no relationship to the `src/` retirement — if it is still live work it wants its own
decision, not a rebase onto a migration branch.

---

## 5. What the board says is still open [R]

- **Wave 0** (strip; one-install resolution) — **partly done**: `a93c5f2d` stripped the methodology
  tooling (37 files). W0.3 (prove `sdk/` resolves as plain TypeScript from one root install) reads
  as pending.
- **Wave 1** (bring the missing modules in) — **started**: W1.2 landed the three payment rails. The
  board's W1.1 (module inventory, take/merge/skip verdict per module) gates the rest.
- **Wave 2** (repoint) — **partly done**: both shim-retarget increments landed. A wholesale
  retarget of PR-1420's ~441 `platform -> src` edges is explicitly out of scope — "only the edges
  an increment needs" [R — `order.md` §7]. My increment continued that pattern where it was free.
- **Wave 3** (gates) — not reached.

---

## 6. What landed in `inc/wave-b` (11 commits, oldest → newest)

    6071efdb  wallet: the cashu stack moves to coco 2.0 and cashu-ts 5 (B2a)
    bbde01f9  docs: §9.12 — the cashu stack is coco 2.0 + cashu-ts 5, and the gate is closed
    45b89e82  platform: move the src-free auction-validator tests beside the code they test
    c2ee2d24  src: delete four re-export shims nothing imports
    4a40ca94  platform: import the Nostr event helpers from @sdk/core, not the src shim
    f14b8038  stores: the ndk store stops importing the wallet - the 36-file cycle is cut
    2240370a  nostr: the relay-list read stops coupling the query layer to the ndk store
    25427920  wallet: the NWC reads stop coupling the ndk store to the query layer
    c036e632  nostr: split the io port's contract out of the module that imports its adapters
    12d40e54  payment: publishing a payment detail belongs in publish/, not in the read layer
    e45659d9  docs: handover for inc/wave-b
    767e52df  docs: add the module map to the inc/wave-b handover

`6071efdb` + `bbde01f9` are the board's B2a stage; `docs/handover/wave-b-ui-components-handover.md`
§9.12 is its record.

**Public-surface changes a rebase must handle**

- **Dependencies.** `coco-cashu-core` → `@cashu/coco-core`, `coco-cashu-indexeddb` →
  `@cashu/coco-indexeddb`, `@cashu/cashu-ts` `^2.1` → `5.0.0-rc.4`; the `patchedDependencies` block
  and `patches/coco-cashu-core@1.0.0-rc11.patch` are deleted. The v5 call-site rules (`Mint`/`Wallet`
  renames, `Proof.amount` as an `Amount`, `getDecodedToken(token, ids)` with keyset ids,
  `new Mint(url, { customRequest })`, no `@cashu/cashu-ts/crypto/*` subpaths) are in §4 of
  `docs/handover/wave-b-ui-components-handover.md`.
- **New modules, all inside `src/`:** `src/lib/nostr/io-types.ts` (the io contract; `io.ts`
  re-exports it, so type importers are unaffected), `src/lib/nostr/relayListRead.ts`,
  `src/lib/wallet/nwcWalletRead.ts`.
- **Signature changes:** `walletOps.initialize()` lost its never-read pubkey argument; the three
  `fetch*` readers take the ndk instance first (hooks bind it, so hook callers are unaffected);
  `USER_NWC_WALLET_LIST_KIND`/`..._LABEL` are no longer re-exported from `src/queries/wallet`
  (import them from `@sdk/commerce/payments`).
- **Moved:** `PublishPaymentDetailParams` / `publishPaymentDetail` / `usePublishPaymentDetail` from
  `src/queries/payment.tsx` → `src/publish/payment.tsx`; six tests from `src/lib/__tests__/` to
  `platform/server/**`.
- **Deleted:** the four shims named in `c2ee2d24`.
- **Sign-in behaviour:** the NIP-60 Cashu bootstrap moved from `src/lib/stores/ndk.ts` to
  `src/lib/stores/auth.ts` — same fire-and-forget semantics; only observable change is a log prefix,
  `[ndk]` → `[auth]`.
- **Shared mutable file:** `scripts/src-boundary-baseline.txt` — lower the matching lines in the
  same commit that lowers a count; whoever lands second must re-run the guard and reconcile.

---

## 7. Rebase mechanics

    git fetch fork
    git rebase fork/inc/wave-b        # or trust the integration branch only, per §4
    bash scripts/check-src-boundary.sh

The guard is the acceptance test: it must print `OK`, and a count that fell should have its baseline
line lowered in the same commit. Expect conflicts in
`src/queries/{payment,wallet,relay-list}.tsx`, `src/publish/{auctions,payment}.tsx`,
`src/lib/nostr/io.ts`, `src/lib/stores/{ndk,auth,walletOps}.ts`, `src/lib/wallet/*`,
`platform/server/**` and `scripts/src-boundary-baseline.txt`.

---

## 8. Verification at `767e52df` — measured, and what was not

- `npx tsc --noEmit` → **264** errors against a **264** baseline. Equal; no new error site. The repo
  carries pre-existing type debt, so the rule was _no new error site_, never zero.
- `bun run test:unit` → **2725 pass / 0 fail / 7546 expect() across 260 files**, unchanged across
  every commit, so no test stopped being collected. (A different baseline from the board's
  2447/240 — different base; both green.)
- `bun run format:check` → clean. `bash scripts/check-src-boundary.sh` → `OK`.
- **Not run:** `bun run test:integration` (starts the local nutshell mint; needs explicit approval
  per `AGENTS.md`), any Playwright e2e suite, any deploy. No live-instance verification.
- **Pre-existing errors flagged, not fixed:** `src/publish/payment.tsx(155,88)` (a
  `string | string[]` coordinates union reaching a string-typed key factory) and `(206,5)`
  (`useOnChainPaymentDetailMutation` passes `paymentMethod: 'on-chain'` while
  `PAYMENT_DETAILS_METHOD` declares only `'ln'`), plus `src/lib/stores/ndk.ts(380,15)` (implicit
  `any`).

---

## 9. The frozen `src -> sdk` line — recommendation, qualified

`scripts/src-boundary-baseline.txt` allows each direction to fall only. Re-pointing a consumer
**inside `src/`** onto `@sdk/...` therefore _raises_ the frozen count — the mechanism of draining
`src/`, which the counter cannot distinguish from cementing it.

- **(a) Raise the line, paid for** [J; recommended *if* #1412/#1420 is settled first]: make a raise
  legal only in a commit that **deletes the `src/` module it replaces** and **states the ceiling**.
  The guard's header already sanctions a justified raise; the condition would make it explicit.
- **(b) Hold the freeze:** cycle work and platform/ui-side retargets only. Its measured ceiling is
  nearly reached — the dead shims are gone, and the remaining cycles are enablers, not movement.

**Both are second to the packet's prior decision** (§2). If `sdk/core/event-store` is about to be
replaced wholesale, the migration target itself is unsettled.

---

## 10. Traps that cost real time here

- **Moving a test out of `src/` can create a NEW cross-tree edge.** Tests under `src/lib/__tests__/`
  that exercise `platform/` code often reach into `src/` by _relative_ path (`../cashu/nut7`,
  `../auction/events`). From `src/` those are same-tree and uncounted; from `platform/` the same
  line becomes a forbidden `platform -> src` edge, and type-only ones still fail tsc (`TS2307`).
  Detect with `grep -nE "from '\\.\\.?/"`. Moving three of them turned 264 tsc errors into 267.
- **A re-export detector written with `;` splitting lies.** `src/lib/constants.ts` looks like a shim
  because it contains `export { ... } from '@sdk/core/geo'`; it is a real module that also
  re-exports. Decide shim-ness structurally (strip comments, `re.sub` out every
  `export (*|{|type {) ... from '...'`, require an empty remainder). Read a file in full before
  deleting it.
- **Rank single-edge removals before choosing one.** Of the 36-file knot's 86 internal edges exactly
  one collapsed it (36 → 9); the next best bought 36 → 30. Simulate; don't eyeball.
- **Simulate the obvious fix too — it can be worse.** Moving the wallet bootstrap to `auth.ts` adds
  `auth -> walletOps`, closing `auth -> walletOps -> cashu -> auth`: an 11-file group instead of 9.
  Taken anyway, deliberately, because the alternative needed a load-order-guaranteed wiring point
  that would have added a `platform -> src` edge.
- **Keep the import census neutral when you move a function.** A moved function that drags an
  `@sdk/...` import must have that import (and any dead re-export) deleted on the old side in the
  same commit, or `src -> sdk` rises.
- **An inherited summary can be wrong about placement.** The first version of this document was
  derived from the tree alone and missed that the program had a board, a packet and an unresolved
  two-PR decision. Read §2's four documents before acting on §9.

Deeper detail, including the full cycle history: the `src-boundary-guard.md` reference in the
`plebeian-market-engineering` skill.

---

## 11. Module map — the `src/` remainder in the units the work is done in

File counts are a rough measure; the method's unit is a **module** (a directory plus a
`<module>.md`, extracted in one commit that deletes its `src/` original). Measured at `e45659d9`
over the **169 production files `platform/` reaches** (406 import statements from 64 platform
files). Each entry: files · platform importers · total dependents (all four trees) · knots.

1. **Read layer — `src/queries/`** · 22 · 43 · 188 · 1 knot (`v4v.tsx`, in the cart 4-cycle).
   Contract: `auctionKeys`, `auctionQueryOptions`, `collectionByIdQueryOptions`,
   `OrderWithRelatedEvents`, `PaymentDetail`, `UserNwcWallet`, … **Largest single win.**
2. **App stores — `src/lib/stores/`** · 13 · 40 · **209** · 4 knots (`auth.ts` 73 dependents/24
   platform, `cart.ts`, `walletOps.ts`, `product.ts`). Contract: `authStore`/`authActions`,
   `cartStore`/`cartActions`, `configStore`/`configActions`, `cashuStore`, `blacklistStore`,
   `Wallet`, `PendingToken`. Deepest fan-in left.
3. **Publish layer — `src/publish/`** · 13 · 15 · 44 · 1 knot (`auctions.tsx`, wallet/money 11).
   Contract: `publishPaymentReceipt`, `publishOrderWorkflowWithDependencies`, `addToFeatured*`,
   `addToBlacklist*`, `ShippingFormData`.
4. **Helpers — `src/lib/utils/`** · 11 · 12 · 38 · 1 knot (`productFormStorage.ts`). Contract:
   `getCoordsFromATag`/`getATagFromCoords`, `filterBlacklistedPubkeys`, `defaultAuctionFilters`,
   `PIIScanResult`.
5. **`src/hooks/`** · 10 · 7 · 15 · **0 knots** — the easiest tier: `useAuctionWinMonitor`,
   `useBlacklistSync`, `useBreakpoint`, `useNip05Sync`, `useNotificationMonitor`, `usePIIMonitor`,
   `useServiceWorker`, `useV4VManager`, `useVanitySync`, `useEntityPermissions`.
6. **Event parsers — `src/lib/schemas/`** · 5 · 8 · 29 · **0 knots** — `parseAuctionEvent`,
   `parseBidEvent`, `parsePathReleaseEvent`, `parseSettlementEvent`, `parseValidatorVerdictEvent`,
   `AppSettingsSchema`. Clean, but needs a **placement decision**: `AGENTS.md` ties these to the
   validation doctrine and no `sdk/` tree holds a schema level.
7. **`src/lib/nostr/`** · 4 · 10 · 49 · **0 knots** — **ADR-0002's seam, not this lane's.** Remote
   branches `wave-0/io-seam-and-ci-guard` and `feat/applesauce-wave-a1b-flip` exist; `sdk/core/nostr-io`
   is already a complete spec'd module, so that collision is a deletion job.
8. **Auction domain — `src/lib/auction/` + `src/lib/auction*.ts`** · 5 · 2 · 22 · 1 knot
   (`bidderRecords.ts`) — `findBidderRecord`, `getAuctionBidderStatus`, `useDleqKeysetPolling`,
   `useNut7Polling`. Destination `sdk/commerce/auctions` exists.
9. **UI components — `src/components/**`** · **74** · 42 · 101 · **0 knots** — largest block, least
blocked (42 of 74 have a single platform consumer). Destination is **`ui/`**, not `sdk/`.

**Single-file leaf contracts worth their own commit:** `src/lib/utils.ts` (47 dependents — `cn`,
`isValidHexKey`, `isValidNip05`, `isValidNpub`, `truncateText`), `src/lib/constants.ts` (30 · 7
platform — `CURRENCIES`, `PRODUCT_CATEGORIES`, `SHIPPING_TEMPLATES`, `ZAP_RELAYS`,
`PAYMENT_DETAILS_METHOD`), `src/lib/instance-config.ts` (5·9), `src/lib/appSettings.ts` (3·6),
`src/lib/ogTags.ts` (3·4), then `queryClient.ts`, `router-utils.ts`, `zapPurchase.ts`,
`src/config/*`.

**The knots, in full.** Only **8 of the 169** sit in a cycle: `stores/auth.ts`, `stores/cart.ts`,
`stores/product.ts`, `stores/walletOps.ts`, `utils/productFormStorage.ts`,
`auction/bidderRecords.ts`, `publish/auctions.tsx`, `queries/v4v.tsx`. Seven more cyclic files are
outside the queue (`lib/cart-persistence.ts`, `lib/sdkAdapters.ts`, `stores/cashu.ts`,
`wallet/{auctionFunds,cashuWalletSource,storage}.ts`, `queries/cart.tsx`). Cycle-breaking is a
**15-file** problem, not 169 — and it is what frees the four store contracts with the most
dependents. `src/lib/stores/ndk.ts` (96 dependents, the highest fan-in contract in the tree) is now
out of every cycle and **extractable**.

_Measurement note:_ an earlier run in this session reported 9 cyclic files in the queue against the
8 above, from a slightly different edge set. Treat as 8–9; re-measure with
`python3 method/checks/audit.py . --top 25` before quoting.

**Headline file counts (at `767e52df`):** `src/` **507** source files (360 production, 147 test) —
514 at the branch base, net −7. `sdk/` 277 · `ui/` 154 · `platform/` 110. 117 of `src/`'s 360
production files already import from `@sdk`.
