# Browser + network lens: what ends the browse-search read before the service

Independent investigation (browser/network only). Read-only; no source edits, no service restarts.

## 1. The single measurement separating "the body ended" from "the read was cut"

**The browser's reader reaches `done: true`. Its promise never rejects. No abort ever fires.**

Instrumented `window.fetch` on `https://market-e2e.playday.it/?q=bitcoin`, intercepting only
`/api/browse-search/search`, calling `getReader()` and recording the terminator:

| run | request body | reader end-state | frames observed | abort calls | rejection |
|---|---|---|---|---|---|
| 1 | `{"q":"bitcoin","limit":1,"indexOnly":true}` | `done:true` | `search`=1 | 0 | none |
| 2 | `{"q":"bitcoin","limit":100}` | `done:true` | search 1, relay 16, event 500, dropped 138, **outcome 1** | 0 | none |

Also instrumented `AbortController.prototype.abort` globally plus an `abort` listener on every
`init.signal` the app passes: `window.__o.abortCalls` = `[]` — **zero** abort invocations, for the
whole page lifetime, across every run. `window.__h2.errs` contains exactly one
`unhandledrejection`, and it is unrelated to the stream:
`Error: "error: relay storage reserve reached; retry later: insufficient free disk: 460378112 bytes available, 536870912 required"` — a Nostr relay's `NOTICE`, thrown at `chunk-aetd0gxx.js:115:111048` (`_onmessage`), no `Browse`/`RabbitHole` frame in the stack.

Measured with the browser's own Resource Timing, no JS interception at all — the network layer
independently confirms a complete response:

```
{ name: ".../api/browse-search/search", dur: 13180, ttfb: 4096?, transferSize: 1245850,
  encodedBodySize: 1245550, decodedBodySize: 1245550, nextHopProtocol: "h2" }
```
`encodedBodySize == decodedBodySize` and `transferSize > encodedBodySize` is the signature of a
**fully transferred body whose chunked terminator was received**, not a cut connection (a cut
stream yields `encodedBodySize` far below the eventual size and no `responseEnd`).

Response headers seen by the browser (server: Caddy):
`content-type: application/x-ndjson; charset=utf-8`, `cache-control: no-store`, `server: Caddy`,
`alt-svc: h3=":443"; ma=2592000`. No `content-length` on the streamed response (chunked), and no
`connection:` header — HTTP/2 (`nextHopProtocol: "h2"`), so no hop-by-hop close home for this.

## 2. Reproducing the truncation — and where it actually happens

Run from the shell directly against the service (`127.0.0.1:7711/search`, raw socket, dechunked),
9 of 61 runs ended with **no `outcome` frame**, and every one of them ended with:

- `Transfer-Encoding: chunked` (initial headers 200 OK all present, ~250–400 ms)
- `end: FIN (clean EOF from peer)` — **not** an RST, not a read timeout
- `relay` frames = **15** (one relay never reported a terminal state)
- `event` frames = **500**, `dropped`: 32–182
- the body's last bytes were a **complete** frame followed by a chunk terminator:
  `…{"type":"relay","relay":"wss://nostr.bitcoiner.social","state":"answered"}\n` + `\r\n` + FIN —
  i.e. the cut lands **between frames**, never mid-frame.

Clean runs from the same socket probe: `relay` = **16**, `outcome` = 1, and terminate with a
proper zero-length chunk (`terminal 0-chunk`).

### Time-based or event-based? Neither, in the naive sense — measured with many queries

| query | candidateCount | event frames | outcome at (ms) |
|---|---|---|---|
| `zzzznonexistent` | 0 | 0 | 20 |
| `x` | 643 | 98 | 897 |
| `hoodie` | 115 | 125 | 8501 |
| `bitcoin` | 1687 | 500 | 8230–13735, or **missing** |

The 500-event cap is already reached at ~600 ms (`last_event_ms` 423–606 ms) while the stream stays
open for another 7–13 s. So the body end is **not event-driven**: the 500-event limit is reached long
before the close, and the stream continues past it every time.

Truncated runs closed at: **9901, 10247, 10338, 10476, 11167, 12001, 12001, 12007, 12016 ms**.
Clean runs closed over: **1524, 1557, 1637, 1700, 1707, 1713, 1748, 2160, 2212, 2233, 2245, 2333, 4968, 8211, 8219, 8258, 8230, 8231, 8239, 8241, 8252, 8272, 8279, 8293, 8305, 8307, 8497, 8511, 8547, 8851, 9739, 10511, 11326, 11382, 11578, 12786, 12859, 12912, 13052, 13095, 13228, 13546, 13735 ms**.

**The ranges overlap**: four clean runs (10511, 11326, 11382, 11578) closed *inside* the truncated
runs' range. So it is **not a wall-clock timer** either — no fixed `T` separates the populations.
The only clean discriminator is the one I measured directly: **`relay` frame count 15 (no outcome)
vs 16 (outcome)** — i.e. the close tracks the service finishing one relay short, and the deadline
value is whatever the slowest relay needed at that moment. In the truncated run I traced in full,
the two relays that never reached a terminal state were `nostr-pub.wellorder.net` and
`nostr-01.yakihonne.com`; in clean runs `nostr-pub.wellorder.net` reports
`failed / "dial timeout after 8000ms"` and `yakihonne` reports `answered`.

