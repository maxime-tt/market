# CHAIN COMPANIONS + STUCK-ESCROW DECISION BRIEF (2026-11-19)

For the chain session (the three defensive asks from handover §4 items 5–7) and, in Part 2, the
measured decision brief on the escrows that the denomination defect has stranded. Everything here
was re-measured today from the running chain, the settler's own journal and the living mint; the
chain trees (`~/work/wt-validator`, `~/work/arena-merged-ref`) and every other tree were read only.

**Snapshot this note is built from (all times UTC, 2026-11-19):**

| Read | Command | Result |
|---|---|---|
| chain state | `curl -s -m 30 http://127.0.0.1:8090/api/state -o state-now.json` (12:06:15) | height **2966**, 50 auctions, 64 bids |
| settler journal | `wc -l ~/work/arena-merged-ref/run/settle-journal.jsonl` (12:11:34) | **871** lines: **70** completed, **801** failed |
| mint verdicts | `POST http://127.0.0.1:3338/v1/checkstate` (`Ys` = `hash_to_curve(secret)`, NUT-07) | each stuck escrow: `UNSPENT` |
| mint errors | `journalctl --user -u auctions-demo-mint.service` | `ERROR \| Exception: 80` then `POST /v1/swap HTTP/1.1 400` |

---

# Part 1 — three companion asks for the chain session

All three are small and local to code that already exists. They are defences, not the fix: the fix
is app-side (decompose each destination's amount into the mint's denominations, never hardcode them,
and refuse at funding time when an amount cannot be represented).

## (a) Refuse at admission a template whose output amounts are not keys in the pinned keyset

**Rule to add.** In the CONSENSUS admission check for a bid's outcome templates,
`verifySigAllBidTemplates` (`chain/sigall.go:327`), inside the amount-conservation loop
(`chain/sigall.go:378-392`) and equally in the V4V branch
`settleMatchesSplit` (`chain/v4v.go:229-255`), refuse by name any output whose `Amount` is not a key
of the pinned keyset:

```go
if _, ok := params.Keys[fmt.Sprint(out.Amount)]; !ok {
    return fmt.Errorf("sigall %s output %d has amount %d, which the pinned keyset %s cannot sign",
        e.name, index, out.Amount, params.KeysetID)
}
```

`params.Keys` is already exactly the right thing and is already in hand at that call site: it is the
pinned keyset's amount→public-key map (`chain/app.go:27`), committed from the mint at genesis
(`chain/node.go:197`) and served to the app as `params.keys` in state (measured:
`len(state["params"]["keys"]) == 64` for keyset `0102b930f4dc…`, containing `1,2,4,…,2^63`, and
containing **neither `72` nor `80`**; it does contain `8`, `16`, `64`). The chain already owns the
right shape in `splitAmount` (`chain/settle.go:325-341`), which returns `nil` for an amount the
keyset cannot represent — the check is the same predicate, run at the door instead of at the mint.

**Why admission is the only cheap place.** The mint refuses *before it examines any signature*
(measured: a non-denomination output returns `400 {"detail":"72","code":0}` even with a deliberately
garbage witness, while the same inputs with denomination-decomposed outputs get past the amount
check and fail later on the witness — `400 {"detail":"signature threshold not met. 0 < 1.","code":11000}`).
A template the mint can never honour must therefore never be admitted; otherwise the chain locks
value it can never move.

**Measured blast radius of not having this check:** **18** committed bids, **1344** sats, every one a
2-proof escrow whose due template is a single collapsed output of **72** (12 bids) or **80** (6 bids)
— see Part 2.

