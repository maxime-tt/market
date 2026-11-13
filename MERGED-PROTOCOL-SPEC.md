# Merged protocol spec — auctions

**Status:** owner-ruled, 2026-11-13. Binding for the ports onto
`ChiefmonkeyArt/plebeian-arena-auctions`.

**Supersedes:**
- **his v0.5.x** — the group-key re-lock, the `expiring()` / `Expired` no-sale close,
  the two-mode locktime floors (`EndAt + M` vs `now + M − grace`), and the settler's
  authority to *build* outputs.
- **our branches** — the bid-time-relative locktime floor, and any refund path other
  than the two named in §4.

**Kept from him:** push settlement (validators move the escrow themselves), the two
listing modes, no maximum auction time, the 1440 kind series, layout-B `sigAllMessage`.

**Governs the ports:** `feat/two-of-two-lock`, `feat/v4v-splits`,
`feat/editable-allowlist`, `feat/verdict-publish`.

---

## 0. The one-paragraph version

An auction escrow is a NUT-11 **2-of-2 `[bidder, committee]` `SIG_ALL`** lock. The bidder
**pre-signs two outcome transactions at bid time** — settle to the seller, refund to itself
— so the committee can move the money **only to those two destinations**, and the mint
enforces it. Each bid carries a locktime derived from **the end the bid itself establishes**
plus a settlement safety window. Lots may run forever under anti-snipe, and locks may be
arbitrarily long. An outbid bidder is refunded by the **instant path** (its own pre-signed
refund, co-signed by the committee); if that never happens, the **last-resort path** opens
at locktime and the bidder reclaims alone. The validators' settler is an **executor, not an
author**: it can submit a pre-signed outcome and nothing else.

---

## 1. The escrow lock

### 1.1 Shape

NUT-11 P2PK, exactly:

| element | value |
|---|---|
| `data` | the **bidder's** wallet public key |
| `pubkeys` | **one** entry: the committee key (a single FROST group key; never per-validator keys) |
| `n_sigs` | **2** |
| `sigflag` | `SIG_ALL` |
| `refund` | the bidder's wallet public key |
| `locktime` | see §2 |
| `n_sigs_refund` | **absent** (defaults to 1) |

**The canonical secret carries exactly five tags**, byte for byte:

```
[["locktime","<unix>"],["pubkeys","<committee>"],["n_sigs","2"],["refund","<bidder>"],["sigflag","SIG_ALL"]]
```

`n_sigs_refund` is **not** emitted: `cashu-ts` only writes it when
`requiredRefundSignatures > 1`, and the wallet sets 1. A parser that demands six tags
refuses every lock the wallet builds, and vice versa. This was settled empirically against
a live Nutshell 0.21.0 mint, not reasoned about.

### 1.2 The signing message (layout B)

`SIG_ALL` signs the **transaction**, not the secret:

```
sha256( concat(input secret ‖ input C, in order)
     ‖ concat(str(output amount) ‖ output B_ hex, in order) )
```

BIP-340 Schnorr over that digest. This is the **current** Cashu layout (spec PR #302,
2025-11-15) and it is what Nutshell ≥ 0.20.3 accepts; layout A (secrets and `B_` only) is
refused by any current mint. `cashu-ts` 5.0.0-rc.4 exposes both
(`buildP2PKSigAllMessage` = B, `buildLegacyP2PKSigAllMessage` = A).

### 1.3 What is actually enforced, and by whom

**State this accurately in any PR; do not overclaim.**

- The mint enforces exactly three things: all inputs share one secret; **two distinct valid
  signatures over the recomputed message**; and the balance. **There is no destination in
  the signed message and the mint has no concept of seller or bidder.**
- Therefore the "only two destinations" property is delivered by **(a)** the bidder's honest
  pre-signing of exactly two templates, and **(b)** the chain's admission rule refusing any
  template not locked to the committed seller and bidder keys. It is **not** a mint property.
