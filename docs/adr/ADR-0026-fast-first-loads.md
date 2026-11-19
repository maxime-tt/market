# ADR-0026: Fast First Loads

## Status

Accepted — Plebeian Reckless test instance

## Date

2026-11-19

## Related

- ADR-0002: NDK to applesauce migration
- `platform/web/ndk/ndkStore.ts` — `fetchEventsWithTimeout` early settle
- `platform/web/ndkReadContext.ts` — bounded event reads
- `platform/web/app/useServiceWorker.ts`, `public/sw.js`
- `styles/fonts.css`, `platform/server/http/static.ts` — font routes

## Context

Collection pages stayed on "Loading" forever, and most pages took 3.5–5 s to show content on a fast connection. We traced four causes:

1. Some reads (`fetchEventsByFilter`, `fetchEventById`, `fetchEventByNaddr`) called NDK's `fetchEvents` with no timeout. They wait for every relay to send EOSE, and a dead relay (a 403 or 503 at handshake) or a silent one never does.
2. Even bounded reads waited the full timeout whenever a few relays stayed silent. NDK only settles early in some cases.
3. On a first visit the service worker's `clients.claim()` fired `controllerchange`, and the app reloaded itself, so it booted twice.
4. Bun's CSS bundler inlined every bundled font as base64, which made the main stylesheet 1.39 MB and blocked the first paint.

## Decision

- Every app read is bounded. The NDK read helpers go through `fetchEventsWithTimeout` (6 s cap).
- A bounded read settles early. Once the app relay, or at least half the relays, have sent EOSE, the rest get a 400 ms grace and the read resolves. Instance data lives on the app relay, so it is complete by then. Slower public relays can still add events within the grace period.
- The service worker reloads the page only when an older worker was already in control, which means a real update. The worker handles only its offline fallbacks; everything else goes straight to the network and the HTTP cache.
- Fonts are served as files from our own origin: `/fonts.css` plus `/fonts/<face>.woff2` from `platform/web/app/assets/fonts`, with a 7-day cache. `index.html` adds the stylesheet link at runtime because Bun's bundler can't resolve absolute font URLs. Nothing comes from a third-party host.

## Consequences

- Collection pages load (about 3 s), and home, product, auction and lot pages show content roughly twice as fast on a fast connection.
- The main stylesheet drops from 1.39 MB to 520 KB. A browser downloads only the font faces a page uses.
- A public relay that is slower than the app relay plus 400 ms can miss a one-shot read. Live subscriptions are unaffected.
- Follow-up: the JS bundle is still one 7 MB chunk, because Bun.serve's runtime HTML bundling inlines dynamic imports. Code splitting means serving a prebuilt `Bun.build({ splitting: true })` output and changing the deploy. That gets its own ADR.
