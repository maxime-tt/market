# Ruling — page serving, widget composition, and the app's own relay

Owner, 2026-11-13. Refines the page-serving model and settles the relay split. His words are authority.

## 1. Server-side rendering is right in principle, and fails on dynamic content

> "this could work in theory but I would perhaps point to the case of dynamic content as where its limits
> would show - since a full server-side rendering could not dynamically update content in realtime
> unless it was constantly refreshing all its contents."

**The limit, stated plainly: a fully server-rendered page cannot reflect live data without re-rendering
constantly.** So SSR is **not** the answer for a page's dynamic surfaces. This corrects my lean ("render
at publish and store the result") — that is right for a page's **static** content and wrong for its
live parts. A design that prerenders everything and serves it as if current would be serving stale data
as fact, which is the mirror image of the failure this run exists to eliminate.

## 2. The efficiency answer: built JavaScript bundles, served as static pages

> "on the other hand if we can compile the react or other typescript into built JavaScript bundles and
> serve those as static pages I do think it would make things more efficient, let me know if that makes
> sense."

Binding: **compile the React/TypeScript into built JS bundles and serve those as static assets**, rather
than rendering per request. It makes sense and it is the efficient shape — the cost of rendering moves
to build/publish time, and serving becomes a static asset fetch.

## 3. Pages are NOT source code — web components, loaded by script import

> "For sure page publishing should not be source code (can link a git repo) but web components focused,
> renderable directly in the browser using script imports for widget libraries."

Binding, and it constrains the page-definition model:

- **A published page is not a code artifact.** It must not inline or contain source.
- **A page may LINK a git repo** — e.g. where a widget or sub-app is built from. A link, not a copy of
  the source.
- **Pages are web-components-focused, renderable directly in the browser**, and **widget libraries
  are pulled in via script imports.** So the composition model is: a page definition references
  widgets; widgets are **custom elements delivered as script-imported bundles**.

**Reconciled with §1 and §2**, the serving story is a hybrid and it is coherent:
a **static shell plus the page's static content** is rendered once and served instantly (SEO, previews,
no per-request render), while **widgets hydrate and fetch their own live data in the browser** — so
dynamic content is live without anything re-rendering the whole page.

## 4. What the plan revision already got right, and must be preserved

The reviser independently landed on a compatible shape, and these parts are worth keeping rather than
rewriting:

- **`pageStore.ts` + `pageRender.ts` + `pageHtml.ts`** — a local page store, a document→HTML renderer,
  and a response composer. The relay fetch is gone from the serve path.
- **SEO-grade output asserted by a command**: `curl /x` must show the page's **body** and its `og:` /
  `twitter:` meta **without executing JavaScript**.
- **The client HYDRATES the same DOM rather than re-rendering it**, so the crawler's page and the
  human's page cannot diverge — the reviser flags that divergence as otherwise invisible to tests.
- It measured that `renderToStaticMarkup` is already used in **102 files**, so server rendering of
  components is an established pattern in this repo, not a new capability.

**What still diverges and must change:** the plan models pages as React SSR + hydration. The owner's
model is **web components delivered by script-imported bundles**, with a page able to **link a git
repo**. React SSR remains the mechanism for the shell's static content; the **widget layer** is the
part that must be re-modelled.

## 5. The app relay is separate from the auctions relay — both of my questions answered as leaned

> "Auctions relay is not the app relay - the auctions relay (the one we're running locally) is a test
> placeholder relay for the real public relays. What we're talking here is a relay purely for internal
> app use, with potential exposure to the outside world but with strict limitations and ACL/data
> management, serving purely internal app purposes and potentially a 'POST'-like endpoint for nostr
> signed events related to the app functionality. So actually answering both questions in one, towards
> your lean on both counts."

- **Two relays, two roles, never conflated.** The local auctions relay is a **test placeholder for the
  real public relays** — it is not the app's relay and must not be modelled as one.
- **The app's relay is purely internal**: strict limitations, ACL and data management, serving internal
  app purposes. It may be exposed to the outside world but only with those constraints.
- **It includes a POST-like endpoint for Nostr signed events related to app functionality** — that
  endpoint **is the app's write/ingest path** for signed app events.
- **Both my leans upheld:** separate roles, and the private store is a store rather than a
  general-purpose relay.

## 6. Settled by confirmation — do not re-open

- **Modular means basic replaceable slots.** *"some basic slots that can be replaced is good enough to
  start."* Do not over-design the slot model in this build.
- **Sub-app sub-paths do NOT conflict with top-level-only leases** — programmed routes may be deep;
  only leases are top-level. Confirmed.
- **One binding per path, and the binding wins** — a re-pointed legacy path is not served in parallel
  from the compiled tree. Confirmed.
