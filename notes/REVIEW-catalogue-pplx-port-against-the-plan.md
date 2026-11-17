# REVIEW — the pplx Catalogue port against the escrow-gaps plan

**Reviewed:** `wt-union-1420/notes/HANDOVER-2026-11-17-catalogue-pplx-port.md` (284 lines, untracked),
against `notes/PLAN-arena-escrow-gaps.md`. Written 2026-11-17 by the session that owns the plan.

---

## 1. The handover's claims, verified rather than repeated

| claim | verification |
|---|---|
| the union carries a partial Catalogue but it is unrouted | ✓ `grep -c catalogue platform/web/routeTree.gen.ts` → **0**; the six files are present (`ui/auctions/catalogue/{catalogue-view.tsx,catalogue-preset.ts,catalogue-preset.test.tsx,catalogue-theme.css}`, `platform/web/auctions/catalogue/catalogueQuery.ts`, `platform/web/routes/auctions.catalogue.tsx`) |
| the payload is one commit, 13 files | ✓ `206bc7fe1` — 13 files, **+1573 / −4** |
| it does **not** carry the earlier snapshot's staged deletion | ✓ `git show --diff-filter=D --name-only 206bc7fe1` → **empty**. `ProductRowPicker.tsx` is not touched. |
| the design reference is untracked on disk | ✓ `/home/admin_maxime/work/market/notes/artboards/auctions/` holds `HANDOVER-PPLX-BASELINE.md`, `KIT.md`, `CONTENT.md`, `frames/`, `_art.html` — and it is in **no branch** |

The handover is accurate on all four. Its §4 warning about `protocol/client.ts` and
`platform/server/http/auctionsProtocol.ts` also matches this plan's finding 1 exactly: there are
**two** HTTP readers on the union (the bid host's config read, and `catalogueQuery.ts`'s state poll),
and they are the only two.

---

## 2. What the port must still tackle independently (unchanged by the plan)

Everything in the handover's §6: port the Layout A presentation as props-only, replace the read,
re-point the detail route, delete `catalogueProtocolClient.ts` and bind the bid action to the arena
path, regenerate routes, resolve the presentation overlap per ruling 1. Plus §10's gates and §12's
definition of done. Nothing in the escrow plan does that work, and nothing in the plan conflicts with
it textually — the handover's "no textual conflict" is correct.

---

## 3. What it changes about the plan — four real crossovers

### 3.1 The port and increment 9 are the same boundary from opposite ends
The port deletes the **catalogue's** HTTP read; increment 9 replaces the **bid host's** config read and
then deletes the proxy and the client. If both run independently they collide on the proxy, on
`protocol/client.ts` and on `routeTree.gen.ts`. **One owner per seam:**
- the port owns re-pointing `catalogueQuery.ts` and must **not** delete the proxy (a reader still
  exists while it runs);
- increment 9 owns the *last* HTTP reader's removal **and** the deletion of
  `platform/server/http/auctionsProtocol.ts` + `platform/web/auctions/protocol/{client,httpPorts}.ts`,
  verified by a network check on the running instance (zero requests to `/api/auctions/*`).

The handover's "don't take `protocol/client.ts`'s 19 demo fields" is a subset of that deletion: the
port should simply not import the client after the re-point, and leave the deletion to 9.

### 3.2 Ruling 2 (the countdown clock) is the *same decision* as increment 3's
Both need one time source, and the repo cannot have two. What exists today:
- the route injects wall clock — `now={now}` into both hosts, documented as "the route's one ticking
  clock, shared with the bid panel";
- `ArenaAuctionCardModel.endsAt` is **create-derived**: `root.created_at + duration_seconds`, `null`
  when the create stated no positive duration;
- **the read already parses the chain commitments**: `arenaAuctionRead.ts` subscribes to `1447` and
  its snapshot carries `stateCommitments: ParsedArenaStateCommitment[]`, whose content is
  `{schema, height, appHash, time}` — a validator-signed **time** and the height it belongs to.

So a chain-anchored clock is available *in the read* — the moment the chain publishes (today nothing
does, so it would honestly render "unknown"). The decision is the same one increment 3 needs for the
*moved* end, and `MERGED-PROTOCOL-SPEC.md` §2.1/§3 put every time rule on committed block time.
Deciding them separately is how the app ends up with two clocks.

### 3.3 Ruling 1 relocates the UI half of increments 3, 4 and 5
If Layout A replaces the arena presentation, then the extension display (3), the outbid-refunded state
(4) and the settlement/outcome display (5) all land in `ui/auctions/catalogue/catalogue-detail-view.tsx`
and friends — **not** in `ui/auction/arena/*`. So the port must land **before** those UI halves, or
they build on a surface that is being replaced, and two writers touch one detail view.
The natural split, given the port's §6.1 (presentation is props-only): Layout A supplies the views, the
existing arena hosts and routes keep supplying the data.

### 3.4 The arena read-model answers the port's §11 "honest unknown" — and it changes the assumed props
The handover assumes the catalogue props `id, title, seller, imageUrl, startingBid, endTime, status,
fundingMode`. Measured against `ui/auction/arena/model.ts`:

- **`fundingMode` has no arena equivalent at all.** The model carries none, and the escrow is
  mint-backed rather than custodial-reservation. So that prop either goes or is re-sourced from the
  params increment 9 publishes. **Do not invent a default.**
- **`status` is not one field.** The arena gives `phase` (`open|ended|unknown`) + `verdict` (`null`
  when none was read) + the read's five-word state (`loading|settled|incomplete|no-relays|error`) +
  `divergent`. A flat `status?: string` has to split, and "unknown" must survive as a word.
- **`endsAt` is the create-derived end** — exactly the field increment 3 turns into the committed,
  possibly-extended end. The port should not build a countdown that increment 3 will move.
- **positions are derived sums of bid *deltas*** (`topBidTotal`, `positions[]`), and increment 4
  changes what a position *means*: once an outbid position is refunded at once, a position is locked
  sats owned by the current leader, not a cumulative claim. The model's own comments and the surface
  copy move with it.
- **verdict rows are "a *claim*, not a receipt"** — increment 5 must add the receipt side (the
  validator-moved escrow) rather than presenting the claim as the money fact.

### 3.5 One more thing the plan should carry from this
The port's §5 reference is **untracked** — one `git clean` in that worktree and the ruled baseline is
gone. It should be committed (the handover and at least the extractions), and the handover file itself
says it was left untracked on purpose while a sibling session was live.

---

## 4. Sequencing after this review

**6 → 7 → 1 → 9 → 10 → 2 → 3 → 4 → 5 → 8**, where **10 is the catalogue port** and lands:
- after **9** for its *bid* half (binding the bid action to the arena path needs the escrow terms,
  which must come from the relay params — binding it to the HTTP config we are deleting is building on
  the thing being removed);
- before **3, 4, 5** for their *UI* halves, because it decides which views those increments edit;
- independently of **2** (the ingest seam is a chain/app wire concern; the port is presentation).

Its read half could land earlier — it consumes a read that already ships — but landing it in one piece
avoids touching the same files twice.
