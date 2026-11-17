# HANDOVER — the app-side work that runs in parallel with the validator session

**For:** the session implementing the market-app side of the arena auctions work.
**From:** the session that did the chain deployment + verification. **Written** 2026-11-17.
**Why now:** the validator-side workstreams are handed over (see
`~/work/arena-merged-ref/docs/HANDOVER-2026-11-17-validator-workstreams.md`). The app side can proceed in
parallel; only two of its items wait on the chain, and they are named below.

---

## 0. Read this first

**The plan of record is `notes/PLAN-arena-escrow-gaps.md`** (branch `d7s2/arena-escrow-plan` in
`~/work/wt-key-prov`, pushed to `fork`). This brief is its app-side execution order, not a replacement. Where they
disagree, the plan wins and this brief is stale.

**The chain is live and publishes to the relay already** — verified 2026-11-17: kind-1447 state commitments
(anchored `height`/`app_hash`/`time`) and kind-1445 verdicts are on `wss://relay.playday.it`, and the deployment
runs as `arena-chain.service` on `127.0.0.1:8090` with the four validators on 7101-7104. **So the read half of
everything below is verifiable today, without waiting for the validator session.**

**Rulings already given by the owner (do not re-open):** Layout A **replaces** the arena presentation ("only the
new UI"); the clock is a **combination of wall time and block time**; the heartbeat is an **ephemeral** kind; a
bid's confirmation is the **block commit** (a normal stored event), never the heartbeat; the escrow's terms come
from a **new stored params event** on the relay (validator workstream D).

---

## 1. Unblocked now — do these in this order

### 1.1 The read's dedupe key must include `time` *(small, and it gates the clock)*
`platform/web/auctions/relay/arenaAuctionRead.ts` (~:959-969) dedupes commitments by
`(validatorPubkey, height, appHash)` and sorts by height then validator. **`time` is not in the key**, so several
heartbeats at one unchanged height collapse to one and the newest `time` is lost — the clock would be as stale as
the oldest tick seen at that height. Fix: include `time` in the identity, and sort `height desc, time desc`.
This matters **more** now that the heartbeat is ephemeral, because several ticks per height are expected.
Evidence to bring: a unit test with two commitments at one height and different `time`s, asserting the newest wins.

### 1.2 The clock *(the ruling: wall time for display, block time for the rules)*
- Expose the chain time to the surfaces: `ArenaAuctionSnapshot.highestCommitment` already exists
  (`arenaAuctionRead.ts:653`) but **nothing outside the read and anchor modules reads it** — surface it through
  `platform/web/auctions/relay/auctionSurfacesRead.ts` alongside the existing health/divergence data.
- **Rules use chain time; the display uses the route's ticking clock.** The route already passes `now` into the
  hosts (`auctions.$auctionId.tsx:55`, `auctions.index.tsx:61`, documented as "the route's one ticking clock").
  Keep that for display, and judge *rules* (window open, end passed, lock settleable) against the anchored time.
- **Freshness must be visible, not implied.** Chain time is "as of height N": show how far wall clock has moved
  since, and render **unknown / stale** when no commitment has arrived — never present an old time as now.
  The existing fork detection (`commitmentForks`) is the input for refusing to advance on a forked height, and the
  clock must **never regress**.
- When the ephemeral tick lands (validator workstream A), it becomes the fast clock on top of the same rule; build
  the freshness/staleness logic now against the commitment, and add the tick as a second source later.
- Verifiable today: the relay already carries real 1447s to read.

### 1.3 Increment 10 — the Layout A port *(the biggest item; presentation half is fully unblocked)*
Full brief: `~/work/wt-union-1420/notes/HANDOVER-2026-11-17-catalogue-pplx-port.md` (read §1, §4, §9 first) and my
review of it at `notes/REVIEW-catalogue-pplx-port-against-the-plan.md` on the plan branch. In short:
- the payload is `d7s2/auctions-catalogue-extract` @ `206bc7fe1` — one commit, 13 files, **zero deletions**
  (verified);
- take the presentation as **props-only** (`ui/AGENTS.md:18-28`, `:120` — no `@platform/`, no fetching in `ui/`);
- **re-point the read** from the demo HTTP client to the arena read seam; **delete**
  `platform/web/auctions/catalogue/catalogueProtocolClient.ts`;
- **do not take** the generated `routeTree.gen.ts` (run `bun run generate-routes`), and do not take the
  `Header.tsx` catalogue link (Layout A *is* the auctions surface — ruling 1);
- **the honesty rules are the house rule**: every unknown is `null` and is rendered in words, never a `0`;
- the port's semantic decisions map to the rulings: time source → §1.2; funding/bid path → the arena bid modules
  (`arenaBidFunding.ts` / `arenaBidEscrow.ts` / `arenaEscrowCocoSend.ts` / `arenaBidPublish.ts`);
- **the arena read-model answers the port's "honest unknown"** (measured): `fundingMode` has **no arena
  equivalent at all**; `status` is not one field (it is `phase` + `verdict` + the five-word read state +
  `divergent`); and `endsAt` today is **create-derived** (`root.created_at + duration_seconds`) — i.e. the field
  the committed/extended end replaces. Do not invent defaults for any of these.

### 1.4 Delete the second read (`catalogueQuery.ts`)
It polls `GET /api/auctions/state` (the demo, proxied). Replace it with the arena read — **one read, not two**.
This is one of the two client→backend HTTP call sites; the other is §1.5.

### 1.5 The app-side e2e against the live chain
The read half is verifiable now: point the app at the running chain and confirm lots, bids, verdicts and the
anchored time render from the relay alone. The bid half waits on §2.

---

## 2. Blocked on the validator session — named, so nothing is guessed

| item | blocked on | effect while blocked |
|---|---|---|
| `AuctionBidHost.tsx:110`'s `createHttpPorts({apiBase:'/api/auctions'}).getConfig()` → the relay params event | validator **D** (the new stored params kind) | the escrow's terms still come over HTTP; **do not hardcode a committee key** — it changes on every `arena init` |
| deleting the proxy + `platform/web/auctions/protocol/{client,httpPorts}.ts` + `AUCTIONS_PROTOCOL_UPSTREAM_URL` | **D**, and the last reader moving (§1.4, §1.5) | the HTTP path must not be left as a "fallback" — delete it in the same change as the last reader |
| the port's **bid action** (Layout A detail → arena bid path) | **D** (the same terms) | the presentation and read can land without it |
| the clock's **tick** source | validator **A** (ephemeral heartbeat) | build against the commitment now (§1.2) |
| bid-confirmation timing expectations (1-2 s) | validator **C** (prompt block production) | UI work proceeds; do not "fix" a slow confirmation with a longer client wait |

**Do not** build a fallback that reads the committee key from the demo config, and **do not** treat the chain's
`/api/tx` `200` as commitment — it returns ok on a relay publish alone (measured).

---

## 3. Trees, gates and hard rules

- **Work in a fresh worktree off the union tip** (`unite/1420-all`); **do not edit `~/work/wt-union-1420`** — an
  auctions session is live in that tree. Stage **explicit paths** (`git add <files>`), never `git add -A`, and
  re-check `git status` after committing.
- **Deploy file by file**, not by directory (`git checkout <branch> -- <dir>` sweeps a sibling's in-flight work
  into the live instance).
- **Gates** (measure before and after, and never weaken an assertion to make one pass):
  `bun run test:unit` (record the count), `bunx tsc --noEmit` (**"clean" means the number does not grow** — the
  programme carries a permanent baseline), `bun test ui`, `bun run widget-book:test`,
  `bash scripts/check-ui-assembler.sh`, `bash scripts/check-ui-styles.sh`, `bash scripts/check-src-boundary.sh`,
  `bun run format:check`, and `bun run generate-routes` after any route change.
- **Push to `fork`** (`maxime-tt/market`) and `nostr`; **never to `upstream`** (`github.com/PlebeianApp/market`).
- **Do not touch the chain repos** (`~/work/arena-merged-ref`, `~/work/arena-integration`) — the validator session
  owns them now.

---

## 4. Definition of done for this lane

- [ ] commitments dedupe by `(validator, height, app_hash, time)`; newest `time` at a height wins (test)
- [ ] chain time is surfaced through the surfaces read, with freshness/staleness rendered in words and never
      presented as now; the clock never regresses
- [ ] Layout A renders the arena read; `catalogueProtocolClient.ts` is deleted; routes regenerated, not copied
- [ ] `catalogueQuery.ts`'s HTTP poll is gone — one read, not two
- [ ] the HTTP proxy and `protocol/{client,httpPorts}.ts` are deleted **in the same change as the last reader**
      (waits on validator D)
- [ ] gates recorded before/after; nothing weakened; `tsc` baseline not grown
- [ ] pushed to `fork` + `nostr`, and the live instance answers 200
- [ ] any item still blocked is reported as blocked **with the workstream it waits on**, not worked around
