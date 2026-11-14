# What the two search-stream investigators actually concluded

Consolidated from the two independent subagent transcripts written 2026-11-10, plus the report one of
them left on disk. Read-only review; nothing was re-run.

- Lane A — `deleg_162f860b` (20:29:51 → 21:00:55 UTC; 1,862 s; `status=completed`)
- Lane B — `deleg_49450ee7` (20:30:05 → 22:30:23 UTC; 7,217 s; `status=completed`)

**Evidence caveat, stated up front.** These logs are append-only transcripts whose tool results were
truncated *at write time* — `…(+N chars)`, 54 occurrences in Lane A's log, and Lane B's final
summary is itself cut mid-JSON at 637 characters per line. So the conclusions below are the ones the
investigators stated, but several of the numbers they cite sit in the omitted tails. Where that
matters it is called out under **Unbacked claims** at the end. Neither lane was cut off mid-work;
both terminated normally and produced a final answer.

## What was asked

Both were dispatched on the same defect — the browse-search NDJSON read ending before the service
does, with no `outcome` frame — with the same starting document, and were explicitly told not to read
each other's work. The lenses differed:

- **Lane A:** browser and network instrumentation only. Establish whether the response body's reader
  reached `done: true` or its promise rejected, and if it rejected, why. Where it disagreed with the
  finding doc, show evidence.
- **Lane B:** adversarial reproduction and falsification — reproduce the cut, then try to break the
  leading explanations by varying one axis at a time.

The background brief held that the defect was intermittent, that 8/8 control runs completed at
~8.3 s, and that the suspected boundary was ~12.0 s with a clean FIN.

## Lane A (browser/network) — deleg_162f860b

### What it did

Instrumented `window.fetch` on `https://market-e2e.playday.it/?q=bitcoin`, intercepting only
`/api/browse-search/search`, calling `getReader()` and recording the terminator; instrumented
`AbortController.prototype.abort` globally plus an abort listener on every `init.signal`; read the
served client bundle for its timeout constants; then ran raw-socket probes against
`127.0.0.1:7711` to get a population of failures to compare against the browser runs. It also read
the Caddy vhost config. It wrote `INVESTIGATION-browser-network-lens.md` (10,422 bytes,
`/home/admin_maxime/work/wt-union-1420/`).

### What it actually observed

Browser side, in the transcript's own output:

- `{'q':'bitcoin','limit':1,'indexOnly':true}` → `done: true`, frames `{search:1}`.
- `{'q':'bitcoin','limit':100}` → `done: true`, frames `{search:1, relay:16, event:500, dropped:138,
  outcome:1}` (transcript line 221 final summary; line 130 same shape).
- One full browser read: `elapsed 13733 ms, bytes 1259591`, kinds
  `{search:1, relay:16, event:500, dropped:84, outcome:1}` (line 104).
- `window.__o.abortCalls = []` — zero abort invocations across the page lifetime; final hook run
  returned `{"main": [], "abortCalls": []}` (line 214).
- Only `unhandledrejection`: a relay `NOTICE` about "insufficient free disk: ~460 MB available,
  512 MB required" (relay-side storage reserve, unrelated to the stream) — corroborated by `df`"
  showing 439 MiB available (line 188).
- Settled UI read `"6 relays responded with 370 products · 2 PENDING"` — the *settled* branch, not
  "Search incomplete" (lines 216–218).
- Deliberately aborting a live read at 1,000 ms and 3,000 ms produced
  `{name:"AbortError", message:"BodyStreamBuffer was aborted"}` — the fingerprint a client-side cut
  would leave, never seen in a natural run (line 118).
- Served bundle constants: `hRn=12000, mRn=3000, gRn=hRn+mRn` → 15,000 ms client timeout; the client
  would throw `RabbitHole: timed out…mid-stream` or `stream ended without an outcome frame`. Neither
  string ever appeared (lines 84, 88, 102).

Shell side, where the defect *did* reproduce (line 142, 146, 150, 172, 176, 210):

- Truncated EOFs: `9901, 10247, 10338, 10476, 11167, 12001, 12001, 12007, 12016 ms` — with a
  `FIN (clean EOF from peer)`, never an RST, and `relay=15`, `event=500`, no `outcome`.
- Clean EOFs: 43 runs, `relay=16`, `outcome=1`, terminated with a proper zero-length chunk; four of
  them (`10511, 11326, 11382, 11578`) closed *inside* the truncated range.
