# HANDOVER — auctions, end to end, and the denomination defect (2026-11-19)

For an omp session picking up **all** of it: the phase threads, the bug just found, and the objective.
Written by the app-side session. Everything below was measured on this box today; nothing is inherited
from a summary without a check.

---

## 1. The objective

**A fully working auction in the Plebeian Market app, live on `playday.it`:** create → fund → bid →
outbid with automatic refund → in-window extension → close → verdict → settle → the seller and the
bidder each claim their ecash → the claim message carrying shipping details reaches the seller → the
seller's order and fulfilment surfaces show the winner. Every step **verified against the running chain,
mint and relay** — not merely in tests, and not from the app's own optimism.

The app is being built against a purpose-built arena chain (Cosmos-style consensus, four validators),
a Cashu mint and a Nostr relay, all live on this box.

---

## 2. Where everything lives

### Market (app) — `~/work/market` is the main checkout; never commit there
| Purpose | Path | Branch | Commit | Remote |
|---|---|---|---|---|
| **Canonical** ("finished" lands here) | (no worktree holds it) | `unite/1420-all` | `3000692b7` | — |
| **Integration / landing** | `~/work/wt-app-merge` | `d7s2/app-side-merge` | `ddabb0c1c` local, `7fb0e52ac` on both remotes | fork, nostr |
| Phase D (purchase projection) | `~/work/wt-app-orders` | `d7s2/app-orders` | `ab5e511d3` | fork, nostr ✓ |
| Phase F (state half: 1449/1450) | `~/work/wt-app-lotstate` | `d7s2/app-lot-state` | `8d65b26c8` | fork, nostr ✓ |
| Phase E (lifecycle e2e) | `~/work/wt-app-e` | `d7s2/app-lifecycle` | `9d35b6097` | **NOT pushed** |
| Typecheck work (uncommitted) | `~/work/wt-tsconfig` | `d7s2/tsconfig-projects` | **uncommitted** | — |
| Deployed app tree | `~/work/wt-e2e` | detached | `7fb0e52ac` | — |

