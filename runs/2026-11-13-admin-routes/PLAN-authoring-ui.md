# PLAN — the admin authoring UI: per-page identity, a page picker, and create/edit route

**Run:** `runs/2026-11-13-admin-routes` · **Track:** authoring UI only (`ui/`, `platform/web/`) ·
**Worktree:** `/home/admin_maxime/work/wt-admin-page-ui`, branch `d7s2/admin-page-ui`, HEAD `1154be66a`
**Role:** one of two parallel planners. The **other planner owns the server side** — `platform/server/`,
the page-path/series layer, the compiled-in set, leases, ACL. **This plan touches neither `platform/server/` nor
`sdk/`.**

**State of this document:** a plan. No source file was modified to produce it, nothing was committed, no remote was
touched. Every claim about current behaviour below carries the command that established it. Anything I could not
measure is labelled **[U]** and nothing downstream rests on it.

**Authority:** the owner's framing (quoted verbatim in the composer brief) > `ruling-d8-multipage-and-lists.md` >
`ARCHITECTURE.md` > `IMPLEMENTATION-PLAN.md` (increment 8 is the management surface; increment 2 is the page-path
layer) > `ruling-react-components-and-deferred-widgets.md`. Where this plan finds the documents disagreeing with the
code, it says so rather than smoothing it over — see §0.

---

## 0. What I measured first, because two of the brief's premises are only partly true

The brief says the Routes page "CANNOT BUILD ANYTHING". Half of that is right and half of it is wrong in a way that
changes the design, so it goes first.

### 0.1 The editor is not plugged into the server, so a page published today is not servable today

`storefrontPublish.ts` publishes to **relays only** and never calls the ingest:

```
$ grep -rn "app-events" --include=*.ts --include=*.tsx platform/web/ | grep -v test
platform/web/routes-authoring/routeTableQuery.ts:9: * (`POST /api/app-events`).
platform/web/routes-authoring/routeTableQuery.ts:114:  const response = await fetch('/api/app-events', {
```
**[M]** — the only caller of `POST /api/app-events` in the whole web tree is the route-intent write. The page publish
goes `signNostrEvent` → `publishNostrEvent` (`platform/web/ndkPublishContext.ts:134,140`), i.e. to relays.

The serve path, meanwhile, reads **only** the local store:

```
$ sed -n "105,110p" platform/server/buildServer.ts
const page = pageStore.get(resolution.target.author, resolution.target.d)
if (!page) {
  // Routing succeeded; the binding's target is missing. That is 500 with
  // a named error — never 404, which stays reserved for "no binding matched".
```
**[M]** — and `data/pages` does not exist in this worktree (`$ ls data/` → `pages.example routes.example.json`);
only the ingest populates it (`platform/server/http/appEvents.ts:196-207`, `pageStore.put(record)`).

`IMPLEMENTATION-PLAN.md:556-557` states this directly: *"the CMS still publishes to relays as before (so
'published' and 'served' diverge until increment 3 — stated in §1.5)"*.

**Consequence.** The existing Routes page's "hint" (`routeAuthoringPage.tsx:63-72`, *"Found a published page: …"*) reads
the **relay** copy through `useStorefrontAddressPage`, so it can happily report a page as found for an address the
server would answer `binding-target-missing` for. Binding a path today is therefore a preview of intent, not a
working route. **The ingest switch is the other track's job** (§9 "cross-track", and "not satisfied" in §11). This
plan is written so that when the ingest lands, nothing here changes: the UI already writes the address the serve path
keys on.

### 0.2 A fresh `d` genuinely is a new page, with no schema change — this part is confirmed

```
$ sed -n "164,180p" platform/server/http/appEvents.ts
    // `d` comes from the event's tag, never from the request body.
    const d = event.tags.find((tag) => tag[0] === 'd')?.[1]
    if (typeof d !== 'string' || d.length === 0) return fail(400, 'invalid-page', '/d: missing d tag')
```
**[M]** — the store keys on `(author, d)` (`pageStore.ts:30`, `get(author, d)`; `put` derives one file per
coordinate at `:75-77`), and the ingest accepts admin/editor signers (`appEvents.ts:124`). So an admin signing a
kind-30024 with `d=featured-13-11-2026` stores a *second, independent* page. Publish is the **only** place the
constant is applied:

```
$ grep -rn "STOREFRONT_PAGE_D_TAG" --include=*.ts --include=*.tsx sdk/ platform/
sdk/commerce/storefront/storefrontPage.ts:34:export const STOREFRONT_PAGE_D_TAG = 'storefront-page'
platform/web/storefront/storefrontPublish.ts:60:  const tags: string[][] = [['d', STOREFRONT_PAGE_D_TAG]]
platform/web/storefront/storefrontQuery.ts:69:  async function fetchStorefrontPage(pubkey, dTag = STOREFRONT_PAGE_D_TAG)
```
**[M]** — note what *already exists*: the read side is **already parameterised by `d`**. `fetchStorefrontPage(pubkey,
dTag)` takes it, `useStorefrontAddressPage(pubkey, dTag)` passes it, and `/$vanityName` feeds the path segment in
verbatim (`platform/web/routes/$vanityName.tsx:41` → `<StorefrontAddressPage dTag={vanityName} />`). **The page
address is half-wired already; only the write side and the editor are pinned to the constant.**

### 0.3 There is no page index, and the only one available is a relay read

```
$ grep -rn "STOREFRONT_PAGE_KIND" --include=*.ts --include=*.tsx sdk/ platform/ | grep "'#d'\|#d"
platform/web/storefront/storefrontQuery.ts:83   kinds: [STOREFRONT_PAGE_KIND],
    (followed by `authors: [pubkey], '#d': [dTag]`)
```
**[M]** — every kind-30024 read in the tree pins a single `#d`. There is no "list this author's pages" query
anywhere, no page index on disk (the page store's only index is `series/<key>/<author>.json`, written only for pages
that carried `t` tags — `pageStore.ts:82-89`), and nothing in `data/`. The only way to enumerate an author's pages is
a kind-30024 read **without** a `#d` filter, which is a **relay** read. §3.3 prices that honestly.

