# PLAN — relay loading: everything lazy-loads, nothing waits on a timeout

**Written** 2026-11-19 by the `PlanRelayLoading` session, read-only on code.
**Base:** `d7s2/app-side-merge` @ `c6c440d36` (the worktree moved under this session: it was
`4a136feda` when I started and `c6c440d36` — `merge(upstream): take canonical main 4b56e7461` — when I
finished; **every line number below was re-verified against `c6c440d36`**).
**Nothing in this plan is a code change.** No file outside this note was written.

The user asked for two things: (1) everything should live/lazy-load from relays, with no awaiting of
query timeouts, and (2) dependent reads should cascade into the UI as they resolve (the highest bid
appearing when it arrives) instead of gating the whole view, with loading distinguished from genuine
no-data.

**The measured answer is sharper than that.** Data already cascades — it arrives in tens of
milliseconds. What the user waits for is the read's **caught-up gate**: the read cannot leave
`loading`, and cannot say `settled` or `incomplete`, until *every* configured relay has settled or the
read's 8 s deadline fires. On this deployment two relays never settle for the lot filters and one holds
a 4–7 s reconnect ladder, so a page whose data arrived in 20–55 ms states its status at 4.2–8.0 s.
Section 3 is the evidence; section 5 is the inventory; section 6 is what has to change; section 7 is
the ordered plan.

Everything below was measured against the live system (relay `wss://relay.playday.it`, app at
`https://market-e2e.playday.it`, mint `https://mint.playday.it`) with `nak v0.20.6`, a raw WebSocket
client, and the app's **own** transport (`applesauce-relay` 6.2.1 — the same `RelayPool`/`group.req`
`createRelayStream` uses). Scripts are in `~/.hermes/profiles/maxime/cache/scratch/` (`measure.py`,
`req_timing.py`, `per_relay_req.py`, `gate2.ts`, `gate3.ts`, `frames.ts`). The one thing I could not
reproduce is called out in §8.

---

## 1. What today's changes already give — do not redo these

These landed in `349c45374` / `c6c440d36` and are the base this plan builds on:

- **A bid is read by `#e` as well as `#a`.** `arenaLotBidFilters` (`arenaAuctionRead.ts:287-296`) sends
  `#a` for relays that index it and `#e` for the create's 64-hex id; `arenaLotFollowUpFilters`
  (`arenaAuctionRead.ts:346-360`) returns the `#e` filter set, and `openFollowUps`
  (`arenaAuctionRead.ts:1680-1693`) subscribes it as a **second REQ** once the create decodes. This is
  the cascade the user asked for, and it works: measured, the follow-up REQ answers on the app relay in
  **30–53 ms** after the create, so the top bid appears ~50 ms after the lot does.
- **The bounded read no longer dies on one relay's CLOSED/ERROR.** `createRelayStream`
  (`applesauceIo.ts:378-462`) tracks each named relay's own EOSE/CLOSED/ERROR and emits its caught-up
  marker only when all of them have settled; a relay still delivering is never called dead
  (`arenaAuctionRead.ts:1727-1745`, `answer()` at `:1653-1661`), and the deadline settles a relay `'ok'`
  when it delivered anything (`arenaAuctionRead.ts:1782-1792`).
- **The lot detail reads one lot** (`arenaLotFilters`, `arenaAuctionRead.ts:320-337`) instead of the
  whole-arena firehose, and **the index no longer runs a duplicate read** — the index now uses the same
  `useArenaLotRead` with `d: null` (`routes/auctions.index.tsx:31-33`).
- **A retry exists** for a read that ended without an answer (`SellerAuctionLotHost.tsx:55-63`,
  `RETRYABLE`).

## 2. The relay rules this plan must respect (unchanged, not re-litigated)

- Single-letter tag values **> 100 chars** are not indexed; a `#a` bid filter (`1440:<64 hex>:<uuid>` =
  106 chars) is answered from the index with a confident **zero**. Measured: `#a` only → 0 events,
  EOSE 2 ms; `#e` only → 1 event, EOSE 3 ms (app relay).
