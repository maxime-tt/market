# Composer brief — run A (admin-routes), the single writer

You are the **one composer** for run A. The research is done by others; your job is to turn it into the
artifact a busy owner can accept or refuse in a single word, plus an increment precise enough to
execute without re-deriving anything.

## Read, in this order

1. `runs/2026-11-13-admin-routes/order.md` — the bound. **Do not widen it.**
2. `runs/2026-11-13-admin-routes/ruling-acl.md` — the owner's ACL, and the seven things it leaves open.
3. `research/01-current-surface.md`, then `02-target-and-gaps.md`, then `03-consumers-and-acceptance.md`,
   with their `evidence/` files. Where a report contradicts the order or each other, the **measurement**
   wins — and the contradiction is something the proposal must state, not smooth over.

## Write exactly two artifacts

- `runs/2026-11-13-admin-routes/proposal.md`
- `runs/2026-11-13-admin-routes/order-increment-1.md`

Nothing else. **Do not write anywhere in the source tree.** Nothing is built beyond increment 1's
specification, and nothing is deployed.

## What the proposal must contain

1. **The decisions, first, each with a lean and its consequence.** The owner reads the top and answers.
   Every one of the seven open items in `ruling-acl.md` must be settled or explicitly escalated — not
   summarised. In particular: who **signs** a self-service reservation (the app key is a
   server-side secret, so this is really "what does the server check before it signs, and what
   evidence"), self-service vs admin-approved, what proves entitlement and whether that check **fails
   closed or open**, precedence when an admin route, an editor grant and a reservation name the same
   path, lapse/renewal (including whether the holder is warned **before** it lapses), what "path/domain"
   means here, and the naming rules.
2. **The target model** — the route entry: name, typed target, default marker, authority (admin /
   editor-grant / reservation), and term. Say which fields the existing registry can carry **as-is**
   and which need a new shape, with `file:line`.
3. **The resolution rule** — how a name resolves, the order, and every fallback. Include what `/` does
   when the default is absent, switched off, or unresolvable.
4. **The default flag, in full.** Exactly one default; what a second one does; removal; recoverability;
   whether the default may point at a non-page target. These are the owner's own example (`/home`
   marked default) and must be answered rather than assumed.
5. **The trust and permission answer.** Use the measured fact that the app key never reaches the
   browser and the WS proxy re-signs what it validated — so **the server is the enforcement point**.
   State plainly what the client may decide and what only the server may decide, and what a compromised
   client could still do. This is the section a reviewer will attack hardest.
6. **The graded requirement status**, carried over honestly from axis 2: for each requirement,
   SPECIFIED (with the quote and line) / SUGGESTED / OUR CHOICE. Do not present our choice as an
   obligation, and do not present an obligation as our choice.
7. **The management surface** — where the dashboard page mounts, how it is gated to the three tiers,
   and how add/remove/modify maps onto the existing write paths.
8. **The acceptance plan**, including the five negative paths in `ruling-acl.md` — and say plainly
   which are assertable today against which existing test files, and which need new ones.
9. **The build order** beyond increment 1, one line each, in dependency order.

## What `order-increment-1.md` must contain

Increment 1 as executable steps: exact files, exact import re-pointings or additions, the evidence
commands, the counts to quote before and after (**the typecheck baseline on this base is exactly 522**),
and the exit criteria. A competent executor should need no further decisions from you.

## Rules

- Every claim about code carries `file:line`; every number carries its command.
- Separate **measured** / **read from source** / **judged**. `UNVERIFIED` is legitimate and better than
  a guess.
- **Do not decide the sibling run's shape** (`runs/2026-11-13-auctions-ui/`) and do not touch its files.
- Mask key-shaped literals in any captured output.
- If the trust question cannot be answered without a ruling, say exactly that and stop — that is a
  stop condition, not a gap to fill with an assumption.

## Report back

The decisions with their leans (so the parent can put them to the owner), the increment-1 steps, and —
separately — every place where the research contradicts the order or itself.
