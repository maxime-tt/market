# `inc/wave-b` handover — the cashu stack bump and the src/ import-cycle work

**For:** whoever rebases the UI migration (or the ADR-0002 relay-I/O stack) onto this branch.
**Branch:** `inc/wave-b`
**Base:** `fedab687` (`docs: §9.11 — the store is deleted and the wallet state is coco's (NDK cut, part 18)`)
**Remote:** `fork` → `github.com/maxime-tt/market`, branch `inc/wave-b` at `fedab687` before this push.
**Worktree:** `/home/admin_maxime/work/pr1420-inc-p6`

> **This is deliberately not 100% complete.** It is the cashu 2.0 bump (finished, verified) plus
> the _enabling_ work for the `src/` retirement (cycle-breaking, shim removal, one platform
> retarget). The actual migration of `src/` modules into `sdk/` is blocked on one decision recorded
> in §6, and nothing in this branch pretends otherwise.

---

## 1. Status in one line

`src/` is still importable and still holds the app-level modules, but the import graph no longer
contains a 36-file knot, the four dead re-export shims are gone, and the cashu stack is on
`@cashu/coco-core@2.0.0` + `@cashu/coco-indexeddb@2.0.0` + `@cashu/cashu-ts@5.0.0-rc.4`. All four
gates are green at this commit (§5).

## 2. What landed (10 commits, oldest → newest)

6071efdb wallet: the cashu stack moves to coco 2.0 and cashu-ts 5 (B2a)
bbde01f9 docs: §9.12 — the cashu stack is coco 2.0 + cashu-ts 5, and the gate is closed
45b89e82 platform: move the src-free auction-validator tests beside the code they test
c2ee2d24 src: delete four re-export shims nothing imports
4a40ca94 platform: import the Nostr event helpers from @sdk/core, not the src shim
f14b8038 stores: the ndk store stops importing the wallet - the 36-file cycle is cut
2240370a nostr: the relay-list read stops coupling the query layer to the ndk store
25427920 wallet: the NWC reads stop coupling the ndk store to the query layer
c036e632 nostr: split the io port's contract out of the module that imports its adapters
12d40e54 payment: publishing a payment detail belongs in publish/, not in the read layer

`6071efdb` + `bbde01f9` are the wave-B B2a stage; §9.12 of
`docs/handover/wave-b-ui-components-handover.md` is its record. The other eight are this branch's
own work and have no other documentation — this file is it.

## 3. Public-surface changes a rebase has to handle

**Dependencies.** `package.json` and `bun.lock` changed. The removed package names are gone for
good: `coco-cashu-core` → `@cashu/coco-core`, `coco-cashu-indexeddb` → `@cashu/coco-indexeddb`,
`@cashu/cashu-ts` `^2.1` → `5.0.0-rc.4`, and the `patchedDependencies` block plus
`patches/coco-cashu-core@1.0.0-rc11.patch` are deleted. Anything touching cashu must use the v5
API surface — see §4 of the wave-B handover for the call-site rules that were needed
(`Mint`/`Wallet` renames, `Proof.amount` as an `Amount` value object, `getDecodedToken(token, ids)`
taking keyset ids, `new Mint(url, { customRequest })`, no `@cashu/cashu-ts/crypto/*` subpaths).

**New modules (all inside `src/`, all leaf modules with no store coupling):**

- `src/lib/nostr/io-types.ts` — the Nostr I/O port's contract. `src/lib/nostr/io.ts` re-exports the
  whole type surface, so existing `import type { NostrIo | NostrFilter | NostrEvent } from
'@/lib/nostr/io'` sites are unaffected.
- `src/lib/nostr/relayListRead.ts` — `fetchUserRelayListWithPreferences(ndk, userPubkey)`.
- `src/lib/wallet/nwcWalletRead.ts` — `fetchUserNwcWallets(ndk, userPubkey)`,
  `fetchNwcWalletBalance(ndk, nwcUri)`, `NwcBalance`.

**Signature changes (breaking for callers):**