### 0.4 StorefrontBuilder is pinned to `(pubkey, storefront-page)` in eight places, not one

```
$ grep -n "pubkey\|D_TAG\|export function" platform/web/storefront/StorefrontBuilder.tsx
88:export function StorefrontBuilder({ pubkey }: { pubkey: string }) {
89:  const { data: published, isLoading } = useStorefrontPage(pubkey)
146:    const draft = loadStorefrontDraft(pubkey)
179:      saveStorefrontDraft(pubkey, page)
190:    saveStorefrontDraft(pubkey, fromPuckData(data, enabled))
199:    if (currentData.current) saveStorefrontDraft(pubkey, fromPuckData(currentData.current, next))
233:      clearStorefrontDraft(pubkey)
252:    clearStorefrontDraft(pubkey)
```
**[M]** — and `useStorefrontPage(pubkey)` (line 89) is `fetchStorefrontPage(pubkey)` with the **default** `d`; it never
passes a `dTag`. So the editor hard-codes the storefront page in the read, all five draft calls, and the publish hook
(`usePublishStorefrontPage`, `storefrontQuery.ts:162-171`, which invalidates only `storefrontKeys.page(pubkey)` —
`queryKeyFactory.ts:210`). This is the exact set §4 has to widen.

### 0.5 The route table's own vocabulary

- `routeIntent.ts:64-67` `isValidIntentDTag` = *any* non-empty string ≤512 chars without NUL. So the **intent** layer
  will happily carry `../etc`, and the **file** layer will store it (`pageStore.segment()` percent-encodes it,
  `pageStore.ts:61-65`, so it is inert on disk but an unreadable directory name). The **path** is strict
  (`validateIntentPath`, `routeIntent.ts:78-88`: one segment, `isValidRouteName`, not URL space).
- `validateDraft` (`routeAuthoring.ts:101-135`) requires an author pubkey and a `d`; a path can be bound **before** its
  page exists, by design (`routeAuthoringPage.tsx:59-61`).
- `describeBindings`/`describeBinding` (`routeAuthoring.ts:61-75`) is the whole row model. It has no notion of "which
  page is this, in words" — it prints `page aaaaaaaa…1111 / storefront-page`.

---

## 1. Decision 1 — page identity in the UI: the path name *is* the page name

### The decision

**One field, one word, one grammar.** When an author creates a page they type **a name**; that name is used as
the page's `d` **and** as the default path it is published under. A page is thus `(author, d)` where `d` is the name,
and the name is `isValidRouteName` — the same grammar as a path (`NAME_PATTERN`, `routeNames.ts:22`:
`/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/`).

`STOREFRONT_PAGE_D_TAG` is **not removed and not renamed**. It stays the reserved default: the page whose name is
`storefront-page` *is* the storefront page. The UI never offers it in the "new page" name field and shows it as
"Storefront" wherever a page is listed.

Why this is the right call and not just the cheap one:

1. **It is the owner's example.** *"found under unique custom paths (i.e. `featured-13-11-2026`)"* — the `d` and the
   path segment are the same string in his own example, and `/$vanityName` already passes the segment through
   verbatim as the `d` (`$vanityName.tsx:41`). Making them the same string by construction is what the serve model
   already assumes.
2. **It removes the whole class of "my name has a `/` in it" failures.** `d` is validated with the **path** grammar,
   not `isValidIntentDTag` (§0.5). That is stricter than the intent layer, deliberately: the intent layer accepts a
   hostile `d` and it lands on disk (§0.5 measured); the *UI* must never mint one. The UI is where I can enforce it
   without touching `sdk/`.
3. **It cannot be changed later** — a page's `d` is its address. Rather than pretend otherwise, the name field is
   **immutable after creation** (§3.1) and the UI says so in those words.

**Uniqueness is per author**, because that is what the storage key is (`(author, d)`, `pageStore.ts:30`). Two admins
may both own a page named `featured`; that is correct, and the page picker (§3.3) must therefore never show a bare
name as if it were an address.

### What this means in the UI

A page's display name, everywhere, is three things: its name, its author (`shortPubkey`, existing helper
`routeAuthoring.ts:42-46`), and whether it is `enabled`. A new view-model function owns that rendering, so the page
list and the picker cannot drift:

```ts
// platform/web/routes-authoring/pageIdentity.ts (new)
export interface PageIdentity { author: string; d: string }
export interface PageLabel { name: string; authorLabel: string; enabled: boolean; isDefault: boolean }
export function pageIsStorefront(d: string): boolean          // d === STOREFRONT_PAGE_D_TAG
export function pageLabel(name: string): string              // 'storefront-page' → 'Storefront'
export function describePage(identity: PageIdentity, enabled: boolean): PageLabel
export function validatePageName(input: string): string | null   // reuse NAME_PATTERN; refuse the default
```

`validatePageName` returns the sentence, not a boolean, in the same shape as `validateIntentPath`
(`routeIntent.ts:78`), so the form can show it under the field without a second mapping.

---

## 2. Decision 2 — the same editor, opened as a custom-page editor

### The decision

`StorefrontBuilder` gains **one optional prop, `dTag`, and no mode flag**:

```ts
export function StorefrontBuilder({ pubkey, dTag = STOREFRONT_PAGE_D_TAG }: { pubkey: string; dTag?: string })
```

