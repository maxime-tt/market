# MVP: real Cashu sats, end to end, no FROST

Branch `maxime/auctions-mvp-simplify`, HEAD `5edc0b0ce` (working tree dirty, see S0).

## The MVP in one paragraph

A bidder opens `https://auctions.playday.it`, mints real (FakeWallet) sats from
`https://mint.playday.it` into their own browser wallet, locks them with NUT-11 to the
demo committee key, and bids with a Nostr-signed event carrying only proof references
and DLEQ bindings. If outbid, the same browser gets fresh proofs back **at the moment
the displacement commits**, not at locktime. If they win, the seller's browser receives
fresh proofs locked to the seller's own Nostr key. Both terminal moves are one
cooperative spend: the browser hands over the locked proofs, the coordinator checks
them against committed state, signs the NUT-11 witness with the committee key, and
swaps at the mint. Four CometBFT validators, deterministic state, no FROST anywhere.

### Deliberately not in this MVP

- [ ] No FROST, no DKG, no threshold signer, no R20/`threshold_sigall_v1` path.
- [ ] No FIPS transport, no mesh, no relays, no NIP-60/NIP-61 wallet sync.
- [ ] No real Lightning: FakeWallet mint, worthless sats, `FAKE_MONEY_ONLY` stays.
- [ ] No custody between requests, no new auction mechanics, no fee model, no
  dispute path, no multi-mint.

## Baseline corrections (verified today; they change the slice order)

- [x] **CORS is already fixed.** `/etc/caddy/Caddyfile:240-259` sets one
  `Access-Control-Allow-Origin` and strips the upstream copy
  (`header_down -Access-Control-Allow-Origin`). `curl -D -` against
  `https://mint.playday.it/v1/checkstate` and `/v1/info` returns exactly one ACAO
  header. The "Failed to fetch" cause must be re-tested, not rebuilt.
- [x] **The issuance canary is already removed in the working tree**, uncommitted:
  `app.go`, `mintclient.go`, `demo_mint_lock.go`, `server.go`, `cashu_lock_test.go`
  (5 files, −285/+71). `go build ./...` is green on that tree. HEAD still has the
  canary; the live binary (built 14:20) still contains the refusal string.
- [x] **The bundle is stale in both places.** `internal/poc/static/wallet.js` and the
  served copy are byte-identical (382864 bytes), contain zero `lockedUntil`, while
  `webwallet/src/wallet.ts:246,265` define it.
- [x] **Live double-credit bug.** `applyRefund` (`model.go:1761`) never checks
  `bid.CashuTokenSHA256`, so a displaced mint-backed bidder can post `KindRefund`
  (28642) and receive a legacy signed note for the same amount while still holding
  the proofs. S2 must close this.

## Slices

### S0 — Make the current tree the baseline

- [ ] Commit the working-tree canary removal as one commit.
- [ ] Rebuild the bundle: `cd internal/poc/webwallet && /home/admin_maxime/.bun/bin/bun build src/browser.ts --target=browser --format=iife --outfile=../static/wallet.js`.
- [ ] Do **not** touch `model.go`, consensus validation, or the Caddyfile.
- [ ] Accept: `export PATH="$HOME/.local/go/bin:$PATH"; GOWORK=off GOTOOLCHAIN=local go build ./...` and `go test ./internal/poc/` green; `grep -c lockedUntil internal/poc/static/wallet.js` ≥ 1; in the browser, Mint 500 → balance 500, no `wallet.lockedUntil is not a function`, Reclaim reports a real locktime instead of throwing.
- [ ] Rollback: `git checkout --` the five Go files and `internal/poc/static/wallet.js`.

### S1 — The locktime rule

`static/app.js:574` uses `end_time + 600`, but `end_time` can be pushed to
`original_end_time + 1800` (`model.go:1186-1195`), so a lock can expire while the
auction is still live: the bidder reclaims and the leading bid has no backing. Since
the committee keeps its authority after locktime (audit addendum C), a short locktime
buys the bidder nothing and costs the auction its collateral.

- [ ] `app.js:574` → `original_end_time + max_total_extension + emergency_recovery`,
  read from `/api/config` (add `max_total_extension_seconds` and
  `emergency_recovery_seconds` in `server.go:451-487`), not hardcoded.
- [ ] `demo_mint_lock.go:138` → require exactly
  `OriginalEndTime + Policy.MaxTotalExtension + EmergencyRecoverySeconds`, matching
  the V4 rule at `model.go:1318`. This is off-chain, so tightening is safe.
