# B2 — the broken home test: cause, fix, and what it reveals

Branch `d7s2/home-test-dep-fix` from `f6e681d92`. Worktree `/home/admin_maxime/work/wt-home-test`.
**No source file was changed.** The fix is an install, and the evidence below says why that is the honest fix
rather than a shortcut.

## 1. The cause, measured

**The dependency is declared, locked and installable. It was simply not installed.**

| claim | measurement | verdict |
|---|---|---|
| declared? | `package.json:50` → `"@getalby/sdk": "8.0.3"` | **yes** |
| locked? | `bun.lock:14` (dep list) and `bun.lock:175` → `@getalby/sdk@8.0.3` + sha512 integrity | **yes** |
| does 8.0.3 ship `./nwc`? | registry `exports` for 8.0.3: `. /nwc /oauth /utils /webln /lnclient`; `"./nwc" → dist/esm/nwc.js` | **yes** |
| present in the base checkout's `node_modules`? | `ls node_modules/@getalby/` → `lightning-tools` only — no `sdk` | **no** |
| why it went missing | `51d3c3c21` (2026-10-19 16:13) added the line to `package.json`; `node_modules/@getalby` is stamped **Oct 16 18:14** — three days *earlier* | **stale install** |

So: not a mis-declaration, not a renamed module, not a resolution-config problem, not a transitive import that
used to resolve. The base checkout's `node_modules` predates the commit that declared the package, and nobody
re-ran `bun install` afterwards. CI is not affected — every workflow runs `bun install --frozen-lockfile`
(`.github/workflows/ci-unit.yml:64`, `deploy.yml:33`, `e2e.yml:68`, …), so this is a **local-checkout defect**,
which is exactly why it reads as "pre-existing on master" and never shows up in CI.

### The controlled A/B (single variable)

In the worktree, with deps installed from the lockfile, I removed *only* `node_modules/@getalby/sdk`:

```
$ mv node_modules/@getalby/sdk <hold>
$ bun test platform/web/browse/BrowseIndexHost.test.tsx
error: Cannot find module '@getalby/sdk/nwc' from '<wt>/sdk/commerce/payments/state/wallet.ts'
 0 pass / 1 fail / 1 error

$ mv <hold> node_modules/@getalby/sdk
$ bun test platform/web/browse/BrowseIndexHost.test.tsx
 42 pass / 0 fail / 158 expect() calls
```

Nothing else in the tree moved. The package's presence is the whole difference.

### The import chain (why a browse test needs a wallet package at all)

`platform/web/browse/BrowseIndexHost.test.tsx` → `BrowseIndexHost.tsx:54`-ish region →
`platform/web/auth/authStore.ts` → `platform/web/config/walletStore.ts:34,38` → `sdk/commerce/payments/state/wallet.ts:34`
→ `import { NWCClient } from '@getalby/sdk/nwc'`. 325 modules are reachable from the test. The test stubs the
read hosts and auth with `mock.module`, but Bun still resolves `walletStore`'s static import graph, so the
package has to exist on disk for the file to load. That is normal app wiring, not a defect in the test.

## 2. The fix

```
$ bun install --frozen-lockfile     # in the worktree; package.json and bun.lock untouched
+670 packages installed [2.11s]
$ ls node_modules/@getalby/  →  lightning-tools  sdk   (8.0.3)
```

No `package.json` edit was needed, so none was made — the declaration was already correct. Nothing in the test
was deleted, skipped or stubbed. The lockfile was not regenerated (`--frozen-lockfile` would have failed if it
disagreed with `package.json`).

## 3. What the test asserts, now that it runs

**42 tests, 0 failures.** Grouped by what they pin down:

- **split view (14)** — `?p=` opens the product panel *beside* the results and marks the card; a bare `?p=` deep
  link on the home still opens the panel instead of an empty grid; the detail read is given the relays the
  search hit arrived on, and falls back to the app read context when the hit recorded none; exactly one panel
  mounts for `?q=` + open product; loading / empty / error states of the panel each render distinctly; no split
  while the search itself is loading; a category browse keeps the results base state.
- **card sizing (1)** — a card is the same width with and without the panel (the track sizing is explicit).
- **idle index (7)** — hero stats, wall strips and category rows come from the feed; wall tiles state the
  seller's name, not a pubkey prefix; product surfaces are real links (deep link + seller profile); a category
  row count states the *loaded* items, never the frame total; no hero numbers before the feed loads; a failed
  category read reports the failure instead of an empty section; the placeholder row shows while streaming.
- **facet pills (5)** — pills render the probe's market counts (not a count of the loaded window); the
  unfiltered probe is asked even while a filter is selected; expansion happens from a real control, capped at six.
- **seller identity (2)**, **listing truth (2)** — resolved name/picture vs. tinted-disc prefix fallback; the
  listing's image tag is the shot with art only as fallback; a fiat listing renders in its own unit, never as sats.