- What the lock *does* guarantee: **the committee alone cannot move the escrow** — it cannot
  forge the bidder's half, Schnorr is message-bound, and no combine or reuse exists. Only a
  nonce-reuse bug would break it.
- The residual, accepted by the owner: **a colluding bidder + committee can send the escrow
  anywhere**, and the chain cannot prevent it because the spend happens at the mint. There is
  **no fund-loss victim** (the seller never had custody), the templates are **public** so a
  seller can verify the committed destinations before shipping, and a diversion is
  **detectable and attributable** against the chain's own record. Not preventable; provable.

### 1.4 Refusals, by name

The strict parser and admission rules must refuse, naming the field or rule:

- `lock must use SIG_ALL`
- `lock data must be the bidder wallet key`
- `lock pubkeys must be exactly the committee key`
- `lock n_sigs must be 2`
- `lock refund must be the bidder wallet key only`
- `lock carries an unexpected n_sigs_refund`
- `locktime below the floor for this lot` (see §2)
- `all proofs must share one lock`
- `template destination is not the committed seller or bidder`
- `template inputs are not the committed proofs`
- `template digest does not match`
- `template is not signed by the bidder`

---

## 2. Locktime derivation

### 2.1 The rule

```
minLock = max(EndAt, now + WindowSec)          // the end this bid itself establishes
        + settlement_safety                     // 900 s
        + bid_to_consensus_latency              // 15 s
```

A bid is refused unless `locktime >= minLock`.

### 2.2 The check-order amendment — this is load-bearing

**The check must run against the end the bid itself establishes**, i.e. *after* applying any
anti-snipe extension, or equivalently using `now + WindowSec` for an extending bid.

His code checks **before** the extension (`checkLock` at `app.go:494` precedes the extension
block at `:537`), validating an extending bid against the **old** `EndAt`. Because the
extension jump is `≤ WindowSec` and `safety + latency = 915`, the post-end safety margin
**collapses from 900 s to as little as 15 s**:

> lot ends 12:29:59Z, the winner's reclaim opens 12:30:15Z — 16 seconds of slack for
> settlement.

Normal settlement is ~1 s, so it usually survives, but a ~15 s settler stall loses the sale —
and **15 s is worse than the 30 s ADR 0002 A3 already rejected**. Getting the order right
makes the safety margin independent of `MaxWindowSec`; getting it wrong silently couples them.

### 2.3 No maximum lock time

A lock may be arbitrarily long. It freezes only the bidder's own funds: it does not block the
lot from closing, other bidders, the seller, the settler, or the FROST session table. The
last-resort refund simply arrives later. Accepted.

---

## 3. Auction modes and the end time

`EndAt` is the lot's scheduled close; the lot closes when `now >= EndAt`.

- **`fixed`** — `EndAt = createdAt + durationSec`. **Never moves.** `MaxDurationSec` bounds it.
- **`antisnipe`** — `EndAt = createdAt + durationSec` initially, and an **accepted** bid
  arriving with less than `WindowSec` left sets **`EndAt = max(EndAt, now + WindowSec)`**.
  **No cap and no hard end: the lot ends when the bidding stops.**

Two properties worth stating because they are what make the design work:

- A **rejected** bid cannot move `EndAt`: a late/void bid returns early, before the extension
  block. Only an accepted bid pushes the end out.
- **Every `EndAt` mover becomes the leader**, so no bid can move the end without carrying a
  lock derived from it (§2.1).

**Removed entirely:** `MaxTotalExtension`, and the global `SoftCloseSec` / `ExtendSec` /
`HardEnd` (the last three already removed by him in v0.5.0).

---

## 4. The two refund paths — and no others

There is **only the 2-of-2 `SIG_ALL` method.** No third path exists.

**(a) Instant refund — the pre-signed template.**
The bidder pre-signed the refund at bid time. The moment the bid becomes `outbid`, `void` or
`lost`, that template plus the **committee's FROST co-signature** is a complete spend. The
settler (§5) collects the co-signature and submits it. This is the fast path and the intended
one.