Remotes: **`fork`** = `https://github.com/maxime-tt/market.git`, **`nostr`** =
`nostr://…/relay.ngit.dev/plebeian-market`. Push to **both** and read the SHA back from both. No
`origin` (it is a legacy alias of `nostr`). **Never push `upstream`** (PlebeianApp/PlebeianMarketV2Test,
which is the real project's repo — it is the definition of done, not a scratch remote).
`unite/1420-all` is advanced **only** by the union owner; the app lane lands on `d7s2/app-side-merge`.

### Chain — read-only from the app side
| Purpose | Path | State |
|---|---|---|
| Chain source | `~/work/wt-validator` | `feat/validator-workstreams` @ `998c7b6` |
| Deployed binary + root | `~/work/arena-merged-ref` | `bin/arena` sha256 `460bd5c9863a4ed4…`, 49,356,384 bytes |
| Chain docs (where the chain session reads) | `~/work/arena-merged-ref/docs/` | handovers + this defect note |

### Services (all active, systemd **user** units)
- `arena-chain.service` — 4 validators `127.0.0.1:7101-7104`, gateway `127.0.0.1:8090`, `-relay
  wss://relay.playday.it`, `-mint http://127.0.0.1:3338`. Logs: `~/work/arena-merged-ref/run/chain.log`,
  settle journal `~/work/arena-merged-ref/run/settle-journal.jsonl`.
- `auctions-demo-mint.service` — Nutshell 0.21.0, FakeWallet, loopback; log via
  `journalctl --user -u auctions-demo-mint.service`.
- `market-e2e.service` — serving `~/work/wt-e2e` as `https://market-e2e.playday.it`.

---

## 3. Phase threads — state, and what each one still owes

**A (chain: publish the money facts + instant refund) — DONE and deployed.** Kinds 1443 (refund) and 1444
(settle) are published, anchored like verdicts. Verified live.

**B (app: read the receipts) — DONE.** `platform/web/auctions/relay/arenaReceiptsRead.ts` + claims.

**C (app: claim the ecash) — DONE.** `arenaReceiptClaims.ts` claims the P2PK-locked receipt outputs into
the app wallet, at-most-once in persisted state `arena_receipt_claims_v1`. Proven live: `balanceBefore: 0
→ balanceAfter: 64`, and a second run claims nothing, naming `arena.claim.already_claimed`.

**D (app: a win is a purchase) — DONE, committed `264cdf9ea`, merged.** `platform/web/orders/
arenaPurchases.ts` projects one row per lot the buyer took part in, money facts from the receipts: a
`1444` = won-and-paid with its height, a `1443` = refunded, anything else = **"no receipt read"** (never
"unpaid"). Two bids on one lot = one row, the winning bid wins it. Rendered as an "Auction wins" table on
`/dashboard/account/your-purchases`.

**E (the lifecycle e2e) — BUILT, committed `9d35b6097`, and green from the wire up to the money step.**
`~/work/wt-app-e/scripts/auctions/live-lifecycle.test.ts` (plus `scripts/auctions/liveArenaHarness.ts`).
Opt-in: `AUCTIONS_LIVE=1 bun test scripts/auctions/live-lifecycle.test.ts`. Proven in a live run: create
committed, bidder A committed, bidder B committed, **A's refund read and A's wallet claimed it**, the
admission probe, **the anti-snipe extension asserted from kind 1449**, the lot closing with the right
winner, the verdict, and a refused create rendered from its kind 1450. **The settle step fails — caused by
the defect in §4, nothing else.** The test deliberately keeps that assertion failing and records the
defect as the cause; do not "fix" it by weakening the assertion.
Open question to resolve: its typecheck reads **186** against a canonical-tip baseline of **185** — confirm
that extra error's identity before landing E. (The parent session started that measurement; check
`$HOME/.hermes/profiles/maxime/cache/scratch/tsc-E.txt`.)

