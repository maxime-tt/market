# PLAN — consolidating the two top nav bars into one AppBar

**Written** 2026-11-19. **Base:** `main` @ `f5765d38d`, worktree
`/home/admin_maxime/work/wt-appbar-plan`, branch `docs/appbar-consolidation-plan`.
**Status:** planning only. Nothing in this document is implemented.

Every claim about current behaviour below is cited `file:line` against that
base. Anything inferred rather than read is labelled **[INFERENCE]**.

---

## 1. Today: two bars, and they never co-render

There are exactly two top nav bars in the app.

**Bar A — the legacy header.** `platform/web/layout/Header.tsx:226-483`,
mounted once by the root frame:

- `platform/web/routes/__root.tsx:102` — `{!headerHidden && <Header />}`.
- `headerHidden` is `platform/web/routes/__root.tsx:65`:
  `useMatches({ select: (matches) => hidesAppHeader(matches) }) && !appPage`.
  The `!appPage` half means a page the server bound to this path overrides the
  opt-out — a page rendered inside the app's frame must have the frame's nav.
- `hidesAppHeader` is `platform/web/layout/appChrome.ts:45-46`: true when any
  match in the chain declares `staticData.hidesAppHeader === true`. The field is
  augmented onto TanStack's `StaticDataRouteOption` at
  `platform/web/layout/appChrome.ts:21-28`.

**Bar B — the Browse nav.** `ui/browse/browse-nav.tsx:52-171`
(`data-slot="browse-nav"`, `data-testid="widget-browse-nav"`), mounted **twice**,
both inside the `/` route's own subtree:

1. `platform/web/routes/index.tsx:107-113` — the CMS home (no `?q=`, no `?p=`),
   with `wordmarkLabel={instanceName}`, `onNavigateHome`, `onNavigateFeatured`
   and `accountSlot={<HeaderAccountControls />}`.
2. `platform/web/browse/BrowseIndexHost.tsx:883-889` — the search/results/idle
   surface, with `searchSlot={navSearch}` and
   `accountSlot={<HeaderAccountControls />}` (`BrowseIndexHost.tsx:674`).

The `/` route is the one route that opts out of Bar A:
`platform/web/routes/index.tsx:42` — `staticData: { hidesAppHeader: true }`.

**They cannot co-render.** A route either hides the legacy header and draws
`BrowseNav` itself, or draws the legacy header. That mutual exclusion is pinned
by `platform/web/layout/appChrome.test.tsx:82-95`:
`expect(markup.split('<nav').length - 1).toBe(1)` and
`expect(markup.split('<header').length - 1).toBe(0)` for the browse route, and
`platform/web/layout/appChrome.test.tsx:97-108` for a route that still gets the
header. It is not an accident of markup — it is a design where each surface
replaces the other, and the price is two nav bars to maintain, two account
clusters, and a header that is absent from the two most-visited pages.

**Arena/light chrome.** `usesArenaChrome` (`appChrome.ts:56-58`) puts
`.arena-chrome` on the root wrapper for `/`, `/auctions`, `/auctions/*`, `/products` and `/products/*` (ADR-0024)
(`__root.tsx:100`). That class rebinds the widget tokens to Arena's dark values
(`styles/arena-chrome.css:42-50`), so markup written against
`bg-surface-raised` / `text-text-high` / `border-border-default` / `bg-fill-ink`
is correct in both chromes without a per-chrome branch. Bar A does **not** rely
on that: it branches on pathname into `arena` and `ownArenaScope`
(`Header.tsx:274-275`), rewrites its own classes (`Header.tsx:349-352`),
computes a scroll-dependent background (`Header.tsx:280-345`) and wraps itself
in a second `.arena-chrome` scope for the dashboard (`Header.tsx:478-482`).

---

## 2. The AppBar: one bar at the frame level

**The change.** One bar is mounted once, by the root frame, on every route
except `/setup`. It replaces the `Header` mount and the two `BrowseNav` mounts.

- **Frame mount.** `platform/web/routes/__root.tsx:102` becomes `<AppBar />`
  (unconditional). Delete `headerHidden` and the `useMatches` call at
  `__root.tsx:65`; the `hidesAppHeader` import at `__root.tsx:3` drops with it.
  `isSetupPage` still returns early at `__root.tsx:94-96`, so `/setup` keeps no
  chrome.
- **Delete the opt-out.** Remove `hidesAppHeader`, the `StaticDataRouteOption`
  augmentation and `AppChromeMatch` from `platform/web/layout/appChrome.ts`
  (lines 21-47), and remove `staticData` from the `/` route
  (`platform/web/routes/index.tsx:42`). `usesArenaChrome` stays in
  `appChrome.ts` and keeps feeding `__root.tsx:100`.
- **Delete the two Browse-local mounts.** `platform/web/routes/index.tsx:107-113`
  and `platform/web/browse/BrowseIndexHost.tsx:883-889` are deleted, together
  with everything that existed only to feed them:
  `BrowseIndexHost.tsx:674` (`accountSlot`), `BrowseIndexHost.tsx:688-696`
  (`navSearchHidden`, `navSearch`), `BrowseIndexHost.tsx:353`
  (`instanceName`), the `onNavigateFeatured` prop of `BrowseIndexHost`
  (`BrowseIndexHost.tsx:83`, passed at `index.tsx:148`) — the AppBar owns the
  Featured destination now — and the `HeaderAccountControls` /
  `BrowseNav` / `instanceName` imports at `BrowseIndexHost.tsx:37,39,66` and
  `index.tsx:9,10`.
- **One nav list.** A single module supplies the list; the desktop bar and the
  mobile menu both read it (today the same list exists twice: `Header.tsx:367-401`
  and `MobileMenu.tsx:53-60`).
