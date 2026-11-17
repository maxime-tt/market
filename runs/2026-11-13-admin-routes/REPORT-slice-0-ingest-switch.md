# Slice 0 — the ingest switch

Branch: `d7s2/ingest-switch` (base `0c481e5d8`). Committed locally only; nothing
was pushed and no remote was contacted.

## 1. The defect

A page published from the CMS was not a page the server could serve. The two
halves existed and nothing joined them:

* `platform/web/storefront/storefrontPublish.ts` signed a kind-30024 page event
  and published it to **relays only**. It never called `POST /api/app-events` —
  the only caller in the whole web tree was `routeTableQuery.ts:114`.
* `platform/server/http/appEvents.ts:206` is what fills the local store
  (`deps.pageStore.put(record)`), and `platform/server/buildServer.ts:105` is
  the only thing the serve path reads.
* `data/pages` does not exist in the repo (only `data/pages.example`), so
  nothing had ever been ingested.

Reproduced end-to-end over HTTP before the change — a signed page is POSTed to
the ingest (as the CMS now does) and the bound path is fetched:

```
$ bun run platform/server/routes/zz-transcript.ts        # temporary probe, since deleted; see §4
GET /shop -> 500; contains NEEDLE-42: false; binding-target-missing: true
POST /api/app-events (enabled=true) -> 200 {"stored":true,...}
GET /shop -> 200; contains NEEDLE-42: true; binding-target-missing: false
```

…and before the change, the same publish path with no ingest call at all:

```
$ bun test --isolate platform/web/storefront/storefrontIngest.e2e.test.ts
(fail) ... publish → ingest → store → the bound path answers with the page bytes
error: expect(received).toBe(expected)
Expected: 200
Received: 500
 1 pass
 1 fail
```

## 2. What changed, file by file

| file | +/− |
| --- | --- |
| `platform/web/storefront/storefrontPublish.ts` | +93 / −6 |
| `platform/web/storefront/storefrontQuery.test.ts` | +108 / −1 |
| `platform/web/storefront/storefrontIngest.e2e.test.ts` (new) | 136 lines |
| `platform/server/buildServer.ts` | +9 / −3 |
| `platform/server/routes/pagesHttp.test.ts` | +17 / −0 |

### `platform/web/storefront/storefrontPublish.ts` — the switch itself

* Added `APP_EVENTS_PATH = '/api/app-events'`.
* Added `describePageIngestRefusal(status, body)` — the page-arm analogue of
  `describeIngestFailure` in `routeTableQuery.ts`: `no-acl`, `bad-signature`,
  `stale-intent`, `invalid-page`, `render-failed`, `too-large`, `store-failed`,
  and a default that still names the HTTP status.
* Added `ingestSignedPage(event)`: `POST` with
  `{ 'content-type': 'application/json' }` and `JSON.stringify({ event })` —
  exactly the request shape `routeTableQuery.ts` sends. It reads the body,
  treats `!response.ok` as a refusal, and treats a 200 **without**
  `stored === true` as a refusal too (the ingest only answers `stored: true`
  after `pageStore.put` returned).
* `publishStorefrontPage` now calls it after the relay ACK check and **throws**
  on any failure:

  > The page reached N relays, but this instance did not store it, so no bound
  > path here will serve it: <reason>. The relay copy stands — this is about
  > this instance, not about your page.

  The relay leg is kept and unchanged; the throw happens only after it
  succeeded, so nothing is claimed as published when only one leg worked.
* `unpublishStorefrontPage` is untouched: it already delegates to
  `publishStorefrontPage({ ...page, enabled: false })`, so the withdraw document
  travels the identical path and now also reaches the ingest. No second code
  path was added for unpublish.
* Module doc comment corrected: the old text said "There is no payment, server
  round trip, or app-side gate on this write", which is now false.

### `platform/server/buildServer.ts` — the serve-path guard (see §5, finding 2)

One condition in `servePath`:

```ts
if (!page || page.document?.enabled !== true) { /* 500 binding-target-missing */ }
```

A stored page is served only while the author has it switched on. `enabled:false`
is the unpublish, and the store deliberately keeps the document (ADR-019 R6 —
the author loses no blocks), so the *serve* path is the right place to decide
servability. Without this, requirement 3 was not met: see the probe in §5.

### Tests

