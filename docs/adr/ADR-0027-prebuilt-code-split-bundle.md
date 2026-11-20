# ADR-0027: Prebuilt, Code-Split Web Bundle

## Status

Accepted — Plebeian Reckless test instance

## Date

2026-11-20

## Related

- ADR-0026: Fast first loads
- `scripts/build-web.ts` — `bun run build:web`
- `platform/server/http/prebuilt.ts` — serving `dist/web`
- `ui/utils/lazy-retry.ts` — lazy loading that survives a deploy
- `docs/ops/web-bundle.md`

## Context

Production runs `bun platform/web/app/entry.tsx`, and Bun.serve bundles `index.html` at runtime. That bundler inlines dynamic imports, so the whole app ships as one 7 MB chunk (2 MB compressed) that every page downloads and parses before it can render. The map (maplibre, about 1 MB), the Puck page editor (about 500 KB), the QR scanner (about 135 KB) and the intro animation (gsap, 72 KB) are only used on a few screens.

## Decision

- `scripts/build-web.ts` (`bun run build:web`) builds the same `index.html` with `Bun.build({ splitting: true, minify: true })` into `dist/web`: `index.html` plus hashed files under `_app/`.
- The production server runs that build on boot, in a child process (about 2 s, alongside settings discovery), so no deploy script has to change. It rebuilds on every boot, so a folder reused across versions never serves stale chunks.
- It then serves `dist/web`: the shell as a plain Response, and `/_app/<file>` with `Cache-Control: public, max-age=31536000, immutable`. If the build fails, or `AR_PREBUILT=0` is set, it keeps runtime bundling, so the site still comes up exactly as before.
- These load on first use through `lazyRetry` (React.lazy): the page editor (`LazyStorefrontBuilder`), the pickup map dialog, the QR scanner (`@ui/primitives/lazy-qr-scanner`) and the home intro.
- Each release serves only its own chunks. If a tab opened before a deploy asks for a chunk that's gone, `lazyRetry` reloads the page once to pick up the new release.
- The build defines `process.env` as `{}`, plus `NODE_ENV`, because browser code reads optional env vars before the polyfills run. No `BUN_PUBLIC_*` values are used; client config comes from `/api/config`.

## Consequences

- The entry chunk drops from 5.8 MB to 3.9 MB ; with its preloads the JS a page needs up front goes from 7 MB to 4.1 MB, or 2 MB to 1.2 MB compressed. The map, editor, rich-text stack, Node crypto polyfills and QR scanner each load only when used.
- Boot takes about 2 s longer for the build, which runs in parallel with settings discovery. The build process peaks at about 600 MB and exits afterwards.
- This applies to every production deploy, including staging.
- Chunks are cached for a year and change name on every build, so repeat visits download only what changed.
- Follow-up: the Cashu wallet stack (`@cashu/coco-*`, `@getalby/sdk`, dexie, about 600 KB) and route-level splitting are the next candidates.
