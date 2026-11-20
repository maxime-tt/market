# Web bundle

In production the server builds and serves a code-split bundle on boot (ADR-0027). There's nothing to add to a deploy.

On boot it logs which path it took:

- `📦 Serving the prebuilt bundle (dist/web)`: the build ran (about 2 s) and chunks are served from `/_app/`
- `📦 Bundling index.html at runtime`: the build failed, or `AR_PREBUILT=0` is set

To build by hand, for example to inspect chunk sizes:

```bash
bun run build:web
```

To load something heavy only when it's used, wrap it with `lazyRetry` from `@ui/utils/lazy-retry` and render it inside `<Suspense>`. See `platform/web/storefront/LazyStorefrontBuilder.tsx` for the pattern.
