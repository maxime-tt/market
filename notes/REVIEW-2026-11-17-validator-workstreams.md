# REVIEW — the validator-side workstreams (A–E), from the market side

**Reviewed:** `docs/VALIDATOR-WORKSTREAMS-2026-11-17-RESULT.md` (194 lines) and its §10.1 amendment in
`docs/HANDOVER-2026-11-17-validator-workstreams.md`, on branch `feat/validator-workstreams`
(claimed code state `328ce53`, docs at `8633e40`) of
`https://github.com/maxime-tt/plebeian-arena-auctions.git`.
**Written** 2026-11-17 by the market-side session that owns the app lane
(`notes/HANDOVER-2026-11-17-app-parallel-work.md`).

This is a review of the *provider* side of the boundary this lane consumes. The rule applied is the
house one: a report is a claim, not a fact, so the load-bearing claims were re-measured here and what
was not re-run is named as not re-run.

---

## 1. Verdict

**The work holds up.** Every claim I could re-measure without disturbing the live deployment I
re-measured, and each came back as stated. Two things the report does not say are worth recording
(§4 below), and one of its "recorded not fixed" market-side consequences was a **live defect in this
app** — fixed today (§5).

---

## 2. Re-measured here, with the method

- **The Go suite: 144 pass / 0 fail / 0 skip.** Re-run by me on the branch, in
  `/home/admin_maxime/work/wt-validator/chain`, with
  `ARENA_TEST_MINT=http://127.0.0.1:3338 NAK_BINARY=~/.local/bin/nak go test -count=1 -v ./...` →
  `ok arenachain 18.284s`, counted from the verbose output (`--- PASS` 144, `--- FAIL` 0,
  `--- SKIP` 0). The claimed number is exact. (Note for the next reader: the Go module is
  `chain/go.mod`, so `go test ./...` must be run **from `chain/`**; from the repo root it fails with
  "does not contain main module".)
- **The push exists.** `git ls-remote origin feat/validator-workstreams` →
  `8633e40ab551eb5842981a3e691cb1a9778a53b1`, equal to the local ref. Pushed, as claimed.
- **The old gate really was the old gate.** `git show 738413c:chain/verdictpublish.go` line 173:
  `needCommit := height%p.every == 0 || publishedVerdict || p.lastCommit == 0` — verbatim what the
  report says the base did. The new gate is at `verdictpublish.go:213-214`:
  `publishedVerdict || p.lastCommitTime == 0 || height != p.lastCommitHeight || now-p.lastCommitTime >= MaxInterval || needParams`.
  So the "fails on the base" claim is credible on inspection; I did **not** re-run the base branch to
  watch it fail.
- **The kinds and schemas exist as described.** `chain/nostr.go`: `KindParams = 1448`,
  `KindStatePulse = 21447`; `chain/verdict.go`: `ParamsSchema = "arena.params.v1"`,
  `StatePulseSchema = "arena.statepulse.v1"`, `StateCommitMaxInterval = 10 * time.Second`;
  `chain/main.go` and `chain/node.go` both carry `-commit-max-interval`.
- **The params event carries what the app needs, and its reader is strict.**
  `ParamsContent` has `group_key, mint_url, keyset_id, keys, settlement_safety_sec,
  bid_to_consensus_latency_sec, min_window_sec, max_window_sec, min_duration_sec, max_duration_sec,
  max_proofs, threshold, validators` — every term the plan's increment 9 asks for.
  `ParseParamsEvent` verifies the signature, the schema, the tag anchor **against** the content anchor
  (so a relay cannot re-frame one and hide the other) and the roster.
- **The acceptance harness does what the report says it does.**
  `scripts/acceptance-validator-workstreams.sh` uses a local relay (`ws://127.0.0.1:10547`), a fresh
  root (`run/chain-e2e`, never `run/chain`), port `:8095` (not `:8080`) and `-demo-controls`, and
  restores the unit through an `EXIT` trap.

## 3. The live deployment: the report's "nothing deployed" claim is TRUE — and it is the whole story

I checked this directly rather than trusting it, because it is the claim my lane depends on:

- the unit runs `/home/admin_maxime/work/arena-merged-ref/bin/arena` (mtime 2026-11-17 13:22) with
  root `run/chain`;
- `strings bin/arena | grep -c arena.params.v1` → **0**, and the same for `arena.statepulse.v1` — the
  running binary **predates** workstreams A and D;