- Multi-letter tag names are **not indexed** by the app relay's store (it scans, so they are slow but
  correct) and are **refused outright** by several public relays. Measured: the lot read's `#auction`
  filter is `CLOSED … error parsing #auction: unindexed tag filter` by `nostr.mom`, `nos.lol` and
  `relay.nostr.net`, and `NOTICE: ERROR: bad req: unindexed tag filter` by `relay.minibits.cash`.
- The relay is not to be touched.

---

## 3. Measured timings

### 3.1 The app relay alone is fast (single-filter REQ, `nak req`, first EVENT → EOSE)

`nak` includes process start, DNS/TLS and the WebSocket handshake, so these are upper bounds; §3.2 is
the app-equivalent number.

| filter on `wss://relay.playday.it` | events | first EVENT | EOSE |
| --- | --- | --- | --- |
| `1440 limit 500` | 65 | 585 ms | 624 ms |
| `1441 limit 500` | 85 | 741 ms | 830 ms |
| `1447 limit 60` | 60 | 554 ms | 609 ms |
| `1445 limit 200` | 200 | 592 ms | 707 ms |
| `1449 limit 200` | 200 | 505 ms | 640 ms |
| `1450 limit 200` | 72 | 699 ms | 742 ms |
| `1443 limit 200` | 108 | 560 ms | 630 ms |
| `1444 limit 200` | 84 | 560 ms | 611 ms |
| `1448 limit 10` | 10 | 490 ms | 515 ms |

### 3.2 The app's own REQs, one REQ with N filters, raw WebSocket (t0 after the handshake)

| case (filters as the app sends them) | filters | first EVENT | EOSE |
| --- | --- | --- | --- |
| whole arena (`arenaAuctionFilters`, 7 filters) | 7 | 2 ms (1440) … 101 ms (1450) | **106 ms** |
| lot detail (`arenaLotFilters`, 4 filters) | 4 | 2 ms (1440) | **27 ms** |
| lot follow-up `#e` (1 filter) | 1 | 4 ms | **5 ms** |
| bid `#a` only (106-char value) | 1 | — (0 events) | 2 ms |
| bid `#e` only | 1 | 2 ms | 3 ms |
| params `1448` | 1 | 2 ms | 4 ms |

### 3.3 Per relay: who answers, who refuses, who ignores (raw WebSocket)

| relay | whole-arena REQ | lot REQ |
| --- | --- | --- |
| `relay.playday.it` | EOSE 132 ms, the whole arena | EOSE 26 ms |
| `sendit.nosflare.com` | `NOTICE: Denied! This relay does not accept REQs.` | same |
| `nostr.mom` | EOSE 26 ms (1 create) | `CLOSED … unindexed tag filter` |
| `nos.lol` | EOSE 28 ms (1 create) | `CLOSED … unindexed tag filter` |
| `relay.nostr.net` | EOSE 167 ms (1 create, 6 commitments) | `CLOSED … unindexed tag filter` |
| `relay.damus.io` | **HTTP 503** at the handshake | **HTTP 503** |
| `relay.minibits.cash` | EOSE 24 ms (0 events) | `NOTICE … unindexed tag filter` — **never CLOSES** |

### 3.4 The gate, through the app's real pool (three rounds each)

`RelayGroup.req(filters, {resubscribe: false, reconnect: {count: 3, delay: 1000}})` — exactly what
`createRelayStream` issues (`applesauceIo.ts:210-212`), over the 7 relays `/api/config.publicRelays` +
`appRelay` give (`webRelayPolicy('query')`, `sdkNostrIo.ts:7`).

