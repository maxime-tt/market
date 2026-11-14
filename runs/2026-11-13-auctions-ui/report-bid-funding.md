# B — the bid's escrow payload (the write half's money)

Branch: `d7s2/arena-bid-funding`, off `df68b6f26` (the chain tip, union + 27).
Commit: **`b01ce21d6db396d6aa5254f708024bf96e07b5b3`** — pushed to **`fork` and `nostr`**, read back from both.
Worktree: `/home/admin_maxime/work/wt-arena-bid-fund`.

Answers `FINDING-protocol-drift.md` **break 2** and the fourth delegated question
("**whether this app can pre-sign a template digest at all**"). Built by a child
that died mid-iteration without writing a report; the parent finished it —
the root cause of its 26 red tests was one off-by-one — and re-measured everything.

## The feasibility question, answered by construction

**Yes.** The app holds a wallet spend key (`walletKeyMaterialCache`:
`walletPrivkey` / `walletP2pk`) and `@cashu/cashu-ts` exposes
`schnorrSignDigest`, so the bidder can pre-sign its two outcome templates over
each template's digest. `walletOps.getAuctionBidWalletSigner()` exposes the key as
a **signing surface that can sign a 32-byte digest and nothing else** — the
funding module never sees the private key — and it answers `null` until the key
migration has produced the pair, so a caller has to refuse the bid rather than
invent a key.

The rule the whole design rests on holds in the code: **the event is signed by the
Nostr identity, the templates by the wallet key, and neither is derived from the
other.**

## Files

```
platform/web/auctions/relay/arenaBidFunding.ts        (644, new)
platform/web/auctions/relay/arenaBidFunding.test.ts   (481+, new)
platform/web/auctions/relay/arenaBidEscrow.ts         (104, new)
platform/web/auctions/relay/arenaBidPublish.ts        (+106)
platform/web/auctions/relay/arenaBidPublish.test.ts
platform/web/auctions/relay/AuctionBidHost.tsx
platform/web/wallet/walletOps.ts                      (+35)
```

## What it enforces

- **The escrow lock**: exactly **five** tags in canonical order — `locktime`,
  `pubkeys` (the committee), `n_sigs` `2`, `refund` (the bidder's wallet),
  `sigflag` `SIG_ALL` — over a `P2PK` condition whose `data` is the bidder's wallet
  key. A one-of-one lock, an `n_sigs` of 1, a lock with no `pubkeys`, a six-tag
  lock, a readable or uppercase nonce, a non-canonical (re-marshalled, escaped,
  padded) secret, and a `locktime` below the floor are **each refused by name**.
- **One identical lock across every proof** — a bid whose proofs disagree about
  their condition is refused, which is what makes the lock one escrow.
- **The two outcome templates**: `settle` (the seller, plus the committed V4V
  split) and `refund` (the bidder's wallet), each pre-signed BIP-340 over its own
  digest. A template whose inputs are not the committed proofs, whose digest
  moved, whose inputs are not the escrow's, that pays a split recipient on the
  refund side, that re-locks the escrow back to the committee, or that is simply
  **not signed by the bidder**, is refused.
- **`arenaSigAllDigest` is pinned to the reference chain's own golden vector**
  (`chain/sigall.go` `sigAllGoldenDigest`, exported as
  `ARENA_SIGALL_GOLDEN_DIGEST`), so client and validator are proven to agree on
  layout B before any bid exists.
- **The publish path refuses an unfunded bid** (`bid.unfunded`), re-checks the
  payload against the auction's own terms (`bid.funding-invalid`), and requires the
  escrow total to equal the amount the bid names. The 1441 content now carries the
  coordinate, the wallet key, the proofs and the templates.
- The old header comment that called the funding payload "part of the retired
  bidder-held path" is **gone** — it was the opposite of the truth, and it was the
  evidence the module predated the consolidation.

## Evidence

| command | result |
|---|---|
| `bun test --isolate platform/web/auctions/ platform/web/wallet/` | **520 pass, 1 skip, 0 fail**, 1306 expect() calls, 31 files |
| `tsc --noEmit` | **205**, the baseline at `df68b6f26`; 0 errors in any file this slice touches |
| before/after | the slice arrived with **26 red tests** in its own suite and **10 new type errors** (215) |

## Fixed in review, each measured

1. **One off-by-one, 26 red tests.** `parseArenaEscrowLock` destructured the five
   tags as `[pubkeys, n_sigs, refund, sigflag] = tags`, so the `locktime` tag was
   read as the committee key and every valid lock was refused
   `lock.pubkeys-not-committee`. Fixed to skip the first tag; 26 → 13.
2. **A `never`-returning helper needed an explicit annotation.** `refuse` was an
   inferred-`never` arrow function, and TypeScript only narrows control flow after
   a call whose declaration carries an explicit type — so every
   `if (bad) refuse(…)` left the value unnarrowed (5 errors). Annotated: 215 → 206.
3. **The 13 remaining reds were the honest consequence of the new requirement.**
   Making funding mandatory broke every pre-existing publish test that bid without
   escrow. They now build a **real** escrow (the pinned cashu-ts output builder, a
   real BIP-340 signature by the wallet key) for the amount each test bids, and
   three new refusals are asserted: unfunded, escrow ≠ amount, funding checked
   against other terms. 206 → 205, and 0 fail.
4. A debug `console.error('DBG', …)` left in the parser is gone.

## What is NOT done — the honest boundary

**This host does not yet obtain the payload.** `AuctionBidHost.tsx` passes
`funding: null`, so a bid placed from the UI is refused by name
(`bid.unfunded`) and the panel says so. **A funded bid cannot yet be placed in the
app.** Closing it needs three things, named here so the next slice does not have to
rediscover them:

1. **The mint-side escrow send** — a Cashu send that writes the 2-of-2 condition.
   The app's existing `auctionFunds` lock is the **retired** 30408 path (it is what
   stage 5 deletes); it does not produce this condition.
2. **The committee key** from `GET /api/config`.
3. **The auction's own terms** — `sellerWallet`, `v4vSplit`, and the end+window
   locktime floor — which `ArenaAuctionDetailModel` still exposes under the retired
   names. Same gap the read report records; the detail model is the next increment
   on this path.

Nothing here is deployed.