A **mode** is refused on purpose. The editor's behaviour does not branch on *what kind of page this is* — the storefront
page and a custom page are the same document, the same blocks, the same publish validation. The only thing that differs
is **the address written into the event's `d` tag**. A mode flag would invite someone to add "storefront-only" chrome
(default framing, a title block that cannot be deleted) inside the page — exactly what the owner ruled out: *"I wouldn't
have a default component inside of the page, because the page itself should be the one deciding what to display."*
The seam is an **address parameter**, and it is deliberately the whole of the difference.

The existing call site keeps working untouched, because `dTag` defaults to the constant:

```tsx
// platform/web/routes/_dashboard-layout/dashboard/account/profile-page.tsx:27 — unchanged
return <StorefrontBuilder pubkey={pubkey} />
```

### The eight places that must widen — this is the real content of the decision

A `dTag` prop on line 88 that is not threaded through is a lie. The complete list, measured in §0.4:

| # | file:line | today | becomes |
|---|---|---|---|
| 1 | `StorefrontBuilder.tsx:89` | `useStorefrontPage(pubkey)` | `useStorefrontPage(pubkey, dTag)` — **the read hook must take a `d`** |
| 2 | `StorefrontBuilder.tsx:146` | `loadStorefrontDraft(pubkey)` | `loadStorefrontDraft(pubkey, dTag)` |
| 3 | `StorefrontBuilder.tsx:179` | `saveStorefrontDraft(pubkey, page)` | `(pubkey, dTag, page)` |
| 4 | `StorefrontBuilder.tsx:190` | idem | idem |
| 5 | `StorefrontBuilder.tsx:199` | idem | idem |
| 6 | `StorefrontBuilder.tsx:233` | `clearStorefrontDraft(pubkey)` | `(pubkey, dTag)` |
| 7 | `StorefrontBuilder.tsx:252` | idem | idem |
| 8 | `StorefrontBuilder.tsx:248` deps | `[enabled, publish, pubkey]` | `[…, dTag]` |

And the three modules behind it:

| file:line | today | becomes |
|---|---|---|
| `storefrontQuery.ts:69` | `fetchStorefrontPage(pubkey, dTag = D_TAG)` | **already correct** — no change |
| `storefrontQuery.ts:104-113` `storefrontPageQueryOptions` | key `storefrontKeys.page(pubkey)`, fn ignores `d` | take `dTag`, key `[…all, 'page', pubkey, dTag]` |
| `storefrontQuery.ts:115-117` `useStorefrontPage` | `(pubkey)` | `(pubkey, dTag?)`, passed into the options |
| `storefrontQuery.ts:162-171` `usePublishStorefrontPage` | `publishStorefrontPage(page)` (`:166`); invalidates `page(pubkey)` (`:168`) | `(page, dTag)`; invalidates the `(pubkey, dTag)` key |
| `storefrontPublish.ts:53,60` `buildStorefrontPageEvent` | `tags[0] = ['d', D_TAG]` | `(page, dTag = D_TAG)`; `['d', dTag]` |
| `storefrontPublish.ts:81` `publishStorefrontPage` | `(page)` | `(page, dTag = D_TAG)` |
| `storefrontPublish.ts:115` `unpublishStorefrontPage` | `(page)` | `(page, dTag = D_TAG)` |
| `draftStorage.ts:17-18` `draftKey` | `plebeian-storefront-draft:${pubkey}` | `…:${pubkey}:${dTag}`; four functions take `dTag` |
| `storefrontQuery.ts:149-153` `shouldRenderStorefrontPage` | unchanged | unchanged |

**Every one of these gains a parameter with a default equal to today's value**, so all existing call sites
(`StorefrontOrProfilePage.tsx:44`, `profile-page.tsx:27`, `storefrontQuery.test.ts`, `e2e/`) compile and behave
unchanged. That is the whole reason the seam is cheap.

**Two things I am deliberately *not* changing, and why:**

- **The draft key gains a segment, so existing drafts become unreachable** under their old key. `draftKey` currently
  returns `plebeian-storefront-draft:<pubkey>` (`draftStorage.ts:17-18`); after the change a signed-in author's
  unsaved storefront draft would silently vanish. Fix: `loadStorefrontDraft(pubkey, dTag)` reads
  `:<pubkey>:<dTag>` and, **only when `dTag === STOREFRONT_PAGE_D_TAG`**, falls back to the legacy
  `:<pubkey>` key and re-saves under the new one. One extra branch, one test (§7 T6) — cheaper than telling authors
  their afternoon is gone.
- **`StorefrontOrProfilePage.tsx:44`** does `loadStorefrontDraft(pubkey)` for the live preview. It takes the new
  `dTag` argument with the constant, unchanged behaviour. Making the *preview* follow a non-storefront page is the
  serve-path's business (the other track); touching it here would be a second, undeclared seam.

### The address a custom page is previewed at

`StorefrontBuilder.tsx:97-101` computes `liveHref` from the vanity entry or `/profile/<pubkey>`, both of which point at
the **storefront** page. For a custom page that link is wrong. With `dTag ≠ STOREFRONT_PAGE_D_TAG` the preview link
becomes **`null`** ("no live page yet") rather than a plausible-but-wrong URL. The link is set correctly by whoever
builds the route that serves the page — the Routes page's "View" action (§3.4), which is where the path is known.
Inventing a URL here would be a claim about the serve path this lane does not own.

---

## 3. Decisions 3 & 4 — the Pages surface, the picker, and create/edit route

### 3.1 Where a page is created (the owner's "build a page somewhere")

New surface: **`/dashboard/app-settings/pages`** — "Pages", in the APP SETTINGS section next to Routes
(`ui/nav/model.ts:177`, `adminOnly: true`). It lists the pages this author has, and has one action, **New page**.