- **Arena/light both handled.** The bar is written against the widget tokens
  only — `bg-background`, `border-b border-border-default`,
  `text-text-mid`/`text-text-high`, `bg-fill-ink`, `bg-surface-raised`
  (`ui/browse/browse-nav.tsx:78-96`, `ui/browse/search-field.tsx:177-196`).
  Inside `.arena-chrome` those tokens already resolve to Arena's dark values
  (`styles/arena-chrome.css:42-50`), so both chromes are one code path. The
  pathname branches at `Header.tsx:274-275`, the second arena scope at
  `Header.tsx:478-482`, and the scroll-gradient machinery at
  `Header.tsx:280-345` are **not** carried over.

**Files.**

| File                                      | Change                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `platform/web/routes/__root.tsx`          | `<AppBar />` at line 102; drop `headerHidden`/`useMatches`/`hidesAppHeader`                                  |
| `platform/web/layout/appChrome.ts`        | delete the module augmentation (21-27) and `AppChromeMatch`/`hidesAppHeader` (30-47); keep `usesArenaChrome` |
| `platform/web/routes/index.tsx`           | delete `staticData` (42) and the `BrowseNav` mount (107-113)                                                 |
| `platform/web/browse/BrowseIndexHost.tsx` | delete the nav mount (883-889) and its feeders (353, 674, 688-696, 83)                                       |
| `platform/web/layout/AppBar.tsx`          | **new** — the frame-level host                                                                               |
| `ui/appbar/app-bar-view.tsx`              | **new** — presentational bar, moved from `ui/browse/browse-nav.tsx`                                          |
| `platform/web/layout/navItems.ts`         | **new** — the one nav list                                                                                   |

**Why two new files and not one.** The repository splits presentation
(`ui/`) from host wiring (`platform/web/`) — `BrowseNav` (presentational,
`ui/browse/browse-nav.tsx`) already takes slots (`searchSlot`, `accountSlot`,
`browse-nav.tsx:16-31`) that its hosts fill. The plan keeps that split and
generalises the existing component rather than inventing a second one:

- `ui/appbar/app-bar-view.tsx` — `BrowseNav` moved verbatim, with its hardcoded
  "Featured" link (`browse-nav.tsx:123-149`) replaced by a `navItems: ReactNode`
  slot and its `wordmarkLabel` prop replaced by a `brand: ReactNode` slot.
  Keep `data-slot="app-bar"`, and keep the phone-safety rules the current nav
  encodes: the search slot wrapper must keep `flex-1 flex justify-center min-w-0`
  (`browse-nav.tsx:158`, load-bearing per its own comment) and the nav list must
  keep `hidden sm:flex` (`Header.tsx:367` today).
- `platform/web/layout/AppBar.tsx` — mounts the view, owns router/store reads.

**Prop interface.**

```ts
// platform/web/layout/AppBar.tsx
export interface AppBarProps {
	/** Extra classes for the bar root. The frame mounts it with none. */
	className?: string
}
```

Everything else is read, not passed: location/navigate from
`@tanstack/react-router`, `useInstanceName()` + `useConfigQuery()` for identity,
`useStore(authStore)` for the account menu, `cartStore` for the cart count,
`appNotificationsBinding`/`appUnseenCounts` for the dashboard badge, and
`useRouteTable()` for pinned pages. That is why the frame mount is
`<AppBar />` and nothing else.

---

## 3. Identity

The bar's identity is the instance's, not a literal.

- **Title:** `useInstanceName()` (`platform/web/config/instanceName.ts:25-28`),
  which resolves `displayName → name → "Plebeian Market"`
  (`instanceName.ts:20-22`). Bar A already does this by hand
  (`Header.tsx:276-279`) and so does the Browse nav
  (`index.tsx:108`, `BrowseIndexHost.tsx:884`).
- **Logo:** `config.picture` from `useConfigQuery()`, rendered as
  `<img src={config.picture} alt={config.displayName || config.name} />` when
  present — exactly what `Header.tsx:357-359` does today. `picture` is optional
  in the instance config (`sdk/config/instance-config.ts:72`), so a missing logo
  falls back to the title alone.
- **Wordmark/link:** the logo+title block is the link to `/`
  (`data-testid="home-link"`, as at `Header.tsx:356`; `e2e/tests/og-meta-tags.spec.ts:522`
  depends on that testid).

The identity is read inside `AppBar.tsx`; it is **not** a prop. Do not thread
`title`/`logo` from the frame — the frame has no config and would add a second
place for the brand to drift.

---

## 4. Search

**One search implementation, on every route.** `ui/browse/search-field.tsx`
(the `SearchField` component, `search-field.tsx:114-301`) is mounted once, in
the AppBar, at `size="nav"` (the default; `search-field.tsx:70-88`).

- It is a controlled pill: keep local state, and **on go / Enter** navigate to
  `/?q=<value>` — `navigate({ to: '/', search: { q: value } })`. The `/` route
  validates the param (`platform/web/routes/index.tsx:27-30`) and hands it to
  `BrowseIndexHost` (`index.tsx:133-152`).
- The field's own contract is unchanged: `value`, `onChange`, `onGo`,
  optional `onClear`, `size` (`search-field.tsx:25-56`). The AppBar supplies
  them.
- `ProductSearch` is **deleted**: `platform/web/products/ProductSearch.tsx`,
  its import at `Header.tsx:3`, and both mounts (`Header.tsx:410` desktop,
  `Header.tsx:468` mobile). It is the only importer of the file
  (grep: `ProductSearch.tsx` has no other consumer), and the things it uses
  stay used elsewhere — `useProductSearch`/`productQueryOptions`
  (`platform/web/products/productQuery.ts:226,1029`) are used by
  `platform/web/cart/cartStore.ts:338` and `ProductCardHost.tsx:86`;
  `ProductSearchResults` (`ui/products/product-search-results.tsx`) stays.