- **search field (5)** — the nav band renders exactly once in every state; it is the *same element* in the idle
  and results trees; the compact field is the one on screen when a product is open; the hero placeholder states
  the loaded count, not the market total.
- **relay indicator (2)**, **family options (2)**, **streaming results (2)** — fetching state, settled relays +
  count; the open family's panel offers its options defaulting to the first available, a simple product opens no
  family read; products delivered so far render while the read runs, and a read that stops without a verdict says
  so rather than stating a count as the answer.

These are real behavioural assertions (158 `expect()` calls), not smoke. The home now has its regression net back.

Whole directory, in the form the gate battery uses:

```
$ bun test --isolate platform/web/browse/     → 168 pass / 0 fail / 496 expect()
```

**Note (not fixed, pre-existing):** *without* `--isolate` the same directory gives `153 pass / 15 fail` — the
`BrowseIndexHost` cases fail because `mock.module` registrations leak between files in one process. That is a
test-isolation property of the suite, not of this fix; the battery uses `--isolate`, and the file's own header
says so. Flagging it because a bare `bun test platform/web/browse/` is a red herring for whoever runs it next.

## 4. Typecheck

| | command | count |
|---|---|---|
| before (base checkout, as the order defines it) | `NODE_OPTIONS=--max-old-space-size=12288 bun bunx tsc --noEmit` | **522** — as stated |
| after (clean worktree @ `f6e681d92`, lockfile install) | same | **205** |

The 3 `TS2307: Cannot find module '@getalby/sdk/nwc'` lines
(`platform/web/payments/paymentPublish.ts:21`, `sdk/commerce/payments/state/wallet.ts:34`,
`sdk/core/nwc-wrapper/ts/session.ts:16`) are **gone**. No new repo-source error appears.

**But the 317-line drop is mostly not this fix, and that matters for the run:**

- **193** of the base's 522 error lines are in files that do not exist in git at all — they are untracked
  scratch in the dirty base checkout: `src/` (a whole untracked tree, e.g. `src/components/ui/browse/product-card.tsx` 23),
  `notes/pr-1226-orderdetail-descriptor-view.tsx` (72), `runs/union-1420/...` (43), `runs/pr-1289/*` (31+).
  `tsconfig.json` includes `**/*.ts,**/*.tsx` with no exclude, so they are typechecked.
- **134** more are on tracked files but vanish once `node_modules` matches `bun.lock`. Beyond `@getalby/sdk`, the
  stale install is missing `applesauce-signers` (9 errors) and has an older `@cashu/cashu-ts` (33 errors: no
  `Amount`/`Mint`/`Wallet` exports) and no `@types/debug` types (3).
- **+10** errors exist only in the fresh install, all inside `node_modules` declaration files (`@types/debug`
  absent for other packages' d.ts, `applesauce-relay-hermetic/dist/*.js` absent).

**Consequence for the parent:** "522" is reproducible *only* in that dirty checkout. A clean worktree at
`f6e681d92` with a lockfile install typechecks at **205**. Whoever verifies "before and after" must pin the
environment or they will read the untracked `src/` tree as a 300-error regression. The three `@getalby/sdk/nwc`
lines are the part of the 522 that this slice actually removes.

## 5. Deliberately NOT fixed

- **`@webbtc/webln-types`** — 2 `TS2307` errors from `@getalby/lightning-tools`'s own `.d.ts` (line 86–87 of the
  before output). The fresh lockfile install does not bring it either; it is a transitive typing gap in that
  package, not a declaration we own. Still 2 errors after.
- **`@types/debug` / `applesauce-relay-hermetic` d.ts gaps** — 10 `node_modules`-internal errors in the fresh
  install. Not repo source; would be a separate dependency-hygiene change.
- **The stale base checkout's `node_modules`** — I did not repair it. Re-installing there could reshape the tree
  (Bun 1.4 layout) under a live sibling run. The one command that repairs it is
  `cd /home/admin_maxime/work/market && bun install --frozen-lockfile`.
- **The `--isolate` leak** in `platform/web/browse/` — pre-existing, outside this slice.
- **No production bug surfaced.** The test is green on real behaviour; there is nothing to hand back as a
  finding about the home itself.

## 6. Files

- `runs/2026-11-13-auctions-ui/B2-home-test-dep-fix.md` (this report)
- `runs/2026-11-13-auctions-ui/evidence/01-before-and-ab.txt`
- `runs/2026-11-13-auctions-ui/evidence/02-declared-and-locked.txt`
- `runs/2026-11-13-auctions-ui/evidence/03-fix-and-test.txt`
- `runs/2026-11-13-auctions-ui/evidence/04-typecheck.txt`

No change to `package.json`, `bun.lock`, or any file under `sdk/`, `platform/`, `ui/`.