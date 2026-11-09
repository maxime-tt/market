# SLICE-D-BRIEF — per-auction timing policy and locktime

Owner decision: the auction chooses its own anti-snipe window, extension, cumulative
extension cap and final locktime, exactly as it already chooses duration and min
increment. The network policy stops being the value and becomes the CEILING.

This file is the frozen interface. Both workers code against these names and do not
edit each other's files.

## Frozen names

`Auction` (committed state, JSON) — three new configured fields plus one derived:

| field | json | meaning |
|---|---|---|
| LateBidWindow | `late_bid_window_seconds` | how close to the end a bid counts as late; `0` = no anti-snipe |
| LateBidExtension | `late_bid_extension_seconds` | how far a late bid pushes the end |
| MaxTotalExtension | `max_total_extension_seconds` | ceiling on cumulative extension for THIS auction |
| RequiredLocktime | `required_locktime` | DERIVED, read-only: the locktime a bid's mint lock must carry |

`createContent` (create event body) — four new OPTIONAL fields:
`late_bid_window_seconds`, `late_bid_extension_seconds`,
`max_total_extension_seconds`, `locktime_seconds` (explicit final locktime; omit
for the derived floor).

Derivation, one named helper in `model.go`, used by every call site:

```
func auctionRequiredLocktime(auction Auction) int64 {
    return auction.OriginalEndTime + auction.MaxTotalExtension + EmergencyRecoverySeconds
}
```

`EmergencyRecoverySeconds` stays a package constant. It is the recovery window
after the worst-case end, not an auction choice.

## Rules (pin each one with a test)

1. **Defaults.** An omitted field takes the matching policy value, so an auction
   that says nothing behaves exactly as today.
2. **Policy is the ceiling.** At create, `late_bid_window_seconds <= policy.LateBidWindow`,
   `late_bid_extension_seconds <= policy.LateBidExtension`,
   `max_total_extension_seconds <= policy.MaxTotalExtension`, and every one `>= 0`.
   A value above the ceiling is refused, naming the ceiling. The network must keep
   bounding the worst case.
3. **Internal coherence.** `late_bid_extension_seconds <= max_total_extension_seconds`.
4. **`window == 0` means no anti-sniping**: no bid extends the end, and the auction
   closes exactly at `end_time`. The extension branch must be guarded on `> 0`.
5. **Locktime floor.** `locktime_seconds`, when supplied, must be
   `>= auctionRequiredLocktime(auction)`; shorter is refused naming the floor,
   because a lock that expires before the auction can close leaves a winning bid
   with no backing. It must also be `<= floor + policy.MaxTotalExtension`.
   Omitted means exactly the floor.
6. **The extension reads the auction**, not the policy:
   `if auction.LateBidWindow > 0 && committedAt >= auction.EndTime-auction.LateBidWindow { candidate := committedAt + auction.LateBidExtension; capEnd := auction.OriginalEndTime + auction.MaxTotalExtension; ... }`
7. **The coordinator enforces the same floor**: `POST /api/demo/mint-lock` accepts a
   locktime at or above the AUCTION's floor (and within the band), not an exact
   equality against a policy constant. The refusal names the auction's floor.

## Worker split — do not touch the other's files

- **D1 (model + coordinator, `.go` only):** `internal/poc/model.go`,
  `internal/poc/demo_mint_lock.go`, `internal/poc/server.go`, their `_test.go` files.
  Owns: the struct fields, create validation, defaults, the extension site, the two
  locktime sites (`demoMintExpectedLocktime`, and the V4 rule near `model.go:1580`),
  and the API exposure of the auction's new values.
- **D2 (page + wallet, `static/*` and `webwallet/*` only):** `internal/poc/static/lab.html`,
  `internal/poc/static/lab.js`, `internal/poc/webwallet/src/*.ts`, then rebuild
  `internal/poc/static/wallet.js` with the project's own build script.
  Owns: the create form's four fields, and `locktimeFor(auction)` reading the
  AUCTION's `max_total_extension_seconds` + `required_locktime` instead of
  `state.config.max_total_extension_seconds`. Rebuild the bundle with
  `bun run build` — never hand-strip the IIFE wrapper.

Neither worker restarts the demo service, wipes the network, or commits. The parent
verifies, deploys and re-initialises.

## Definition of done

`go build ./...` and `go test ./...` green; every rule above pinned by a named test;
the bundle rebuilt; the parent then runs the live e2e: an auction with `window=0`
closing exactly at its duration, one extending inside its own cap, and a bid whose
lock is below the floor refused by name.