**The home hero field is page content, not a second search.** The idle frame's
large field is `SearchField size="hero"` at `BrowseIndexHost.tsx:824-830`. It
stays: it is the idle frame's affordance and the same component. What changes is
the handoff machinery that existed only because the nav field was
Browse-local and could unmount — `navSearchInput`/`heroSearchInput`/
`focusTarget` (`BrowseIndexHost.tsx:363-368`), the focus effect
(`BrowseIndexHost.tsx:659-672`), `handleHeroSearchChange`'s focus juggling
(`BrowseIndexHost.tsx:491,504`), the `onRefine` focus call
(`BrowseIndexHost.tsx:634`) and the scroll handoff `NAV_SEARCH_HANDOFF_PX` /
`usePageScrolled` (`BrowseIndexHost.tsx:166,174`). Delete them: the AppBar field
never unmounts, so there is nothing to hand off to. Consequence to accept: on the
home idle state the page shows the hero field **and** the AppBar field, both
bound to `q`. If the owner wants one field on the home, hide the AppBar field on
`pathname === '/' && !q && !p` — but that reintroduces a per-route branch in the
bar, so the recommendation is to keep both and let the hero field be the
prominent one on idle only. **Treat this as the one open UI decision in this
section.**

**The placeholder** default is `'Search products, sellers and lists'`
(`search-field.tsx:117`). The home hero's count-aware placeholder
(`BrowseIndexHost.tsx:704-708`) stays on the hero field only.

---

## 5. Removals

Each item below is deleted or unmounted in the same change that adds the AppBar,
so the repo never carries two bars.

