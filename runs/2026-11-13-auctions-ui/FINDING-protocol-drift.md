# FINDING — stream B's protocol integration against the consolidated protocol

Verified 2026-11-13 by the orchestrator, before dispatching any implementation, against
`notes/HANDOVER-consolidated-auction-client.md` and `/home/admin_maxime/work/auctions-simplify/MERGED-PROTOCOL-SPEC.md`.
The handover's own rule applies: **the client reference implementation
(`web/src/lib/arena.js` on the fork's `feat/auctions-merged-protocol`, built on `3b83d33`) beats the
documents where they disagree.**

## Break 1 — the immutable field list shares ZERO field names with the protocol

`platform/web/auctions/relay/arenaAuctionRead.ts:176` (branch `d7s2/auctions-read-adapter`) enforces:

```
auction_id, starting_bid, min_increment, reserve, duration_seconds,
late_bid_window_seconds, late_bid_extension_seconds, max_total_extension_seconds,
locktime_seconds, funding_mode, seller_coco_payment_public_key
```

The consolidated protocol's immutable set is:

```
startPrice, minIncrement, mode, windowSec, durationSec, sellerWallet, v4vSplit
        (mutable: title, description, image)
```

**No field name appears in both lists.** So the gate checks fields that no longer exist — a no-op —
and **misses the fields that must not change**. Concretely, the following supersessions are currently
**accepted by our reader while the protocol refuses them**:

- `mode` flipped from `fixed` to `antisnipe`;
- **`sellerWallet` changed** — the payout destination;
- the **V4V split** altered.

This is security-relevant rather than cosmetic: two of the three change where money goes. The
enforcement point is the read gate, so a client reading only the relay would show a canonical auction
the protocol considers invalid.

## Break 2 — our bid attaches no funding payload, and misclassifies what is missing

`platform/web/auctions/relay/arenaBidPublish.ts` (branch `d7s2/auction-bid`) states in its own header
comment that it attaches **no** funding payload, and calls the `reservation` / `cashu_lock` /
`outcome_templates` / `sigall_deposit` extensions *"part of the retired bidder-held path and funding
modes this slice does not implement."*

**That classification is wrong for the consolidated protocol.** A valid bid now requires:

- the money as Cashu proofs locked with a **2-of-2 NUT-11 P2PK** condition: `data` = bidder's wallet
  key, `pubkeys` = `[committee]`, `n_sigs` = 2, one `refund` = bidder's wallet key, `sigflag` =
  `SIG_ALL`, plus a `locktime` — **exactly five tags, canonical order**; a 1-of-1 lock, an `n_sigs` of
  1, a lock with no `pubkeys`, or a six-tag lock is refused **by name**;
- **`outcome_templates`**: a `settle` and a `refund` template **pre-signed by the bidder's WALLET key**
  over each template's digest — *"If the bidder does not pre-sign, the bid is refused"*;
- a `nonce` of **32 bytes of lowercase hex** (a readable nonce is refused);
- a `locktime` at or above the protocol's floor (the lot's current `EndAt`, or `now + windowSec` for a
  late antisnipe bid);
- `e` = the auction **ROOT**.

So **the bids this flow produces today would be refused by the validator.**

**The distinction that matters:** the retired thing was the *bidder-held* path. The new thing is a
**committee co-signed lock whose two possible destinations the bidder fixes at bid time**. Those
pre-signed templates are the core of the design, not an optional extra — which makes the stale comment
itself the evidence that this module predates the consolidation.

Also required and worth stating: **the Nostr identity is the authorization layer and the wallet owns
value and holds its own spend key — never derive one key from the other.** The bidder signs the bid
with its Nostr key and moves money with its wallet key.

## Already aligned (checked, not assumed)

- **Kinds** `1440` create / `1441` bid / `1445` outcome / `1447` commitment, all **regular** — matches
  the handover, including the reason (an ephemeral event is dropped by a relay with no live
  subscriber).
- **The verdict reader enforces the anchor**: `arenaAuctionRead.ts` refuses an unanchored event
  (`arena.unanchored`, "missing anchor") and reports `verdictDivergence` per validator — both required
  by the handover.
- **The client reads `/api/config`** for the committee key (`platform/web/auctions/protocol/client.ts:78`
  carries `committee_public_key`; `:104` documents `GET /api/config`), which the handover requires
  instead of hardcoding.

## Still to verify — delegated, not assumed

- the **schema string** (`arena.verdict.v1`?) and the **outcome vocabulary**
  (`winner` / `reserve_not_met` / `cancelled` / `aborted`) our reader expects, since it has an
  `arena.bad_schema` refusal that could be refusing the wrong thing;
- the **roster `p` tag** carrying the validator's own pubkey;
- the **append-only, latest-per-validator** rule;
- **whether this app can pre-sign a template digest at all** — the wallet key must exist for that, and
  if the capability is absent the bid-funding slice cannot be completed as specified.

## Dead integration on master, part of the retired implementation

The app's server still exposes a proxy to a path the consolidated protocol no longer serves:
`platform/server/http/auctionsProtocol.ts:34` (`AUCTIONS_RESERVATION_PATH = '/api/demo/reservation'`)
forwarding at `:94`, wired into the server at `buildServer.ts:12`; and the old protocol client posts to
it at `platform/web/auctions/protocol/client.ts:241`. The handover says `/api/demo/*` is gone, and
`/api/release` 404s. **These belong to the retired 30408 implementation**, so they should be removed
with it in stage 5 rather than patched — and until then the app carries an endpoint that cannot
succeed upstream.

## What was dispatched in response

Three slices, in parallel: the **read realignment** (field sets, the `(seller, d)` supersession rule,
the verdict reader), the **bid funding payload** (the lock, the pre-signed templates, the nonce and the
locktime floor — with an explicit instruction to assess feasibility and stop and report rather than
fake a signature), and **stream A's increment 1** (independent of all of this).
