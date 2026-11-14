# HANDOFF — making `/` a CMS-produced home page

Written 2026-11-10, after **two lanes failed this task by working in the wrong tree**:
one reported commit `f7a5b2d4c` which does not exist in the repository, the other
concluded *"the home route is not implemented"* — which is false. Both had
searched a tree that was not this one. **Start by proving the tree**:

```
pwd
git rev-parse --show-toplevel          # must be ~/work/wt-cms-home
ls platform/web/routes/index.tsx       # must exist
```

If those fail, stop — you are in the wrong repository.

## What already exists (verified 2026-11-10, on `d7s2/cms-home` @ `5d1c7ef26`)

| Piece | Where |
|---|---|
| The home route | `platform/web/routes/index.tsx` — `createFileRoute('/')`, component `BrowseIndex`, renders `BrowseIndexHost` |
| The CMS page resolver | `platform/web/storefront/storefrontQuery.ts` — `storefrontAddressPageQueryOptions(pubkey, dTag)` and `useStorefrontAddressPage`, reading **kind 30024** by `(author, d)` |
| The CMS page renderer | `platform/web/storefront/StorefrontAddressPage.tsx` (honest empty state when nothing is published) |
| The vanit y-route fall-through | `platform/web/routes/$vanityName.tsx` — a registered vanity, else the **app key's `d` namespace** |
| The blocks | `sdk/commerce/storefront/storefrontPage.ts` (closed union), `ui/storefront/StorefrontRenderer.tsx`, `ui/storefront/blocks/{Search,ProductRow,Categories}Block.tsx`, slots in `platform/web/storefront/StorefrontBlockSlots.tsx` |

## The change

In `platform/web/routes/index.tsx`:

1. Resolve the home page with `useStorefrontAddressPage(appPublicKey, 'home')` — the
   same app-key `d` namespace `$vanityName` already falls through to. Do not invent a
   second resolution path.
2. If a validated page exists, render it through the CMS renderer **inside the browse
   chrome**: keep `BrowseNav` (the browse surface owns the nav), and let the page's
   blocks supply the content (`Search` hero wired to `?q=`, `ProductRow`s, `Categories`).
3. If nothing is published, keep today's `BrowseIndexHost` — that is the honest
   fallback, not an empty screen; the owner's ruling is that browse wraps CMS pages,
   not that the home may go blank.
4. Do not touch `platform/web/browse/browseQuery.ts` or
   `platform/web/browse/BrowseIndexHost.tsx` (owned by another session).

## Acceptance

- Route renders a published page's blocks; falls back to the browse host when absent.
- The nav, the hero↔nav search handoff and the relay indicator keep working.
- `bun test --isolate ui platform/web sdk` (excluding `ws.test.ts` and
  `newProduct.test.ts`), `bunx tsc --noEmit` ≤ 193 sites, `prettier --check`,
  `check-ui-styles.sh`.
- **Commit and push** (owner rule 2026-11-10): `git push fork d7s2/cms-home` and
  `git push nostr d7s2/cms-home`, and paste the real output of `git rev-parse HEAD`
  in the final report.

## Still owed after this

The builder authoring pass (compose the home page in the Puck editor at
`/dashboard/account/profile-page`), and a deploy of `unite/1420-all` — the deploy
needs a restart of `market-e2e.service`, which the owner has not authorised while
the instance is his test surface.