| Item                             | Current location                                                                 | Disposition                                                                                                                                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BugReportButton`                | `Header.tsx:167-196` (component), mount `Header.tsx:419`, import `Header.tsx:21` | **Delete.** `BugReportModal` (`platform/web/messaging/BugReportModal.tsx`) has no other consumer — delete it with the button.                                                                                                                        |
| `ConnectionStatusPill`           | mount `Header.tsx:415`, import `Header.tsx:22`                                   | **Owner's call: drop for now, revisit later.** Unmount and drop the import; **keep the file** (`platform/web/layout/ConnectionStatusPill.tsx`) and its `ndkStore` health read, because the relay-health surface is a planned revisit, not dead code. |
| `CartButton`                     | `Header.tsx:91-122`, mount `Header.tsx:426`                                      | **Moves into the account dropdown** as a menu item (§6). The badge count logic (`Header.tsx:92-101`) moves with it; the `cartStore` read stays.                                                                                                      |
| `ProductSearch`                  | `platform/web/products/ProductSearch.tsx`, mounts `Header.tsx:410,468`           | **Delete** (§4).                                                                                                                                                                                                                                     |
| `MobileMenu`'s literal link list | `platform/web/layout/MobileMenu.tsx:53-60` (`menuItems`)                         | **Replace with the shared list** from `platform/web/layout/navItems.ts` (§9, WP4). The menu itself stays as the small-screen nav surface (`Header.tsx:472`).                                                                                         |
| `HeaderAccountControls`          | `Header.tsx:204-224`, used at `index.tsx:112` and `BrowseIndexHost.tsx:674`      | **Delete** once both mounts go; the AppBar's account menu (§6) subsumes it.                                                                                                                                                                          |
| Bar A's pathname branches        | `Header.tsx:274-345`, `478-482`                                                  | **Not carried over.** Token-driven styling makes them redundant (§2); record the visible change: the transparent-over-hero gradient header is gone.                                                                                                  |

---

## 6. Account dropdown

**One auth-aware menu**, built on `ui/primitives/dropdown-menu.tsx`, styled with
the widget tokens — **not** the primitive's shadcn skin. The primitives accept
`className` on every part (`ui/primitives/dropdown-menu.tsx:34-45` for
`DropdownMenuContent`, `:62-83` for `DropdownMenuItem`), so the menu supplies:

| Part                                  | Token classes                                                         |
| ------------------------------------- | --------------------------------------------------------------------- |
| `DropdownMenuContent`                 | `bg-surface-raised`, `text-text-high`, `border border-border-default` |
| `DropdownMenuItem` (active/highlight) | `focus:bg-fill-ink focus:text-on-fill-ink`                            |
| `DropdownMenuSubContent`              | same as `DropdownMenuContent`                                         |
| `DropdownMenuSeparator`               | `bg-border-default`                                                   |
| `DropdownMenuShortcut`/labels         | `text-text-mid`                                                       |

The primitive's defaults are shadcn's — `bg-popover` /
`text-popover-foreground` on `DropdownMenuContent` (`dropdown-menu.tsx:47`),
`focus:bg-accent focus:text-accent-foreground` on `DropdownMenuItem`
(`dropdown-menu.tsx:75`). They are merged **before** the caller's `className`
(`cn` is `twMerge(clsx(...))`, `ui/utils/cn.ts:4-6`), so a widget token passed on
each part wins; anything left unoverridden shows the shadcn skin inside the
widget chrome.

**Auth-state read.** `platform/web/auth/authStore.ts:305` exposes `authStore` (a
`@tanstack/store` view of the machine, mirrored from it at `authStore.ts:300-320`). The state shape is
`sdk/core/auth/types.ts:16-22`: `{ user, isAuthenticated, isAuthenticating,
needsDecryptionPassword, needsMigration }`. The menu reads
`useStore(authStore)` and branches on `isAuthenticating` → spinner,
`isAuthenticated` → menu, else → sign-in. `user.pubkey`
(`types.ts:11-13`) is the identity for the profile link and the avatar.

**Signed out:** one `DropdownMenuItem` — "Sign in" → `uiActions.openDialog('login')`,
exactly the action the current login button fires (`Header.tsx:33`).

**Signed in:** the trigger is the avatar (`ProfileButton`'s read,
`Header.tsx:55-89`: `useProfile(authState.user?.pubkey)` +
`AvatarUser`), and the menu is:

1. **Profile** → `/profile/$profileId` with `profileId = user.pubkey`
   (`Header.tsx:66-68`).
2. **Wallet** → opens the wallet surface. Today that is `Nip60WalletHost` in a
   `Popover` (`Header.tsx:147-166`, `data-testid="wallet-button"`); the menu item
   opens the same host. Keep `data-testid="wallet-button"` on the item so the
   existing e2e selectors still resolve.
3. **Dashboard** → `/dashboard`, carrying the unseen-count badge that
   `Header.tsx:124-145` computes from `appUnseenCounts`
   (`Header.tsx:229-256`).
4. **Cart** → `uiActions.openDrawer('cart')` (`Header.tsx:99`), with the item
   count from `cartStore` (`Header.tsx:92-101`). **Added.**
5. **Currency** — a **submenu** (`DropdownMenuSub` + `DropdownMenuSubTrigger` +
   `DropdownMenuSubContent`, `dropdown-menu.tsx:195-245`), items from
   `CURRENCIES` (`sdk/config/constants`), each calling
   `uiActions.setCurrency(currency)` and checked against
   `uiStore.selectedCurrency` — the radio behaviour of
   `platform/web/layout/CurrencyDropdown.tsx:12-17,44-53`. **Added**; replaces
   the standalone `CurrencyDropdown` mount (`Header.tsx:423`) and its mobile
   copy inside `MobileMenu.tsx:99-101`.
6. **Sign out** → `authActions.logout()` (`Header.tsx:48`).

**What must be ADDED.**

- **A signer-type.** `AuthUser` carries only `pubkey` (`sdk/core/auth/types.ts:11-13`)
  and `AuthSessionSnapshot` only `pubkey`/`state` (`types.ts:56-59`), so the app
  today cannot say _how_ the user signed in. `AccountPane`'s `signedInWith`
  (`ui/browse/account-pane.tsx:29`) is exactly that string. The machine knows
  the lane it started — `ncryptsec` (`sdk/core/auth/machine.ts:175`), `nsec`
  (`:212`), `extension` (`:241`), `bunker` (`:272`) — so the change is: add the
  lane to the machine's state as a `signerType` field (one of `extension`,
  `nsec`, `ncryptsec`, `bunker`, `nostrconnect`) mirrored into
  `authStore`'s `AuthState`, and render it in the menu's profile header. This is
  required **only if** the profile section of the menu shows `signedInWith`;
  the six nav items above do not need it. Recommendation: add it, because the menu's
  first section is the profile block and a bare npub is thin.
- **A cart entry** (item 4 above; `cartStore` is already there).
- **The currency submenu** (`DropdownMenuSub`; the primitive exports it,
  `dropdown-menu.tsx:195-245`).

**`ui/browse/account-pane.tsx`: re-cut, not reused.** It is a 420px floating
panel (`account-pane.tsx:86`) mounted only by the widget-book
(`widget-book/libraries/browse.tsx:245-262`). It takes twelve props
(`account-pane.tsx:21-51`), several of which the menu has no use for —
`balance`, `onTopUp`, `onWithdraw`, `onConnectNWC`, `onTransactions` are a
wallet dashboard, not nav. A dropdown menu of `DropdownMenuItem`s is the wrong
container for a full-width pane. So the menu **re-cuts the pane's link content**
(profile, orders/notifications/saved-lists, sign out) as items, and
`AccountPane` stays what it is today: a widget-book-only component. Do not
delete it; do not mount it in the bar.

---

## 7. Pinned routes

**Goal.** The operator pins pages into the nav from the routing file, so
`/featured` (and any future bound page) appears in the bar without a code
change. Today the only pinned entry is hardcoded: the "Featured" link in
`ui/browse/browse-nav.tsx:123-149`, navigating to `/$vanityName` with
`vanityName: 'featured'` (`index.tsx:111`, `BrowseIndexHost.tsx:887`).

**The field.** Add an optional nav entry to `Binding`:

```ts
// platform/server/routes/routeFile.ts, beside Binding (line 76)
export interface BindingNav {
	/** The label the AppBar shows. Non-empty, ≤ 24 chars. */
	label: string
	/** Ascending sort key; the AppBar orders pinned entries by it. */
	order: number
}
// Binding gains:  nav?: BindingNav
```

`filter(b => b.nav)` then `sort((a,b) => a.nav.order - b.nav.order)` is the
whole AppBar read (§7.7).

### 7.1 `platform/server/routes/routeFile.ts`

- Add `BindingNav` and `nav?: BindingNav` to `Binding` (`routeFile.ts:76-86`).
- **Validate and copy it.** The per-binding reconstruction at
  `routeFile.ts:292-306` builds a fresh object literal —
  `{ kind, path, ...lease fields, target, updatedAt, updatedBy }` — so **every
  key it does not name is silently dropped today**. (The file-level unknown-field
  check at `routeFile.ts:158-162` covers only top-level keys; per-binding keys
  are never checked.) Add, beside the `updatedAt`/`updatedBy` checks at
  `routeFile.ts:263-269`:
  - `raw.nav === undefined` → omit.
  - otherwise it must be an object with `label` a non-empty string ≤ 24 chars
    (`${base}/nav/label`) and `order` an integer
    (`Number.isInteger`, `${base}/nav/order`); collect violations with the same
    `POINTER` helper.
  - and `... (navValid ? { nav: { label, order } } : {})` in the pushed literal.
  - **Refuse `nav` on a lease.** A lease lapses at `expiresAt`
    (`routeFile.ts:479-481`) while the AppBar reads the table's current
    bindings (`platform/server/http/routeTable.ts:27`), which would leave a
    pinned link to a 404. The violation is
    `${base}/nav: nav is only valid on a permanent binding`. This is the clean
    fix; the alternative (filter expired leases in the AppBar) puts the
    liveness rule in a second place.
- Serialization needs no change: `serializeRoutesFile` sorts keys of whatever
  object it is given (`routeFile.ts:417-425`), so `nav` round-trips once it is on
  the binding.

### 7.2 `sdk/commerce/storefront/routeIntent.ts`

- Add `nav?: RouteIntentNav` to `RouteIntent` (`routeIntent.ts:55-63`); the `remove` arm
  keeps `nav` absent (a remove deletes the binding).
- **The closed key allowlist** at `routeIntent.ts:118` —
  `['version', 'action', 'path', 'target']` — gains `'nav'`. Without this, an
  intent carrying `nav` is refused as `/${key}: unknown field`.
- Validate and copy in the `set` arm (beside the target checks,
  `routeIntent.ts:147-192`), same rules as 7.1 (`/nav/label`, `/nav/order`), and
  return it on the parsed intent.
- **`routeIntentContent`** (`routeIntent.ts:176-182`) must emit it:
  `...(intent.nav ? { nav: intent.nav } : {})`. This is the signed document; a
  field the content does not emit cannot be signed, and an authored pin would
  vanish between the form and the event.
- `buildRouteIntentEvent` (`routeIntent.ts:197-205`) needs no change — it validates through
  `parseRouteIntent(routeIntentContent(intent), intent.path)`.

### 7.3 `platform/server/routes/routeTable.ts`

- `toRouteTarget` (`routeTable.ts:77-82`) is target-only; leave it.
- **`sameTarget` (`routeTable.ts:84-89`) is the no-write check and compares only the
  target.** A nav-only change would therefore return `changed: false`
  (`routeTable.ts:136-140`) and never be written. Extend the check — either add
  `sameNav(existing.nav, intent.nav)` and require both, or rename to
  `satisfiedBy` and compare target **and** nav. This is the subtlest line in the
  package: the existing test at `platform/server/routes/routeTable.test.ts:113-119`
  ("an intent that is already satisfied writes nothing") pins the current
  behaviour, so its fixture must keep having no nav, and a new test must prove a
  nav-only change _does_ write.
- `apply`'s binding construction (`routeTable.ts:142-148`) gains
  `...(intent.nav ? { nav: intent.nav } : {})`.
- `candidateFile` (`routeTable.ts:65-73`) passes `bindings` through untouched, so other
  bindings' nav survives the re-validation; `commit` (`routeTable.ts:103-108`) writes the
  validator's reconstruction, which now carries nav (7.1).

### 7.4 The read model — `platform/web/routes-authoring/routeAuthoring.ts`

- `BindingRow` (`routeAuthoring.ts:16-31`) gains `navLabel: string | null` and
  `navOrder: number | null` (`null` = not pinned).
- `describeBinding` (`routeAuthoring.ts:60-80`) copies them from `binding.nav`.
- `BindingDraft` (`routeAuthoring.ts:33-39`) gains `navLabel: string` and `navOrder: string`
  (form inputs are strings; the draft validator coerces) — or
  `showInNav: boolean` + label + order if the form wants a checkbox. Recommendation:
  `showInNav` plus label and order, because "empty label" is a confusing way to
  say "not pinned".
- `EMPTY_DRAFT` (`routeAuthoring.ts:159`) and `draftFromRow` (`routeAuthoring.ts:161-163`) gain the fields.
- `validateDraft` (`routeAuthoring.ts:112-150`) validates the pair together: a pinned draft
  needs a non-empty label and an integer order, and `errors` names the field
  (`'Enter a nav label.'`, `'Nav order must be a whole number.'`).
- `describeBindings` (`routeAuthoring.ts:82-84`) keeps sorting rows by `path` — the authoring
  list is path-ordered, not nav-ordered.

### 7.5 The authoring form — `ui/settings/route-authoring-views.tsx` and its host

- `RouteBindingRow` (`route-authoring-views.tsx:32-45`) gains the nav fields; `RouteBindingsList`
  (`route-authoring-views.tsx:220`) shows a "In nav: <label> (<order>)" line on pinned rows.
- `RouteBindingForm` gains a section beside the path field
  (`route-authoring-views.tsx:91-99`): a "Show in navigation" switch, a label
  `Input` (default: the path) and an order `Input type="number"`. `RouteCreateForm`
  and `RouteEditCard` pass the values through.
- The host `platform/web/routes-authoring/routeAuthoringPage.tsx` threads the
  draft fields into `RouteBindingForm` and into the `RouteIntent` it builds
  (`routeAuthoring.ts` `validateDraft` → intent), so the signed event carries
  `nav`.

### 7.6 The existing `GET /api/routes` consumer

`platform/web/routes-authoring/routeTableQuery.ts`:

- `RouteTableView.bindings: Binding[]` (`routeTableQuery.ts:23-30`) is typed from the server's
  `Binding`, so **no structural change** is needed; `fetchRouteTable` (`routeTableQuery.ts:42-63`)
  casts `body.bindings as Binding[]` and nav rides along.
- `platform/server/http/routeTable.ts:24-33` serialises
  `table.current().bindings`, which now include `nav`. Nothing to change there.
- Note the (pre-existing) validation gap: `fetchRouteTable` does not validate the
  binding shape, so the AppBar must tolerate a malformed `nav`
  (`typeof b.nav?.label === 'string' && Number.isFinite(b.nav?.order)`) before
  rendering it — relay/HTTP data is untrusted, and this is instance state read
  over the wire.

### 7.7 The AppBar reads it

```ts
const { data } = useRouteTable()
const pinned = (data?.bindings ?? [])
	.filter((b) => b.nav && typeof b.nav.label === 'string' && Number.isFinite(b.nav.order))
	.sort((a, b) => a.nav!.order - b.nav!.order || a.path.localeCompare(b.path))
