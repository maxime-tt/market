# Ruling — React components and the existing CMS widgets; the widget layer is DEFERRED

Owner, 2026-11-13. A scope decision, and a recurring one — he notes this conversation has happened before.

> "we've previously had similar conversations such as this one and what we usually fall back on is the
> fact that we can stick to React components, assume the loaders will either be Plebeian Market
> instances or similar, and thus stick to our current widget definitions that we use in the CMS, to
> avoid script binding and widget compiling. I think it would be better to stick that to simplify scope
> and focus on the routing functionality first"

## What is ruled

- **Stay on React components.** No web components, no custom elements, no script binding, no widget
  compiling — for now.
- **Assume the loader is a Plebeian Market instance or similar.** The runtime that renders a page is
  ours; a page is not required to be portable to an arbitrary host.
- **Reuse the EXISTING CMS widget definitions** — the storefront block registry the CMS already has
  (`ProductGrid`, `ProductRow`, `ProductStrips`, `Search`, `Categories`, `Hero`, `Text`, `Image`,
  `LinkList`, `Divider`, `Spacer`, `BrowseStats`, `BrowseFeed`, `AuctionList`, …). A page definition
  references **those**, which are React components already in the tree and already in the editor.
- **Priority: the routing functionality first.** Routing is the deliverable; the page-composition
  layer is not the thing to be investing in right now.

## Why this is the right call, and it is measured

The previous revision priced the widget layer as **new machinery** and said so, from its own
measurement:

- **0 occurrences** of `customElements`, `extends HTMLElement`, `attachShadow` across the tree;
- **no widget-bundle build** — `build.ts:129-131` derives entrypoints from `src/**.html` and there are
  **0** such files, so `bun run build` emits no bundle today;
- **no remote script loading** in app code — no `<script src="https://…">`, no `import('https://…')`,
  no import map.

So deferring is not a loss of something present; it is **declining to build something absent**, and it
removes a whole layer from the critical path. That is exactly the scope reduction the owner asked for.

## What this reverses, precisely

- The `WIDGET` and `WIDGET REGISTRY` nouns and any "widget bundle" ingest refusal introduced by
  revision 3 become **DEFERRED, not designed**. They are recorded as deferred with their consequence
  (below) rather than deleted, so the door is not silently closed.
- The page definition references **the existing CMS block types**. `PAGE` remains "the page definition
  that references blocks", with blocks being React components from the live registry.
- **"Link a git repo"** and third-party widget delivery are **deferred** with it.

## What is NOT reversed — keep this

The scope cut removes the *widget* layer, not the *serving* model. These stay, because they carry the
owner's SEO and dynamic-content requirements:

- **A bound page is served from local storage with no relay round-trip** (the earlier ruling), and the
  routing decision never touches the network.
- **Render once at ingest, store the fragment, and hydrate the same DOM client-side** rather than
  re-rendering — so the page a crawler sees and the page a person sees cannot diverge.
- **Data-bound blocks stay dynamic** by fetching their own live data in the browser after hydration.
  That is what the existing data-bound CMS blocks already do, which is why this scope cut is
  coherent rather than a compromise.

## The consequence of deferring, stated so it is a choice and not an omission

A **third party cannot ship a page into the instance without the instance building their block.** The
page-composition vocabulary is ours, and extending it means shipping React components with the app. If
that becomes a requirement — a partner wanting to contribute a widget — the deferred layer is what has
to be built, and it is new machinery. Recorded, not hidden.

## One correction the previous revision made about its own evidence

Revision 2 cited "`renderToStaticMarkup` in 102 files" as evidence that server rendering is an
established pattern. Revision 3 checked: **all 102 are tests** (94 under `ui/`, 8 under `platform/`,
**0 non-test**). So it is a *test* convention proving `ui/` components render without a DOM — it
establishes **no production server rendering**. Whatever renders the stored fragment at ingest
therefore needs its mechanism **named and priced**, and must not be assumed to exist because a test
helper does.

## The scope, in three parts — corrected by the owner after the first draft

The first draft of this ruling listed a binary (in / out). The owner corrected it: **modular sub-apps and
list management are IN, sequenced after the current work** — *"modular subapps, and list management I
would both like in - but perhaps after we can get our current todo list done."* So:

1. **NOW — the current todo list.** Routing · the routing file · the page store · serving · the ACL ·
   leases.
2. **LATER, and already committed to.** **Modular sub-apps** — legacy and general pages becoming modular
   sub-apps with their own sub-paths (browse experience, seller dashboard, buyer/orders dashboard), so a
   monolith is not rebuilt. **List management** — generalising the currently blacklist-and-featured-only
   list machinery so all users can use lists, plus a CMS reference meaning "the members of the named
   list". Both are sequenced, not dropped.
3. **DEFERRED — needs a new reason to build.** The **widget/portability layer only**: web components,
   custom elements, script binding, widget compiling, linking a git repo, third-party widget delivery.
   The owner did **not** reinstate this one, so the consequence recorded above stands. The **signed
   ledger** stays deferred with it.

**The architecture must merely LEAVE ROOM for (2), and that has to be verified rather than assumed.**
Two checks, because two revisions have since touched this ground: does the programmed-prefix rung still
allow an arbitrarily deep sub-app path, given that only *leases* are restricted to a top-level path? And
does the page definition's reference model still have room for a `list` reference? If either has been
narrowed, that is a real conflict to report, not to paper over.

## Standing convention, recorded because this recurs

When the page-composition layer is discussed, **the fallback is React components plus the existing CMS
widget definitions** — not web components, not script-imported bundles. This is the second time this has
been settled; it should not need settling a third time without a new reason.