**(b) Last-resort refund — locktime expiry.**
After `locktime`, the NUT-11 `refund` key lets the bidder reclaim **alone**: no committee, no
settler, no chain involvement, no deadline. This exists for the case where the committee is
unreachable, the settler is broken, or the lot never resolves.

**Not permitted, ever:**
- A refund to any key other than the bidder's committed wallet key.
- A group-key output as an outcome. **A template that re-locks the escrow to the committee key
  is forbidden** — it hands the committee a spendable output and is therefore *worse than not
  having the 2-of-2 at all*, because the committee then needs no bidder signature. Rejected by
  the owner; do not reintroduce it.
- Any refund of a **winning** bid before its locktime.

---

## 5. Settlement

**The settler is an executor, not an author.** He keeps a settler loop, but its authority is
reduced:

- It may **submit a pre-signed outcome template** (settle or refund) and record the result.
- It may **not build outputs, choose a destination, or re-lock.** Under the 2-of-2 the outputs
  are already fixed by the bidder's signature, so `settler.build()` — which constructs outputs
  in his design — has no role.
- It holds no key. It collects one FROST co-signature per move and performs the mint swap.

**Push is primary, and there is no pull path for refunds.** The settler pushes refunds and
payouts so that nobody has to be online. His `/api/release` pull release — the manual request
for a co-signature — is **deleted**: under the 2-of-2 the bidder's half is already pre-signed,
and the committee's half is collected automatically off committed blocks, so there is nothing
to request. **Neither changes who can move funds.**

**Consequence of deleting it, accepted:** a settler that is down at close **loses the sale**
rather than being rescued by a page. The winner reclaims via the last-resort path (§4b) and
the parties re-arrange. Money is never at risk, and no escrow is stuck.

**Timing.** One FROST round plus one mint swap after the trigger. This must stay comfortably
inside `settlement_safety` (§2.1).

**Failure.** If the settler never lands the settle, the winner's locktime expires and the
bidder reclaims via path (b). The sale is lost; **no money is lost, no escrow is stuck, and
there is no double claim** — the mint enforces single spend and the settler's `spent()` check
refuses cleanly.

---

## 6. V4V payout splits

Committed **at auction creation**, because the settle template is pre-signed and a split
chosen later cannot be in it.

- Rows: `{role: "validator" | "v4v", recipient_pubkey, allocation_bps}`, integer bps.
- `seller_remainder_bps = 10000 − Σ(allocations)`. Duplicate recipient pubkeys refused.
- Role set exactly `validator | v4v`. Total ≤ 10000.
- **Immutable after first publish** — the split is a money field (§8).
- **The settle template must match the committed split exactly**: same recipients, amounts and
  order. A template that omits, adds, reorders or reprices a row is refused by name. **The mint
  knows nothing about V4V** — this is a protocol rule, not a mint rule.
- **A refund template must not carry a split row.**
- Rounding: floor auxiliary rows, remainder to the seller, so the outputs sum to the bid
  **exactly**.

---

## 7. Kinds — the 1440 series

Regular kinds only. Never the NIP-01 ephemeral range: khatru (`nak serve`) refuses an
ephemeral event with no matching live subscription and does not buffer it.

| role | kind |
|---|---|
| create / root | **1440** |
| bid | **1441** |
| chat | **1442** — his; ours uses it for nothing |
| refund | **1443** |
| settle | **1444** |
| outcome / verdict | **1445** |
| funding abort | **1446** |
| state commitment | **1447** |

One exported map per implementation; no scattered literals.

**Coordinates.** `a = 1440:<seller_pubkey>:<d>` — our own convention, **not** NIP-01
addressability. 1440 is regular, so the relay replaces nothing and the latest accepted version
must be resolved explicitly (§8).

---

## 8. The editable allow-list

**Display is mutable; money, time and cryptography are not.**

**Immutable after the root is published:**

- `auction_id` (the `d` value)
- `starting_bid`, `min_increment`
- `mode` — **new, remapped** from the removed late-bid fields
- `window_sec` — **new, remapped**
- `duration_seconds` (fixed lots)
- `locktime`-affecting fields
- `funding_mode`
- `seller_coco_payment_public_key`
- the **V4V split** (§6)