- [ ] Leave `model.go:1600` alone: `[end_time, end_time+3600]` already admits
  `original_end+2700` for every reachable `end_time`.
- [ ] Accept: place a bid; in `/api/state` the `cashu_locks[...].locktime` equals
  `original_end_time + 2700`; after a late-bid extension, `locktime - end_time` is
  still ≥ 900.
- [ ] Rollback: revert the two files; old receipts stay valid (the window only widened).

### S2 — Refund at the moment of being outbid

- [ ] New `internal/poc/demo_mint_spend.go`, route `POST /api/demo/mint-refund`
  next to `server.go:327`, legacy-loopback gated like `demoMintLock`.
- [ ] `model.go` `applyRefund`: if the bid has `CashuTokenSHA256 != ""`, set
  `lock.Status = "refunded"` and issue **no** note. Closes the double-credit bug.
- [ ] `app.js`: after `refresh()`, for each own bid whose lock is `refundable` and
  whose proofs are still in `localStorage.locked`, call the endpoint, import the
  returned proofs into `spendable`, then submit the signed `KindRefund` event.
- [ ] Accept: A bids 100, B bids 200. Within one refresh A's spendable balance is
  back to its pre-bid value, `/api/state` shows A's lock `refunded`, the mint reports
  A's old `Y`s `SPENT` and the new ones `UNSPENT`, and A's wallet can spend them.
- [ ] Rollback: remove the route and file, revert the `applyRefund` branch; locks
  already `refunded` stay refunded, no value moves back.
### S3 — Seller settlement at close

- [ ] Same file, `POST /api/demo/mint-settle`. `applyClose` (`model.go:1724-1731`)
  stays as is; the money move is off-chain, the state change is a new event.
- [ ] Add `KindSettle = 28643` (`model.go:25-27`) and a `case` in `applyEvent`
  (`model.go:925`) that only accepts a `cashu_lock_v1` winner lock in
  `winner_selected` and sets `lock.Status = "paid"`. New `Lock` field
  `CashuPayoutTokenSHA256 string \`json:"cashu_payout_token_sha256,omitempty"\``.
- [ ] `app.js`: the winner's browser calls the endpoint on refresh when it sees its
  own lock `winner_selected`, then submits the signed `KindSettle` event.
- [ ] Accept: A wins at 100; A refreshes; the seller's wallet shows +100 spendable;
  mint: A's old `Y`s `SPENT`, seller's new proofs `UNSPENT`; `/api/state` lock `paid`.
- [ ] Rollback: remove route, kind and case. A `paid` lock is terminal; do not
  attempt to reverse a completed swap.
### S4 — Say only what is true

- [ ] `index.html:20` "certified outbid returns" → "outbid returns, paid the moment
  you are displaced" (true only after S2).
- [ ] `index.html:34` "The browser automatically imports certified terminal returns
  when available." → "When you are outbid, this browser swaps your locked proofs back
  to your own key and imports them." (after S2).
- [ ] `index.html:52` "New auctions register one bounded payout authorization when
  created, so bidders do not need later seller approval." → delete. It describes the
  R20 path, which this deployment does not run (`browser_threshold_*_ready: false`).
- [ ] `/api/config` `payment_attestation` (`server.go:442`): drop "the mint enforces
  non-double-spend at settlement" until S3 lands, then say "the coordinator swaps the
  winning lock to the seller's key at close; the mint enforces the NUT-11 condition".
  `bid_funding` (`server.go:444`): drop "or an attested custodial reservation on
  auctions that ask for one" once no live auction uses it.
- [ ] The DLEQ sentence: keep "the mint returned no DLEQ proof, so the locked value
  cannot be proven" (`wallet.ts:230`) — it is true — but stop implying admission
  re-checks it. Admission checks NUT-07 only; DLEQ is checked by the coordinator
  before it signs (`demo_mint_lock.go:187`).
- [ ] Accept: `curl -s https://auctions.playday.it/api/config | grep -i attestation`
  matches the new text; no page string promises a mechanism that is not in the build.
- [ ] Rollback: revert the strings; they carry no state.

## The cooperative spend (one primitive, two modes)

**Browser sends** `POST /api/demo/mint-{refund,settle}` with
`{bid_id | auction_id, proofs: [{amount, id, secret, C}], event: <signed Nostr event>}`.
The event is the authorization: `KindRefund` or `KindSettle`, `pubkey` must equal the
lock's bidder, signature verified with the same code path as `/api/event`.