- `walletOps.initialize()` no longer takes a pubkey — it never read it.
- The three `fetch*` functions above take the ndk instance as their first argument; the React hooks
  in `src/queries/{relay-list,wallet}.tsx` bind them to the store's connection, so hook callers are
  unaffected.
- `USER_NWC_WALLET_LIST_KIND` / `..._LABEL` are no longer re-exported from `src/queries/wallet`.
  They had no consumer; import them from `@sdk/commerce/payments`.

**Moved:**

- `PublishPaymentDetailParams`, `publishPaymentDetail`, `usePublishPaymentDetail`:
  `src/queries/payment.tsx` → `src/publish/payment.tsx`. `paymentMethod` is now typed
  `PaymentDetailsMethod` (the `PaymentMethod` alias stayed behind with the read-side types).
- 6 tests: `src/lib/__tests__/auctionValidator{Index,ObservedAtRecovery,PendingBuffer}.test.ts` →
  `platform/server/auction-validator/`, and `cvm-server-key`, `ogMeta`,
  `server-bootstrap-persistence` → `platform/server/`. Platform's convention is co-located tests,
  which is what these now are.

**Deleted:** `patches/coco-cashu-core@1.0.0-rc11.patch`,
`src/components/shared/SelectableBadge.tsx`, `src/lib/auction/immutability.ts`,
`src/lib/cashu/p2pkSecret.ts`, `src/lib/checkout/deliveryRequirements.ts` — the last four were
re-export shims with no consumer anywhere.

**Behaviour-adjacent — read this if the UI migration touches sign-in.** The NIP-60 Cashu bootstrap
and its teardown moved out of `src/lib/stores/ndk.ts` into `src/lib/stores/auth.ts`
(`bootstrapCashuWalletInBackground`, called at all three sign-in sites, `walletOps.reset()` on
logout). Same fire-and-forget semantics, same position alongside the relay-list and NWC steps. The
one observable difference is a log prefix, `[ndk]` → `[auth]`.

**Shared mutable file:** `scripts/src-boundary-baseline.txt`. Both branches will want to edit it.
The rule is in its header — lower the matching lines in the same commit that lowers a count. Whoever
lands second must re-run `bash scripts/check-src-boundary.sh` and reconcile rather than take either
side.

## 4. Rebase mechanics

    git fetch fork
    git rebase fork/inc/wave-b        # after this branch is pushed
    bash scripts/check-src-boundary.sh

Expect conflicts in the areas this branch rewrote: `src/queries/{payment,wallet,relay-list}.tsx`,
`src/publish/{auctions,payment}.tsx`, `src/lib/nostr/io.ts`, `src/lib/stores/{ndk,auth,walletOps}.ts`,
`src/lib/wallet/*`, `platform/server/**` (test locations), `platform/web/routes/**` (import lines
only) and `scripts/src-boundary-baseline.txt`.

The boundary guard is the acceptance test for a rebase: it must print `OK`, and if any count fell,
the matching baseline line should be lowered in the same commit.

## 5. Verification at this commit — what was measured

- `npx tsc --noEmit` → **264** errors against the **264** baseline. Equal, no new error site.
  The repo carries pre-existing type debt; the rule used throughout was _no new error site_, never
  zero.
- `bun run test:unit` → **2725 pass / 0 fail / 7546 expect() across 260 files**, unchanged across
  every one of these commits (so no test silently stopped being collected).
- `bun run format:check` → clean.
- `bash scripts/check-src-boundary.sh` → `OK`, every direction at or below its baseline.

**Not run, do not assume:** `bun run test:integration` (it starts the local nutshell mint, which
needs explicit approval per `AGENTS.md`), the Playwright e2e suites, any deploy. No live-instance
verification was done on this branch.

**Pre-existing errors worth someone's attention (deliberately not fixed here):**

- `src/publish/payment.tsx(155,88)` — a `string | string[]` coordinates union reaches a key factory
  that takes a string.