* `storefrontQuery.test.ts` — the file that already owns this module's coverage.
  A `globalThis.fetch` recorder stands in for the ingest endpoint (the only
  network call these modules make), plus five new tests: the exact request the
  browser sends; a 403 `no-acl` refusal; a dead ingest; a 200 that does not
  confirm the store; and the unpublish document reaching the ingest with the
  same `d` tag. The pre-existing `publishStorefrontPage` tests are unmodified.
* `storefrontIngest.e2e.test.ts` (new) — the end-to-end proof. Real
  `publishStorefrontPage`, real `Bun.serve` built from the production
  `buildAppEventsRoutes` + `buildContentRoutes`, real HTTP, real
  `verifyEvent` (the mocked signer uses `finalizeEvent`, so the signature is a
  genuine one). The only shim is `globalThis.fetch` resolving the relative
  `/api/app-events` against the test server's origin, which is what a browser
  does against the page's own origin.
* `pagesHttp.test.ts` — reuses the existing HTTP harness (no second harness)
  for the withdraw case: ingest `enabled:true` → `GET /shop` 200 → ingest
  `enabled:false` at the same coordinate → `GET /shop` 500
  `binding-target-missing`.

## 3. RED before GREEN

Every test that fails below was written and run before the implementation.

```
$ bun test --isolate platform/web/storefront/storefrontQuery.test.ts
error: expect(received).toHaveLength(expected)
Expected length: 1
Received length: 0
 24 pass
 5 fail
Ran 29 tests across 1 file.
```

