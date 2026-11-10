# Search buckets and the index-first grid — implementation plan

**Goal:** a search that paints its grid from the index immediately and offers a set of honest,
non-overlapping narrowing buckets built from the whole result set — tags and sellers alike.

**Architecture:** the read becomes **index-first, relay-enriched**. The index answers the page in
28 ms and the grid paints from it; the relay stream still opens in parallel and enriches the detail.
The **count and the buckets come from one full-set scan** (186 ms for 1,685 docs, paged, slim fields),
so the number, the tag buckets and the seller buckets agree by construction rather than by
coincidence. The buckets are chosen by an **overlap test** — the same test finds redundancy ("these
two are one bucket") and disjointness ("these two are different buckets") — with a share floor and a
format-marker filter. No model is involved; this is arithmetic over documents.

**Tech stack:** TypeScript, Bun, Meilisearch 1.56 (`rabbithole-meili.service`), the RabbitHole search
service (`rabbithole-api.service`, port 7711), TanStack Query, React (the browse app in
`~/work/wt-union-1420`).

**Repos and conventions:**
- `~/work/rabbithole` — the search service. Tabs? No: **2-space indent, double quotes, semicolons.**
- `~/work/wt-union-1420` — the app. **Tabs, no semicolons, single quotes**, JSDoc that states **why**.
- `bun` is at `/home/admin_maxime/.bun/bin/bun` (not on PATH). `node_modules/.bin/tsc` is blocked by a
  command guard — use `bunx tsc --noEmit`, and `NODE_OPTIONS=--max-old-space-size=12288` for the app
  repo's full run.
- **Do not restart `market-e2e.service`** while the owner is testing, and never leave it down.

---

## Vocabulary — facets and buckets are NOT the same thing, and the difference earns its keep

The owner asked whether these are the same. They are the same **family** but not the same stage:

- A **facet** is the **search engine's raw count**: Meilisearch's `facetDistribution`, one count per
  value of a field, over the scope of the request. It answers *"what values exist here, and how
  many"*.
- A **bucket** is a **narrowing option we choose to offer a person**: it has passed the format-marker
  filter, the overlap collapse, the share floor and the ranking, and it carries a number we can stand
  behind. It answers *"what is worth offering you next"*.

Three differences that matter in code:

1. **Source.** A facet comes from the engine. A bucket may also come from a dimension we compute, and
   its number **must come from the documents** — see the accuracy point below.
2. **Selection.** A facet is *every* value, including `new`, `other`, `misc`, `Physical`. A bucket is
   the survivors of the filters.
3. **Accuracy.** Measured on `q=bitcoin`: the facet for `bitcoin` reports **1197** against a true
   in-set count of **1100** (+9%), and `clothing` reports **242** against **199** (+22%) — the facet
   is computed over a **candidate superset**. Six of nine tags were exact, so a facet is a good
   signal for *"is there a bucket here"* and **not** authoritative for a number that is shown or
   ranked.

**Naming rule for the code:** `facet` means the engine's API and its raw counts; `bucket` means the
presented, selected, document-derived option. Keeping the two words keeps the accuracy rule visible —
a future reader who conflates them will reach for `facetDistribution` and ship a number that is 20%
wrong.

---

## Task 0: Raise and record `maxTotalHits` (already done, record it)

**Objective:** the full set must be fetchable, and the cap must be documented.

**Files:**
- Modify: `~/work/rabbithole/config/rabbithole.config.json` (the index `pagination` setting)
- Note: the live index setting was raised **1000 → 5000** during research; the config must carry it so
  a rebuild reproduces it.

**Step 1:** read the config's index settings block and add `"maxTotalHits": 5000` under the listings
index's `pagination` (or wherever `faceting.maxValuesPerFacet` already lives — put it beside that).

**Step 2:** verify:
```bash
curl -s -H "Authorization: Bearer $MEILI_MASTER_KEY" \
  http://127.0.0.1:7700/indexes/listings/settings/pagination
```
Expected: `{"maxTotalHits":5000}`

**Step 3:** commit — `chore(index): record the raised maxTotalHits so a rebuild reproduces it`

---

## Task 1: A full-set scan that reports its own truncation

**Objective:** one function that fetches every matching document, slim, and says so when it cannot.

**Files:**
- Create: `~/work/rabbithole/src/index/scan.ts`
- Test: `~/work/rabbithole/tests/scan.test.ts`
- Modify: `~/work/rabbithole/src/index/client.ts` (expose the paged search it needs)

**The shape:**
```ts
export interface FullSetScan {
  /** Every matched document, slim. */
  hits: SearchHit[];
  /** What the index said the set was, before paging. */
  total: number;
  /** True when `hits.length < total` — the cap cut the set short. Never derive silently from a prefix. */
  truncated: boolean;
}

export async function scanFullSet(
  client: MeiliClient,
  indexUid: string,
  q: string,
  opts: { fields: string[]; pageSize?: number; maxPages?: number; filters?: string[] },
): Promise<FullSetScan>
```

**Step 1 — write the failing test.** Two cases, both with a stubbed client:
- a set of 2,500 documents is returned whole (3 pages) with `truncated: false`;
- a set of 6,000 with `maxPages` capping it at 5,000 returns `truncated: true` and `total: 6000`.

**Step 2 — run it.** `cd ~/work/rabbithole && /home/admin_maxime/.bun/bin/bun test tests/scan.test.ts`
Expected: FAIL — module not found.

**Step 3 — implement.** Page in `pageSize` chunks (default 1000) until `hits.length === total` or
`maxPages` is reached. **Set `truncated` from the comparison, never from the loop exit** — that is the
whole point of the type.

**Step 4 — run.** Expected: PASS.

**Step 5 — commit** — `index: a full-set scan that reports its own truncation`

---

## Task 2: Derive buckets from the scanned documents

**Objective:** one pure function that turns a scanned set into ranked, non-overlapping buckets across
**every dimension that can carry one** — the labeller's `label_tags`, the sellers' `category_tags`,
and **the sellers themselves as authors**.

**Files:**
- Create: `~/work/rabbithole/src/index/buckets.ts`
- Test: `~/work/rabbithole/tests/buckets.test.ts`
- Modify: `~/work/rabbithole/src/index/search.ts` (`suggestionsFromFacets` stays for the cheap
  pre-filter path; the bucket derivation is the authoritative one)

**The shape:**
```ts
export type BucketDimension = "label_tags" | "category_tags" | "seller";

export interface Bucket {
  dimension: BucketDimension;
  /** The value to add to the query when the bucket is chosen — a tag, or a seller pubkey. */
  value: string;
  /** Exact count of documents in the set carrying it. Never a facet count. */
  count: number;
  /** count / set size. */
  share: number;
  /** Present for a seller bucket: the display name the app should show. */
  label?: string;
}

export function deriveBuckets(scan: FullSetScan, opts: {
  minShare?: number;        // default 0.05 — a bucket below this is noise
  maxBuckets?: number;      // default 4 per dimension, per the owner's "four subsets, four sellers"
  formatMarkers?: string[]; // blocked values, reuse the existing blocklist
  maxOverlap?: number;      // default 0.8 — above this, two buckets are ONE bucket
}): Bucket[]
```

**The algorithm, in order:**
1. Count each dimension's values over `scan.hits` — tags from `label_tags` and `category_tags`, sellers
   from `pubkey`.
2. Drop values in the format-marker blocklist (`new`, `other`, `misc`, `Physical`, `ordinals`,
   `raresats`, `wecsats_ad`, `type_raresat`, `nostr`, `shopstr`, …) and normalise case (`Bitcoin` and
   `bitcoin` are one value — a live defect today).
3. Drop anything below `minShare`.
4. **Collapse by overlap.** For two candidates A and B, overlap = `|A ∩ B| / |A ∪ B|`. Above
   `maxOverlap` they are one bucket: keep the larger. This is the *same* test that finds
   disjointness, so it needs no second mechanism. Measured: `health`+`pharma` 0.86 (pharma is inside
   health), `satoshoes`+`sneakers` 0.78, `nft`+`ordinals` 1.00.
5. Rank by share and take `maxBuckets` per dimension.

**Note on the overlap test's cost.** Computing it pairwise over every candidate is `n²` lookups into
per-document tag sets already in memory — cheap, because the documents are already fetched. Do **not**
run `n²` Meilisearch queries; that was 1,225 queries / 45 s when probed against the index.

**Step 1 — failing test:** a fixture of 10 documents where `pharma` (6 docs) is entirely inside
`health` (7 docs) must yield **one** bucket, not two; a `cotton` value at 1/10 must be dropped by the
share floor; a seller with 4/10 must appear as a `seller` bucket with `count: 4`.

**Step 2 — run:** Expected FAIL.

**Step 3 — implement.**

**Step 4 — run:** Expected PASS.

**Step 5 — commit** — `index: derive buckets from the scanned set, across tags and sellers`

---

## Task 3: Serve the count and the buckets with the page

**Objective:** the search frame carries the count and the buckets, computed from the full set.

**Files:**
- Modify: `~/work/rabbithole/src/api/handler.ts` (`SearchRequest`, `SearchFrame`)
- Modify: `~/work/rabbithole/src/api/server.ts`
- Test: `~/work/rabbithole/tests/api.test.ts`

**Step 1 — failing test:** a `POST /search` with `{"q":"mug","limit":50}` returns a `search` frame
carrying `hits.length === 50`, `candidateCount` equal to the set size, a `buckets` array, and
`truncated: false`; and a request against a set larger than `maxPages` returns `truncated: true`.

**Step 2 — run:** Expected FAIL.

**Step 3 — implement.** Add `buckets: Bucket[]` and `truncated: boolean` to `SearchFrame`. Keep
`suggested` as-is for compatibility until the app stops reading it, then remove it in a follow-up.

**Step 4 — run:** Expected PASS.

**Step 5 — commit** — `api: the search frame carries the full-set buckets and its own truncation flag`

---

## Task 4: The app paints the grid from the index before the relays answer

**Objective:** the grid renders from the `search` frame; the relay stream enriches rather than gates.

**Files:**
- Modify: `~/work/wt-union-1420/platform/web/browse/rabbitholeClient.ts` (map `search`-frame hits to
  `BrowseProduct` immediately; keep the relay events as enrichment)
- Modify: `~/work/wt-union-1420/platform/web/browse/browseQuery.ts` (publish the frame's hits into the
  progress store before the stream settles)
- Test: `~/work/wt-union-1420/platform/web/browse/rabbitholeClient.test.ts`

**Step 1 — failing test:** given canned NDJSON where the `search` frame carries 3 hits and the `event`
frames arrive later, the `onProducts` callback must fire **with those 3 hits before the `event`
frames** — i.e. the grid has content before any relay event lands.

**Step 2 — run:** `bun test --isolate platform/web/browse/rabbitholeClient.test.ts` — Expected FAIL.

**Step 3 — implement.** The mapping must be the SAME `mapProduct` the settled path uses, so a
frame-painted card and a relay-painted card cannot disagree.

**Step 4 — run:** Expected PASS.

**Step 5 — commit** — `browse(search): paint the grid from the index frame, enrich from the relays`

---

## Task 5: The bucket line

**Objective:** render the buckets as a line that narrows the query when chosen.

**Files:**
- Create: `~/work/wt-union-1420/ui/browse/search-buckets.tsx`
- Test: `~/work/wt-union-1420/ui/browse/search-buckets.test.tsx`
- Modify: `~/work/wt-union-1420/platform/web/browse/BrowseIndexHost.tsx` (render it above the grid,
  replacing the `TagFilterBadge` row)
- Modify: `~/work/wt-union-1420/ui/browse/relay-error.tsx` (`TagFilterBadge` is reused, or superseded)

**Behaviour:**
- Two groups: **tags** and **sellers**, up to 4 each.
- A seller bucket shows the seller's display name and its count; choosing it adds the seller to the
  query (the same mechanism as a tag bucket — one mechanism, per the owner's standing rule).
- Choosing a bucket **adds to the query** rather than replacing it, so the person narrows rather than
  losing their search.
- The **active** state is the query already containing the value — same rule as the search field.

**Step 1 — failing test:** with two tag buckets and one seller bucket in the props, the markup
contains both groups, and clicking the seller bucket calls `onNarrow` with the seller's value.

**Step 2 — run:** Expected FAIL. **Step 3 — implement.** **Step 4 — run:** Expected PASS.

**Step 5 — commit** — `browse(search): the bucket line — tags and sellers, narrowing not replacing`

---

## Task 6: Disclose the cap

**Objective:** when the scan was truncated, say so and offer the way past it.

**Files:**
- Modify: `~/work/wt-union-1420/platform/web/browse/BrowseIndexHost.tsx`
- Test: the host suite

**Behaviour:** when `truncated` is true, render one line: the set was larger than the index scan
reaches, so the buckets describe the first N results — and refining the query narrows the set below
the cap and extends the reach. **A disclosure with an affordance, never an error, and never silent.**

**Step 1 — failing test:** with `truncated: true` the markup contains the disclosure and the word for
refining; with `truncated: false` it does not.

**Step 2 — run:** Expected FAIL. **Step 3 — implement.** **Step 4 — run:** Expected PASS.

**Step 5 — commit** — `browse(search): disclose a truncated scan and offer the way past it`

---

## Task 7: Verify against the live index, with numbers

**Objective:** the claims in this plan are re-measured on the real corpus, not asserted.

- `q=bitcoin` (1,685 matches): the buckets must include `satoshoes` (253) and the top seller
  (**264 = 15.7%**), and must **not** include the five rare-sat/nft tags as five separate buckets
  (they are one set of 392 — overlap 1.00).
- `q=swimsuit` (15 matches): buckets may be empty — below the share floor — and the line must not
  render a single-bucket "narrowing" affordance.
- `q=art` (767): `Art` and `bitpopart` should collapse or both appear, and whichever happens must be
  reported with the overlap number that decided it.

**Commit** — `test(browse): verify the buckets against the live corpus`

---

## Risks, tradeoffs, open questions

1. **The full-set scan costs 186 ms for 1,685 docs, and it grows with the set.** It runs in parallel
   with the page-1 read, so the grid is unaffected — but the bucket line's arrival time is the scan's.
   For a very large set the scan must be capped (`maxPages`), which is exactly why the truncation flag
   exists.
2. **`minShare` and `maxOverlap` are judgement calls with measured anchors**, not truths: 0.05 comes
   from the top seller being 15.7% and the fifth being 3.1%; 0.8 comes from `health`+`pharma` at 0.86
   being one bucket and `health`+`bitcoin` at 0.00 being two. They should be **config values with
   those numbers in the comment**, not constants buried in code.
3. **Case normalisation is a live defect** (`Bitcoin` 98 vs `bitcoin` 474 are separate values). Fixing
   it in the bucket derivation fixes the buckets but not the underlying tag vocabulary — the labeller
   is where that belongs, and it is a separate change.
4. **The format-marker list is hand-maintained.** It will drift. A later increment could learn it, but
   not before the arithmetic version is in and measured.
5. **`suggested` is kept alongside `buckets` for one release** so the app can be switched without a
   flag day; removing it is a follow-up task, not part of this plan.
6. **Open question for the owner:** should choosing a seller bucket navigate to the seller's page, or
   narrow the current search in place? The plan implements **narrow in place** (adds to the query),
   because it keeps one mechanism — but a seller page is a reasonable alternative for a seller bucket
   specifically, and the owner raised both.