- `src/publish/payment.tsx(206,5)` — `useOnChainPaymentDetailMutation` passes
  `paymentMethod: 'on-chain'` while `PAYMENT_DETAILS_METHOD` in `src/lib/constants.ts` declares only
  `'ln'` (its `'on-chain'` key is commented out).
- `src/lib/stores/ndk.ts(380,15)` — an implicit `any` parameter.

## 6. The blocked decision (the reason the migration is not done)

**The frozen `src -> sdk` line, and the amendment I recommend.**

`scripts/src-boundary-baseline.txt` allows each direction to fall only. Re-pointing a consumer that
lives _inside_ `src/` onto `@sdk/...` therefore **raises** the frozen `src -> sdk` count — the old
same-tree import was never counted, the new absolute one is. That is not cementing `src/` in place;
it is the mechanism of draining it, but the counter cannot tell the two apart.

Two options, and the recommendation:

- **(a) Raise the line, paid for.** Recommended. Amend the rule so a raise is legal only in a commit
  that **deletes the `src/` module it replaces** and **states the ceiling** it raises to. That keeps
  the guard's real purpose — no half-migrations leaving a dead `src/` original behind, which is the
  failure the sibling retarget commits tracked — while allowing travel. Each raise is then paired
  with a real reduction in `src/`, and the number falls again as the remaining consumers drain.
- **(b) Hold the freeze.** Continue with cycle work and platform/ui-side retargets only. Measured
  ceiling of this path: the dead shims are gone, the remaining cycles are _enablers_ rather than
  movement, and `platform -> src` is 406 imports across 64 files that reach into src's real modules
  (`stores/auth` 24 consumers, `stores/ndk` 17). Those cannot move without (a).

If (a) is chosen it is an architecture decision and wants an ADR line (or an amendment to the guard's
header), not just a baseline edit — this document deliberately does not make that call.

## 7. Next targets, in dependency order

1. **`src/lib/nostr/relayListRead.ts` → `sdk/core/relays`** and
   **`src/lib/wallet/nwcWalletRead.ts` → `sdk/commerce/payments`.** Small, both delete their `src/`
   original in the same commit, and both give (a) its first honest test at a size where getting it
   wrong is cheap. Prerequisite: `sdk/core/relays` is one of nine `sdk/core` directories with no
   `<module>.md`, so its spec has to be written as part of the move.
2. **Do not start with the io seam.** `src/lib/nostr/io.ts` belongs to ADR-0002 — its own header
   says `io-ndk.ts` and the NDK singleton are deleted in Wave D, and there are unmerged
   `wave-0/io-seam-and-ci-guard` and `feat/applesauce-wave-a1b-flip` branches on the remote. That
   seam's migration is theirs to sequence. Note that `sdk/core/nostr-io` is already a complete,
   spec'd module (`createNostrIo`, `toUpstreamPool`, `RelaySeamError`, `MAX_EVENTS_PER_READ`, over
   `applesauce-relay`), so that collision is a deletion job, not a build job.
