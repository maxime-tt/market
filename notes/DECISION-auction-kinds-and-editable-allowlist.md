# Decision — the auction kind range, and the editable-field allow-list

**Status:** decided by the owner (Maxime), 2026-11-12. Binding for both the market web app
and the ChiefMonkey auctions implementation (`plebeian-arena-auctions`).
**Companion to:** `HANDOVER-nostr-read-path-and-verdict-publish.md` (the read/publish path).

---

## 1. The ruling

> "I would say we go with our own range of events — 1440 etc. — keeping the auction event
> editable with the allow-listed fields as the previous auctions implementation allowed.
> That is the main piece of work we should port over."

Decomposed:

1. **Kinds: our own range, the 1440 series.** Not NIP-15's `30020`/`1021`/`1022`. NIP-15 was
   examined and is set aside; its mandatory fields (`stall_id`) and its time-extension model
   conflict with ours, and its edit rule is weaker (see §4).
2. **The auction event stays editable after publication**, but only across an explicit
   **allow-list** of mutable fields — the mechanism the previous auctions implementation
   specified. Everything that affects money, time or cryptography is frozen at first publish.
3. **That allow-list mechanism is the main port** from `upstream/auctions` (`AUCTIONS.md`,
   134 KB — the Plebeian/market auctions fork) into the merged implementation.

## 2. Kind allocation — verified free

The 1440 series is **regular** (`1000 <= n < 10000` per NIP-01), so relays are expected to
store these events. This is the point: the ephemeral range (`20000 <= n < 30000`) is *not*
expected to be stored, and khatru actively refuses such an event when no subscriber matches it
(`mute: no one was listening for this`) and does not buffer it.

Three independent checks, all clean:

- **NIPs registry** (`nostr-protocol/nips` @ `1fb3a95f`, 2026-11-12): none of 1440–1447 is
  referenced anywhere. The highest 1xxx kind the registry claims is **1987**.
- **All 1,898 PR branches** in the NIPs repo (open and closed): none of 1440–1447 referenced.
- **Live relays** (relay.damus.io, nos.lol, relay.nostr.band, nostr.wine): **0 events** for any
  of 1440–1447. Control queries returned events for kind `1`, so the zeros are real absence.

| role | kind | note |
|---|---|---|
| auction create / root | **1440** | already used by `plebeian-arena-auctions` (`chain/nostr.go:22`) |
| bid | **1441** | already used there |
| chat | **1442** | already used there — **leave it; do not reuse for anything of ours** |
| refund | **1443** | new |
| settle | **1444** | new |
| outcome / validator verdict | **1445** | new — the publish path of the companion handover |
| funding abort | **1446** | new |
| — | 1447+ | spare |

**One place.** These numbers must live in a single exported map per implementation, never as
literals scattered through the tree. On the POC side they currently sit at
`internal/poc/model.go:25-40` as `KindCreate`/`KindBid`/… (5 raw literals in 2 files; the other
~140 uses are symbolic — so one edit renumbers everything). On the app side,
`platform/web/auctions/protocol/client.ts:29-32` holds the kind map and
`client.test.ts:63` asserts on a literal.

⚠️ **Our current numbers are ephemeral and must change:** the POC uses
`28640`/`28641`/`28642`/`28643`/`28645`/`28650`. All inside the drop range. That is the bug
this decision closes.

## 3. The editable allow-list, in our field names

The previous implementation's rule, restated against our auction create payload
(`createContent`, `internal/poc/model.go:865-886`). The split is: **display is mutable; money,
time and cryptography are not.**

**Immutable after the root is published** — a later event that changes any of these is rejected:

- `auction_id` (the `d` value — the auction's identity; changing it is a different auction)
- `starting_bid` — the absolute floor; every bid is checked against it
- `min_increment` — the step rule
- `reserve` — the close-time winner gate
- `duration_seconds` — when the auction closes
- `late_bid_window_seconds` — anti-snipe window
- `late_bid_extension_seconds` — anti-snipe extension per late bid
- `max_total_extension_seconds` — the ceiling on total extension
- `locktime_seconds` — the final locktime a bid's mint lock must carry
- `funding_mode` — which money path a bid must use
- `seller_coco_payment_public_key` — where settlement pays

**Mutable** — may be edited freely, including *after* the first bid:

- `title`
- `description`
- `image_url`

Rationale, and it is the whole point of the mechanism: a typo in a title, a better photo, or a
clarified description must be fixable without detaching the bids already placed. Freezing only
the fields that decide *what is being sold, for how much, until when, and to whom it settles*
makes that safe.

## 4. The mechanism — and the one piece that is genuinely new

The port is faithful, with one addition. Three rules:

1. **Root pinning.** The **first** 1440 event for a given `(seller, d)` is the auction root. Its
   event id is `auction_root_event_id`, and clients/indexers MUST store it.
2. **Bids bind to the root, not to the latest version.** Every 1441 bid MUST carry
   `e = <auction_root_event_id>`. This is what makes edits non-destructive: a new auction event
   does not orphan the bids, because they never referenced the version that changed.
3. **Updates are supersessions, and the allow-list gates them.** A later 1440 event with the
   same `(seller, d)` and `e = <auction_root_event_id>` is accepted only if every immutable
   field above is unchanged. A change to any of them is rejected with
   `immutable_field_changed`, naming the field.

**What is NOT free in this range — the new work.** The previous implementation used kind
`30408`, which is *addressable* (`30000 <= n < 40000`): the relay itself replaces the older
version at the same `(kind, pubkey, d)`. Our 1440 is **regular**, so the relay stores every
version side by side and performs no replacement. Therefore the 1440 series needs an explicit
**"resolve to the latest accepted version"** rule that addressability used to provide for free:

- the canonical auction is the **latest** 1440 event for `(seller, d)`, by `created_at`,
  **that passes the immutable check**; an update failing the check is ignored, not applied.

Worth stating plainly, because it is easy to misread the previous implementation: **the
allow-list was never enforced by the relay.** Even with an addressable kind, the relay replaced
the event blindly — it does not inspect which tags changed. `AUCTIONS.md` says so itself:
*"Updates changing immutable fields MUST be rejected by clients/indexers."* So enforcement was
always client- and validator-side, and it stays that way. The only new requirement is the
explicit latest-version resolution above.

**Coordinate convention.** Since the relay gives us no addressability, define our own:
`a = 1440:<seller_pubkey>:<d>`. This mirrors the previous implementation's
`30408:<seller_pubkey>:<d>` and keeps `#a` filtering meaningful. State it explicitly rather than
implying NIP-01 addressable semantics that do not apply to a regular kind.

## 5. Relationship to the companion handover

- Kind **1445** is the validator-verdict kind specified in
  `HANDOVER-nostr-read-path-and-verdict-publish.md` §3.2(a). That document's proposed block
  (1443/1444/1445/1446) is hereby **confirmed** as the decision, and its ⚠️ about `1442`
  colliding with chat is **resolved**: we do not use 1442 at all.
- Verdicts remain **regular** kinds (1445) and keep the block-height + hash anchor. They are
  *not* replaceable; the previous implementation's `30440` was parameterised-replaceable, and
  if a lifecycle opinion (placed → won → settled) needs replacement semantics we must decide
  that separately, because the 1440 series does not give it for free any more than the create
  event does. **Flagged, not settled.**

## 6. What this supersedes

- The ephemeral POC kinds (`2864x`, `28650`) — replaced.
- NIP-15 kind adoption (`30020`/`1021`/`1022`) — examined, set aside. Recorded here so the
  analysis is not repeated: `stall_id` is a mandatory field we cannot fill (no stall concept),
  and `duration_extended` (time-extension soft close) contradicts a frozen `max_end_at`.
- The earlier proposal to use `1022` for verdicts — withdrawn in favour of a regular 1445.

## 7. Open items

1. Whether verdicts need replacement/lifecycle semantics (see §5) — decide before 1445 freezes.
2. Whether the app publishes `a = 1440:<seller>:<d>` or also keeps a `d`-only lookup path.
3. The `1447+` spares: reserve now, or leave unallocated.