| case | app-relay first EVENT | app-relay EOSE | **gate (caught-up)** |
| --- | --- | --- | --- |
| whole arena | 42 / 42 / 55 ms | 186 / 150 / 172 ms | **6694 / 7103 / 6780 ms** — held by `relay.damus.io` |
| lot detail | 20 / 40 / 38 ms | 40 / 62 / 61 ms | **8009 / 8012 / 8010 ms** — held by `relay.minibits.cash` |
| lot detail + `#e` follow-up | 25–44 ms | base 48–79 ms, follow-up 30–53 ms | 6804 / 4185 / 6787 ms |
| params `1448` (all 7) | 21–36 ms | 22–38 ms | 2177 / 6922 / 2207 ms — held by `relay.damus.io` |

Per-relay timeline, whole-arena round 2: `playday EOSE@186`, `sendit ERROR@140`,
`nostr.mom EOSE@172`, `nos.lol EOSE@139`, `relay.nostr.net EOSE@236`, `minibits EOSE@130`,
`damus OPEN@1564, OPEN@3568, OPEN@6332, EOSE@7103`. The `OPEN`s are the 503 reconnect ladder:
3 retries × 1 s delay (`applesauceIo.ts:210-212`) plus connect attempts.

Per-relay timeline, lot round 1: `playday EOSE@40`, `sendit ERROR@97`, `nostr.mom CLOSED@123`,
`nos.lol CLOSED@144`, `relay.nostr.net CLOSED@159`, `damus … ERROR@6762`, **`minibits OPEN@7` and
nothing after** → the read's own 8 s deadline closes the gate.

### 3.5 The same reads with only the instance relay in the set (the payoff bound)

| case (app relay only) | first EVENT | gate |
| --- | --- | --- |
| whole arena | 17 / 18 / 100 ms | **137 / 154 / 404 ms** |
| lot detail | 10 / 11 / 13 ms | **29 / 30 / 289 ms** |
| params `1448` | 10 / 11 / 23 ms | **12 / 13 / 25 ms** |

And the event counts: whole arena **875 events on the app relay alone vs 884 with all 7** — the other
six relays contribute **9 events** and **4.2–7.0 s** of gate. The lot read delivers **61 events either
way** (the other relays contribute nothing at all).

### 3.6 HTTP (the two non-relay awaits)

| endpoint | TTFB | total |
| --- | --- | --- |
| `GET /api/config` (the boot gate) | 72 ms | 73 ms |
| `GET https://mint.playday.it/v1/keysets` | 77 ms | 78 ms |
| `GET https://mint.playday.it/v1/info` | 91 ms | 92 ms |

---

## 4. Fixed timeouts that can gate the UI

| constant | file:line | bound | reached? (measured) |
| --- | --- | --- | --- |
| `DEFAULT_DEADLINE_MS` | `arenaAuctionRead.ts:1538` (used `:1575`) | 8 000 ms | **yes** — the lot gate was 8 009/8 012/8 010 ms |
| the read's deadline timer | `arenaAuctionRead.ts:1782-1792` | 8 000 ms | yes, same |
| never-EOSE fallback | `applesauceIo.ts:384` | 8 000 ms | yes, per relay, for `minibits` on the lot filters |
| `SUBSCRIBE_RECONNECT` | `applesauceIo.ts:210-212` | 3 retries × 1 000 ms | **yes** — `damus` 503 → 4.2–7.1 s |
| per-relay read context | `sdkNostrIo.ts:24,54,63` | 8 000 ms | same bound, per relay |
| params read deadline | `arenaParamsRead.ts:474,491` | 8 000 ms (hard `AbortController`) | not reached now: the read is pinned to the app relay (12–38 ms) |
| `MINT_PARAMS_DEADLINE_MS` | `chainMint.ts:45` | 4 000 ms | not reached now (12–25 ms) |
| `CONFIG_WAIT_MS` | `chainMint.ts:56` | 2 000 ms | only on a cold boot before config lands (72 ms normally) |
| config fetch | `boot.ts:87-89` | 10 000 ms × 3 + 500/1 500 ms backoff | not reached (72 ms), but it is a **hard gate on the shell** |
| legacy NDK read timeouts | `readContext.ts:96`, `ndkStore.ts:373` | 8 000 ms | not on the arena path (products, test labels) |