- The cut body ended on a complete frame plus the chunk's trailing CRLF, then FIN —
  `…{"type":"relay","relay":"wss://nostr.bitcoiner.social","state":"answered"}\n` + `\r\n`
  (line 172), i.e. between frames, not mid-frame.
- Caddy vhost is a bare `reverse_proxy 127.0.0.1:3460` with no `flush_interval`,
  `response_header_timeout` or timeouts (lines 196–200).

### What it concluded

Stated with confidence levels in its report:

- **High confidence:** in the browser the read reaches `done: true`, never rejects, no abort fires.
  *If* the browser ever saw a missing outcome, it would be a server-side close.
- **High confidence:** the defect reproduces identically with no browser in the path — raw socket to
  `127.0.0.1:7711`, 15 relay frames, 500 events, no outcome, clean FIN between frames.
- **Medium confidence:** the trigger is a race around the slowest relay's settlement, *not* a
  deadline. Only clean discriminator it found: `relay` frame count 15 (no outcome) vs 16 (outcome).
  In the traced truncated run the relays with no terminal state were `nostr-pub.wellorder.net` and
  `nostr-01.yakihonne.com`; in clean runs those report `failed / dial timeout after 8000ms` and
  `answered` respectively.
- **Explicit "could not determine":** whether the close is inside `rabbithole-api` or the transport;
  why it is intermittent (9 hits in the first ~60 runs, 0 in the next ~60); whether Caddy can ever
  cut this response (no evidence, not attempted); and why the service reports
  `elapsedMs 13443` with `deadlineHit:false` when `total_deadline_ms` is 12,000.
- **Disagreed with the finding doc** that the count cap was a live hypothesis: the 500th event lands
  at ~600 ms and the stream stays open 7–13 s afterwards.

## Lane B (adversarial/falsification) — deleg_49450ee7

### What it did

Wrote a de-chunking frame tap and reproduced from a raw Python socket with no browser and no proxy;
then swept axes one at a time: direct vs proxy, connection header (keep-alive vs `Connection: close`),
client receive timeout (60 s vs 100 ms), HTTP/1.0 close-delimited vs HTTP/1.1 chunked, query size,
`maxEvents`, slow-reader backpressure, byte thresholds, and socket-level observation via `ss` of both
the proxy→service upstream socket and the server-side socket state. It also read
`src/fetch/stream.ts`, `streaming.ts`, `handler.ts`, `relay-client.ts`, `server.ts` and the service
config.

### What it actually observed

- Reproduced through the proxy: `end=clean_eof @ 12019 ms`, no outcome, last frame at 1484 ms
  (line 88). Rate: proxy 3/17 cut; direct 15/15 clean in the first batch (lines 90, 94).
- Cuts on the **direct** path too: `end=12007/12008 ms` (line 180), so the proxy is not required.
- Head-to-head direct vs proxy: **DIRECT 1/14 cut, PROXY 0/14**; every proxy-served frame
  byte-identical in kind and count (lines 334–336).
- Socket view of a cut: the proxy's upstream socket to 7711 still `ESTAB` with byte counters frozen
  at `rd=1,269,375` while the client already had a clean EOF (line 154); on the direct path the
  service is in **FIN-WAIT-2** (server sent FIN first) and `term=False` (line 250).
- Cut runs have **no `0\r\n\r\n` terminator** (`term=False`) — the chunked message is abandoned, not
  completed; the client-side read therefore ends in `IncompleteRead` (lines 348, 368).
- Time shape: every cut has `lastrx ≈ 1.1–1.5 s`, then a silent gap of ~9.6–10.9 s, then FIN at
  ~11–12 s: e.g. `10452/lastrx 1349/gap 9103`, `12000/1164/10836`, `11356/1267/10089`,
  `12003/1190/10813`, `11995/1168/10827` (line 286).
- Later, with keep-alive, close times landed on a **12 s lattice**: `11991, 11995, 11996, 11997,
  12002, 12002, 19986, 19989, 19992, 20001, 20007, 23996…24012, 24466`; 16 of 20 within ±12 ms of a
  12 s multiple (line 338).