**Mutable:** `title`, `description`, `image_url`.

**Mechanism.** The **first** 1440 event for `(seller, d)` is the root; its event id is
`auction_root_event_id`. Every 1441 bid **must** carry `e = <auction_root_event_id>`, verified
**in the deterministic transition**, not only at admission — admission is a mempool filter, and
a Byzantine proposer can include a transaction that never passed it. A later 1440 with the same
`(seller, d)` and `e = <root>` is accepted only if every immutable field is unchanged; otherwise
it is refused with **`immutable_field_changed <field>`** and **ignored, never applied**. The
canonical auction is the **latest accepted** version by `created_at`.

---

## 9. Verdicts and the read path

- **Kind 1445**, one event per validator per decision, signed under that validator's own key.
- **Anchored**: `height` + `block_hash` on every verdict **and** every state commitment
  (kind 1447). A client **ignores** an unanchored verdict.
- **Published only after the deciding block is committed**, anchored to that block's hash.
  Never for an uncommitted height — a claim a reorg can contradict is worse than no claim.
- **Append-only. Not replaceable.** A lifecycle change is a **new** event; clients resolve
  latest-per-validator. Replacement would destroy the audit trail the security argument rests on.
- The relay **notifies**; the chain **decides**; the anchor **proves**.

---

## 10. Parameters

| parameter | value | note |
|---|---|---|
| `MinWindowSec` | **60** | raised from 15 s: the window is the reset amount and 15 s is too close to block jitter |
| `MaxWindowSec` | 900 | unchanged |
| `settlement_safety` | **900** | replaces `LockMarginSec`'s role as a lock driver |
| `bid_to_consensus_latency` | **15** | replaces `lockGraceSec` |
| `MinDurationSec` | 20 | unchanged |
| `MaxDurationSec` | **259200** (3 days) | **raised from 7200** — a fixed lot's duration IS its life, and the lock derives from it, so the cap protects bidders from a seller-locked marathon. Staging: 3 days now, 30 days (2592000) when the demo is a testing ground no longer. |
| `MaxTotalExtension` | **removed** | |
| `Threshold` | 3 | FROST 3-of-4 |
| `LockMarginSec` | **retired as a lock driver** | its only remaining meaning is the settlement safety |

---

## 11. What is deleted from his code

- the **re-lock** move and `Relocks` counter,
- **`expiring()`** and the `Expired` flag and the **no-sale close** path,
- `MaxTotalExtension`,
- the two-mode locktime floors — replaced by §2.1's single rule,
- the settler's output-building authority.

Nothing here is replaced by new machinery; the design is smaller than his.

---

## 12. Chain format

Adding `outcome_templates` to `Bid`, and the `mode` / `window_sec` / split fields to `Auction`,
changes committed state shape. **Bump the chain format to 6 and wipe.** There is no migration:
under the standing rule a shape change is a wipe, and nothing committed is worth preserving.

---

## 13. Accepted residual risks

1. **Bidder + committee collusion** can send an escrow anywhere. No fund-loss victim; provable
   against the chain's record. (§1.3)
2. **Settlement slower than `settlement_safety`** loses the sale: the winner reclaims, the
   seller is unpaid, and the parties re-arrange. Money is safe and nothing is stuck. (§5)
3. **A Byzantine majority can authorise a successor key.** Inherent; not engineered away.
4. **An unannounced mint keyset rotation** still needs a re-genesis. Pinning ahead covers known
   keysets only.
5. **Adding a validator needs a new group key** — the FROST library can refresh but not add.
   Membership changes therefore require a drain window; same-slot swaps do not.

---

## 14. Open items

- The membership/rotation runbook (§13.4, §13.5) — separate document.
- Whether `MaxDurationSec` moves from 3 days to the target 30 days once the demo is no longer a
  testing ground. The value is a parameter, not a shape change.