Note the *shape* of the params read: `readArenaParams` (`arenaParamsRead.ts:489-507`) awaits the stream
to its caught-up marker, so it is an unconditional wait for a relay round trip — fast today only because
`arenaParamsRelays` (`arenaParamsRelays.ts:18-21`) pins it to the instance relay alone.

---

## 5. Inventory — what still awaits a relay round trip

| # | surface | read / entry point | what it awaits | deadline (file:line) | measured | what the user sees while waiting |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **every route** (SPA shell) | `bootApp` → `/api/config` | `bootStore.status !== 'ready'` → renders `Loading...` | `frontend.tsx:92-93`; `boot.ts:87-89` | config 72 ms | a blank "Loading..." screen, no chrome |
| 2 | **`/auctions` index** | `useArenaLotRead({d: null})` (`routes/auctions.index.tsx:31`) → whole-arena filters | first paint: nothing (`EMPTY_READ`, `ArenaAuctionLotHost.tsx:63-68`); cards at the first batch; **status only at the gate** | `arenaAuctionRead.ts:1538,1575,1782` | card 42–55 ms, status **6.7–7.1 s** | cards plus "Still reading from relays — what is listed below is what has arrived so far." for ~6.8 s |
| 3 | **lot detail** `/auctions/$auctionId` | `useArenaLotRead({d, seller})` → lot filters + `#e` follow-up | same: detail at the first batch, status at the gate | same | detail 20–40 ms, status **8.0 s** | the lot renders, but `ArenaLotView` (`arena-lot-view.tsx:360-371`) keeps the `loading` state — "N bids so far", a live-but-unsettled panel, and no retry, for 8 s |
| 4 | **bid read** | the `#e` follow-up REQ (`arenaAuctionRead.ts:346`, `:1680-1693`) | the top bid arrives when this REQ answers; it also **joins the gate** | same 8 000 ms | app relay 30–53 ms; opened on *all 7* relays, including the 4 that just CLOSED the base | the top bid appears ~50 ms after the create; the read still waits 8 s |
| 5 | **receipts / state half** (1443/1444/1449/1450) | the lot read's `#auction` filter (`arenaAuctionRead.ts:325-334`) | only the app relay can answer it (4 refuse, 1 ignores) | same 8 000 ms | app relay 26 ms for the whole lot REQ | receipts, verdicts and the committed end can only come from the app relay; the gate still waits on the refusers |
| 6 | **wallet `initialize`** | IDB + local seed (`sdk/commerce/payments/state/cashu.ts:319-413`) | **no relay** — `status: 'ready'` is set at `:401` before `seedMintsIfEmpty` (`:413`) | — | — | nothing; the wallet is ready without a relay |
| 7 | **wallet first mint** (`seedMintsIfEmpty`) | `resolveChainMint` (`chainMint.ts:134-140`) | config (≤2 000 ms) then the params read | `chainMint.ts:45,56`; `arenaParamsRead.ts:474,491` | params 12–25 ms (pinned relay) | a wallet with an empty mint list for ~50 ms |
| 8 | **bid escrow terms** | `readConfig` in `arenaBidFundPorts` (`AuctionBidHost.tsx:118-124`) | params read + `resolveEscrowMintUrl` (config wait + keysets HTTP) | same | 12–25 ms + 78 ms | a bid in `publishing` for ~100 ms |
| 9 | **chain clock** | derived in `collectArenaSurfacesRead.refresh` (`auctionSurfacesRead.ts:385-392`) from the 1447s in the same read | the label is `null` until the first commitment | none (no timer of its own) | first 1447 at 85–128 ms | no chain-clock label for the first ~100 ms |

Two things this table makes explicit:

- **Nothing on the arena path awaits a timeout for *data*** — the data arrives in tens of
  milliseconds. What awaits is the **status** (the gate), plus the shell's config gate.
- **The dependent reads already cascade**: the create → detail, and the create → `#e` follow-up → top
  bid. What does *not* cascade is the read's own state word.

## 6. The three states, per surface, and what has to change

The model already exists and is good:

- `ArenaSurfaceStatus = 'loading' | 'settled' | 'incomplete' | 'no-relays' | 'error'`
  (`ui/auction/arena/model.ts:40`), one honest sentence each in `readStateMessage`
  (`model.ts:567-596`), `arenaListEmptyMessage` (`ArenaAuctionsListHost.tsx:216-252`) and
  `arenaListPartialNotice` (`ArenaAuctionsListHost.tsx:254-267`).
- `ArenaLotView` renders `readStateMessage(status)` when `model === null` (`arena-lot-view.tsx:360-371`);
  the seller lot page renders it through `CatalogueDetailView` (`catalogue-detail-view.tsx:142-152`);
  the list renders cards plus the partial band (`ArenaAuctionsListHost.tsx:339-380`).
- The state is carried by the read: `ArenaSurfacesReadState.status` / `AuctionListReadState.status`.

**The gap is in the read's health model, not in the copy.**

1. `auctionListStatus` (`auctionListRead.ts:79-83`, re-exported as `arenaSurfaceStatus`,
   `auctionSurfacesRead.ts:83`) has **no `loading`**: aborted→`incomplete`,
   `noRelaysReachable`→`no-relays`, `pending.length > 0`→`incomplete`, else `settled`. `pending` is a
   property of the **final** health, so mid-read it cannot say "one relay answered, one is pending".
2. Both collectors **hardcode** `status: 'loading'` for every progress batch
   (`auctionListRead.ts:196`, `auctionSurfacesRead.ts:404-406`). So while reading, the UI cannot
   distinguish "nothing has arrived yet" from "the app relay answered and four others are dead".
3. `loading` therefore means *two different things* today, and `incomplete` can only appear at the end.

| surface | paints immediately (measured) | must arrive later | loading | no data | data |
| --- | --- | --- | --- | --- | --- |
| `/auctions` index | chrome + cards at the first batch (42–55 ms) | the settled word; verdict flags | `loading` + `arenaListPartialNotice` band | `settled` + "No auctions yet." (reachable **only** from settled, `ArenaAuctionsListHost.tsx:26`) | cards, each qualifying its own numbers (`bidCountLabel`, `model.ts:598-602`) |
| lot detail | the lot + gallery + bid panel at 20–40 ms; top bid at ~50 ms | verdicts/receipts/committed end (app relay only) | `loading` + `readStateMessage` when no model yet; the panel's own "Reading the auction's terms from relays…" (`bid-panel.tsx:326`) | `settled` + "No such auction was read." | the full `ArenaLotView` |
| bid read (`#e`) | the top bid ~50 ms after the create | nothing further | n/a (it is inside the same read) | n/a | the bid ladder |
| receipts / state half | only from the app relay (26 ms) | — | `loading` until the gate | `settled` + nothing read | receipt rows, committed end |
| wallet / mint | wallet `ready` needs no relay; the first mint ~50 ms | — | n/a | `resolveChainMint`'s own refusal/notice | mint registered |
| chain clock | first commitment 85–128 ms | — | label hidden (`chainClockLabel === null`) | `unknown` (never `0`, `arenaClock.ts` header) | the label |

**What has to change** (detail in the increments below):

- Derive the progress status from the **live** health instead of hardcoding `loading`
  (`auctionListRead.ts:196`, `auctionSurfacesRead.ts:404-406`), and add a `loading` branch to
  `auctionListStatus` keyed on "nothing has arrived yet" (`answered === 0` and nothing pending).