- Axes: `Connection: close` baseline 0/12 cuts; keep-alive 2/12; recv-timeout-60 s 3/12;
  **HTTP/1.0 close-delimited 0/12 vs HTTP/1.1 chunked 6/12** (lines 306, 330–332). Slow reader
  (0.02/0.05 s per chunk) did not reproduce it → not backpressure (line 230). `maxEv50` cut at a
  ~120 KB body and `maxEv200` 3/8, `maxEv500` 2/8 → not a byte threshold (lines 220, 218).
- `maxEvents` falsified as the cause: a cut run was 32 events short of the cap, while 16 full bitcoin
  runs reached exactly 500 events and still emitted an outcome (line 430). `event=500` runs normally
  end at 1.37–3.65 s.
- Service did not crash or restart: uptime 3 h 09 m, 12 fds, no journal errors (lines 190–192). The
  market app log does show `TypeError: The socket connection was closed unexpectedly … ECONNRESET`
  against `127.0.0.1:7711` (lines 406–412).

### What it concluded

From its narration and the surviving fragment of its final JSON:

- Defect is **intermittent**, ~10–25% of uncapped `bitcoin` runs, and reproduces on the **direct
  service path** — no app, no proxy, no browser. The finding doc's 13.02 s-with-outcome was "the
  lucky draw", a single atypical sample.
- The close is a **periodic 12 s timer / lattice** (12.0, 20.0, 24.0 s), not a size or event limit;
  the 20.0 s cluster is read as the 8 s relay dial timeout plus one 12 s tick.
- **Chunked transfer encoding is the discriminator** — HTTP/1.0 close-delimited never cut.
- **Proxy exonerated**; direct and proxy are 1:1.
- Confidence "high on WHERE": the service emits the cut, the browser is ruled out, the 500 cap is
  ruled out. It did **not** name the code path; it notes `streamFetch` has no overall cap and that
  `total_deadline_ms: 12000` is referenced at `src/fetch/stream.ts:252` and `streaming.ts:77`.

## Agreement

Both lanes agree, on their own measurements, that:

1. **The defect is intermittent**, not deterministic (~10–25% / 9 of ~52 direct runs).
2. **It reproduces against the service directly**, with no browser and no app proxy in the path.
3. **The browser/client is not the cutter.** Lane A: `done:true`, zero aborts, and a deliberately
   induced abort has a *different* fingerprint (`AbortError: BodyStreamBuffer was aborted`) that never
   occurs naturally. Lane B: direct-path cuts with the same signature; head-to-head parity.
4. **The proxy is not the cutter** — Lane A by code read plus fast-path runs, Lane B by head-to-head
   1/14 vs 0/14.
5. **There is no `outcome` frame** on a cut run, and the transport ends with a **FIN, not an RST**.
6. **The 500-event cap does not govern the close** (reached at ~0.6 s; stream continues 7–13 s).
7. **The service does not crash or restart** during a cut (Lane B's uptime/fd/journal check; Lane A's
   transport observation).
8. **The `elapsedMs > total_deadline_ms` with `deadlineHit:false` anomaly is real and unexplained**
   (clean runs at 12,786–13,735 ms with `deadlineHit:false`).

## Contradiction

One central contradiction, plus two consequential ones:

1. **The ~12 s boundary: timer or race?** Lane B: a periodic 12 s lattice, 16/20 within ±12 ms of a
   multiple of 12 s, chunked-encoding-dependent. Lane A: explicitly **not** a fixed wall-clock timer —
   its truncated closes span 9,901–12,016 ms and four clean runs close inside that range, so no fixed
   `T` separates the populations. Lane A's discriminator is relay-frame count 15 vs 16 (one relay
   never settled); Lane B treats the boundary as a service timer that fires mid-stall. Neither lane
   reconciled the other's data: Lane B's own early cuts (10,452 / 11,120 / 11,356 / 11,695 ms) are
   *not* 12 s multiples, which is the same scatter Lane A reports.
2. **Is the cut signature universal?** Lane A asserts `relay=15, event=500` on *every* truncated run
   ("all relay=15: True | all event=500: True"). Lane B observed cuts on `maxEv50` (~120 KB body) and
   a cut **32 events short of the cap**, so Lane A's invariant does not generalise.
3. **Was the chunked message terminated?** Lane A's report §3 says "FIN with the chunked message
   already terminated"; Lane B measured `term=False` (no `0\r\n\r\n`) and the client sees
   `IncompleteRead`. Lane A's *own* raw capture also recorded `"terminal": false` on a cut run
   (transcript line 172), so its report's wording contradicts its own data — the two lanes actually
   agree on the bytes and disagree only on how to describe them.

