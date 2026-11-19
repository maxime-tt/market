# Increment 1 — the routing table and the page store, end to end

Branch: `d7s2/routing-page-store`, off `d4aba3db6` (the `unite/1420-all` tip).
Commit: **`690a35d2331febdfcd24c13093a11574c945483a`** — pushed to **`fork` and `nostr`**, read back from both.
Worktree: `/home/admin_maxime/work/wt-routing-1`.

**Who measured what.** This slice was built by a child that died mid-run and never
wrote its report (its log stops at 22:30 on 2026-11-13, mid-probe). The work
survived uncommitted in the worktree. **Every number below was re-measured by the
parent on 2026-11-14 against the committed tree**, not inherited from the child.
Where the child's own claims could not be reproduced, that is said so.

## Files

Created — **13**, exactly the plan's §1.1 list:

```
platform/server/routes/routeFile.ts        (473)   load/validate/serialize/writeAtomic/lookup/prefixMatch
platform/server/routes/resolve.ts           (77)   the three-rung ladder, pure, no I/O
platform/server/routes/pageStore.ts        (134)   the local store: put/get/series index/writeAtomic
platform/server/routes/pageRender.ts       (126)   static → HTML; data-bound → a placeholder region
platform/server/routes/pageHtml.ts         (106)   head meta + fragment + SPA bootstrap + #__AR_PAGE__
platform/server/http/appEvents.ts          (174)   POST /api/app-events — the ONE ingest surface
platform/server/routes/routeFile.test.ts   (253)
platform/server/routes/resolve.test.ts     (108)
platform/server/routes/pageStore.test.ts    (92)
platform/server/routes/pageRender.test.ts   (51)
platform/server/routes/pageHtml.test.ts     (54)
platform/server/routes/pagesHttp.test.ts   (310)   the write restriction, end to end
sdk/config/routeNames.ts                   (102)   RESERVED_NAMES (37) + NAME_PATTERN
```

Fixtures: `data/routes.example.json`, `data/pages.example/example.json` — committed, not loaded by default.

Modified — **6**. The plan's §1.1 listed three; the other three are required by
its own later sections, and each is named below rather than folded in silently:

- `platform/web/app/entry.tsx` — loads the routing file before `buildServer` (§1.1).
- `platform/server/buildServer.ts` — mounts the resolver and pages routes in front of the SPA catch-all (§1.1).
- `sdk/config/vanity.ts` + `platform/server/VanityManager.ts` — the 37 reserved names now exist once, in `sdk/config/routeNames.ts` (§1.6).
- `platform/boundary.test.ts` — one **named** allowlist entry for `pageRender.ts` (§1.4.2 / §11 R-1).
- `platform/server/startup.ts` — a relay outage degrades settings discovery, not serving (§1.7 E3).

`data/routes.json` is **not committed** (§9: "backed up, monitored, and not
version-control'd by default"). It exists in the worktree for the boot run below
and was restored to an empty table afterwards.

## Evidence, re-measured

| # | command | result |
|---|---|---|
| E1 | `bun test --isolate platform/server/routes/` | **66 pass, 0 fail**, 153 expect() calls, 6 files |
| E2 | `bun test --isolate platform/server/routes/resolve.test.ts` | included above; the no-network mock is the suite's `fetch`-throws case |
| E3 | boot with `APP_RELAY_URL=wss://127.0.0.1:9`, ingest, curl | **verified end to end** — see below |
| E4 | corrupt `routes.json` | boot refused, message names the file and the JSON position |
| E5 | `"path":"api"` | boot refused, `app-owned-name: api is part of the URL space` |
| E5b | `"path":"dashboard"` | **exit 0** with `compiled-in-path: the binding on dashboard supersedes a compiled-in route` |
| E6 | `"meaning":"lease","path":"shop/x"` | boot refused, `lease-must-be-top-level` |
| E7 | `routeFile.test.ts` + `pageStore.test.ts` | **25 pass, 0 fail** — `.bak` holds the previous bytes |
| E8 | grep `fetch(\|ndk\|Relay` over the 6 modules | **0 hits** |
| E11 | `tsc --noEmit` before/after | **205 → 205**; no error in any new file |
| E12 | `bun test --isolate sdk/boundary.test.ts platform/boundary.test.ts ui/boundary.test.ts` | **7 pass, 0 fail** |
| E13 | `git status --porcelain` | the 13 + 6 files above; `ui/storefront/` and `routeTree.gen.ts` untouched |
| E14 | `grep -rn "pages/publish"` / `app-events` | **0** / one registered route |

**E3, the whole claim in one run.** With the relay pointed at a dead port the
process boots (`🚀 Server running at http://localhost:3100/`; the settings fetch
fails and is logged as `⚠️ App settings unavailable; serving from local state: No
relays connected`), a signed 30024 with `d=shop` ingests (`200 {"stored":true,…}`,
store written to `data/pages/<author>/shop.json`), and:

- `GET /shop` → **200**, 2737 bytes, **1** `<h1`, `og:title` present, the static
  marker `NEEDLE-42` present, and the data-bound block emitted as
  `data-ar-block="ProductGrid"` — **with no JavaScript executed**;
- `GET /nothing` → **404** (a real 404, not the SPA shell);
- two requests, `sha256sum` identical (`396252f4…`).

## Two corrections to the plan, both measured

1. **E3's command cannot work as written.** It boots and curls **`/x`** — but the
   shared name grammar (`/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/`, §1.2) refuses any
   name shorter than three characters, so the file is refused at boot
   (`/bindings/0/path: "x" does not match the name grammar`). The end-to-end run
   above uses **`shop`**. The implementation is right and the plan's example is
   wrong; recorded rather than worked around.
2. **E11's "identical list" needs a caveat that is not ours.** The sorted error
   lists differ in exactly two ways, both environmental: the worktree path appears
   inside node_modules diagnostics (`…/wt-union-1420/…` vs `…/wt-routing-1/…`), and
   two `relay-applesauce-semantics.test.ts` errors differ because the two worktrees
   hold different installs of `applesauce-relay-hermetic`. Source errors: 0 new.

`format:check` **fails on the base too** — 35 files, all pre-existing
(`ui/storefront/StorefrontRenderer.tsx` among them); **none** of this slice's
files are flagged. So E12's format half is unmet by the tree, not by this change.

## Not verified, and why

- **E10b (hydration parity)** needs a browser: Playwright over a served page with
  the client bundle, comparing the placeholder's `innerHTML` before and after
  hydration. Not run. The mechanism it tests — the `#__AR_PAGE__` seam applying the
  slot map *after* hydration — is increment 3's client work and is not in this
  slice; the server-side half (slot-less rendering) is asserted by
  `pageRender.test.ts`.
- **E2's precise claim** ("no `fetch`/NDK call is reachable") is asserted inside the
  suite by making every outbound fetch throw, which the suite does; it is not
  re-asserted here as a separate harness.

## What increment 1 does not do

No lease write path, no payment, no `may()`, no `grants`, no `series` target, no
management UI, no client routing change beyond the hydration seam, no widget layer,
no removal of `VanityManager`/`ZapPurchaseManager`. Nothing is deployed.
