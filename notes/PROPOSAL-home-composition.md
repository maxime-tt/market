# PROPOSAL — the home composition, and what it fixes downstream

**Status:** proposal for the owner's call. Not a ruling.
**Why now:** it blocks stage 4 of `DECISION-retire-bidder-held-path.md` ("wire into the app
experience"), and it is the same question as "auctions are completely separate from the rest".
**Date:** 2026-11-13.

---

## 1. The problem, stated from evidence

There are two competing home compositions, and the swap between them silently removed working
surfaces.

`215867521` and its predecessors (`ca7abb8dd`, `3480f6836`) changed
`platform/web/routes/index.tsx` so that, with no `?q=` / `?p=` on the URL, `/` renders:

```
<IntroOverlay /> + <BrowseNav /> + <StorefrontRenderer page={page} slots={storefrontBlockSlots} />
```

where `page` is either the app key's published `home` page (kind 30024) or an inline fallback of
exactly three blocks: a `Search` block, **one** `ProductRow` block holding a **single hardcoded
d-tag**, and a `Categories` block with three links.

`BrowseIndexHost` — 1025 lines, the browse home with the hero, the wall strips, the measured stats
line, the live category rows and the split view — is **no longer the home**. It is reached only
when `?q=` or `?p=` is present. Nothing was deleted from disk; it was displaced from the route.

So the front page lost, in one move: the scrolling wall strips, the measured
*"N items loaded from N sellers"* line, the live category rows, and the hero composition the intro
storyboard was written to hand off to.

## 2. Why the CMS block set could not express it

The block set in `ui/storefront/blocks/` is, in full:

`HeroBlock`, `TextBlock`, `ImageBlock`, `LinkListBlock`, `Divider`, `Spacer`, `ProductGridBlock`,
`FeaturedProductBlock`, `ProductRowBlock`, `SearchBlock`, `CategoriesBlock`, `ProfileHeaderBlock`.

**Twelve blocks, in four categories, and not one of them is live-browse-shaped.** The registry
(`storefrontCms.tsx:197-461`) offers, verbatim grouped:

- `identity`: `ProfileHeader`, `Hero`
- `content`: `Text`, `Image`, `LinkList`, `Search`
- `commerce`: `ProductGrid`, `FeaturedProduct`, `ProductRow`
- `layout`: `Divider`, `Spacer` *(plus `Categories` registered for the commerce-style list)*

There is no block for the wall strips, none for the measured stats line, none for a streamed
browse feed, and none for auctions. `ProductGrid` and `FeaturedProduct` are explicitly
author-anchored (a page can only show the author's own items). `ProductRow` is the deliberate
exception: its slot fetches by the **explicit `#d` addresses in the document across any author**,
with the slot's own comment explaining why (an author-scoped read on a CMS-authored page would
always be empty). Worth knowing because the block's *docstring* still says "resolved against the
author's own listings" while the slot does the opposite — a stale comment, and exactly the
author-anchoring question the auction block will have to answer for itself.

Notably there is no category for live/derived content at all. The taxonomy itself has no place to
put such a block, which is why one was never added.

Meanwhile `BrowseIndexHost` renders `BrowseIdle` (the hero, with the search field homed in it),
`CategoryRows` with live `CategoryRow`s, `ProductArt` (the drifting art mount), the wall strips via
`ui/browse/product-strip.tsx`, the `SplitView` master/detail, `SearchBucketLine`, `SkeletonGrid` —
the surfaces the intro storyboard choreographs.

**That is the whole regression: the CMS swap replaced a rich composition with a block set that
cannot say what the composition said.** It was not a decision to remove the features; it was a
composition layer that was narrower than the thing it replaced.

## 3. The options

### Option A — restore the browse hero as the home
Point `/` back at `BrowseIndexHost` unconditionally, and keep the CMS for authored pages on other
routes (`/$vanityName`).

- **For:** immediate, restores every lost surface and the intro's handoff target exactly as the
  brief specified. Smallest change.
- **Against:** contradicts the owner's ruling that *"the home page is CMS-produced"*
  (`215867521`'s own commit message records it). It also leaves auctions nowhere to live, since
  `BrowseIndexHost` has no auction surface either.

### Option B — keep the CMS home, hand-extend the fallback
Add blocks to the inline fallback document until the home looks right again.

- **For:** no architecture change.
- **Against:** the inline fallback is exactly the thing that should not carry the product. It puts
  the composition back in code, duplicated from the CMS, and it still cannot express live surfaces
  without new blocks. Treats the symptom.

### Option C — make the home a CMS page whose block set includes the live surfaces (RECOMMENDED)
Keep the owner's ruling (the home *is* a CMS page), and **close the block-set gap** so the page can
say what the browse hero said. Concretely, add:

1. a **live product-strips block** (the wall strips — `ui/browse/product-strip.tsx` already exists;
   the block wraps it and supplies data through the existing slots mechanism),
2. a **measured-stats block** (the *"N items loaded from N sellers"* line, fed by `feed.stats`, with
   the existing test's string unchanged),
3. a **live browse-feed block** (the streamed grid, for a page that wants the full experience),
4. an **auction block** (the new `1440` protocol's listings) — see §4.

- **For:** honours the CMS ruling *and* restores every lost surface *and* gives auctions a
  first-class place in the home composition instead of a separate route. The intro keeps its
  handoff requirement, because the overlay's target becomes the CMS-rendered home and the surfaces
  it choreographs (strips, stats line) are now blocks.
- **Against:** more work than A, and it makes the block set a real API that has to be designed
  rather than accreted. That is the honest cost.

## 4. Why Option C also answers "auctions are completely separate"

Today `/auctions/catalogue` has **zero inbound links** — not the header, not the nav, not the home.
It is reachable only by typing the URL. That is not a styling problem; it is that auctions were
never part of the composition layer.

An **auction block** in the CMS block set makes auctions composable: the owner can author a home
page that places an auction block beside a product row, the generic blocks work on it the same way,
and the browse/search surfaces can include it. That is what "an interconnected UI experience"
means concretely — one composition layer, not a bolted-on route.

Note this **supersedes** the chain-fed Catalogue's ambition rather than reviving it: per
`DECISION-retire-bidder-held-path.md` §6, the Catalogue is deferred as a halfway state. The auction
block is the way auctions enter the app experience; the Catalogue is not.

## 5. What this unblocks

- **Stage 4** of the retirement plan — auctions wired into the app experience.
- **The intro storyboard** (`notes/BRIEF-HOME-INTRO-ANIMATION.md`, `notes/DESIGN.md`), whose hardest
  requirement — *"the animation's last frame must match the hero's first frame"* — is currently
  **unmeetable**, because the overlay sits on a CMS storefront rather than a hero. Under Option C
  there is a defined target again.
- The **`ProductRow` fallback carrying one hardcoded d-tag**, which is a placeholder masquerading as
  content.

## 6. The one question I need answered

**Which surface wins for the home: the browse hero's live experience, or an authored CMS page?**

My recommendation is **Option C** — keep the CMS as the composition layer, and extend its block set
so it can express the live surfaces the hero had (strips, measured stats, feed) plus a new auction
block. It is the only option that satisfies the owner's CMS ruling *and* restores the lost features
*and* gives auctions a place in the composition, which is the same problem stated three ways.

If the answer is instead "the browse hero *is* the home, the CMS is for other pages", that is
Option A and it is legitimate — but then the auction block has to be added to `BrowseIndexHost`
instead, and the owner's CMS ruling should be formally retired rather than left contradicting the
code.