Internally, Lane B also says "the cut is simply the case that only got one 12 s tick before the
client's patience ran out" while its own socket probe shows **FIN-WAIT-2** — the server sent the FIN
first, and the client had a 40–60 s timeout. "Client's patience" is not supported by its own evidence.

## Root cause status

**Not established.** Neither lane names the code path that closes the body without writing `outcome`.

- Lane A localises it to the service (or the transport immediately below it), correlates it with one
  relay never reaching a terminal state, and explicitly lists the mechanism as undetermined.
- Lane B localises it further — service-side close, periodic ~12 s, only on chunked HTTP/1.1
  responses, independent of proxy, browser, event cap, body size and reader speed — but does not show
  the branch in `stream.ts` / `streaming.ts` that closes the controller without the outcome, and
  cannot explain its own non-lattice cut times.

The finding doc's "leading hypothesis" (a ~12 s bound closing the stream before the outcome is
written) survives Lane B's data and is undermined by Lane A's; the "two relays failing in sequence at
`per_relay_timeout_ms: 6000`" reconciliation in the doc is not supported by either lane.

## Smallest next step that would settle it

Change one number and re-measure: run the service with `total_deadline_ms` temporarily raised from
12,000 to, say, 20,000 (test instance, one config edit), and repeat Lane B's 20-run raw-socket sweep.

- If close times move to the new bound (and the 12 s lattice becomes a 20 s lattice), the boundary is
  the configured total deadline, and the defect is the deadline branch closing the stream without
  emitting `outcome` — a ~20-line read of `streaming.ts:77–110` then names the exact line.
- If close times stay at 12 s, the timer is elsewhere (Bun server idle/keep-alive), and Lane A's
  relay-settlement race is back in play; the follow-up is a log line in `finish()`/`controller.close()`
  recording which relays were still unsettled.

This is the one axis neither lane varied — both changed transport and load, neither changed the
deadline value that the lattice appears to track.

## Unbacked claims

- **Lane A, "9 of 61 runs":** its own tally file prints `truncated n = 9`, `full n = 43` — 52 runs,
  not 61. The headline denominator is not supported by the evidence under it.
- **Lane A, Resource Timing figures:** the report cites
  `{dur: 13180, ttfb: 4096?, transferSize: 1245850, encodedBodySize: 1245550}`. The transcript's only
  visible Resource Timing entry is `{dur: 416, ttfb: 411, transferSize: 3662, responseEnd_rel: 1412}`
  (line 42). The 1.245 MB figures and the literal `4096?` placeholder have no visible raw output;
  treat that paragraph as asserted, not shown. (The 1.26 MB body size *is* independently evidenced at
  line 104 as `bytes: 1259591`.)
- **Lane A, "full all relay=16 (assumed)":** labelled as an assumption in its own tally, then repeated
  as fact in the report ("Clean runs … `relay` = 16").
- **Lane A, "the app's read does not stop; it completes":** true of every browser run it captured, but
  it never captured a *failing* browser run. The claim that the reported 11,774 ms is a server close
  is an inference from shell-side truncation plus the absence of an abort — reasonable, but not a
  direct observation of the failing browser case. Its report does say this ("If the browser ever saw a
  missing outcome…"), so the overreach is in the summary line, not the body.
- **Lane B, "HTTP/1.0 0/12 vs HTTP/1.1 6/12":** the assertion is in the narration, but the result line
  that would contain axes B2/C1/C2 is truncated exactly at that point (`…(+1843 chars)`); only
  A1/A2/B1 are visible.
- **Lane B, "16 of 20 within ±12 ms":** the close-time list and per-value distances *are* visible
  (line 338), but the 20.0 s cluster's explanation ("8 s dial timeout plus one tick") is inference,
  and the list includes 24,466 ms (466 ms off the tick) and separately 19,486 ms, neither reconciled.
- **Lane B, final conclusion:** its final JSON is cut mid-string at 637 characters (lines 429–432),
  so the full conclusion — including the confidence section and the explicit falsification list — is
  **not recoverable from the transcript**. Everything attributed to Lane B above comes from its
  narration and the surviving ~1.9 KB of that JSON. The report is therefore a reconstruction, not a
  quotation, of its final answer.