- Make the gate stop waiting for a relay that has neither EOSE nor an event within a short quiet bound
  (`arenaAuctionRead.ts:1727-1745` already computes `givenUp` at `:1741`; it just never settles),
  naming it in `health.pending` so the existing `incomplete` copy is the honest word — never `error`.
- Keep `settled` meaning "every relay answered", so "No auctions yet" stays reachable only from a
  settled read.

---

## 7. Ordered increment plan

Ordered by what unblocks the user's perceived slowness first. Each step is small, independently
verifiable, and deterministic under test (no network in unit tests).

### I1 — a relay that never speaks must not hold the read (kills the 8 s)

**Why first:** it is the single largest measured cost (lot gate 8 010 ms, §3.4) and the only one that
hits *every* lot page.
**Files:** `platform/web/auctions/relay/arenaAuctionRead.ts` (the `run()` gate, `:1578-1800`; the
`givenUp` path at `:1741`).
**Change:** bound the *quiet* wait per subscription — a subscription open with zero events and no EOSE
for a short bound (e.g. 1 500 ms) settles as "quiet/pending", is named in `health.pending`, and the
caught-up marker fires once every subscription is settled-or-quiet. A late `answer()` still upgrades it
(`:1653-1661`), so a slow relay that speaks at 3 s is still `ok`.
**Acceptance evidence:** a unit test with a fake relay that opens and never EOSEs → caught-up at the
quiet bound, `health.pending` names it, its status is not `error`; and live, the lot page's
`caught_up_ms` drops from ~8 010 ms to ≤ ~1 500 ms with the same relay set.
**Risk:** a genuinely slow relay is dropped from the *status* sooner — mitigated by naming it `pending`
(the surfaces already render that as `incomplete`, never as failure) and by keeping the data.

### I2 — the progress state carries the live health (loading ≠ incomplete ≠ nothing)

**Why second:** it is what makes the three states honest at every instant, and it is what the user's
"distinguish loading from genuine no-data" asks for directly.
**Files:** `platform/web/storefront/auctionListRead.ts` (`:79-83`, `:196`),
`platform/web/auctions/relay/auctionSurfacesRead.ts` (`:83`, `:404-406`), `ui/auction/arena/model.ts`
(only if a new branch is added).
**Change:** compute the progress status from the current health (`answered` / `pending` / `relays`)
instead of the literal `'loading'`; add "nothing has arrived yet" as the one `loading` case.
**Acceptance evidence:** unit test — mid-flight with one relay EOSE'd and one silent, the state is
`incomplete` with `answered 1 / total 2` and the partial data is present; with nothing yet it is
`loading`; the sentences are unchanged.
**Risk:** copy churn; the state word changes for a page that is already reading, so the two tests that
pin `seen.every(status => status === 'loading')` (`auctionSurfacesRead.test.ts:639-645`,
`auctionListRead.test.ts:376-381`) must be **rewritten to the new truth, not weakened**.

### I3 — stop paying the 503 reconnect ladder on the whole-arena read

**Why third:** the index's gate is 6.7–7.1 s, all of it `relay.damus.io`'s 503 + 3 retries × 1 s
(`applesauceIo.ts:210-212`).
**Files:** `platform/web/applesauceIo.ts` (`:210-212`).
**Change:** a shorter delay, or fewer retries when the failure is the handshake itself (a 5xx/refused
connect), so a relay that cannot connect is settled in ≤ ~1.5 s.
**Acceptance evidence:** measured — the whole-arena gate ≤ ~1.5 s with the same 7 relays; a unit test on
the retry policy (a connect failure settles after N attempts).
**Risk:** a transiently-failing relay is dropped sooner; it carries **9 of 884 events** (measured, §3.5),
and it is still named in `health`.

### I4 — do not subscribe relays that cannot answer this read's filters