**Surface, and its limit (needs an owner decision, not a chain-side one).** A bid refused here is
refused in `CheckTx` (`chain/app.go:874-882`); the bid branch of `CheckTx` is deliberately strict
(its comment says so, and returns code 2 for any error), so the bid is dropped at the door and
**no kind-1450 is ever published for it** — consistent with the recorded ruling that a refused bid is
not committed. (The live `rejections` list does hold kind-1441 entries — e.g. height 25, *"locktime
below the floor for this lot"* — but those are **time-dependent** rules that pass `CheckTx` and only
diverge at delivery, `chain/app.go:952`; a denomination check is static, so it would fire in
`CheckTx`.) The practical consequence: the app must pre-flight the denominations itself from the
kind-1448 params it already reads (it already reads `keysetId`). *[Inferred: I did not trace the
relay observer's submit path end to end, only the `CheckTx` branch it necessarily passes through.]*

## (b) Log both ends of a failed swap; journal the named error beside the attempt

**Correction to handover §4 item 6 first: the chain does print it today.** The error text is logged at
`chain/settler.go:212` —

```go
log.Printf("settle %s %s: %v", it.Outcome, it.Bid.ID[:12], err)
```

— which is why `run/chain.log` holds **731** lines like
`2026/11/19 12:11:34 settle settle e02ae0631573: mint swap: 80`. The handover's "nothing prints it" is
wrong. What is actually missing is everything useful:

1. **The HTTP status and the full body are discarded.** `swap` (`chain/settler.go:343-352`) keeps
   `code, raw` from `post` but only surfaces `r.Detail`:
   `return nil, fmt.Errorf("mint swap: %s", r.Detail)` (`chain/settler.go:351`). For a
   non-denomination output the mint's body *is* the bare amount — measured
   `400 {"detail":"80","code":0}` — so the log line names no rule and carries no status.
2. **The journal records no error at all.** A failed entry's keys are
   `at, auction, bid, bidder_sig, outcome, outputs, reveal, to` — no status, no detail. `settleAttempt`
   (`chain/settler.go:54-65`) has no field for them, and on the failure path the only write happens
   *before* the swap (`chain/settler.go:265`; `finish` writes again only on success, at
   `chain/settler.go:447`; `write` itself is `chain/settler.go:114`, appending one JSON line).

**Ask, implementably.** (i) Carry `code` and `raw` out of `swap` (the plumbing is already there).
(ii) On failure, append a second journal line for that attempt naming
`{"bid","outcome","at","http_status","error"}` (add `HTTPStatus int` / `Error string` to
`settleAttempt` with `omitempty`, and a small `s.write(&settleAttempt{...})` after
`chain/settler.go:280`), so the journal is self-diagnosing and `loadJournal` can count failures per
bid by class. (iii) Keep the detail in the log line: log `code` and `raw` together with the same
`settle %s %s` prefix so existing greps still work.

**Mint-side mirror (not ours to make; noted because it is one line).** The mint's own DLEQ-restore
path already refuses a non-denomination amount *by name* —
`raise TransactionError(f"keyset {promise.id} does not support amount {promise.amount}")`
(`cashu/mint/ledger.py:1657-1659`) — while the swap-generation path indexes the dict with no guard,
`private_key_amount = keyset.private_keys[output.amount]` (`cashu/mint/ledger.py:1740`). That is a
bare `KeyError(80)`; `str(KeyError(80)) == "80"` (measured), which is stringified by
`cashu/mint/app.py:93,106` and returned as `{"detail":"80","code":0}` (app.py:111). So
`ERROR | Exception: 80` in the mint journal **is** the stringified `KeyError`, exactly as handover §4
says. Patching the vendored mint is not this lane's call; the guard at ledger.py:1657 is the
precedent if it ever is.

## (c) A counted health signal / escalation for a swap failing repeatedly

**Today there is none, and the retry is not actually forever — it stops silently.** The settler
retries each due move with backoff `1s,2s,4s,…` capped at `10 min` (`chain/settler.go:198-212`), but
`dueMoves` **skips any lot closed more than 7 days ago** (`chain/settle.go:281,291`,
`settleWindowSec = 7*24*3600`). So a stuck escrow is retried hard for a week and then abandoned with
no record anywhere — strictly worse than "forever".

**Measured evidence of the storm.** Bid `0036d1cf0a69af9c…` (72 sats, lot
`wsc-claim-mwm245tv-kogb28`) has **174** failed journal entries from `11-18 12:47:34` to
`11-19 12:08:14`; `a5fe7c6b27eff87d…` shows the doubling intervals then the 10-minute cap
(`11:15:47, :49, :54, :59, 11:16:09, 11:16:29, 11:17:04, 11:18:09, 11:20:19, 11:24:39, 11:33:14,
11:43:19, 11:53:24, 12:03:29`). Journal totals: **801** failed attempts, **731** of them with a
non-denomination output (`72` ×650, `80` ×81); all 70 completed entries have denomination-only
outputs.

**Ask.** A gateway-visible counter, cheap when combined with (b):
`GET /api/health` (or an added block in `/api/network`, `chain/main.go:264`) returning at least
`{"unsettled_due": N, "oldest_due_age_secs": S, "swap_fail_total": N, "swap_fail_by_amount": {"72": …}, "last_swap_status": …, "last_swap_error": "…"}` — sourced from `dueMoves` (there is already a
`/due` endpoint on each validator, `chain/node.go:348`) and the per-bid failure counters from (b).
Escalation threshold, stated concretely: **any bid that has been due for > 24 h with ≥ 100
consecutive failed swaps**, or **any unsettled due move within 7 days of the retry window closing**
(`settleWindowSec`, so the signal fires before the settler silently forgets the escrow). A counted
signal is the minimum; the kind-1450-shaped fact suggested in the defect note is a larger design
question for the chain session. *[Inferred: I did not verify the app's readiness to consume such a
signal.]*

---

# Part 2 — the stuck-escrow decision brief

## 1. Re-measurement (do not use the handover's 11:23 figure)

**Query path (all three, fresh):**

1. `curl -s -m 30 http://127.0.0.1:8090/api/state -o state-now.json` → committed chain state
   (height 2966). The chain's own settled marker is `bid.settled` (`chain/app.go:130`); **46 of 64**
   bids carry it.
2. `~/work/arena-merged-ref/run/settle-journal.jsonl` → the settler's attempt log (871 lines).
3. `POST http://127.0.0.1:3338/v1/checkstate` with `Ys = hash_to_curve(secret)` → the mint's own
   SPENT/UNSPENT verdict, the independent measure.

**Result — 18 bids, 1344 sats.** The handover's 12 / 888 at 11:23 was 9 settle + 3 refund; the same
measure now reads 12 settle + 6 refund, i.e. **six more bids are due-and-unsettled** than at 11:23
(as more lifecycle lots have closed). Grouped by amount:

- by amount: **72 × 12**, **80 × 6** (total 12·72 + 6·80 = 1344)
- by due outcome: **settle × 12** (closed lots where the bid won), **refund × 6** (5 lost + 1 void)
- by escrow proof count: **2 × 18** (2-proof escrows are the observed *shape*, not the rule)
- by bid status: won × 12, lost × 5, void × 1
- mint checkstate for all 18 escrows: `("UNSPENT","UNSPENT")` — never swapped, so never settled
  (control: three completed journal entries are `SPENT`)
- every one has a single-output due template: `outputs=[{amount:72}]` / `[{amount:80}]`
- every one's escrow secret is the same 2-of-2 shape: `data`=bidder wallet, `pubkeys`=[group key],
  `n_sigs=2`, `refund`=bidder wallet, `sigflag=SIG_ALL`, and **`n_sigs_refund` absent**; the
  `locktime` is **already in the past for all 18** (earliest `11-18 13:02`, latest `11-19 12:00`).

## 2. The lots

12 lots, every one a throwaway app test lot (`wsl-lifecycle-*`, `wsc-claim-*`):

| lot `d` | stuck bids | amounts |
|---|---|---|
| `wsc-claim-mwm245tv-kogb28` | 1 | 72 |
| `wsc-claim-mwm24hro-4vjrva` | 1 | 72 |
| `wsc-claim-mwm2gt2u-bg4awg` | 1 | 72 |
| `wsl-lifecycle-mwnfkki3-tgocgw` | 2 | 72, 80 |
| `wsl-lifecycle-mwnfp6f0-kq9rmw` | 1 | 72 |
| `wsl-lifecycle-mwnfsrh4-qqpnf2` | 1 | 72 |
| `wsl-lifecycle-mwnfzyyk-33wozt` | 1 | 72 |
| `wsl-lifecycle-mwng8kks-2zs5hw` | 2 | 72, 80 |
| `wsl-lifecycle-mwngdekl-r4eub5` | 2 | 72, 80 |
| `wsl-lifecycle-mwngsk9a-7hfsut` | 2 | 72, 80 |
| `wsl-lifecycle-mwnh2uqv-4gm1lt` | 2 | 72, 80 |
| `wsl-lifecycle-mwnhamb5-tq3okr` | 2 | 72, 80 |

The first of these (bid `a5fe7c6b27eff87d…`) is the Phase E lot whose winner is named and whose
escrow is the one Phase E's settle step blocks on.

## 3. The load-bearing question: does the settler re-derive the outputs at settle time?

**No. It submits the committed template's own outputs, amounts verbatim.** The answer is a re-derivation
of the *point* `B_` from the committed secret and blinding factor — never of the amount or of the
output set:

- `chain/settler.go:218-241` `templateMaterial` walks `template.Outputs` (read from the committed
  bid) and appends `SignOutput{Amount: o.Amount, ID: o.ID, B: point}` (`chain/settler.go:234`), where
  `point` is recomputed by `sigAllOutputPoint(o.Secret, o.R)`. `chain/settler.go:222-226` refuses
  outright if the bid carries no template; the settler "never builds an output of its own".
- `chain/settle.go:99-116` `settlementOutputs` (the validators' signing path) does the same via
  `sigAllTemplateSignOutputs` (`chain/settle.go:108`).
- `chain/sigall.go:222-241` `sigAllTemplateSignOutputs` copies `out.Amount` straight out of the
  committed template. There is no call to `splitAmount` anywhere on the settle path — measured, its
  only references are its own definition (`chain/settle.go:325`) and two tests
  (`chain/settle_test.go:321,329`).
- The amounts are **bound at admission**: `verifySigAllBidTemplates` reproduces the SIG_ALL digest
  from the committed inputs and outputs (`chain/sigall.go:416`) and requires the bidder's
  pre-signature to verify over it (`chain/sigall.go:424`, inside `chain/sigall.go:327-428`, called
  from `chain/app.go:755`). Changing an amount at settle time
  would invalidate the bidder's half of the 2-of-2 witness, and the mint would refuse it.

**Therefore: an app-side fix to the template *builder* cannot touch a single already-committed
template. The handover §4 statement — "the same escrows will become spendable, since the template is
what is wrong" — is REFUTED as stated.** The settler will keep submitting `outputs=[{amount:72}]`
until the 7-day window shuts it off; no app-side change affects that. Direct consequence for the app
lane: **the fix cannot turn Phase E's settle step green on the existing `wsl-lifecycle-mwng8kks-…`
lot** — that assertion needs a *new* lot funded after the fix (or the reclaim path in §4). Do not
weaken it to make it pass.

## 4. But they are NOT permanently unspendable — the bidder can reclaim them

The escrow is a NUT-11 P2PK `SIG_ALL` proof with a `refund` tag naming the bidder's wallet key and
`n_sigs_refund` absent. In the mint's own verifier:

- `cashu/mint/conditions.py:278-303`: once `locktime` has passed, a `refund_path` is built with
  `required_sigs = secret.n_sigs_refund or 1` (**1**) over the `refund` pubkeys
  (here `[bidder wallet]`), while the primary path keeps `required_sigs = 2`.
- `cashu/mint/conditions.py:314-378` tries the primary path first and **falls through to the refund
  path** on failure.

Two independent measurements confirm it for these very escrows and for the mechanism:

1. **The live stuck escrows already exercise the refund path.** Sending a stuck escrow's real inputs
   with denomination-decomposed outputs and a garbage witness returns
   `400 {"detail":"signature threshold not met. 0 < 1.","code":11000}` — i.e. the mint got past the
   amount check and evaluated the **1-signature refund path** (`"0 < 1"`; the primary path would say
   `2`). The same escrow with its committed single 80-sat output returns `400 {"detail":"80","code":0}`
   (the amount check, before any signature).
2. **A same-shape escrow I control spends with one signature after locktime, and only after.** Built
   at the live mint (`data`=key A, `pubkeys`=[group key], `n_sigs=2`, `refund`=key A,
   `sigflag=SIG_ALL`), nudged into by a swap, then spent with a **single** signature from key A over
   denominations chosen at spend time:
   - `locktime` in the past → **HTTP 200** (spend accepted);
   - identical shape, `locktime` in the future → **HTTP 400** `"not enough pubkeys (2) or signatures (1) present for n_sigs (2)."`
   (script: `$HOME/.hermes/profiles/maxime/cache/scratch/refund_path_probe.py`, re-runnable).

**Consequence for the objective.** The bidder's sats are recoverable *without any chain change*: a
wallet holding the bidder key can, after `locktime`, sign a fresh SIG_ALL message over any valid
(decomposed) output set and swap the escrow out. What can never happen is the intended outcome: the
**seller is never paid** on such a lot (the settle template can only be submitted verbatim and the
mint refuses it). That — not "money lost forever" — is the accurate harm, and it is why asking (a)
matters more than any backfill.

*Caveat, unverified:* I did not attempt the reclaim against the 18 live test escrows themselves. The
Phase E/funded-bid harness constructs its bidder wallets in-process
(`~/work/wt-app-e/scripts/auctions/live-lifecycle.test.ts:225-308`), and I found no persisted key
material for those test lots; I stopped at the same-shape proof rather than hunting for keys.

## 5. Recommendation — flagged as the user's decision, not mine

The three candidate paths, in the order I would argue them:

1. **Do not build a chain-side rescue.** It would contradict the executor design (the settler "builds
   nothing and chooses nothing", `chain/settle.go:16-23`) and the owner's own rule that the chain
   never authors outputs. Asking (a) makes the class impossible for *new* bids; that is the real fix
   on this side.
2. **Discard the 12 test lots** (`wsl-lifecycle-*`, `wsc-claim-*`): their sats are FakeWallet play
   money, the wallets are throwaway, and the escrows cannot settle. This is my default
   recommendation for these specific lots.
3. **If a product-level story is wanted**, the only genuine rescue is app-side and already possible:
   a "reclaim a stuck escrow" wallet action that spends the escrow through the post-locktime refund
   path with denomination-decomposed outputs — the mechanism proven above. That benefits *real*
   users, not the test lots, and it must be a deliberate feature (it changes who can move the money).

**Your call**, not mine: whether the 18 escrows are discarded as test debris or whether a
user-facing reclaim is specified. Either way, no chain change is needed for the money itself, and the
seller-never-paid harm on any future bad template is removed by asking (a).

---

## What I could not determine

- **Whether the 18 live test escrows are actually reclaimable by their original keys** — I proved the
  mechanism on a same-shape escrow, but did not recover the test lots' bidder keys (Part 2 §4 caveat).
- **The exact relay→`CheckTx` submission path** for a bid that ask (a) would refuse: I read the
  `CheckTx` branch (`chain/app.go:874-882`) and the delivery rejection path (`chain/app.go:952`), and
  inferred the surfaced outcome from the two together; I did not instrument the observer end to end.
- **Whether the app is ready to consume a `/api/health` signal** (Part 1 (c)) — not measured.
- **Why the mint, not the chain, is where the refusal lands** is settled (dict lookup at
  `cashu/mint/ledger.py:1740`), but I did not enumerate every amount that survives the mint's
  denomination rule versus the chain's `splitAmount` — they are the same predicate; I checked
  `72`/`80` absent and `8`/`16`/`64` present in the pinned keyset's 64 keys.

---

# Part 3 — the v4v one-output-per-row coupling (verified from the chain source, read-only)

**Claim under test:** the app now decomposes every settle/refund destination into one output per
denomination (`arenaDenominationSplit`, commit `965560dc7`), so a v4v row is no longer a single
output; the deployed chain's `settleMatchesSplit` requires exactly one template output per committed
v4v row, so a decomposed v4v row is refused at admission.

**VERDICT: the claim is correct and the coupling is LIVE IN CODE.** Worse than "needs sums": after
`965560dc7` the app cannot fund *any* v4v lot whose per-recipient share is not itself a single
denomination — the near-universal case — because the chain refuses the decomposed template before the
mint is ever asked. It is latent **only** in today's deployment, where no live auction commits a
split (`grep -c v4vSplit` over `/api/state` at height 2966 = **0**; the app's form can add rows).

**1. The rule (consensus, at admission).** `settleMatchesSplit` (`chain/v4v.go:229`), reached only
from the settle branch of `verifySigAllBidTemplates` (`chain/sigall.go:373-378`), itself called from
`applyBid` (`chain/app.go:755`) and therefore running in the kind-1444 bid branch of `CheckTx`
(`chain/app.go:874-882`, deliberately strict → Code 2, dropped at the door). The check is positional
and exact:

- `expected := splitSats(au.SellerWallet, au.V4VSplit, amount)` — one `splitOut` per committed row,
  plus a seller remainder when >0 (`chain/v4v.go:202-211, 235`);
- `len(template.Outputs) < len(expected)` → `"sigall settle template omits a committed v4v split output"` (`chain/v4v.go:237-238`);
- `len(template.Outputs) > len(expected)` → `"sigall settle template adds an output that is not in the committed v4v split"` (`chain/v4v.go:239-240`);
- per index `i`: recipient must equal `expected[i].Recipient` (`chain/v4v.go:253-254`) and
  `out.Amount` must equal `expected[i].Amount` (`chain/v4v.go:256-257`).

So a decomposed row (one row → N denomination outputs) fails the length check (*adds*) and, if forced
past it, the per-index amount check (*reprices*). **A multi-output destination for one v4v row is
refused at admission, by name.**

**2. A non-v4v destination is NOT constrained the same way.** When `len(au.V4VSplit) == 0` the
settle and refund templates take the `else` branch (`chain/sigall.go:375-424`): amounts positive,
each output names the pinned keyset, amounts **sum** to `content.Amount`, and every output is locked
to the single destination (seller for settle, `chain/sigall.go:420-421`; bidder for refund,
`:423-424`). **Multiple outputs to that one destination are allowed**, so the one-output-per-destination
rule binds ONLY the settle template of a lot with a committed split. That is exactly why the
80→64+16 seller decomposition (the Phase E fix) is legal and the equivalent v4v decomposition is not.

**3. The app's v4v amounts — how the non-denomination share arises.** The app computes v4v shares
identically to the chain: `share = Math.floor(amount * row.allocationBps / 10_000)` per row, seller
remainder = `amount - allocated`, then `flatMap`s every destination through `arenaDenominationSplit`
(`platform/web/auctions/relay/arenaBidFunding.ts:457-467` producing the destinations, and `:669-671`
decomposing them into outputs; the builder is `buildArenaOutcomeTemplate`). The *per-recipient amount*
is that raw share, and the app only ever emits it split into denominations. Example the app's own
test asserts: 500 bps of 1000 sats → V4V gets 50 = `32+16+2`, seller gets 950 =
`512+256+128+32+16+4+2` → **10 outputs for the chain's 2 expected rows**, refused as *adds an output*.
The app is internally consistent (its own verifier expects the decomposed outputs,
`arenaBidFunding.ts:665-671`); the mismatch is strictly app↔chain. **Live in code.** *[Inferred: I did
not actually fund a v4v lot to observe the `CheckTx` refusal; it follows directly from 1 and 3.]*

**4. The exact change the chain session must make.** In `settleMatchesSplit` (`chain/v4v.go:229-258`)
replace the positional one-output-per-row comparison with a **per-recipient SUM** comparison:

- keep the `chain/v4v.go:230-233` loss guard (a row that rounds to 0 at this bid is still refused);
- build `expected := map[string]int64` from `splitSats(...)` by accumulating
  (`for _, s := range splitSats(...) { expected[s.Recipient] += s.Amount }` — safe even though
  `validateV4VSplit` already forbids duplicate recipients, `chain/v4v.go:141,154`, and the seller
  remainder is a distinct payee);
- require the outputs to conserve the amount: positive, `ID == keysetID`, summing to
  `content.Amount`;
- require every output's recipient to be a key in `expected` (no uncommitted payee, no missing payee)
  and `Σ out.Amount` over each recipient to equal `expected[recipient]`;
- **drop the order/index requirement entirely** — it is what forbids decomposition; the SIG_ALL
  digest still binds the exact output set, so the bidder's pre-signature is unaffected and the mint
  still sees exactly the outputs the bidder authorised.

Net rule: *"the settle template pays exactly the committed split — one or more denominated outputs
per recipient, summing per recipient to the committed share."* Pair it with ask **(a)** above
(amounts must be keys of the pinned keyset): a per-recipient sum is satisfied by a decomposed row but
a hand-crafted non-denomination output would still pass sums and lock value.

**What I could not determine.** (i) Whether any other settle-path code re-imposes a count/order rule:
`chain/settle.go:99-116` only re-derives `B_` from the already-committed (and admission-canonical)
template, so admission is the only place needing the change; I did not re-read every function in
`settle.go`. (ii) Whether a live v4v lot will be funded soon — v4v is reachable from the app form
(`AuctionFormContent.tsx:65-185`) and carried by create (`arenaAuctionCreate.ts:105-116`), but every
current lot and test harness uses `v4vSplit: []`.