(all five failures are the new `publishStorefrontPage — the ingest switch` tests;
the 24 passes are the file's pre-existing tests, untouched)

```
$ bun test --isolate platform/web/storefront/storefrontIngest.e2e.test.ts
error: expect(received).toBe(expected)
Expected: 200
Received: 500          ← the published page is not served: the defect, over HTTP
 1 pass
 1 fail
Ran 2 tests across 1 file.
```

```
$ bun test --isolate platform/server/routes/pagesHttp.test.ts
(fail) POST /api/app-events ... > a page switched off is no longer served at its bound path
 30 pass
 1 fail
Ran 31 tests across 1 file.
```

After the change:

```
$ bun test --isolate platform/web/storefront/storefrontQuery.test.ts
 29 pass / 0 fail / 53 expect() calls

$ bun test --isolate platform/web/storefront/storefrontIngest.e2e.test.ts
 2 pass / 0 fail / 8 expect() calls

$ bun test --isolate platform/server/routes/pagesHttp.test.ts
 31 pass / 0 fail / 96 expect() calls
```

Regression sweep over the three directories that can see this code:

```
$ bun test --isolate platform/web/storefront/ platform/server/routes/ platform/web/routes-authoring/
 170 pass
 0 fail
 389 expect() calls
Ran 170 tests across 15 files.
```

## 4. End-to-end proof

The proof that a published page is served at its bound path through HTTP:

```
$ bun test --isolate platform/web/storefront/storefrontIngest.e2e.test.ts
(pass) a page published from the CMS is served at its bound path > publish → ingest → store → the bound path answers with the page bytes
(pass) a page published from the CMS is served at its bound path > switching the page off withdraws it from the bound path
 2 pass
 0 fail
Ran 2 tests across 1 file.
```

The assertions on the served body are: status 200, contains `NEEDLE-42`,
contains `data-testid="storefront-page"`, contains `"d":"storefront-page"`
(the record's own coordinate), and `<link rel="canonical" href="/shop"` — i.e.
the bytes came through the store at the bound path, not from the SPA shell.

A raw HTTP transcript (temporary script, deleted after use) showing the full
ingest → serve → withdraw cycle on the production route set:

```
GET /shop -> 500; contains NEEDLE-42: false; binding-target-missing: true
POST /api/app-events (enabled=true) -> 200 {"stored":true,"kind":30024,"author":"4f35…71aa","d":"storefront-page","eventId":"6476…c756"}
GET /shop -> 200; contains NEEDLE-42: true; binding-target-missing: false
POST /api/app-events (enabled=false) -> 200 {"stored":true,"kind":30024,"author":"4f35…71aa","d":"storefront-page","eventId":"15a9…74a2"}
GET /shop -> 500; contains NEEDLE-42: false; binding-target-missing: true
```

The corresponding served bytes (from the failing-then-passing e2e run) carry
`<title>Served shop</title>`, `og:title`, `<link rel="canonical" href="/shop">`
and the `__AR_PAGE__` payload `{"author":"4f35…","d":"storefront-page","version":1}`.

## 5. What I deliberately did not do, and what I found

Deliberately out of scope:

* **No per-page identity / `dTag` parameter.** The page lands at the coordinate
  its own event names — `(author, 'storefront-page')`. An admin binding that
  path must name `d: 'storefront-page'` (the Routes form already hints at it).
  Binding any other `d` would still 500, correctly, because no such page was
  ever ingested.
* **No page-path / series machinery touched**, no route-table changes, no
  `routeFile`/`routeTable`/`resolve` changes, no new endpoint.
* **The relay publish is kept** and still runs first; nothing was removed.
* **The Routes page's "Found a published page" hint is unchanged.** It reads the
  relay copy (`useStorefrontAddressPage`), so it can still say "found" for a
  page this instance has not ingested. Making it truthful needs a store-backed
  query (`GET /api/routes` does not expose page presence), which is a different
  slice; flagging it here rather than half-building an endpoint.
* **`StorefrontBuilder`'s error banner** still reads "This page was not
  published:" above the error list. The message it renders is now precise
  ("reached N relays … this instance did not store it … the relay copy
  stands"), but the banner heading is shared with pre-publish validation
  errors and I did not reword UI copy in this slice.

Findings:

1. **The ingest ACL admits `app`, `admin`, `editor` only — and the storefront
   CMS signs as the logged-in user.** `platform/web/routes/_dashboard-layout/dashboard/account/profile-page.tsx`
   mounts `StorefrontBuilder pubkey={pubkey}` for the current user, and
   `publishStorefrontPage` signs with the auth session's key. ADR-0006 says the
   app must not be the author of page content. So for an ordinary user the
   ingest now answers `403 no-acl` and publish fails honestly with "this
   instance only stores pages written by its app key, an admin or an editor".
   This is a real product consequence of the ingest contract, not of the switch:
   I did not change the contract to make my call succeed. It needs a decision —
   either pages served by a bound path are by definition app/admin authored, or
   the ingest needs a user-owned-page arm with its own ACL model.
2. **The serve path ignored `document.enabled`.** I probed this before deciding
   (temporary test, deleted): ingest `enabled:true` → `/shop` 200; ingest
   `enabled:false` at the same coordinate → `/shop` still 200 with the page
   body. So ingesting the unpublish event alone does **not** withdraw the page,
   and requirement 3 would have been a half-fix. That is why `buildServer.ts`
   carries the one-condition guard. No existing test asserted that a disabled
   page is served, so nothing was weakened; the guard is the only change outside
   the ingest leg and can be dropped if another slice owns serve-time
   withdraw semantics.
3. `pageStore.get` was left as a pure coordinate read (it still returns a
   withdrawn document), so the store keeps the author's blocks as ADR-019 R6
   requires; servability is the serve path's decision.

## 6. Not verified

* **No project-wide `tsc`.** Per the slice's constraints it OOMs/times out. I ran
  a scoped `tsc --noEmit` over only the two production files I touched
  (`storefrontPublish.ts`, `buildServer.ts`), via a throwaway tsconfig extending
  the project's so the aliases resolved. It reported **no diagnostic naming
  either file**; it did report pre-existing errors in `node_modules`
  (missing `debug` types, bun-types/`node:util` mismatches) and in unrelated
  files (`platform/web/app/sdkAdapters.ts`,
  `platform/web/auctions/auctionPublish*.ts`). Those are pre-existing and
  untouched by this change. No full-project type result is claimed.
* **No real browser/signer run.** The e2e test mocks the signer bridge
  (`@platform/web/ndkPublishContext`) because a test process has no signer, but
  the event it returns is genuinely `finalizeEvent`-signed, so the ingest's
  `verifyEvent` is exercised for real. The production signer path
  (`applesauceIo.sign`) is unchanged by this slice and not exercised here.
* **No real relay.** `publishNostrEvent` is mocked to return one ACK; the relay
  leg's own behavior is pre-existing and covered by the unchanged tests.
* **`data/pages` still does not exist in the repo.** The store is created by the
  server at runtime; the e2e/harness tests use a temp root. Nothing was written
  into the working tree.
