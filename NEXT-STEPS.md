# Next implementation steps

Constraint set by the owner, and it scopes everything below: **the front end needs no parent/child
reasoning at all.** The taxonomy is a labeller-side guide for tagging and nothing downstream may
depend on it. Checked — the browse app (`sdk/`, `platform/`, `ui/`) references `category_top` and
`category_sub` **nowhere**; they are a search-engine-side artifact only. So the constraint is already
met on the front end, and the work below is about removing the coupling where it does exist.

## 1. "See all" becomes a raw keyword search — DONE (`b29e0aa20`)

**Why:** the owner's ruling. The index already searches `all_tags` alongside title and body, so the
keyword finds more than the tag filter did — `q=testosterone` 671 vs filter 481, `q=bitcoin` 1683 vs
1139 — and relevance ranking orders what the filter was narrowing.

- `platform/web/browse/browseQuery.ts` — drop the `category_tags = "${tag}"` filter derivation. The
  tag becomes the term; no `filters` are sent.
- `platform/web/browse/BrowseIndexHost.tsx` — the category row's `See all →` and the facet pill
  click both navigate to `?q=<value>`.
- **This is also the fix for the pharma pills.** The facet probe runs with an empty term when only
  `tag` is set, which is what let it answer over the whole index and put the Health/Pharma cluster on
  a Bitcoin page. With the term never empty, the probe is scoped again.

## 2. Remove the taxonomy from the search index and the suggestions — DONE (rabbithole `715462c`)

**Why:** the owner's ruling — the flat list is the only list to match, and nothing downstream needs
the hierarchy.

- `rabbithole/src/index/search.ts` — `SUGGESTABLE_FIELDS` becomes `["all_tags", "has_image"]`. This
  alone makes the duplicate pills impossible: the same word can no longer arrive from two fields.
- `rabbithole/src/index/client.ts` — drop the two fields from the index document.
- `rabbithole/src/harvest/pointer.ts`, `carry-labels.ts` — drop the fields and the carry-forward.
- `rabbithole/src/harvest/taxonomy.ts` — `deriveCategory` and the module go with them; nothing else
  calls it.
- **The labeller keeps the taxonomy unchanged**, as its tagging guide. `~/work/labeller/TAXONOMY.md`
  documents the tree and the mechanism; that remains the only place the hierarchy is meaningful.

## 3. Ranking — the open decision, and the one that needs a ruling

With the derived fields gone, the labeller's signal in the index is `label_tags` (closed, ours) and
the seller's is `category_tags`; `all_tags` is their union. A ranking rule that says "rank by tags"
is not specific enough — it would silently rank by what sellers typed.

This is an **index-side** concern, so it does not violate the no-front-end-reasoning constraint: the
front end receives an order, not a taxonomy. Options:

- **(a) Rank by `label_tags` presence** — a listing the labeller placed in a category outranks one it
  only tagged by seller words. Cheap, uses what exists.
- **(b) Add a labeller-derived relevance field** — a per-listing score the index can sort on. More
  work, and it is the Laya fine-tune's output shape.
- **(c) Do nothing yet** — accept seller-tag ordering until the balance question is settled.

**Interaction to be aware of:** after step 2 the pills are `all_tags`, which is dominated by the
largest sellers' vocabulary (health 1903, pharma 1629, steroid 928 …). So step 2 without a step 3
makes the pills *more* seller-shaped, not less. The two belong together.

## 4. The CMS home page

The owner's directive for today. Curate the home page by making it CMS-produced:

- Extract the **search component** and the **product rows** into CMS-usable components.
- Make the products shown in a row **pickable** rather than query-driven.
- The **categories below** become customisable CMS components alongside everything else.
- This also unblocks the **CMS page route**.

## 5. Umami

Self-hosted, MIT, cookieless by default. Search demand is instrumented **in our own search service**
(aggregate counts, k-anonymity floor) — a client script cannot see a term that travels in a POST
body. Purchases are counted at the order path. Umami covers the funnel/retention layer only.

- Heatmaps: the owner wants these **as a starter to test**, not switched off.
- An **opt-out control** on the home page.
- The box has no Docker and no Postgres today — that is the deployment decision to make.

## Verified live after the deploy

- `?q=Bitcoin` — the pills are **NFT 392 · SATOSHOES 253 · CLOTHING 242 · SNEAKERS 198 ·
  STREETWEAR 174 · BLACK 139**, and **no value appears twice**. Before: `HEALTH 1903` + `HEALTH
  1866`, `PHARMA 1629` + `PHARMA 1627`.
- The pills are **scoped to the term** now (bitcoin-adjacent), not the whole index.
- A pill click writes **`?q=nft`** — the tag parameter is gone from the app's own navigation.
- `?q=Bitcoin` returns **175** cards against the tag filter's 31: the keyword finds more.
- Service-side: 12 suggestions, **zero duplicate values**, all from `all_tags`.

## Order

1 and 2 are one change set: both are removals that make the search honest, and 2 is what fixes the
duplicate pills at the root. 3 needs a ruling before it can be built. 4 is the owner's stated focus.
5 is last.
