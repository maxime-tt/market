# The browse search read ends ~1.3 s before the service does

Reported from the live e2e instance on 2026-11-10, immediately after the index-first + buckets deploy.
**Status: OPEN. Root cause not yet established.** What follows separates what is *measured* from what
is *hypothesis*, because the distinction is the whole value of this document.

## Symptom

On `https://market-e2e.playday.it/?q=bitcoin` (a large result set — `candidateCount` 1,687):

- The indicator renders **"Search incomplete — 367 products received before the read stopped"** with
  `2 PENDING`. That wording is produced by the `incomplete` branch, which is only reachable when the
  stream ends **without** an `outcome` frame.
- The app's own stream (captured in-browser, reading the response body incrementally) **ended at
  11,774 ms** with **654 frames** and **no `outcome` frame**. Frame kinds: `search` 1, `relay` 15,
  `event` 500, `dropped` 138.
- The grid, however, is complete and correct-looking (368 cards), and the bucket line rendered with
  the right numbers. So the *frame* path works; it is the *stream completion* that is lost.

## THE DEFECT IS INTERMITTENT, AND IT TRACKS THE FAN-OUT'S SPEED

This is the most important thing learned since the first draft, and it changes the shape of the
question. The same query, same code, run repeatedly:

| path | runs | wall | outcome frame | ended with |
|---|---|---|---|---|
| direct service | 4 | **8.26–8.29 s** | **YES ×4** | clean |
| through the app proxy | 4 | **8.29–8.37 s** | **YES ×4** | clean |
| direct service | earlier | 11.58 · 12.73 · 13.02 s | YES | clean |
| the app in a browser | the report | **11.77 s** | **NO — cut** | clean FIN |
| adversary's runs | — | **12001 / 12007 / 12001 ms** | **NO — cut** | clean FIN |

**It is not deterministic.** Eight consecutive runs just now — four direct, four through the proxy —
all completed in ~8.3 s with an outcome. The cut appears on runs that drag on, and the measured cut
points cluster at **~12.0 s ending with a clean FIN, not an RST** — a boundary, not a breakage.

**Leading hypothesis, NOT confirmed:** when the fan-out is slow enough to reach a ~12 s bound, the
stream is closed before the `outcome` frame is written, and the client then correctly reports an
incomplete read. The client is right; the missing verdict is the defect.

**What does not yet fit and must be explained before this is accepted:** the service's config sets
`total_deadline_ms: 12000`, yet the runs at 12.73 s and 13.02 s **did** emit an outcome with
`deadlineHit: false`. So either that deadline is not the ~12 s boundary measured, or a second bound
applies. **The code path that closes the stream without writing the outcome has not been shown** —
until it is, this is a hypothesis. The reconciliation to test: two relays failing in sequence at
`per_relay_timeout_ms: 6000` would reach ~12 s with the total deadline never firing.

## Measured — the service terminates correctly on the fast path

The identical request made directly, with no app in the path:

```
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"q":"bitcoin","limit":100}' http://127.0.0.1:7711/search
```

- **wall time 13.02 s**
- frames: `search` 1, `relay` 16, `event` 500, `dropped` 138, **`outcome` 1**
- the outcome frame reads: `status=partial`, `answered=6`, `failed=2`, `deadlineHit=false`,
  `eventsDelivered=500`

So the service **does** terminate the stream correctly and does emit its verdict. It takes 13.0 s,
and the browser read ended at 11.77 s — the app's read stops **~1.3 s before the service finishes**.

**The service's own bound is `total_deadline_ms: 12000`** (`~/work/rabbithole/config/rabbithole.config.json`
→ `fetch`). The 13.0 s wall time observed here **exceeds the configured deadline**, which is itself
worth explaining — the deadline should bound the fan-out. That is a second, separate question this
investigation should settle rather than assume.

## Ruled out