**Coordinator verifies against committed state, in this order, before signing:**

- [ ] the event signature and `event.pubkey == lock.Bidder`;
- [ ] `lock.Status` is `refundable` (refund) or `winner_selected` and
  `auction.Winner == lock.Bidder` (settle);
- [ ] every `secret` hashes to a `Y` in `receipt.ProofStateRefs`, and the submitted
  set equals that set exactly — this is what binds the proofs to the committed bid;
- [ ] `sum(amount) >= lock.Amount`;
- [ ] the mint answers `UNSPENT` for every `Y` (NUT-07, `mintclient.go:168`).

**Coordinator signs** the NUT-11 `SIG_INPUTS` witness with `server.demoCommitteeKey`
over the concatenated input secrets, exactly as the audit script did
(`audit-spend/audit_spend.py`, verified 200 against the live mint).

**Coordinator broadcasts** `POST /v1/swap` to `mintTransportOrigin(...)`, not the
public origin (`mintclient.go:54`), with outputs it builds itself:

- refund → fresh proofs P2PK-locked to `02||bidder_npub`, no locktime;
- settle → fresh proofs P2PK-locked to `02||auction.Seller`, no locktime.

**Where the value goes:** refund proofs are returned in the HTTP response and imported
by the bidder's own wallet; settlement proofs are returned and imported by the
seller's browser, which holds the matching Nostr key. The coordinator persists neither.

**Trust consequence, stated plainly.** The NUT-11 lock gives the committee the
*authority* to spend but not the *material*: only the bidder holds the secrets. This
endpoint hands the coordinator the material for one request, on an already-terminal
lock. That is a real increase in power — a malicious coordinator could swap to its own
key. It is bounded (one request, outputs visible in the response) but not zero.

**Stricter alternative.** The browser builds the outputs and broadcasts the swap; the
coordinator only returns a witness signature over the input secrets and never sees the
new proofs. Strictly better for refunds, where the bidder is the beneficiary and can
redirect only to themselves. It cannot work for settlement, where the coordinator must
control the outputs to guarantee they are locked to the seller.

**Recommendation:** ship coordinator-broadcasts for both modes — one code path, and
settlement needs it anyway. Move refunds to witness-only next, once the flow works.

## Risks

- **The winner can walk away.** After locktime the winner may reclaim instead of
  paying; the committee's authority does not stop them, it only coexists. With
  `original_end+2700` the seller has ~15-45 minutes after close to be paid. Without
  FROST there is no way to remove this; it must be labelled, not hidden.
- **Settlement needs the winner online.** The proofs live in the winner's browser. If
  they close the tab, the seller waits until they return. This is the MVP's central
  limitation and the honest reason a threshold signer exists.
- **Split brain between mint and chain.** A swap can succeed while the `KindRefund`/
  `KindSettle` event never lands. The mint is the money truth; consensus state is a
  mirror. Retries must treat `SPENT` as "already done", not as an error.
- **Mint outage at the terminal moment** blocks both branches; fail closed and say so.
- **State replay.** Any new `State`/`Lock` field must be `omitempty`, and `Clone` +
  `omitempty` yields nil maps unless `ensureMaps` runs.
- **Never tighten application validation.** Already-committed transactions replay
  through the same code; a new refusal forks the chain. S1's coordinator check is
  off-chain and safe; nothing in S2/S3 may add a consensus refusal.

## Stop and ask the owner

- [ ] If "the seller gets paid" is expected to hold when the winner is offline — that
  requires custody or FROST, both excluded here.
- [ ] If the coordinator may hold a bearer proof between requests (it would make
  settlement unconditional, and it is a different product).
- [ ] If any fix appears to need a tighter consensus check, or a state field without
  `omitempty`.
- [ ] If the demo must move to real Lightning or a public mint.
- [ ] If the winner-reclaim window is judged unacceptable for a live demo.

## Standing owner ruling (2026-11-07) — no backwards compatibility, ever

Nothing already committed to the chain, the relay or the mint is worth conserving. The
demo is disposable: the owner will wipe and re-initialise the network rather than carry
migration code. Therefore:

- No compatibility paths for old lock shapes, old receipts, old auctions or old chains.
  One shape, one verification path.
- Re-initialising the network/mint is the default answer to a schema change, not a
  last resort.
- Backwards compatibility is never an acceptable reason to add code to this project.
