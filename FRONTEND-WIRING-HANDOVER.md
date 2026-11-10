# HANDOVER — wiring a front-end to the auctions backend

Read this whole file before touching anything. It is a **reference**, not a ticket:
it tells you what the backend exposes today, the exact sequence a bid must follow,
and the traps that cost this programme real time. Nothing here asks you to modify
the backend repository.

## 0. The boundary (read first)

- The backend lives at **`/home/admin_maxime/work/auctions-simplify`** and is
  **owned by another session**. Do not edit it, do not commit in it, do not push
  from it. Your work goes in your own tree (`/home/admin_maxime/work/market`).
- **Never restart or stop `auctions-mvp-demo.service`**, and never run
  `poc init` or `start-demo.sh`: those write the demo network root and one of them
  wipes the chain. A restart shows the humans 502s and a momentarily empty page.
- Never push to `PlebeianApp/market`. Fork and hand off.
- The value is **fake sats** (`FAKE_MONEY_ONLY`). Say so in any UI you build.

## 1. What the backend is

A CometBFT application (4 validators, loopback, 1s blocks) that orders signed
**Nostr events** into committed auction state. Two ways in, and they are not
equivalent:

- **HTTP** — `POST /api/event` with the **bare signed Nostr event** (not an
  envelope; the decoder uses `DisallowUnknownFields`, so
  `{"version":…,"type":"event",…}` is a `400 unknown field "version"`).
- **Relay** — publish the same event to the demo relay
  (`nak serve`, `ws://127.0.0.1:7777`); an observer commits it.

Use the relay for anything a real client publishes. **Subscribe before you
publish**: the kinds sit in the NIP-01 ephemeral range and the relay is in
memory, so an event published while nobody is listening is simply gone.

Reads:

- `GET /api/state` — the authoritative committed state. Fields live under
  **`state`** (the reply is `{app_hash, canonical_state, state, wallet}`), so
  `view.height` is `null` while `view.state.height` is correct.
- `GET /api/config` — chain id, committee public key, cashu mint URL, funding
  mode, the recovery window and the network **ceilings** (below).
- `GET /api/validators` — four slots with `commit_signatures`.

## 2. The event kinds — and the one that fails silently

`KindCreate = 28640`, `KindBid = 28641`, `KindRefund = 28642`, and the
application-authority outcome record `28645`.

Publishing a create as the marketplace's own `30408` listing kind is stored by
the relay, reported as `success`, and then **never committed** — the observer
transports only the auction kinds, and no error anywhere names the kind. Check
the kind constant first when an event vanishes.

## 3. Time is block time

Deadlines, the anti-sniping extension and the late window all evaluate against
**committed block time**. `CheckTx` substitutes the last consensus time. So:

- Poll `last_consensus_time` / `end_time` from `/api/state`; do not compute
  deadlines from the browser clock, and do not sleep a fixed duration before
  expecting a close.
- A bid inside the late window pushes `end_time` out. Recent code makes the
  **auction** own those numbers (see §5), so read them off the auction.

## 4. Funding mode: `cashu_sigall_v1` is what the demo runs

A mint-backed bid locks **real Cashu proofs** to a 2-of-2 NUT-11 `SIG_ALL`
condition (bidder + committee), and the bidder publishes **two pre-signed
outcome transactions** with the bid so the coordinator can finish the auction
without the bidder online.

The bidder holds the funds; the coordinator holds the locked proofs from bid to
outcome and can send them **only** to the destination the bidder pre-authorized
(the `SIG_ALL` signature covers the outputs). The browser wallet is the bundled
`cashu-ts` at `/wallet.js`, exposing
`window.PlebeianWallet = { BidderWallet, browserStorage, memoryStorage,
refundClaimMessage, refundClaimMessageV2 }`.

## 5. Per-auction timing (newest — do not hardcode these)

An auction now chooses its own anti-snipe timing, exactly as it chooses duration
and minimum increment. The network policy is only the **ceiling**.

Create content (`KindCreate`, kind 28640) accepts, in addition to
`auction_id`, `title`, `description`, `image_url`, `duration_seconds`,
`starting_bid`, `min_increment`, `reserve`, `funding_mode` and
`seller_coco_payment_public_key`:

| field | meaning |
|---|---|
| `late_bid_window_seconds` | how close to the end a bid counts as late; `0` disables anti-sniping |
| `late_bid_extension_seconds` | how far a late bid pushes the end |
| `max_total_extension_seconds` | cumulative extension ceiling **for this auction** |
| `locktime_seconds` | optional explicit locktime; omit for the derived floor |

All four are **optional**: omitted means "take the network's value". Each is
refused at create if it exceeds the matching network ceiling, and the refusal
names the ceiling. `late_bid_extension_seconds` must not exceed
`max_total_extension_seconds`.