**Why fourth:** the lot's whole payload came from the app relay alone (61 events, identical with and
without the other six), yet 4 relays CLOSE the `#auction` filter and `minibits` NOTICEs it and hangs.
**Files:** `platform/web/auctions/relay/arenaAuctionRead.ts` (`openFollowUps` `:1680-1693`, the CLOSED
handling in `pump`).
**Change:** mark a subscription settled on a CLOSED that names an unindexable tag filter, and do **not**
open the `#e` follow-up to a relay that just CLOSED this read (`:1691` currently pumps *every* relay).
**Acceptance evidence:** the lot read's gate ≤ the app relay's EOSE (~30–290 ms, §3.5); a unit test that
a relay CLOSING with `unindexed tag filter` is settled and receives no follow-up REQ.
**Risk:** skipping a relay that would have answered a different filter — scope the skip to the read's
own filter set.

### I5 — the shell must not gate on `/api/config`

**Why fifth:** it is a hard gate on *every* route (`frontend.tsx:92-93`) and costs 72 ms here, but up to
10 s × 3 + backoff by its own bounds. It is the remaining "awaiting a timeout before first paint".
**Files:** `platform/web/frontend.tsx` (`:92-93`), possibly `platform/web/boot.ts`.
**Change:** render the shell and let config arrive (the served-page path already does this); keep reads
that need `appRelay` working through the existing fallbacks (`chainMint.ts:96-101`,
`readConfiguredMints` at `:73-81`).
**Acceptance evidence:** a test with a slow/absent config still paints the chrome; measured config
72 ms so the visible win is on a slow or failed config.
**Risk:** a read that needs `config.appRelay` before it lands — the two known callers already wait or
fall back.

### I6 (adjacent, not loading) — a bare-`d` lot page reads no coordinate half

**Why last, and flagged as not-loading:** with no `?seller=`, `arenaLotFilters` (`:320-337`) cannot
build the `#auction` filter, so verdicts, receipts and the committed end are **never read** for a lot
opened without the disambiguator. That is a correctness gap next to the loading work, not a latency one.
**Files:** `platform/web/auctions/relay/arenaAuctionRead.ts` (`arenaLotFollowUpFilters` `:346-360`),
`platform/web/auctions/relay/ArenaAuctionLotHost.tsx`.
**Change:** open a follow-up `#auction` REQ once the create names its seller (the same mechanism the
`#e` bid fix uses).
**Acceptance evidence:** a lot opened without `?seller=` shows its verdict/receipts after the create
arrives; a unit test for the follow-up filter.
**Risk:** an ambiguous `d` (several sellers) must not guess a seller — the follow-up must stay empty
until the seller is unambiguous.

---

## 8. What I could not determine

- **The code's own "8759 ms" note.** `arenaAuctionRead.ts:1727-1734` records "the app relay's first
  kind-1440 EVENT arrived at 8759 ms, after the transport's 8 s fallback". I measure **42–100 ms** for
  the same REQ through the same pool and the same relay (§3.4, §3.5) and cannot reproduce it. The
  plausible explanations — the measurement was taken while the (since reverted) relay-side long-tag
  patch was deployed, or with a cold app-relay connection — are hypotheses, not findings.
- **`nak`'s 490–830 ms vs the raw WebSocket's 2–130 ms.** The raw client's t0 is after the handshake and
  `nak`'s includes process start; I report both rather than reconcile them.
- **What applesauce's own messages were for `minibits`.** The NOTICE is what the raw WebSocket saw; the
  group's observable simply stayed open for the full 8 s, and I did not instrument applesauce's internal
  message stream to confirm it saw (and dropped) the NOTICE.
- **Second-by-second behaviour of the deployed page.** I measured the transport, not a browser; the
  "user sees X for Y ms" column is the read's own state machine plus the surface code, not a
  screen recording.
- **The deployed page's live relay set.** I measured with the 7 from `/api/config` (`publicRelays` +
  `appRelay`); a session whose NIP-65 relay list has loaded may read a different set.
- **I1's quiet bound (1 500 ms) is a design choice**, not a measurement; it is the number to tune.