```

Rendered after the built-in list, each item a `Link` to `/<path>`. `useRouteTable`
is already a react-query read (`routeTableQuery.ts:65-67`) with a stable key
(`routeTableKeys.all`, `routeTableQuery.ts:31-33`); the AppBar therefore re-reads after an
authoring write, which `usePublishRouteIntent` already invalidates
(`routeTableQuery.ts:137-146`). No new fetch.

### 7.8 Interaction with `default`, `prefixes` and leases

- **`default`** names a path, not a page (`routeFile.ts:529-531`); `/` runs the
  same ladder for it (`platform/server/routes/defaultBinding.ts:45-48`). A
  binding that the default names can carry `nav`, and the AppBar pins it by its
  own `path` — so "pin the home" is expressed as pinning whatever path the
  operator chose as the default. No special case.
- **`prefixes`** are `PrefixRoute` objects (`routeFile.ts:88-92`), not
  `Binding`s; they can never carry `nav`. That is correct: a prefix is a pattern
  (`item/:eventId`), not a page an operator pins by name.
- **Leases** — refused by 7.1. A lapsed lease must not leave a dead nav link.

### 7.9 Migration for files without the field

- `nav` is **optional**, so every existing `data/routes.json` validates
  unchanged: absent means "not pinned", and the AppBar contributes nothing.
- The first write after the upgrade re-serialises each binding through the
  validator (7.1), which now _copies_ nav; a file that never had it simply never
  has it. `ROUTES_FILE_VERSION` stays `1` (`routeFile.ts:31`) — an additive
  optional field does not need a version bump, and bumping it would refuse every
  existing file (`routeFile.ts:165-167`).
- The 4 MiB budget (`routeFile.ts:42`) is unaffected in practice: `{"nav":{"label":"Featured","order":1}}`
  is ~38 bytes against a ~335-byte binding baseline.
- **Rollback:** a build that predates the field drops `nav` on its next write
  (the 7.1 defect is also the old behaviour), so a downgrade loses pins. State
  this in the release note; there is no data loss the operator cannot re-author.

### 7.10 Why `staticData` cannot express this

`staticData` is compile-time route metadata: it is declared on a
`createFileRoute` route object (`appChrome.ts:21-28` shows the augmentation;
`index.tsx:42` is the one use) and read off the matched chain
(`appChrome.ts:45-46`). Operator-pinned pages are **runtime data** and have no
compiled route:

- `/featured` is not in `platform/web/routes/` — the route table has only
  `$vanityName` for forward-slash-plus-one-segment (`platform/web/routes/$vanityName.tsx:33-35`),
  which is the **404 surface** for segments the server did not resolve
  (`$vanityName.tsx:6-16`).
- `/featured` is an exact path in the routing file answered by a series binding
  (`platform/server/routes/resolve.ts:30-35`; the validator accepts a
  `{ type: 'series', series: 'featured' }` target, `routeFile.ts:280-289`).
- The server resolves it and sends the app-chrome payload
  (`platform/web/storefront/appChromePage.ts:73-79`); the SPA never has a route
  object for it, so there is nowhere to hang `staticData.nav`.

A compile-time list would mean a code change and a redeploy for every pinned
page — exactly what the routing file exists to avoid (`routeFile.ts:1-28`). The
pin therefore has to live with the binding.

---

## 8. Mobile

**Approach: built-in responsiveness only.** No separate mobile bar, no
JS breakpoint branch for layout. The bar is one tree that collapses with
Tailwind:

- **Nav list:** `hidden sm:flex` on the desktop list (as today,
  `Header.tsx:367`); below `sm` the `MobileMenu` overlay carries the same list
  (one source, §9 WP4) behind the menu button.
- **Search field:** `w-full max-w-[560px] min-w-0` with the go pill hidden below
  `sm` (`search-field.tsx:71-88`) — the field is already fluid and the
  `min-w-0` on the wrapper (`browse-nav.tsx:158`) is load-bearing; keep it.
- **Account menu:** the dropdown and its currency submenu work at every width;
  the `!isMobile` gating that hides the currency selector, dashboard, wallet and
  logout on small screens (`Header.tsx:246,423,429,432,446`) disappears,
  because the menu is one surface at all sizes.
- **Density:** the bar height stays `h-16` (`browse-nav.tsx:86`), which is the
  value both current bars converge on (`Header.tsx:354`'s `py-4` over a 40px
  control row).

**Deferred:** a detailed responsive pass (control sizes at 360px, the menu
button's placement, the exact wrap order between the nav list, the search and
the account trigger at `md`) is a follow-up, not part of this consolidation.
This section states the approach so the implementer does not build a second bar
to solve small screens.

---

## 9. Sequencing

**The trunk is WP1.** WP2–WP4 hang off it; WP5–WP6 are independent of the whole
chrome change and can land first, in parallel, or after.

### WP1 — the bar exists (trunk)

Files: `platform/web/routes/__root.tsx`, `platform/web/layout/appChrome.ts`,
`platform/web/routes/index.tsx`, `platform/web/browse/BrowseIndexHost.tsx`,
new `platform/web/layout/AppBar.tsx`, new `ui/appbar/app-bar-view.tsx`
(moved from `ui/browse/browse-nav.tsx`), new
`platform/web/layout/navItems.ts`.

Change: mount `<AppBar />` at `__root.tsx:102`; delete `hidesAppHeader` +
the augmentation + the `/` `staticData`; delete both `BrowseNav` mounts and
their feeders; the view renders the built-in nav list
(`Products, Auctions, Community, [Nostr]`) + wordmark.

Lands independently. **Visible:** the transparent-over-hero header is gone.

### WP2 — identity + search

Files: `platform/web/layout/AppBar.tsx`, new `ui/appbar/app-bar-view.tsx`
(search slot), `platform/web/browse/BrowseIndexHost.tsx` (delete the handoff
machinery, §4), delete `platform/web/products/ProductSearch.tsx`,
`platform/web/layout/Header.tsx` (drop the imports/mounts it loses).

Change: `useInstanceName()` + `config.picture`; one `SearchField` at `size="nav"`
navigating to `/?q=`; `ProductSearch` deleted.

Depends on WP1's files existing. Independent of WP5–WP6.

### WP3 — account dropdown

Files: new `platform/web/layout/AccountMenu.tsx` (or
`ui/appbar/account-menu.tsx`), `sdk/core/auth/types.ts` +
`sdk/core/auth/machine.ts` + `platform/web/auth/authStore.ts` (the
`signerType` addition), `platform/web/layout/Header.tsx` (delete
`HeaderAccountControls`/`LoginButton`/`LogoutButton`/`ProfileButton`/
`CartButton`/`DashboardButton`/`WalletButton`/`CurrencyDropdown` usage).

Change: the dropdown + submenu per §6, with token styling, the cart entry, the
currency submenu, and the signer-type read.

Depends on WP1. The `signerType` slice (`types.ts`, `machine.ts`, `authStore.ts`)
is independent and can land first if the menu is built in parallel — it has its
own tests (`sdk/core/auth/machine.test.ts`).

### WP4 — removals + the one nav list

Files: `platform/web/layout/MobileMenu.tsx`, `platform/web/layout/Header.tsx`
(deleted entirely once WP1–WP3 have moved everything out of it),
`platform/web/messaging/BugReportModal.tsx` (deleted with its only consumer),
`platform/web/layout/ConnectionStatusPill.tsx` (its mount removed only — the
file is kept), `platform/web/layout/navItems.ts` (the shared list).

Change: `menuItems` (`MobileMenu.tsx:53-60`) ← `navItems.ts`; the mobile
currency block (`MobileMenu.tsx:99-101`) is deleted (the submenu has it);
`BugReportButton` + `BugReportModal` deleted; `ConnectionStatusPill` unmounted,
file kept.

Depends on WP1 + WP3.

### WP5 — pinned routes, server

Files: `platform/server/routes/routeFile.ts`,
`sdk/commerce/storefront/routeIntent.ts`,
`platform/server/routes/routeTable.ts`.

Change: §7.1–7.3 (the field, the validator copy, the intent allowlist + content,
the `apply` no-write check).

**Independent** of WP1–WP4; cannot break the chrome and vice versa. This is the
package that makes `nav` exist on the wire.

### WP6 — pinned routes, read model + authoring

Files: `platform/web/routes-authoring/routeAuthoring.ts`,
`ui/settings/route-authoring-views.tsx`,
`platform/web/routes-authoring/routeAuthoringPage.tsx`,
`platform/web/routes-authoring/routeTableQuery.ts` (types only).

Change: §7.4–7.6.

Depends on WP5 (the type). Independent of the chrome packages.

### WP7 — the AppBar renders pins

Files: `platform/web/layout/AppBar.tsx`, `platform/web/layout/navItems.ts`.

Change: §7.7 — `useRouteTable()`, defensive shape check, ordered pinned items
after the built-in list.

Depends on WP1 + WP5 + WP6. This is the last chrome package; until it lands the
hardcoded "Featured" entry can stay (mark it `TODO(WP7)` in `navItems.ts` so the
removal is not forgotten).

### WP8 — tests, e2e, quality gate

Files: §10 below.

Depends on everything.

**Independence summary.** WP5 → WP6 → WP7 is one chain. WP1 → {WP2, WP3} → WP4
is another. The two chains meet only in WP7, so two implementers can work
without touching the same file except at `AppBar.tsx` (WP7) — sequence that one
last.

---

## 10. Tests to update

### Pinned to the current chrome (must change)

| File                                                                            | What it pins                                                                                                | Change                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform/web/layout/appChrome.test.tsx`                                        | the two-bar mutual exclusion (82-95, 97-108), the bound-page override (119-166), `hidesAppHeader` (171-180) | Delete the `hidesAppHeader` block and the bound-page-override cases; retarget 82-95 to assert **one** bar (`<header`/`data-slot="app-bar"`) on **every** route, including `/`. Keep the `usesArenaChrome` block (183-196) unchanged. Drop the `BrowseNav` import (line 28) and the `Header` stub (lines 23-25) in favour of the AppBar stub. |
| `ui/browse/browse-nav.test.tsx`                                                 | `BrowseNav`'s wordmark/Featured/slots (19-131) and every `SearchField` case (136-280)                       | The `BrowseNav` block (19-131) moves to `ui/appbar/app-bar-view.test.tsx`: the Featured-link cases (62-66, 106-118, 119-131) become `navItems`-slot cases. The whole `SearchField` block (136-280) is untouched — the component does not change.                                                                                             |
| `e2e/tests/navigation.spec.ts:5-9`                                              | `await expect(page.locator('header')).toBeVisible()` on `/`                                                 | Assert the AppBar's testid instead; `header` was only true because `/` happened to render Bar A's `<header>` on non-browse routes.                                                                                                                                                                                                           |
| `e2e/tests/app-chrome-page.spec.ts:116,128`                                     | `login-button` visible / count 0                                                                            | The sign-in affordance is now a dropdown item; select `account-menu-trigger` then the item. Note the file's own comment (`app-chrome-page.spec.ts:24-26`) already records that `/` hides the legacy header.                                                                                                                                  |
| `e2e/tests/auth.spec.ts:97,110`                                                 | `login-button` on `/`                                                                                       | Same retarget.                                                                                                                                                                                                                                                                                                                               |
| `e2e/fixtures/index.ts:68,83,98,113`                                            | `dashboard-button`, `login-button`                                                                          | The fixtures' readiness gates must open the account menu; every spec that uses those fixtures depends on this, so land it with WP3.                                                                                                                                                                                                          |
| `e2e/tests/og-meta-tags.spec.ts:522`                                            | `home-link`                                                                                                 | Keep `data-testid="home-link"` on the wordmark (§3) — no change if the testid survives.                                                                                                                                                                                                                                                      |
| `e2e/tests/cart.spec.ts`                                                        | the cart entry                                                                                              | The cart button is no longer in the toolbar; open the account menu first.                                                                                                                                                                                                                                                                    |
| `e2e/tests/theme-app-shell.spec.ts`, `e2e/tests/routes-pages-authoring.spec.ts` | the shell/authoring surface                                                                                 | Audit for header/nav selectors; the authoring spec gains the nav fields (WP6).                                                                                                                                                                                                                                                               |

