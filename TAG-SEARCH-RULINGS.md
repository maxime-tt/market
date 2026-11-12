# Tag search — the three rulings, and what each one actually changes

Owner's rulings on the three items raised after the `?tag=Bitcoin` investigation. Each is
recorded with the measurement that decides whether the change is needed, so the next person can
re-derive the conclusion instead of re-litigating it.

## 1. "See all" becomes a RAW KEYWORD SEARCH. No tag filter.

**Ruling:** raw keyword search only. Relevance ranking sorts best matches first; the UX improves to
surface sellers and subcategories as suggestions.

**What changes:** the category row's `See all →` currently navigates to `?tag=<value>`, and
`browseQuery.ts:319` turns that into an index filter:

```
const filters = filter ? [filter] : tag ? [`category_tags = "${tag}"`] : undefined
```

That filter goes away. The tag becomes the **keyword term**, so the request is a plain `q=<value>`
with no `filters` at all.

**Why the measurement supports it.** The index's searchable attributes are `title`,
`content_snippet`, `all_tags` — so the keyword already searches tags. Measured:

- `q=testosterone` → **671** hits from a term in no title; `all_tags = "testosterone"` → 481.
- `q=bitcoin` → **1,683**; `category_tags = "bitcoin"` → 1,139.

The keyword finds *more*, not fewer, because it searches title + body + tags. The filter was
strictly narrowing what the ranking could already order.

**Also gone:** the meaningless "tag-only, empty term" state. There is no longer a search with an
empty `q`, which is what let the facet probe run over the whole index and put the pharma cluster on
a Bitcoin page.

## 2. Substring matching — ALREADY TRUE on the keyword path.

**Ruling:** add the substring matcher. ✅

**Finding: the keyword path already does partial matching.** Measured against the live service with
prefix probes:

- `q=bodybuild` → **985** (the full word `bodybuilding` → 983)
- `q=footwe` → **140**
- `q=testost` → **777**
- `q=bitcoi` → **1,623**

So a partial term matches. That is Meilisearch's prefix matching, and it is what a "substring
matcher" would have bought.

**And the exact-match filter it was meant to fix is the thing being removed in (1).** The only
place substring was a hazard was `category_tags = "Bitcoin"` — an **exact** equality filter, which
would have matched `bitcoin-cash` or `bitcoin-only` but not `bitcoin cash`.

**The risk I flagged was hypothetical, and the data says so.** Every distinct `all_tags` value
containing the substring "bitcoin" is exactly one value: `bitcoin` (1,196 listings). There is no
`bitcoin-cash`, no `bitcoin-only`. Recorded here so the flag is not carried forward as if it were
live.

## 3. Deduplication — already the case, and the duplicate is fixed by (4).

**Ruling:** dedupe only between labeller tags and seller tags; that should already be the case.

**Confirmed, exactly.** Sampled 300 listings:

- **131 of 300** have an overlap between `category_tags` (seller) and `label_tags` (labeller) —
  e.g. `boxer` present in both.
- **0 of those 131** have an `all_tags` length different from the union length.

So `all_tags` **is** already deduped between the two vocabularies — `[...new Set([...category_tags,
...labelTags])]` in `pointer.ts`. No work needed.

**But that dedupe is not what the duplicate pills were.** The duplicates came from a *different
field pair*: `all_tags` vs `category_top`/`category_sub` — e.g. `health` at 1,903 (`all_tags`) and
1,866 (`category_top`), `pharma` at 1,629 and 1,627. Two fields, same word, two React keys.

**So (4) removes the duplicate at the root, and no separate dedupe change is required.** The two
rulings converge: with the derived fields gone, the only suggestion source is the already-deduped
`all_tags`, and a word cannot be suggested twice.

## 4. (carried) Drop `category_top` / `category_sub` as a matching and suggestion source.

**Ruling:** the owner's, from the previous round — the flat list is the only list to match.

**Measured:** sampled 1,000 listings, `category_top` present in `label_tags` in **1,000/1,000**,
`category_sub` the same, **zero exceptions**. They are a copy — `deriveCategory()` reads them out of
the label list, so it can only return a value already there.

**Keep the relation, derive it, don't store it.** The parent→child relation (`footwear` inside
`clothing`) lives in the taxonomy both sides share, not on the document. If Meilisearch needs
something filterable for a navigation tree, store exactly ONE field — a `category_path` like
`clothing/footwear` — so one representation cannot be suggested twice.

**Drift is real:** `pointer.ts` carries forward the previous top/sub when a new label pass matches no
taxonomy path, so a stored category can go stale relative to the current labels.

## 5. The consequence to not lose by accident

The ranking must key on the **labeller's flat list** (`label_tags`), which is ours and closed — not
on `all_tags`, which is the union with the seller's tags. With the derived fields gone, `all_tags`
is the only remaining tag field, so a ranking rule that says "rank by tags" silently hands ranking
back to the sellers. The rule has to name `label_tags` explicitly.

## Open, for the CMS/planning round

- The CMS home page: search component + product rows as CMS-usable components with pickable
  products; categories below as customisable CMS components. Unblocks the CMS page route.
- Umami integration (self-hosted; heatmaps as a starter to test; opt-out control on the home page).
- Ranking by our taxonomy score rather than seller tags — the layer split is already in the schema.