**F (app: read the chain's state half) — DONE, committed `8d65b26c8`, merged.** New reader
`platform/web/auctions/relay/arenaLotStateRead.ts` for **kind 1449** (`arena.lot.v1`: `auction_id,
end_time, original_end_time, extensions, height, block_hash`) and **kind 1450** (`arena.refused.v1`:
`event_id, kind, reason, height, block_hash`) with the receipts' discipline — signature, schema, mandatory
anchor, and the tag anchor required to **agree** with the content anchor, deduped at the earliest anchored
height. The lot's end is decided in **one** place (`auctionEndsAt`): committed end when a 1449 was read,
else the create-derived end, labelled as such; the countdown, the bid rules and the funding locktime floor
all follow from it. `extensions` is a **per-bid ordinal**, never a count of extensions. The create form
pre-flights against the rules the chain publishes in kind 1448. Verified live: all 336 events on the relay
parse; a refused listing renders **"the chain refused this listing: title required (max 120 chars)"**.
Two corrections my earlier handover got wrong, now recorded: there is **no** `Auction.OriginalEndTime` in
chain state (it is derived), and `extensions` is the per-bid ordinal.

**Typecheck work — COMPLETE but UNCOMMITTED** in `~/work/wt-tsconfig` (`d7s2/tsconfig-projects`):
`tsconfig.base.json` with `skipLibCheck: true` + `incremental: true`, the root `tsconfig.json` extending
it, and per-project configs `tsconfig.{src,tests,sdk,ui,platform,contextvm}.json`, each with its own
`tsBuildInfoFile` under `.tscache/` (already gitignored via the existing `*.tsbuildinfo` rule — verified),
plus seven `typecheck*` scripts in `package.json`. Rationale and the measured pain: 14,662 `.d.ts` files
under `node_modules`; 74 of the 185 baseline errors are third-party library internals (`@tanstack` 33,
`@nostr-dev-kit` 21, `react-use` 5) and 74 more live in test files; ~3 minutes on a quiet box, 30+ under
load. **`tsconfig.before.json` in that tree is a temporary A/B artifact — delete it before committing.**
Not done, deliberately: turning this into real Bun workspaces (a `package.json` per area). That is a much
larger change touching the build, deploy and CI, and it deserves its own increment.

---

## 4. THE DEFECT — validated: the app pre-signs outcome templates the mint can never honour

**Status: cause validated by an independent investigation and re-verified by the parent session. It is an
APP-side bug, on the money path, with a large blast radius. Not yet fixed.**

### What happens
Every bid's escrow carries pre-signed **outcome templates** (`settle` and `refund`). The app builds them
in `platform/web/auctions/relay/arenaBidFunding.ts`:

- `arenaSettleDestinations` — with no V4V split it returns **one destination carrying the whole amount**.
- `buildArenaOutcomeTemplate` — **one output per destination**, each created with
  `OutputData.createSingleP2PKData(…, destination.amount, keysetId)`.

A Cashu output must be a **single mint denomination** (this keyset: 1, 2, 4, …, 64, 128). The mint looks
the amount up in a dict — `private_key_amount = keyset.private_keys[output.amount]`
(`~/.mint-venv/.../cashu/mint/ledger.py:1740`) — so an amount that is not a denomination raises
immediately and **`POST /v1/swap` answers HTTP 400**, *before any signature is examined*.

**Consequence: an escrow whose template asks for an output of 80 (or 72, 100, 110 …) can never settle and
never refund.** The bidder's sats are locked forever; the seller is never paid. The chain retries the swap
every few seconds indefinitely.

### Evidence (all re-verified by the parent, not taken on faith)
- Committed state grouped by escrow proof count showed 12 stuck bids vs 19/13/10/1 settled — but **that
  correlation is an artefact**; the real rule is about amounts. (The parent session's earlier "exactly two
  proofs" claim was **wrong** and is retracted here.)
- From `~/work/arena-merged-ref/run/settle-journal.jsonl`: **70** completed entries, **0** of them with a
  non-denomination output amount; **764** failed attempts, **694** of them with a non-denomination output.
- From committed state: **36 of 55 bids** have an amount that is not a power of two — 100 (11 bids), 72
  (9), 110 (8), 80 (3), 115, 200, 250. **Every one of them can never settle or refund.**
- The mint's log line `ERROR | Exception: 80` **is** the KeyError, stringified — which is why it looked
  like a bare number. `/v1/checkstate` answers 200 for the same proofs, so the escrow is unspent; the swap
  is what is refused.
- Ruled out by measurement: the FROST group key (unchanged `03be47f12cc26f63…`, `params_version`
  `71ca57eb…` across all 500 params events read), the mint being down, a keyset rotation (the escrow's
  keyset `0102b930f4dc…` is active), and the signatures themselves (45/45 committee signatures verified
  offline; the mint never reaches them). The chain service restart at 10:50 today is a coincidence to
  ignore, not a lead.

### The fix
**App side (root cause — this lane):**
1. In `buildArenaOutcomeTemplate` / `arenaSettleDestinations`, **decompose each destination's amount into
   the mint's denominations**, producing multiple outputs (a 100-sat destination becomes 64 + 32 + 4). The
   denominations must come from the mint's keyset as the app already reads it — **never hardcoded**.
2. **Refuse at funding time** when an amount cannot be represented at all (an amount smaller than the
   smallest denomination, or a non-integer), *before* any sats are locked. Locking money the chain can
   never pay out is the worst failure mode this system has.
3. Add tests at the funding layer: a 100-sat and an 80-sat destination produce denomination-decomposed
   outputs; the template's inputs and outputs still reconcile to the amount; a V4V split still produces
   exactly one output per recipient (decomposed where needed).
4. Re-run the Phase E walk and confirm it reaches the settle, the seller's balance and the final claim.

**Chain side (companions, hand to the chain session — they are defences, not the fix):**
5. **Refuse at admission** a bid whose outcome template's output amounts are not all keys in the mint's
   keyset. A template the mint can never honour must never be admitted, let alone lock value.
6. **Log the refusal.** The chain builds `fmt.Errorf("mint swap: %s", r.Detail)` but nothing prints it; the
   mint prints only the amount. Both ends must record the HTTP status and body of a failed swap, and the
   settler should journal the named error beside the attempt.
7. **Make a persistent failure visible.** Retrying every few seconds forever with no escalation is how
   hundreds of sats sat locked with nobody noticing. At minimum, a counted health signal on the gateway.

### Housekeeping for the stuck money
At the time of writing: **12 bids, 888 sats** with a due outcome and no settlement (9 winners awaiting
settle, 3 losers awaiting refund), plus the admission-probe escrow. Lots involved are throwaway
`wsl-lifecycle-*` and `wsc-claim-*` test lots. **Decide explicitly** whether to backfill after the fix
(the same escrows will become spendable, since the template is what is wrong) or discard the test lots.

---

## 5. Constraints — these are hard

- **Never** touch `~/work/wt-union-1420` (a live session's tree), the chain repos from the app side
  (`~/work/wt-validator`, `~/work/arena-merged-ref`, `~/work/wt-chain-paramsfix`), or the market trees
  from the chain side. `~/work/wt-catalogue` is read-only (`git show`/`git diff` only).
- **Never run `arena init`.** It regenerates the FROST group key and silently strands every escrow the app
  has locked. Chain deploys replace the binary in place, keep `bin/arena.prev-<date>`, restart the unit,
  and prove the deploy from outside (height continues, root intact, schema strings present).
- **Never commit to `master`.** Never `git add -A` — explicit paths only.
- **Never weaken an existing assertion** to make a gate pass. A gate red for unrelated reasons is a finding
  to report.
- **Do not ask deployment questions during the dev phase** — deploy as part of finishing.
- No build/test logs under `/tmp` (it is a 3.9 GB tmpfs here and a truncated log gives a wrong baseline).
  Use `$TMPDIR` or `~/.hermes/profiles/maxime/cache/scratch/`.

## 6. Gates and baselines (on the canonical tip `3000692b7`, measured)

- `bun run test:unit` — **4996 pass / 2 fail**, and the two are **pre-existing, never ours**:
  `Platform dependency boundary > web code does not pull server modules into the browser bundle` and
  `deferred fixes stay honestly deferred (S1) > F4: the font-body/font-header consumers are recorded`.
- `bun test ui` — 1008 with the same F4 failure.
- `NODE_OPTIONS=--max-old-space-size=12288 bunx tsc --noEmit -p tsconfig.json` — **185**. Do not grow it.
  (`export PATH=$HOME/.bun/bin:$PATH` first; run it in the background — it takes ~3 min quiet, far longer
  under load.)
- `bash scripts/check-ui-assembler.sh` — exit 1 today, footprint **133** against a baseline of 138; **do
  not add a row**. `check-ui-styles.sh`, `check-src-boundary.sh`, `check-auctions-ndk-surface.sh` — all OK.
- Chain suite: `go test ./...` from `~/work/wt-validator/chain` with `ARENA_TEST_MINT=http://127.0.0.1:3338
  NAK_BINARY=$HOME/.local/bin/nak` — **178 pass / 0 fail** at `998c7b6`.

## 7. Suggested order for the omp session

1. **Fix the denomination defect (§4, items 1–4)** — it is upstream of everything else; until it lands, no
   auction can complete.
2. Re-run the **Phase E** walk and get the settle, the seller's balance, and the final claim green from the
   wire.
3. Push **`d7s2/app-lifecycle`** and merge it into `d7s2/app-side-merge`; push the integration branch
   (the defect note `ddabb0c1c` is committed locally but **not yet pushed**); redeploy `~/work/wt-e2e`;
   verify live.
4. Resolve E's **186-vs-185** typecheck question, then commit and land the **typecheck work** from
   `~/work/wt-tsconfig` (delete `tsconfig.before.json` first).
5. Hand the chain session the three companions in §4 (admission validation, logging, health signal), and
   decide the fate of the stuck escrows.
6. **Then my own promised step, still outstanding:** drive the whole walk **by hand in a browser** on
   `https://market-e2e.playday.it` — three identities (the header's `login-button` → PRIVATE KEY panel,
   which can **generate a new key**), funding from the wallet button (the mint is FakeWallet, so a fresh
   identity can fund itself) — create, bid, outbid, extension, close, verdict, settle, claim, claim
   message, seller's fulfilment view. The parent session had recon'd this fully and had not yet run it.
7. Finally, when the lane is genuinely done, the **union owner** advances `unite/1420-all` (the app lane
   never does).

## 8. Open decisions, flagged rather than decided

- **A refused bid is never committed** (owner ruling) — the chain discards it in `CheckTx` and publishes no
  1450 for it, so the app diagnoses from committed state plus the relay and **never invents a reason**.
  Measured nuance now recorded: **24 of 36 live 1450s name a kind-1441** — a bid refused **at delivery**
  *is* recorded and *is* shown with the chain's own words. The boundary is admission, not delivery.
  See `notes/DECISION-2026-11-18-refused-bids-are-not-committed.md`.
- **The observer note** (naming a refused bid's reason) is **deferred, not rejected**. Two constraints
  recorded: it cannot be ephemeral on this relay (measured three ways — `mute: no one was listening for
  this`, nothing stored, while a stored kind is delivered fine), and it must be an observation, never an
  authority.
- **Fulfilment has no protocol home.** Working assumption: the claim message stays an app convention
  (NIP-59 DM) with no protocol kind.
- **The typecheck workspace restructure** (§3) is a real monorepo question and needs its own plan.
- **Ephemeral events**: the relay drops them. Nobody has fixed that; the clock design does not need them.

## 9. Evidence index

- The defect note: `notes/DEFECT-2026-11-19-two-proof-escrows-never-settle.md` (also in
  `~/work/arena-merged-ref/docs/` and `~/work/wt-validator/docs/` — **its title says "two-proof", which is
  the retracted reading; read §4 of this handover for the validated cause**).
- Chain delivery: `~/work/wt-validator/docs/CHAIN-STATE-HALF-2026-11-18-RESULT.md` (§4 raw 1449/1450 events,
  §5 the shape corrections), `MONEY-RECEIPTS-2026-11-18-RESULT.md`, `VALIDATOR-WORKSTREAMS-2026-11-17-RESULT.md`.
- App plan of record: `notes/PLAN-2026-11-18-to-full-e2e.md`.
- Live-check notes: `notes/RESULT-2026-11-17-app-side-lane.md`, `notes/REVIEW-2026-11-17-validator-workstreams.md`,
  `notes/NOTE-2026-11-17-validator-branch-deployed.md`.
- Scratch (this box only): `~/.hermes/profiles/maxime/cache/scratch/` — `chain-state-now.json` (committed
  state at 11:23 UTC), `probe/` (the investigator's verification scripts and boundary test),
  `tsc-*.txt` (typecheck runs, including `tsc-canon-before.txt` = the 185 baseline).

## 10. What I would not claim

- The **mechanism inside the chain** that makes some other amounts fail is not explained beyond the
  denomination rule; the rule is measured, the mechanism is the mint's dict lookup — verified at the exact
  line, so the confidence is high.
- The **12 stuck bids / 888 sats** figure is a point-in-time reading (11:23 UTC); re-measure before acting.
- Phase E's **186 typecheck** is unexplained and must be identified, not waved through.
- Nothing here has been verified in a browser by a human-equivalent walk yet — that is item 6 above, and it
  is the step that turns "the wire says so" into "the product works".