- the live root is the **same** root as before (its `/api/state` reports height **311**, not a fresh
  chain's single digits), so no re-initialisation happened — which matters, because
  `arena init` regenerates the FROST group key and would orphan every escrow.

**So: workstream D is written, tested and pushed, and the market app still cannot read the escrow
terms from the relay, because nothing publishes them on the live chain yet.** The dependency this lane
was told to wait on (validator D) is now *code-complete but not deployed*. That is a deployment step,
not a design gap.

## 4. What the report does not say

1. **The public relay now carries foreign params events.** `wss://relay.playday.it` holds **12**
   kind-1448 events, all at heights **2** and **20**, published 15:58–16:00 UTC by **two different
   validator sets** — i.e. from two short-lived test chains, not from the live deployment (which has
   no params code at all, §3). A client that reads "the newest 1448" would take **the wrong terms**;
   the anchor cross-check (`height`/`app_hash` in both tags and content, against a commitment the
   client trusts) is what makes that safe, and it must be applied. Worth a cleanup pass on the relay,
   or at least a named note, since the app is about to read this kind.
2. **`params_version` is not client-recomputable, and should never be recomputed.** It is the sha256
   of `json.Marshal(Params)` — the **Go struct's** canonical JSON. A client on the wire cannot
   reconstruct that byte string from the published fields, so the value must be treated as an opaque
   **comparison token** ("the same digest means the same terms"), never re-derived. The report's
   rationale for choosing a digest over a counter is sound; this is the consequence of it that the
   client side must respect.

## 5. The market-side consequence that was a live defect — fixed

§3(3) of the report records that the reference client's locktime was derived from its **own** clock,
one `bidToConsensusLatencySec` (15 s) short of the chain's floor whenever the anti-snipe window term
binds, and says the market app has the same defect. It did.

`platform/web/auctions/relay/arenaBidFunding.ts` `arenaBidLocktimeFloor` established the end as
`max(endAt, now + windowSec)` from the **route's** clock, then added safety and latency once. The
chain's `minLocktime` (`chain/app.go:615-625`) evaluates the same expression against the **block** time
of the admitting block, which is the bidder's clock plus exactly that latency. For a bid inside the
window the app therefore locked 15 s short; `CheckTx` admits such a bid, the block includes it, the
transition refuses it, and it never reaches committed state — money locked, no bid. The validators
measured precisely that on the live chain (locktime `1794932210` against a floor of `1794932213`).

Fixed in `dc59240cf`: the end is now established against `now + latency`, the estimate the chain's own
client makes (`web/src/lib/arena.js` `minBidLocktime`), which can only raise the locktime and
over-locking is allowed (spec §2.3). Two assertions moved with it — `arenaBidFunding.test.ts` and
`arenaBidFund.test.ts` — from `now + windowSec + safety + latency` to
`now + latency + windowSec + safety + latency`. That is a **correction of a formula against the
chain's rule with a measurement behind it**, not an assertion weakened to make a gate pass; the fixed
and far-from-the-window cases are unchanged, and the whole suite stays at 4800 pass / 1 skip / 2 fail
(the two failures pre-existing) with `tsc` 185.

## 6. What this unblocks in the app lane, and what it does not

- **D's read half** — the app can now be written against a real relay source for the escrow terms
  (`group_key` first: `arena init` regenerates it, so a hardcoded key strands every escrow). It can be
  **written and unit-tested against fixtures today**; it can only be **verified live** once the
  validator branch is deployed (§3).
- **A's tick** — the ephemeral pulse (kind 21447) is the fast clock the clock policy was built to
  accept as a second source. Same deployment caveat. The market read's dedupe key, which §6 of the
  report flags as market-side and unfixed, **is already fixed on our side** (this lane's item 1.1:
  `(validator, height, app_hash, time)`, and `height desc, time desc`).
- **The HTTP removal is still blocked, correctly.** Deleting the proxy and
  `platform/web/auctions/protocol/{client,httpPorts}.ts` needs the params read to be live first, which
  needs the deployment. Until then the HTTP path stays and the app must not be pointed at it as a
  "fallback" once the relay read exists.

## 7. Recommendation

**Deploy the validator branch to the live unit — build and restart, never `arena init`** (re-init
regenerates the FROST group key and orphans every escrow the app has locked). Then this lane lands the
params read, subscribes the pulse, and the HTTP path can finally be deleted with a network check
proving zero `/api/auctions/*` requests. Until that deployment happens, workstreams A and D are
verified-by-test only, and the app-side halves they gate remain marked blocked rather than worked
around.
