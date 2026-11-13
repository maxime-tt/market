# DECISION — retire the bidder-held-path auctions protocol; rewrite on the 1440 series

**Status:** decided by the owner (Maxime), 2026-11-13. Binding for the market web app.
**Supersedes:** the app's `cashu_p2pk_bidder_path_v1` implementation (`sdk/commerce/auctions/**`,
kinds `30408`/`1023`/`1024`/`1025`/`1026`/`30440`/`30441`/`30442`).
**Related:** `DECISION-auction-kinds-and-editable-allowlist.md`,
`REPLY-nostr-verdict-contract.md`, `HANDOVER-nostr-read-path-and-verdict-publish.md`.

---

## 1. The ruling

> "you can proceed with retiring the bidder-held path flow altogether along with any specifics of
> that implementation. Meanwhile anything useful (such as the root auction event pinning and
> fields) can be ported into the new protocol, but otherwise we should rewrite and wire in the new
> implementation with the kind 1440 events. The chain-fed catalogue was intended to be a UI for the
> new auctions protocol but ended up achieving neither objective due to being a halfway state,
> we'll come back to it later."

Four parts:

1. **Retire the bidder-held-path flow entirely**, and the specifics that belong only to it.
2. **Port what is genuinely reusable** — named explicitly: the **root auction event pinning** and
   the **field set**.
3. **Rewrite and wire in the new implementation on the `1440` series** (regular kinds), not a
   renumber of the old one.
4. **The chain-fed Catalogue is deferred.** It was meant to be the new protocol's UI and became a
   halfway state that serves neither the old protocol nor the new one. Left as-is, revisited later.

Point 3 matters most for sequencing: this is a **rewrite**, so the old implementation is not
migrated in place. The new one is written against the frozen contract, and the old one is removed
once the new one covers its surfaces.

## 2. What is in the app today (the thing being retired)

Established by inspection, not assumption:

- **`sdk/commerce/auctions/constants.ts`** is the single kind source. ~**101 files** reference the
  auction kinds.
- Kinds: `AUCTION_KIND = 30408` (create, addressable), `AUCTION_BID_KIND = 1023`,
  `AUCTION_SETTLEMENT_KIND = 1024`, `AUCTION_PATH_RELEASE_KIND = 1025`,
  `AUCTION_FALLBACK_OFFER_KIND = 1026`, `VALIDATOR_VERDICT_KIND = 30440`,
  `VALIDATOR_POLICY_KIND = 30441`, `BIDDER_AGGREGATE_REPUTATION_KIND = 30442`.
- It **already reads auctions from relays** via NDK: `platform/web/auctions/auctionsQuery.ts`
  subscribes `{kinds: [AUCTION_KIND], authors: [pubkey]}` and the same for bids.
- It has real UI and real e2e coverage: `AuctionCardHost`, `AuctionBidderHost`,
  `AuctionDisplayHost`, `auctionPublish.ts`, `InvalidAuctionNotice`, `AuctionSettlement`,
  `AuctionTimelineChartHost`, `AuctionVerdictPanelHost`, plus specs
  `auction-home-grids`, `auction-bidding-mints`, `auction-live-chat`, `auction-invalid-event-gate`.
- The **allow-list and root pinning already live here**:
  `AUCTION_IMMUTABLE_SINGLE_TAGS`, `AUCTION_IMMUTABLE_MULTI_TAGS`,
  `AUCTION_ROOT_EVENT_ID_TAG = 'auction_root_event_id'`.

## 3. Field inventory — what survives, what goes

This is the "port anything useful" instruction made concrete. The dividing line is
**generic auction semantics** versus **bidder-held-path mechanics**. Anything whose meaning
depends on the HD-xpub / path-release scheme dies with it; anything true of any auction survives.

### SURVIVES — ported onto the new `1440` create event

- **Root pinning.** `auction_root_event_id`: the first create event for a given `(seller, d)`, and
  every bid and update binds to it. Already proven in this app and already ported backend-side.
- **The immutable/mutable allow-list discipline.** `AUCTION_IMMUTABLE_SINGLE_TAGS` /
  `AUCTION_IMMUTABLE_MULTI_TAGS` as the governing idea: display mutable, money/time/crypto frozen.
  The field names must be restated against the *new* payload (see
  `DECISION-auction-kinds-and-editable-allowlist.md` §3), not copied verbatim.
- **Identity and display.** auction id (`d`), `title`, `description`, images, and the
  product-shaped metadata the app already carries (`spec`, `shipping_option`, `weight`, `dim`,
  `location`, summary, content-warning) — these map onto ordinary listing semantics.
- **Money floors.** `starting_bid`, `bid_increment` / `min_increment`, `reserve`.
- **Timing.** `start_at`, `end_at`, `max_end_at`, `settlement_grace`, and the anti-snipe knobs the
  POC already models (`late_bid_window_seconds`, `late_bid_extension_seconds`,
  `max_total_extension_seconds`, `locktime_seconds`).