*Why APP SETTINGS and not the ACCOUNT tab beside "Storefront":* the owner's complaint is that *"the only place to
build the pages is inside of the storefront tab"*. Putting custom pages back inside the ACCOUNT tab reproduces exactly
that. Pages are published **under paths of the app**, and the path lives in APP SETTINGS — the author's page list and
the route table that publishes it are two views of one job and belong side by side. `adminOnly` matches Routes and
matches what the ingest already requires (`appEvents.ts:124` allows app/admin/editor; the nav gate is the stricter,
existing precedent). **[J]** — an editor who *is* admitted by the ingest but not by `adminOnly` cannot reach the
Pages nav item. That gap is the ACL track's (increment 4); this plan follows the existing Routes precedent rather than
inventing a second gate.

The **Storefront** item in ACCOUNT stays, unchanged, pointing at `profile-page.tsx`. It is now honestly one of *many*
pages rather than the only one.

### 3.2 Creating a page

The New-page flow is a **name field and nothing else**:

```
Name: [ featured-13-11-2026 ]      → binds d = featured-13-11-2026
It becomes the address of this page and cannot be changed later.
                                   [ Create page ]
```

On create the UI navigates to `/dashboard/app-settings/pages/$d` and mounts
`<StorefrontBuilder pubkey={me} dTag={$d} />`. With no published document and no draft, the builder's existing seeding
logic lands on `mode === 'wizard'` (`StorefrontBuilder.tsx:152-166` (the `seeded` effect)): *"A document with no blocks is
indistinguishable from no document at all … both send them to the setup wizard"*. **That is the "second way to open
the same editor", and it falls out of the existing code with no new branch.**

**No default block is inserted.** The wizard writes whatever template the author picks, and *that* is a document they
can delete blocks from. Nothing in `pages/new` or in the builder adds a title block: the owner was explicit. The
only default is `enabled: false` — measured at `StorefrontSetupWizard.tsx:107`, which spreads
`...createEmptyStorefrontPage()` (`storefrontPage.ts:570-577`, `enabled: false`) before calling `onComplete` — so a
page created and abandoned is never live.

`d` is checked **before** the editor is reached: `validatePageName` runs on the name field, and creation is refused
locally if the name is taken by an existing page of this author (§3.3's list), is the reserved default, or fails
`NAME_PATTERN`. This is a *hint*: the real uniqueness is the addressable coordinate, and a write to an existing `d`
legitimately **replaces** that page. So the field must say: *"You already have a page called this. Creating it opens
the existing one."* — which is true, because that is what replaceable events do.

### 3.3 The page picker, replacing the pasted npub

`validateDraft`'s author field goes. In its place: **pick a page you own**, or — for an instance built by more than
one admin — **paste an address** in an "advanced" disclosure, because the routing file can point at *any* author's page
(`PageTarget.author`, `routeFile.ts:35-39`) and removing that ability outright would be a regression, not a
simplification.

The picker's data source, stated honestly:

**A relay read of `{ kinds: [30024], authors: [me] }` — the author's own pages, no `#d`.** This is the only source that
exists (§0.3). What it costs:

- **It is a relay read, so it can fail and it can be slow.** The query must therefore have its own surface for
  "could not read" (`PagePickerError`), and the form must not fall back to an empty picker — an empty list on a failed
  read is a lie that leads an admin to create a duplicate page. This is the same rule the bindings list already
  follows (`route-authoring-views.tsx:18-22`).
- **It shows pages the relay has, which is not the same set the server will serve.** Until the ingest switch lands
  (§0.1), a page can appear in the picker and still answer `binding-target-missing`. The picker must **not** claim
  the target is servable; it says *"pointing at this page"* and nothing about serving.
- **It is capped.** A relay will return whatever it likes; the owner's scale is *"hundreds"* of pages. The read must cap
  (`limit`, and a client-side cap that says how many were dropped) and the picker must be **searchable by name** rather
  than a `<select>` with 300 options.
- **Replaceable-event semantics must be applied client-side**, exactly as `selectReplaceable`
  (`storefrontQuery.ts:48-62`) already does for one address: the relay may return several versions of one `d` and the
  newest wins. Reusing that function rather than trusting arrival order is the rule NIP-01 already forced here.

**And it is per author.** For the common instance with one admin, `me` is the app key or the single admin and the list
is simply "my pages". A path pointing at *another author's* page is only reachable through the advanced paste field.
**[J]** — I am choosing to make the author's own list the primary, because the owner's own words are *"select from
existing pages that were already built"*, and a cross-author picker would need a list of *everybody's* pages, which
this app has no surface for and no permission model for.

A third state matters and must be rendered: **the page this binding currently points at, when it is not in this
author's list** (because it belongs to someone else, or the relay did not return it). The picker shows it as the
current selection, labelled by address, rather than silently showing nothing selected.

### 3.4 Create route and edit route

The owner: *"I would add a create route which allows you to create a new page, for example, and then an edit route
which allows you to edit an existing page. Obviously you can edit either the name or you can edit the page itself."*

Two distinct flows, which is what the current single form conflates:

**Create route** — `/dashboard/app-settings/routes/new` (a route, not a card on the list page):
1. **Path** — `validateIntentPath`'s rules, plus a live "not already bound" check (dragged out of `validateDraft`,
   `routeAuthoring.ts:110-113`, unchanged).
2. **Page** — the picker (§3.3), with a **"Create a new page instead"** escape that pre-fills the page name with
   the path name and hands off to §3.2. This is the owner's *"so let's say I want a specific feed to point at a new
   page"*, and it is why create-route must live beside the page list rather than on it.
3. **Bind** — the existing `publishRouteIntent` (`routeTableQuery.ts:104-136`). Unchanged.

The compile-in warning must keep working: the intent result's `warnings` (already surfaced at
`routeAuthoringPage.tsx:101`) become a **pre-submit notice** on the create form when the typed path is a compiled-in
name, not only a post-submit toast. The `describeBindings` `warning` field already carries it per row.