3. Remaining import cycles, all now small and independent (§8): `stores/product` ↔
   `utils/productFormStorage` (needs the six form types moved out of `stores/product.ts` — they
   cannot live in the storage because the store's own consumers import them from the store);
   `sdk/core/nostr-io/ts/{errors,types}` (inside the SDK tree, independent of `src/`); and the cart
   4-cycle (`cart-persistence`, `stores/cart`, `queries/cart`, `queries/v4v`).
4. The wallet/money 11-cycle is the largest and contains the cashu work from `6071efdb`; it is the
   natural place to apply (a) at scale.

## 8. Measured architecture state at this commit

**Cross-tree footprint** (`bash scripts/check-src-boundary.sh`):

- `platform/ -> src/` production: **406 imports / 64 files** (was 410 — the platform retarget)
- `src/ -> platform/` production 28 / 23, test **22 / 11** (was 31 / 17 — the test move)
- `src/ -> ui/` production 239 / 120 (was 241 — two shims deleted)
- `src/ -> sdk/` production 161 / 118 (was 165 — three shims deleted), test 8 / 7
- `ui/ -> src/` and `sdk/ -> src/`: **0 / 0**, both already clean

**Import cycles** were one strongly-connected component of 36 files (86 internal edges, spanning
`platform/web`, `src/lib`, `src/queries`, `src/publish`). They are now four:

- 11 — wallet/money: `stores/auth`, `stores/cashu`, `stores/walletOps`, `wallet/*`,
  `auction/bidderRecords`, `sdkAdapters`, `publish/auctions.tsx`
- 4 — cart: `cart-persistence`, `stores/cart`, `queries/cart`, `queries/v4v`
- 2 — `stores/product` ↔ `utils/productFormStorage`
- 2 — `sdk/core/nostr-io/ts/{errors,types}`

**`src/lib/stores/ndk.ts` is out of every cycle** — the highest fan-in contract in the tree at 96
dependents. Its out-edges are now `@/lib/constants`, `@/lib/relay-policy`, the config store, the
wallet store and the two new read modules, all leaves or lower layers. **It is extractable**, which
was the point of the cycle work.

## 9. Traps that cost real time here (do not re-derive)

- **Moving a test out of `src/` can create a NEW cross-tree edge.** Tests under
  `src/lib/__tests__/` that exercise `platform/` code often reach into `src/` by _relative_ path
  (`../cashu/nut7`, `../auction/events`). From `src/` those are same-tree and uncounted; from
  `platform/` the same line becomes a forbidden `platform -> src` edge, and type-only ones still
  fail tsc (`TS2307`). Detect them with `grep -nE "from '\\.\\.?/"`, not only by looking for `@/`.
  Moving three of them turned 264 tsc errors into 267, which is how it surfaced.
- **A re-export detector written with `;` splitting lies.** `src/lib/constants.ts` looks like a shim
  because it contains `export { ... } from '@sdk/core/geo'` — it is a real module that merely also
  re-exports. Decide shim-ness structurally: strip comments, `re.sub` every
  `export (*|{|type {) ... from '...'` statement out, and require the remainder to be empty. Read a
  file in full before deleting it, and back a zero-consumer claim with a grep across every tree.
- **Rank single-edge removals before choosing one.** Of the 36-file knot's 86 internal edges,
  exactly one collapsed it (36 → 9); the next best bought 36 → 30. Simulate, don't eyeball.
- **Simulate the obvious fix too — it can be worse.** Moving the wallet bootstrap to `auth.ts` _adds_
  `auth -> walletOps`, which closes `auth -> walletOps -> cashu -> auth` and leaves an 11-file group
  instead of 9. It was taken anyway, deliberately, because the alternative needed a
  load-order-guaranteed wiring point that would have added a `platform -> src` edge.
- **Keep the import census neutral when you move a function.** A moved function that drags an
  `@sdk/...` import must have that import deleted (and any dead re-export) on the old side in the
  same commit, or `src -> sdk` rises. That is how the two read-module moves stayed neutral.

More detail, including the full cycle history: the `src-boundary-guard.md` reference in the
`plebeian-market-engineering` skill.

## 10. Branch neighbours to reconcile with

All unmerged at the time of writing, all sharing ancestry around `a93c5f2d`:

- `core/*` (16 branches) — the module extraction line: `core/bolt11-rail`, `core/compose-bolt11`,
  `core/funds-port`, `core/reclaim-statement`, `core/relay-event-access`, `core/relay-event-store`,
  `core/relay-layer`, `core/relay-relay-config`, `core/validation-layer`,
  `core/validation-contribution`, `core/verify-contract`, `core/repoint`, `core/repoint-dm`,
  `core/repoint-events`, `core/migration`.
- `inc/shim-retargets`, `inc/shim-retargets-2` — the same shim-retarget pattern, on a different base.
  They retargeted `platform/` consumers only (17 edges, `platform -> src` 429 → 412 on their tree);
  this branch's equivalent work is `4a40ca94`.
- `wave-0/io-seam-and-ci-guard`, `feat/applesauce-wave-a1b-flip` on both remotes — ADR-0002's stack.

None of these were merged during this work, so nothing here assumes their contents.

## 11. Module map — the remainder in the units the work is done in

File counts are a rough measure. The method's unit is a **module**: a directory plus a
`<module>.md`, extracted in one commit that deletes its `src/` original. Measured at `e45659d9`
(the 169 production files `platform/` reaches), the queue groups like this.

Each entry: files · platform importers · total dependents (all four trees) · knot status.
"Platform imports" lists what actually crosses the boundary — the contract.

**Module-scale candidates**

1. **The read layer — `src/queries/`** — 22 files · 43 platform importers · 188 dependents
   - job: read relay data into the typed query options and view types the routes render.
   - contract: `auctionKeys`, `auctionQueryOptions`, `collectionByIdQueryOptions`,
     `OrderWithRelatedEvents`, `PaymentDetail`, `RichPaymentDetail`, `UserNwcWallet`, …
   - knot: **1 member**, `queries/v4v.tsx` (in the cart 4-cycle). Everything else is clean.
   - verdict: `extract` after cutting `v4v` — the largest single win in the queue.
2. **The app stores — `src/lib/stores/`** — 13 files · 40 platform importers · 209 dependents
   - job: hold the app's session, relay, cart, wallet, config and UI state, with their actions.
   - contract: `authStore`/`authActions`, `cartStore`/`cartActions`, `configStore`/`configActions`,
     `cashuStore`, `blacklistStore`, `Wallet`, `PendingToken`, `RichShippingInfo`, …
   - knots: **4 members** — `auth.ts` (73 dependents, 24 platform), `cart.ts`, `walletOps.ts`,
     `product.ts`.
   - verdict: `extract` the clean members; `knot` for the four, which is what the paid-for-raise
     work in §6 is for.
3. **The publish layer — `src/publish/`** — 13 files · 15 platform importers · 44 dependents
   - job: build, sign and publish the app's events.
   - contract: `publishPaymentReceipt`, `publishOrderWorkflowWithDependencies`,
     `addToFeaturedAuctions`/`Collections`/`Products`/`Users`, `addToBlacklist*`, `ShippingFormData`, …
   - knot: **1 member** — `publish/auctions.tsx` (in the wallet/money 11-cycle).
   - verdict: `extract`; `auctions.tsx` waits on the wallet cluster.
4. **Helpers — `src/lib/utils/`** — 11 files · 12 platform importers · 38 dependents
   - job: pure helpers — coordinates, sorting/filters, PII scanning, invoice sets.
   - contract: `getCoordsFromATag`/`getATagFromCoords`, `filterBlacklistedPubkeys`,
     `defaultAuctionFilters`, `PIIScanResult`, `OrderInvoiceSet`, …
   - knot: **1 member** — `productFormStorage.ts` (the `stores/product` 2-cycle).
   - verdict: `extract` after that one cut.
5. **`src/hooks/`** — 10 files · 7 platform importers · 15 dependents — **0 knots**
   - job: app-level React hooks that sync external state into the stores.
   - contract: `useAuctionWinMonitor`, `useBlacklistSync`, `useBreakpoint`, `useNip05Sync`,
     `useNotificationMonitor`, `usePIIMonitor`, `useServiceWorker`, `useV4VManager`, `useVanitySync`,
     `useEntityPermissions`.
   - verdict: `extract` — clean, small, and the easiest of the ten.
6. **Event parsers — `src/lib/schemas/`** — 5 files · 8 platform importers · 29 dependents — **0 knots**
   - job: the single definition of a valid item per event kind, applied before anything renders.
   - contract: `parseAuctionEvent`, `parseBidEvent`, `parsePathReleaseEvent`, `parseSettlementEvent`,
     `parseValidatorVerdictEvent`, `AppSettingsSchema`.
   - verdict: `extract` — but note the destination question: `AGENTS.md` ties these to the
     repository's validation doctrine ("every event kind the app renders must have a parser under
     `src/lib/schemas/`"), and no `sdk/` tree currently holds a schema level. This one needs a
     placement decision, not just a move.
7. **`src/lib/nostr/`** — 4 files · 10 platform importers · 49 dependents — **0 knots**
   - contract: `NDKEvent`/`NDKFilter`/`NDKSigner`/`NostrFilter` re-exports, `applesauceIo`,
     `getApplesauceRelayPool`, `naddrFromAddress`, `sign`.
   - verdict: **not this lane's** — this is ADR-0002's seam (§7, item 2). Listed for completeness.
8. **The auction domain — `src/lib/auction/` + `src/lib/auction*.ts`** — 5 files · 2 platform
   importers · 22 dependents
   - job: auction-specific reads and helpers beyond the SDK's auction module.
   - contract: `findBidderRecord`, `getAuctionBidderStatus`, `AuctionBidderStatusKind`,
     `PrivateAuctionClaimPayload`, `useDleqKeysetPolling`, `useNut7Polling`.
   - knot: **1 member** — `auction/bidderRecords.ts` (wallet/money 11).
   - verdict: `extract`; destination is `sdk/commerce/auctions`, which already exists.
9. **The UI components — `src/components/**`** — 74 files · 42 platform importers · 101 dependents —
   **0 knots\*\*
   - job: render the marketplace — auction views, order views, dialogs, forms, badges, cards.
   - contract: component + prop types, e.g. `AuctionCard`, `AuctionCountdown`, `AvatarUser`,
     `UserCard` (25 dependents), `ProductCard`, `TestListingNotice`, …
   - verdict: `extract`, and the destination is **`ui/`**, not `sdk/`. This is the largest block by
     file count and the least blocked: zero cycle members, 42 of its 74 files have a single platform
     consumer.

**Single-file leaf contracts worth their own commit** (high fan-in, no wrapper):

- `src/lib/utils.ts` — 5 platform importers · **47 dependents** — `cn`, `isValidHexKey`,
  `isValidNip05`, `isValidNpub`, `truncateText`. Highest fan-in leaf in the tree.
- `src/lib/constants.ts` — 7 platform importers · 30 dependents — `CURRENCIES`,
  `PRODUCT_CATEGORIES`, `SHIPPING_TEMPLATES`, `ZAP_RELAYS`, `COUNTRIES_ISO`,
  `PAYMENT_DETAILS_METHOD`, `PaymentDetailsMethod`. Not a shim: it re-exports four symbols from
  `@sdk/core/geo` but declares the rest itself.
- `src/lib/instance-config.ts` — 5 platform importers · 9 dependents.
- `src/lib/appSettings.ts` — 3 · 6. `src/lib/ogTags.ts` — 3 · 4.
- Then one-file singletons: `src/lib/queryClient.ts`, `src/lib/router-utils.ts`,
  `src/lib/zapPurchase.ts`, `src/config/*`.

**The knots, in full.** Of the 169, only **8 files** sit in a cycle: `stores/auth.ts`,
`stores/cart.ts`, `stores/product.ts`, `stores/walletOps.ts`, `utils/productFormStorage.ts`,
`auction/bidderRecords.ts`, `publish/auctions.tsx`, `queries/v4v.tsx`. Seven more cyclic files are
_not_ in the queue at all (`lib/cart-persistence.ts`, `lib/sdkAdapters.ts`, `stores/cashu.ts`,
`wallet/auctionFunds.ts`, `wallet/cashuWalletSource.ts`, `wallet/storage.ts`, `queries/cart.tsx`).
So cycle-breaking is a **15-file** problem, not a 169-file one — and it is what frees the four store
contracts with the most dependents.

_One measurement note:_ an earlier run in this session reported 9 cyclic files in the queue against
the 8 above; the two runs built their edge sets slightly differently. Treat it as 8–9 and re-measure
with `method/checks/audit.py` before quoting it.