- **Not the client's deadline.** `RABBITHOLE_DEFAULT_TIMEOUT_MS` is derived as
  `RABBITHOLE_SERVICE_TOTAL_DEADLINE_MS (12_000) + RABBITHOLE_TIMEOUT_HEADROOM_MS (3_000) = 15_000`.
  The read ended at 11.77 s, which is **below** 15 s, so the client's own abort did not fire — unless
  the derivation is not what the running bundle contains. Verify that first, because it is cheap.
- **Not a service crash or a missing verdict.** The curl run proves otherwise.
- **Not the buckets or the frame mapping.** Those arrive at 389 ms and render correctly; they are
  upstream of the cut.

## Hypotheses, in the order I would test them

1. **~~The app's proxy for `/api/browse-search/search`.~~ RULED OUT.** Read at
   `platform/server/http/browseSearch.ts:93-126`: `proxyBrowseSearchRequest` awaits
   `fetch(target, { method, headers, body: await request.arrayBuffer() })` with **no `signal`, no
   `AbortSignal.timeout`, no `setTimeout`, no idle bound and no buffering**. Confirmed from outside
   as well — four runs through the public proxy endpoint all completed in 8.29–8.37 s with an
   outcome. (Kept for the record rather than deleted: it was the leading hypothesis and it was
   wrong.)
2. **React Query re-keying or cancellation mid-stream.** `browseQuery.ts` builds the query key from
   `{query, limit, provider}` and publishes progress under `JSON.stringify(queryKey)`. If anything
   changes the key while the stream is running — a facet probe landing, a state update, a re-render
   with a new identity — React Query cancels the in-flight request, which would look exactly like
   this: a read that stops mid-stream with no verdict. **Test:** instrument `context.signal`'s abort
   listener and log who aborts and when, with a timestamp against the frame arrivals.
3. **`maxEvents` / the 500-event cap.** `eventsDelivered=500` is suspiciously round and matches the
   `event` frame count in **both** captures. If the service stops *sending* after 500 events but keeps
   the connection open, an app-side read could time out waiting. **Test:** does the service's own curl
   run also end at 500 events (it does), and does it still emit `outcome` (it does) — so if this is
   the cause, the mechanism is the app's read losing patience, not the service truncating.
4. **An unhandled exception in the app's frame dispatch.** `dispatchLine` throws `RabbitHoleError`
   on a malformed NDJSON line. A thrown error inside the read loop would end the stream without an
   outcome frame. **Test:** capture `window.onerror` / `unhandledrejection` during a search and check
   the console for a thrown `stream-error`.

## How to tell the hypotheses apart — one measurement

Instrument the app's fetch of `/api/browse-search/search` to record, with timestamps:
the response's `status`, the `ReadableStream`'s last frame arrival, **whether the reader's `done`
became `true` or the promise rejected**, and the exact rejection reason. Then log every `abort()` on
the query's `AbortSignal` with a stack. One run of that separates (1) from (2) from (4): a `done: true`
with no outcome means the upstream ended the body; a rejection means something cut it; an abort
callback with a stack names (2) directly.

## Why this matters more than its size

The practical effect is currently small — the `search` frame already delivered the grid and the
buckets at 389 ms, and the cut only truncates the relay *enrichment*. But:

- The app now shows **"Search incomplete"** on a perfectly ordinary large search. That is a
  user-visible defect on every large result set, not an edge case.
- We spent a full cycle removing exactly this class of thing (an 8 s client deadline cutting a 12 s
  service read, which is what produced the original "0 products" line). **This is the same failure
  shape with a different culprit**, and it must not be left as a footnote.
- The verdict's own fields — which relays answered, which failed, `deadlineHit` — are only carried on
  the `outcome` frame. A read that never reaches it loses the relay report entirely, which is what
  `2 PENDING` is standing in for.

## Environment at the time of the report

- Service: `rabbithole-api.service` on port 7711, restarted onto the buckets commit `87deab8`.
- App: the e2e worktree `~/work/wt-e2e`, five files copied from `unite/1420-all` (app commit
  `32349aa5e`), `market-e2e.service` restarted, site at HTTP 200.
- Index: 8,573 listings; `maxTotalHits` 5000; `q=bitcoin` → `candidateCount` 1,687.