**Edit route** — `/dashboard/app-settings/routes/$path` (the path as a route param; it is the addressable `d` of the
intent, `routeIntent.ts:26-29`):
- **Name is read-only**, with the existing explanation in place of the field
  (`route-authoring-views.tsx:104-108` already says *"A path cannot be renamed in place"*). This matches the intent's
  own model — a rename is a remove + a set, and doing it as one form would need a two-event write the ingest does not
  take.
- **The page is editable** — the picker, pre-selected on the current `target`.
- **The published page can be opened**: a "View the page" row action that navigates to `/…/$path`, and a
  "Edit the page" row action that opens §3.2's editor at `(author, d)`. The owner's *"go to the routes section and then
  open up the pages that I've published under each of the different routes"* is exactly this pair of actions, and it is
  why edit-route must show the page it points at, not just its address string.

Removing a binding keeps `RouteRemovalConfirm` as-is (`route-authoring-views.tsx:232-261`); its copy ("The page it
points at is not deleted") is already right, and is now *true* in a way it was not before, because pages are separate
things the author owns.

### The list page's rows

`BindingRow` gains three fields and the row renders them:

```ts
// routeAuthoring.ts — additive
pageName: string        // 'featured-13-11-2026', humanised for the default
pageAuthorLabel: string // shortPubkey(author); 'instance' → 'the instance'
boundAtLabel: string    // existing updatedAtLabel, kept
```
`targetLabel`'s `page aaaaa…1111 / storefront-page` (`routeAuthoring.ts:66`) stays for the **raw address**, but is
demoted to a secondary line. A human reads a row as **"`/featured` → `featured-13-11-2026` (mine)"**.

### 3.5 Nav placement, in one table

| surface | nav item | section | flags | why |
|---|---|---|---|---|
| Pages list | `item('/dashboard/app-settings/pages', '📄', 'Pages', { adminOnly: true, fullBleed: true, hidesPageTitle: true })` | APP SETTINGS, beside Routes (`ui/nav/model.ts:177`) | mirrors Routes exactly | pages are published under app paths; same audience, same job |
| Editor for a page | **none** | — | reached by URL from Pages / Routes only | it is a full-bleed editor (`StorefrontBuilder` already owns the viewport); a nav item would be a second way to a state with no back-link |
| Create route | **none** | — | child of Routes | a modal-in-page flow, not a destination |
| Edit route `/routes/$path` | **none** | — | child of Routes | a detail of one row |
| Storefront (existing) | unchanged | ACCOUNT (`model.ts:149`) | — | it is now honestly one page among many |

Creating/editing routes as **routes rather than in-page state** (versus today's `useState` form in
`routeAuthoringPage.tsx:55-58`) buys deep links — "open the route for `/featured`" is a URL an admin can send — at the
cost of two files and a `tsr generate`. **[J]** I judge that worth it: the owner's flow is *"click on an existing route
and then select from existing pages"*, i.e. navigate to a thing.

---

## 4. Decision 5 — where every component lives (ADR-0007)

The rule, from `docs/adr/ADR-0007-…md:126-165` and `ui/AGENTS.md`: **`ui/` owns every component**; `platform/web/` is
the host/binding layer and *"still must NOT define presentational components, layout, or navigation markup. A route
that needs new UI adds it to `ui/`"*. `ui/` may not import `@platform/`, `@tanstack/`, or `@nostr-dev-kit/`
(`ui/boundary.test.ts`, enforced) — so everything in `ui/` is **props in, callbacks out**.

There is **no `ui-wrappers/` directory** in this tree — measured: `ls -d ui-wrappers` → *No such file or directory*,
while `ui/wrappers` and `ui/shared` both exist. ADR-0007 §1b names `ui/wrappers/` (wrappers around
`primitives/`) and `ui/shared/` (general-purpose) as the real directories. Every component below goes in an ADR-0007
§1b directory; nothing in this plan needs a wrapper, so `ui/wrappers/` is untouched:

| new file | layer | why there |
|---|---|---|
| `ui/settings/page-authoring-views.tsx` | `ui/<feature>` | **sibling of the existing `route-authoring-views.tsx`**, same pattern: presentational, props-driven, `EmptyState`, `Card`, `Button` from `primitives`/`shared`. The picker, the page list, the label chips, the create form |
| `ui/settings/route-authoring-views.tsx` | `ui/<feature>`, **modified** | `RouteBindingForm`'s author/d inputs (`:79-101`) are replaced by a page-picker slot; new `RouteCreateForm`/`RouteEditCard` join the cluster file. Cluster files are explicitly permitted (ADR-0007, clarification 2026-10-24) |
| `ui/settings/operator-settings-views.tsx` | `ui/<feature>`, **reused unchanged** (`:34,42,50,59`) — no diff | `SettingsPageHeader`, `SettingsMobileHeader`, `SettingsLoadingSkeleton`, `SettingsAccessDenied` — every new page uses these, so no new header vocabulary is minted |
| `platform/web/routes-authoring/pageIdentity.ts` | host, **pure** | view model, no React — same role as `routeAuthoring.ts` (`:10-16`: *"Kept free of React and of the network"*), so the naming rules are unit-testable without rendering |
| `platform/web/routes-authoring/pageAuthoring.ts` | host, **pure** | the new-page draft rules and the picker's row model. Pure for the same reason |
| `platform/web/routes-authoring/pageListQuery.ts` | host, **data** | the relay read `{kinds:[30024], authors:[me]}`, through `getReadContext()` like every other read (`storefrontQuery.ts:73-88`) |
| `platform/web/routes-authoring/pageAuthoringPage.tsx` | host, **assembler** | composes `ui/settings/page-authoring-views.tsx` with the queries and `StorefrontBuilder` |
| `platform/web/routes-authoring/routeAuthoringPage.tsx` | host, **modified** | keeps orchestrating; loses the inline form to `/routes/new` and `/routes/$path` |
| `platform/web/routes/_dashboard-layout/dashboard/app-settings/pages.tsx` + `pages.$d.tsx` | host, **route** | file-based route: the list and the editor |
| `platform/web/routes/_dashboard-layout/dashboard/app-settings/routes.new.tsx` + `routes.$path.tsx` | host, **route** | create and edit |
| `platform/web/storefront/{StorefrontBuilder,storefrontQuery,storefrontPublish,draftStorage}.ts(x)` | host, **modified** | §2. **Cross-track interface** |

**Nothing in `ui/` opens a relay read, holds a route param, or signs.** The picker receives `pages: PickerPage[]`,
`selected`, `loading`, `error`, and `onSelect`; the host does the rest. That is what keeps it renderable in the widget
book and out of `ui/boundary.test.ts`'s way.

---

## 5. The cross-track interface, specified precisely

> **This is the one thing the two tracks share, and the parent must sequence it before the other track's increment 2
> lands.**

### 5.1 What the other track gets

```ts
// platform/web/storefront/storefrontPublish.ts
export function buildStorefrontPageEvent(page: StorefrontPage, dTag?: string): EventTemplate
export async function publishStorefrontPage(page: StorefrontPage, dTag?: string): Promise<PublishStorefrontPageResult>
export async function unpublishStorefrontPage(page: StorefrontPage, dTag?: string): Promise<PublishStorefrontPageResult>

// platform/web/storefront/storefrontQuery.ts
export const storefrontPageQueryOptions: (pubkey: string, dTag?: string) => …
export function useStorefrontPage(pubkey: string | undefined, dTag?: string)
export function usePublishStorefrontPage(): { mutateAsync: (v: { page: StorefrontPage; dTag?: string }) => … }
export const storefrontKeys = { …, page: (pubkey: string, dTag?: string) => … }   // dTag defaults to the constant

// platform/web/storefront/draftStorage.ts
export function saveStorefrontDraft(pubkey: string, dTag: string | undefined, page: StorefrontPage): void
export function loadStorefrontDraft(pubkey: string, dTag?: string): StorefrontPage | null
export function clearStorefrontDraft(pubkey: string, dTag?: string): void
export function hasStorefrontDraft(pubkey: string, dTag?: string): boolean

// platform/web/storefront/StorefrontBuilder.tsx
export function StorefrontBuilder({ pubkey, dTag }: { pubkey: string; dTag?: string })
```

### 5.2 The three terms of the interface

1. **`dTag` is always optional and always defaults to `STOREFRONT_PAGE_D_TAG`.** Every existing call site keeps its
   exact behaviour and its exact query key (`storefrontKeys.page(pubkey)` → `['storefront','page',pubkey]`; adding
   `undefined` must **not** produce `['storefront','page',pubkey,undefined]`, so the key builder appends the segment
   only when `dTag` is supplied). This is the property that makes the seam mergeable while the other track is in
   flight.
2. **The seam is an address, not a mode.** `dTag` carries no intent about *what the page is for*. `isStorefront` is
   derived (`dTag === STOREFRONT_PAGE_D_TAG`), never passed. Any `mode: 'storefront' | 'custom'` parameter is a
   design error under the owner's ruling and must be refused in review.
3. **`storefrontPublish.ts:60` is the single write of the `d` tag**, and after this change its value comes from a
   parameter. `grep -n "'d'," platform/web/storefront/storefrontPublish.ts` must return exactly one line, now
   `[['d', dTag ?? STOREFRONT_PAGE_D_TAG]]`.

### 5.3 What the other track must *not* assume

- **`dTag` is not validated by the publish path beyond `isValidIntentDTag`** — `buildStorefrontPageEvent` today
  validates the *document*, not the tag. This plan adds `isValidPageDTag(dTag)` (the `NAME_PATTERN` check plus "not
  empty") to `validatePageName`'s module and calls it in `buildStorefrontPageEvent`, so a page event can never carry
  a `d` that `pageStore.segment()` has to percent-escape.
- **A custom page's `liveHref` is `null`** (§2). If the other track builds a serve path for custom pages, the preview
  link becomes its job and this plan does not fight it — it sets `null`, not a wrong URL.
- **The `d`-agnostic page list read is mine; the page *index on disk* is theirs.** If their increment 2 adds a
  local index, `pageListQuery.ts` has exactly one place to switch its source (`fetchMyPages`), and the UI does not
  change.

---

## 6. Ordered steps

Each step leaves `bun test` green and is independently reviewable. **No step touches `platform/server/` or `sdk/`.**

| # | step | files | proves |
|---|---|---|---|
| S1 | **Widen the d seam** — parameter with default everywhere in §5.1; legacy draft-key fallback | `storefrontPublish.ts`, `storefrontQuery.ts`, `draftStorage.ts` | existing suites pass **unchanged**; new tests pin `dTag` reaches the filter, the event tag and the draft key |
| S2 | **Thread `dTag` through the builder** — the 8 sites, `liveHref` null for non-default, deps arrays | `StorefrontBuilder.tsx` | editor with `dTag='x'` reads/publishes/drafts at `x`; storefront call site unchanged |
| S3 | **The identity view model** — naming rules, labels, `describePage`, `validatePageName` | `routes-authoring/pageIdentity.ts` + test | pure rules; no React |
| S4 | **The page list read** — `{kinds:[30024], authors:[me]}`, replaceable-wins, cap | `routes-authoring/pageListQuery.ts` + test | filter shape asserted exactly; several versions of one `d` collapse to the newest; cap reported |
| S5 | **Views: page list, new-page form, picker** | `ui/settings/page-authoring-views.tsx` + widget/unit test | renders four states (loading / error / empty / populated) distinctly |
| S6 | **Pages route pair** — list + editor | `app-settings/pages.tsx`, `pages.$d.tsx`, `routeAuthoringPage.tsx` (nav wiring) | creating a name opens the builder at that `d` |
| S7 | **Nav entries** | `ui/nav/model.ts` | Pages appears in APP SETTINGS, `adminOnly` |
| S8 | **Route create** — `/routes/new`, path + picker + "create a new page instead" | `app-settings/routes.new.tsx`, `route-authoring-views.tsx` (new form) | a valid path + a picked page produces the intent the server parses |
| S9 | **Route edit** — `/routes/$path`, read-only name, picker, view/edit page actions | `app-settings/routes.$path.tsx`, `route-authoring-views.tsx` | the row's target is pre-selected; a non-list target shows by address |
| S10 | **Slim the list page** to rows + "New route" | `routeAuthoringPage.tsx` | the list no longer carries a second copy of the form |
| S11 | **`tsr generate`** + full suite | `platform/web/routeTree.gen.ts` (generated) | tree contains the four new routes |

**S11 must be the only commit that touches `routeTree.gen.ts`.** Measured: running `bunx tsr generate` on this
worktree rewrites the file with **1049 insertions / 955 deletions** that are overwhelmingly tab→space reformatting plus
one stale `auctions.catalogue` import — i.e. the checked-in file has pre-existing drift from the generator. Do not
hand-edit it, and do not let its churn hide a real route change in review.

---

## 7. Test cases

| # | test | pins |
|---|---|---|
| T1 | `storefrontPublish > a page published with a d tag carries it, not the storefront default` | the event's `tags[0]` is `['d','featured-x']`; **one** `'d'` tag total |
| T2 | `storefrontPublish > with no d tag the storefront default is unchanged` | existing behaviour preserved — the merge-safety property |
| T3 | `storefrontPublish > a d tag that is not a route name is refused before signing` | `'../etc'`, `''`, `'a'.repeat(30)` refused; no signer call |
| T4 | `storefrontQuery > the page read filters on the d tag it was given` | filter is **exactly** `{kinds:[30024], authors:[pubkey], '#d':[dTag]}` (same shape as the existing `:145` assertion) |
| T5 | `storefrontQuery > the storefront call site keeps its query key` | `storefrontKeys.page(p)` equals the old tuple; no `undefined` segment |
| T6 | `draftStorage > a storefront draft written by the previous key still loads` | legacy fallback; and `draftStorage > two d tags do not share a draft` |
| T7 | `pageIdentity > a page name uses the path grammar` | table of accepted/rejected names, including the 30-char boundary and uppercase |
| T8 | `pageIdentity > the default page is named, not hidden` | `'storefront-page'` → label `'Storefront'`, `isDefault` true; it is refused as a *new* name |
| T9 | `pageListQuery > asks for every page of the author, with no d filter` | filter is `{kinds:[30024], authors:[me]}` and **no** `'#d'` key — the assertion that stops anyone re-pinning it |
| T10 | `pageListQuery > several versions of one page collapse to the newest` | reuses `selectReplaceable` semantics (`:48-62`), tie on lower id |
| T11 | `pageListQuery > a relay failure is an error, never an empty list` | the `RouteBindingsEmpty`-style lie is impossible |
| T12 | `pageListQuery > the list is capped and says how many it dropped` | a 500-page response yields ≤ cap and a stated remainder (the owner's *"hundreds"*) |
| T13 | `routeAuthoring > a route draft is valid without an author field` | the pasted-npub requirement is gone, and the intent still names a real `(author, d)` |
| T14 | `routeAuthoring > a picked page produces the intent the server parses` | round-trip through `parseRouteIntent` (`routeIntent.ts:92`) — the existing test at `routeAuthoring.test.ts` extended |
| T15 | `routeAuthoring > the current target is selectable when it is not in the author's list` | a foreign/absent target renders by address, not as "nothing selected" |
| T16 | `page-authoring-views > loading, error, empty and populated render differently` | four distinct outputs — no silent empty fallback |
| T17 | `pages route > creating a name opens the editor at that d` | the builder receives `dTag` equal to the typed name |
| T18 | `pages route > no block is added to a new page` | the created document is the wizard's, not one with an injected title block (the owner's explicit ruling) |
| T19 | `ui/boundary.test.ts` (existing) | the new `ui/settings/page-authoring-views.tsx` imports nothing forbidden |

T18 is the one I would fight hardest for: it is the only test that catches a future "helpful" default component.

---

## 8. Exit criteria

| # | criterion | command | expected |
|---|---|---|---|
| E1 | the authoring suites pass | `cd /home/admin_maxime/work/wt-admin-page-ui && export PATH="$HOME/.bun/bin:$PATH" && bun test platform/web/routes-authoring/ platform/web/storefront/` | 0 fail *(baseline measured today: `18 pass, 0 fail` for `routes-authoring/`)* |
| E2 | the seam's default is intact | `grep -c "STOREFRONT_PAGE_D_TAG" platform/web/storefront/storefrontPublish.ts` | ≥1, and the `'d'` tag is written exactly once: `grep -c "'d'" platform/web/storefront/storefrontPublish.ts` = 1 |
| E3 | no mode flag was introduced | `grep -rn "mode: 'storefront'\|isCustomPage\|editorMode" platform/web/storefront/ ui/settings/` | 0 hits |
| E4 | the page list does not pin a `d` | `grep -n "'#d'" platform/web/routes-authoring/pageListQuery.ts` | 0 hits |
| E5 | `ui/` stayed clean | `bun test ui/boundary.test.ts` | pass |
| E6 | this lane touched nothing it does not own | `git diff --stat master -- platform/server/ sdk/` | 0 files |
| E7 | generated tree is honest | `bunx tsr generate && git diff --stat platform/web/routeTree.gen.ts` | only the four new routes' additions after S11 |
| E8 | typecheck is **not** run here | — | `bunx tsc --noEmit` is forbidden on this runner (400 s+, OOM). Use `bun test` per file plus `bunx tsr generate`; the full typecheck is the parent's, on a clean tree |

---

## 9. What this plan deliberately does not do

- **It does not make a published page servable.** `storefrontPublish.ts` still goes to relays; the ingest switch is
  the other track's (§0.1). Until it lands, the picker's pages are pages *the relay knows*, and a bound path still
  answers `binding-target-missing`.
- **It does not add a page index on disk.** The list is a relay read (§3.3), with the cost stated. A local index is
  the other track's increment 2.
- **It does not build series or "general paths"** (`ruling-d8` R3, `/featured` → newest). Creating a page whose `d`
  is `featured` and pointing `/featured` at it works today as a *fixed* target; the dynamic "newest in series"
  resolution is increment 5, server-side.
- **It does not build list management** (`ruling-d8` §3) — tier 2, no increment.
- **It does not grant editors access to authoring.** `adminOnly` matches the existing Routes item; the wider ACL is
  increment 4.
- **It does not add a default block, a title block, or any framing inside a page.** The owner ruled it out.
- **It does not enable renaming a path.** A rename is remove+set; the form says so.
- **It does not delete or demote `STOREFRONT_PAGE_D_TAG`.** It becomes the default *name*, which is what it already is.
- **It does not touch `ui/primitives/`** (generated) or `routeTree.gen.ts` except via `tsr generate`.

---

## 10. Where I disagree with, or cannot satisfy, the owner's framing

**Satisfied and worth saying so:**

- *"a second way to open that same editor as a custom page editor"* — §2, by one address parameter, no fork.
- *"different routes... open up the pages that I've published under each of the different routes"* — §3.4's
  view/edit row actions.
- *"the routes name... is basically just a name and then the page you could pick between existing pages"* — §3.3.
- *"I wouldn't have a default component inside of the page"* — §3.2, pinned by T18.
- *"edit either the name or you can edit the page itself"* — **only the second half is built.** See below.

**Not satisfied, stated plainly:**

1. **"You can edit either the name or the page."** The name of a **route** is the addressable `d` of its kind-30025
   intent (`routeIntent.ts:26-29`), and the ingest applies one intent per event. Renaming in place would need a
   single write that means "remove *and* set", which the intent union (`action: 'set' | 'remove'`) cannot express
   without an `sdk/` change I am not allowed to make. So the route name stays read-only with the existing
   explanation. **What I can offer instead**: a "Rename" action that performs remove-then-set and reports both
   outcomes, which is a two-write UI flow — I have left it out because it can half-fail (removed, then the set is
   refused), leaving a path pointing at nothing with no explanation on screen. If the parent wants it, it is one
   confirmed flow plus a test for the half-failure. **The page's name** is likewise not editable: it is the page's
   `d`, and a page's address is its identity.
2. **"Publish that page underneath a route of the app."** The UI can now *express* this end to end — name a page,
   write it, bind a path to it — but the last mile is not mine: the page document must reach the **local page store**
   before the server can serve it (§0.1). Without the other track's ingest switch, this plan produces a correct
   intent pointing at a page the server cannot find.
3. **"For the same site... publish multiple pages for the same site"** (the storefront CMS extension). The storefront
   *can* now be one of many pages, and its own multi-page authoring is exactly what the Pages surface is. What is not
   done is the **storefront's own** in-editor page switcher — the owner explicitly deferred it (*"that's not something
   we need to worry about right now"*), and the Pages list reaches the same pages anyway.
4. **The picker shows the author's own pages, not "all pages".** *"Select from existing pages that were already
   built"* reads as the author's own, and no cross-author page index exists (§0.3). A path to another author's page
   is reachable only through the advanced paste field. If the intent was a picker over *everybody's* pages, that needs
   a list surface and a permission model this app does not have — **[U]** whether the owner meant that.

---

## 11. Evidence index (every command quoted above, in order)

```
git log --oneline -1                                    → 1154be66a
grep -rn "app-events" --include=*.ts --include=*.tsx platform/web/ | grep -v test
                                                       → only routeTableQuery.ts:114
sed -n "105,110p" platform/server/buildServer.ts        → pageStore.get(author, d); 500 binding-target-missing
ls data/                                               → pages.example  routes.example.json  (no data/pages)
grep -rn "STOREFRONT_PAGE_D_TAG" --include=*.ts --include=*.tsx sdk/ platform/
                                                       → constant, storefrontPublish.ts:60, storefrontQuery.ts:69 default
sed -n "164,180p" platform/server/http/appEvents.ts     → d from the event tag; storePage keys on it
grep -n "author" platform/server/routes/pageRender.ts   → renderPage(page, { author })
grep -n "level\|no-acl" platform/server/http/appEvents.ts → app/admin/editor accepted
grep -rn "STOREFRONT_PAGE_KIND" … | grep '#d'            → every read pins one #d
grep -n "pubkey" platform/web/storefront/StorefrontBuilder.tsx → 8 pinned sites (88,89,146,179,190,199,233,252)
grep -rn "usePublishStorefrontPage\|draftStorage…"      → draft/query/publish call sites and tests
sed -n "48,62p" platform/web/storefront/storefrontQuery.ts → selectReplaceable (NIP-01 order)
grep -n "storefront" -A 3 sdk/core/query/queryKeyFactory.ts → storefrontKeys.page(pubkey)
cat platform/web/routes/\$vanityName.tsx (line 41)      → <StorefrontAddressPage dTag={vanityName} />
sed -n "58,110p" platform/server/routes/pageStore.ts     → segment() percent-encodes; one file per (author,d)
sed -n "64,88p" sdk/commerce/storefront/routeIntent.ts   → isValidIntentDTag loose; validateIntentPath strict
bun test platform/web/routes-authoring/                → 18 pass, 0 fail
bunx tsr generate                                      → modified routeTree.gen.ts (1049+/955−), reverted with
                                                         git checkout -- platform/web/routeTree.gen.ts; tree clean
```