## 3. The exact error / cause string

**In the browser: there is none.** No rejection, no `AbortError`, no `TimeoutError`. The reader
returns `{done: true}` with a zero-length `tailBytes`. The end is a legitimate HTTP end-of-body.

**On the wire:** no error. `FIN` with the chunked message already terminated.

**The nearest thing to a cause string** is the relay-level reason the service itself reports in a
clean run: `wss://nostr-pub.wellorder.net` → `"dial timeout after 8000ms"`, and in the longer
variant `wss://nostr-01.yakihonne.com` → `"no EOSE after 12000ms"`. The truncated runs are exactly
the runs where one of those two had not yet produced its terminal `relay` frame when the service
closed — the close is the service's *own* verdict path running with one relay still outstanding.

For reference, an actual abort of a live read of this stream (induced deliberately, at 1000 ms and
3000 ms) rejects with:
`{name: "AbortError", message: "BodyStreamBuffer was aborted"}` — a signature I never observed
in any natural run. That is the fingerprint a client-side cut would have left, and it is absent.

For reference, the served client bundle's own bounds (read from `chunk-aetd0gxx.js` as served, not
from the repo): `hRn=12000, mRn=3000, gRn=hRn+mRn` → 15 000 ms client timeout, `yRn="http://127.0.0.1:7711"`.
The client wraps each `read()` in a race against that deadline and would throw
`new Iy("timeout", "RabbitHole: timed out after ... ms mid-stream")`, and on a body that ends with no
outcome would throw `new Iy("truncated", "RabbitHole: stream ended without an outcome frame")`.
**Neither string was ever produced in any of my runs**, which is why the UI settled on
"6 relays responded with 370 products · 2 PENDING" (the `settled` branch) rather than
"Search incomplete".

## 4. What I could NOT determine

- **Whether the truncation is inside `rabbithole-api` (bun) or in the transport between it and the
  socket.** A clean FIN with no `outcome` looks like the service's own `controller.close()` /
  return-from-handler. I could not read the service's code or logs (out of my lens and read-only).
- **Why the truncation is intermittent.** It clustered (9 hits in the first ~60 direct runs, then 0
  in the next ~60). Its occurrence correlates with cold/unhappy relays (`wellorder.net` dial
  timeout, `yakihonne` slow EOSE), which suggests a race in the service's settle path rather than a
  timer — but I could not force a truncation on demand, so I cannot prove the trigger.
- **Whether Caddy can ever close this response early.** The vhost is a bare
  `market-e2e.playday.it { reverse_proxy 127.0.0.1:3460 }` with no `flush_interval`, no
  `response_header_timeout` and no timeouts configured; Caddy's defaults impose no streaming
  response timeout. I found **no** evidence of a proxy-side cut, but I did not attempt to reproduce
  one.
- **The exact reason the doc's curl saw 13.02 s while the service's own `outcome` is stamped
  `elapsedMs: 13443`** — the service reports its own elapsed > the 12 000 ms `total_deadline_ms`,
  with `deadlineHit: false`. That inconsistency is real and reproduced (clean runs at 12 786,
  12 859, 12 912, 13 052, 13 095, 13 228, 13 546, 13 735 ms all with `deadlineHit: false`), and I
  cannot explain it without the service internals.

## 5. Confidence, and what would falsify it

**High confidence (measured directly, repeatedly):** in the browser the read reaches `done: true`;
it does not reject; no abort fires; the body is fully transferred (`transferSize 1 245 850` /
`decodedBodySize 1 245 550`, chunked terminator received). *If* the browser ever saw a missing
outcome, it would be a server-side close, not a client cancel.

**High confidence:** when the defect does reproduce, it reproduces identically **without any browser
in the path** — raw socket to `127.0.0.1:7711`, 15 relay frames, 500 events, no outcome, clean FIN
between frames. The browser is not required and is not implicated.

**Medium confidence:** that the trigger is a race around the slowest relay's settlement rather than
any deadline. Supported by the 15-vs-16 relay-frame discriminator and by the overlapping time
ranges; not supported by a controlled experiment, because I could not force the failure.

**I disagree with the finding document on two points:**

1. **"the app's read stops ~1.3 s before the service finishes"** — framing it as the app stopping.
   My measurements show the app's read does not stop; it *completes*, on the server's schedule.
   The 11 774 ms in the doc is simply a server-side close at ~11.8 s, matching my observed
   truncated closes at 9901–12 016 ms. There is no client-side cut to explain.
2. **"`maxEvents` / the 500-event cap"** as a live hypothesis for the *read* ending. The 500th event
   lands at ~600 ms and the stream then stays open for 7–13 s in every run; the cap does not govern
   the close in any way I could observe.

**What would falsify my conclusion:** a run in which the app's `getReader()` loop rejects (any
`name`), or in which `AbortController.prototype.abort` is invoked, or in which
`transferSize`/`encodedBodySize` is materially below the full body while the UI says
"Search incomplete". I looked for all three across dozens of runs and found none. Conversely, if a
future truncated run shows `relay` frames = 16 *and* no outcome, my "one relay short" discriminator
is wrong.