No `Header` or `MobileMenu` unit test exists (verified: `find` over the tree for
`*Header*.test.*`/`*MobileMenu*.test.*` returns nothing), so there is nothing to
delete there; add `platform/web/layout/AppBar.test.tsx` and
`platform/web/layout/AccountMenu.test.tsx` in WP2/WP3.

### Pinned to the routing table (must change with WP5/WP6)

| File                                                   | Change                                                                                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform/server/routes/routeFile.test.ts`             | Add: a binding with `nav` validates and the validated binding **carries** it (the 7.1 drop is the bug); a bad `label`/`order` names `/nav/label`/`/nav/order`; `nav` on a lease is refused; the round-trip test at ~245 still passes. |
| `sdk/commerce/storefront/routeIntent.test.ts:61-62`    | The closed-allowlist test ("unknown fields … refused") must show `nav` is **accepted** and a different unknown key still refused. Add a `routeIntentContent` test asserting `nav` is emitted.                                         |
| `platform/server/routes/routeTable.test.ts:113-119`    | "an intent that is already satisfied writes nothing" keeps its no-nav fixture; add a new test: same target, **different nav** → `changed: true` and the file carries the new nav.                                                     |
| `platform/server/routes/pagesHttp.test.ts:551-570`     | `GET /api/routes` must include `nav` in the returned bindings.                                                                                                                                                                        |
| `platform/web/routes-authoring/routeAuthoring.test.ts` | `describeBinding` copies nav; `validateDraft` errors name the nav fields; `draftFromRow`/`EMPTY_DRAFT` carry them.                                                                                                                    |
| `ui/settings/route-authoring-views.test.tsx`           | the form renders the nav section; the list shows the pinned line.                                                                                                                                                                     |

### The Feature Quality Gate

`AGENTS.md` (**Feature Quality Gate**) requires every feature PR to ship a
targeted Playwright spec with video evidence, unless it is docs-only or an
infrastructure change that does not alter user-facing behaviour. This work is
neither:

- **This document's PR** is docs-only → exempt (`git diff --check` +
  `bun run format:check`, per _Safe Checks_).
- **Every implementation package** changes user-facing chrome → not exempt. The
  gate spec should be one new `e2e/tests/app-bar.spec.ts` proving: (a) one bar on
  `/` and on `/products`; (b) the search navigates to `/?q=`; (c) the account
  menu's signed-out and signed-in arms; (d) a pinned `/featured` link appears
  after an authoring write and is ordered by `order`. It must follow the
  repository's **Test Isolation** rules (`AGENTS.md`): no external services, the
  mocks in `e2e/utils/` and `e2e/helpers/`.

### Checks at the end of each package

Per the worktree rules: `bun run format:check` once, plus `bun test <changed
test files>` — no e2e run, no full suite.

---

## 11. Gaps and decisions recorded

1. **One field or two on the home idle screen.** §4 keeps the hero field as page
   content and the AppBar field always mounted, so `/` idle renders both against
   the same `q`. Hiding the AppBar field on `/` idle reintroduces a per-route
   branch in the bar. **Recommendation: keep both**; the hero field is the idle
   affordance, the bar field is the persistent one. Owner to confirm.
2. **Transparent-over-hero header is dropped.** `Header.tsx:280-345` fades the
   bar to a scroll-dependent black. The widget bar is opaque
   (`bg-background`/`bg-surface-raised`). If the owner wants the fade back it is
   a `variant` on the AppBar and a follow-up; it is **not** in this
   consolidation.
3. **`signedInWith` needs a new auth read.** §6 states the `signerType` slice.
   Without it the account menu shows a bare npub; with it the menu matches the
   `AccountPane` panel the widget-book documents
   (`account-pane.tsx:29,127`).
4. **`ConnectionStatusPill` is unmounted, not deleted** — the owner asked for it
   to be revisited. `platform/web/layout/ConnectionStatusPill.tsx` and its
   `ndkStore` health read stay.
5. **`AccountPane` is not reused** — re-cut as menu items (§6); it stays a
   widget-book-only component.
6. **Rollback of `nav`** loses pins on a downgrade write (§7.9); re-authoring is
   the recovery.
7. **Mobile passes are deferred** (§8) — approach stated, detailed breakpoint
   work is a follow-up.