The auction exposes a derived, read-only **`required_locktime`**: the locktime a
mint lock must carry so it outlives the worst case this auction can reach
(`original_end_time + max_total_extension_seconds + recovery`). **Read it off the
auction; never compute a margin yourself** — the old page read the network
config, which is now only a ceiling and would lock the wrong value. A locktime
below the floor is refused by name; a longer one inside the band is accepted.

Anti-sniping semantics, so your UI does not mislead anyone: a late bid extends the
end to `bid_time + late_bid_extension_seconds`, capped at
`original_end + max_total_extension_seconds`. An extension **shorter than the time
remaining does nothing** — the auction is already longer than that. This is
correct, not a bug; a tester will report it as one.

## 6. A bid is a DELTA on the bidder's position

A mint-backed bid's `amount` is a **delta added to the bidder's existing
position** on that auction. Consequences your UI must not get wrong:

- First bid of 60 → position 60. A second bid of 65 by the same bidder →
  position **125**, not 65. The minimum the field should suggest is the position
  the bidder ends up with (`current leader + min_increment`), so for a bidder who
  is already leading you must show the **delta**, or state the resulting position
  next to the field. Getting this wrong produces "it bid more than I typed".
- A displaced bidder's position is 0, so their next bid is their whole new
  position and must clear `leader position + min_increment`, funded entirely from
  spendable sats. Collect the refund first, then bid.
- A bidder can never exit their own bid; a raise only adds legs. Every leg is
  returned at once when the whole position is outbid.
- The seller cannot bid on their own auction, and a bid below the minimum is
  refused **client-side with a toast** (not in the status line).

## 7. The bid sequence (the part that must be exact)

At bid time, in this order:

1. Build and sign the two outcome templates (settle to the seller's payout key,
   refund to the bidder's own wallet spend key).
2. `POST /api/demo/mint-lock` with the auction id, bidder, amount, **locktime =
   the auction's `required_locktime`**, the refund public key, the token digest,
   the proof-state refs, the proofs and `funding_mode: "cashu_sigall_v1"`. This
   returns the committee-signed lock receipt.
3. `POST /api/demo/sigall-deposit` with the two templates and that receipt. This
   stores the bearer templates durably and returns the coordinator's signed
   deposit receipt.
4. Sign the `KindBid` (28641) event carrying `auction_id`, `amount`,
   `cashu_lock` (the receipt), `outcome_templates` and `sigall_deposit`, and
   publish it.

The deposit is what makes the coordinator's automatic action fire. A bid that
skips it is inert: the sweep has nothing to submit. Return claims go through
`POST /api/demo/mint-refund`, which serves the parked payout whether the lock
reads `refundable` (swap now) or `refunded` (already done for an offline bidder).

## 8. Traps that cost this programme real time

- **The served wallet bundle is a build artifact.** `/wallet.js` is generated from
  `internal/poc/webwallet/src/*.ts`; editing the TypeScript changes nothing until
  the bundle is rebuilt with the project's own script. Keep the **IIFE wrapper**:
  `wallet.js` and `demo-signer.js` are both classic `<script>` bundles sharing one
  global scope, and an unwrapped wallet's top-level `P` is clobbered by
  `demo-signer.js`'s, which makes `hash_to_curve` reject all 65,536 candidates and
  reads as a mint failure AND a refund failure, in the browser only.
- **A control that flips on the refresh cadence** means two render paths disagree:
  one caller passed no data and a render helper defaulted to zero. Have the
  renderer derive its own state.
- **A render path that returns early while an input has focus** also skips the
  re-render after a successful action, leaving a button stuck at "Bidding…" and
  disabled. On a touch device focus does not leave the field when you tap the
  button, so a second bid becomes impossible.
- **A refusal can be a toast** while the status line still shows the previous
  success; read both.
- **Do not claim a behaviour the build does not have.** The honesty rules on this
  programme are treated as correctness: the page is the human approval surface,
  so an untrue sentence there is a defect. Name the library the page actually
  loads (it is `cashu-ts`, not "Coco"), and describe custody as it is — under this
  route the coordinator holds the locked proofs until the outcome.
- **A UI field derived from a producer's string is a false-negative trap.** If a
  surface decides "online/offline" or "refunded" from one field, check every code
  path that produces that field before reporting a bug.
- **Retest a browser-only failure in a fresh session** (and with `curl`) before
  calling it a product bug; long-lived sessions accumulate stale state.

## 9. What is verified, and what is not

Verified live, by driving the real API and a real browser: create → 2-of-2
`SIG_ALL` lock → deposit → bid → outbid with the whole position returned →
collect → re-bid; auction closes with the bidder offline and the coordinator
settles to the seller, who then spends the payout at the mint; no-bid close;
reserve-not-met returning the money; anti-sniping extension within the auction's
own cap; `window = 0` closing exactly at its duration; a window above the ceiling
refused by name.

Not done: FROST in place of the single committee key (the lock shape is
deliberately identical so the signer swaps behind a port), a real Lightning
backend behind the mint, and FIPS transport. Do not present any of those as
working.