- **Trust anchors.** the `mint` allowlist, `auditors` and `auditor_quorum`, `max_skew_sec`.
- **The validator-judgment *idea*.** "a validator states an opinion about a bid" survives; the
  *shape* does not (see below).

### RETIRES — bidder-held-path specifics, deleted not ported

- Kind `30408` as the create event (replaced by regular-kind `1440`).
- Kinds `1023` (bid commitment), `1024` (settlement), `1025` (path release), `1026` (fallback
  offer) and their parsers/re-exports.
- `key_scheme = hd_p2pk`, `p2pk_xpub`, `settlement_policy = cashu_p2pk_bidder_path_v1` — the
  seller xpub and the bidder-chosen derivation path are the mechanism being retired.
- `AUCTION_PATH_HD_DEPTH`, `AUCTION_PATH_HD_MAX_INDEX` and the whole derivation-path scheme: the
  bidder keeping the path and publishing it at settlement (`1025`) is exactly what goes.
- The `30440` **replaceable** verdict model and its `VALIDATOR_CLAIMS` taxonomy
  (`valid_bid_placed`, `won_pending_settlement`, `settled_promptly`, `griefed`,
  `fraudulent_bid`, …), plus `30441` policy and `30442` aggregate reputation. Superseded by the
  frozen `1445` verdict: `outcome` ∈ `winner | reserve_not_met | cancelled | aborted`, on an
  **append-only regular kind**, with a **mandatory `(height, block_hash)` anchor**.
  The old taxonomy is richer; the new one is anchored and append-only. Do not try to keep both.
- The settlement/fallback/griefing flows built on the path release.

### ⚠️ One genuine loss to name out loud

The `30440` claim taxonomy is **more expressive** than the `1445` outcome. `griefed`,
`settled_late`, `fraudulent_bid` etc. have no direct equivalent in
`winner | reserve_not_met | cancelled | aborted`. If those distinctions are wanted on the wire
later, it is a **contract change to `1445`**, negotiated with the other session — not something to
smuggle in client-side. Flagged, not decided.

## 4. The new model, in one paragraph

An auction is a **regular-kind `1440` event** signed by the seller; its **first** event id is the
pinned root and its mutable fields may be edited afterwards under the allow-list. Bids are `1441`.
The **chain decides** ordering, time and validity; the **relay carries** the events. Validators
publish a signed `1445` verdict (with the mandatory height+hash anchor) and periodic `1447` state
commitments. The client reads **everything from the relay** and treats a verdict as a
**notification of committed state**, never as a receipt — the mint is the authority on whether
money moved. Unanchored verdicts are **ignored by name**.

## 5. Staged plan (each stage independently verifiable)

1. **The kind map and the parsers** — the `1440` series in the app's constants, and pure parsers
   for `1445`/`1447` that enforce the anchor and refuse an unanchored verdict by name.
   *(in flight, separate worktree; additive, against the 522-error typecheck baseline.)*
2. **The relay read adapter** — one module subscribing to `1440`/`1441`/`1445`/`1447`, yielding a
   typed auction view. Multi-relay from the start: the other session's stated mitigation for
   equivocation is ≥2 relays and a client-side diff, not client-side verification.
3. **The new auction surfaces rewritten on `1440`** — card, detail, bid flow, verdict panel —
   reading the relay adapter, not the old `auctionsQuery`.
4. **Wire into the app experience** — auctions as part of the app, not a separate route. This is
   where the still-open **home-composition question** bites (browse hero vs CMS storefront); it
   must be settled here, since the intro storyboard and the auction surfaces both depend on it.
5. **Delete the retired implementation** — kinds, parsers, derivation-path module, settlement
   flows, and the `30408` family from `constants.ts`, with the e2e specs updated or removed.
   Only after stage 3 covers the surfaces, so nothing is lost mid-flight.

## 6. Deferred, explicitly

- **The chain-fed Catalogue.** `d7s2/auctions-catalogue-extract` (verified, tested, pushed to all
  three remotes, unmerged) plus the live `/auctions/catalogue` route. Deliberately **not** merged
  into this work: it is a halfway state that serves neither protocol, and merging it now would
  create a fourth surface to retire later. Untouched.
- Whether `1445` gains the richer lifecycle claims (§3, the flagged loss).

## 7. What must NOT happen

- Do not renumber the old constants and call it done — the ruling is a **rewrite**. A blind renumber
  would break the working feature against the protocol it currently speaks and leave the
  bidder-held-path mechanics in place.
- Do not delete the old implementation before stage 3 covers its surfaces.
- Do not keep `30440`-style replaceable verdict semantics alongside `1445`.
- Do not treat a `1445` verdict as proof of payment.
