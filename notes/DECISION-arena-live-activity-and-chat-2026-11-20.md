# Decision — live activity + lot chat on the arena 1440 family

**Status:** decided by the owner (Maxime), 2026-11-20. Binding for
`notes/HANDOVER-2026-11-20-live-activity-and-chat-to-arena.md`.
**Increment:** repoint the NIP-53 live-activity worker and lot live chat from the
retired `30408:<seller>:<d>` coordinate onto the arena `1440:<seller>:<d>`
coordinate.

---

## 1. Chat stays NIP-53 (handover §6.1)

Keep `1311` chat messages and `30311` live activity; change only the
**coordinate family** the room is rooted on. The alternative — the chain's `1442`
chat — is ruled off-limits in-repo (`notes/DECISION-auction-kinds-and-editable-allowlist.md`
§2, "we do not use 1442 at all") and nothing in-repo reads `1442`. No kind
decision is needed; the chat kind, the activity kind, the digest `d`-tag, the
author lock and the client filters all stay.

Room identity: `30311:<cvmServerPubkey>:auction:<sha256("1440:<seller>:<d>")[:12]>`.

## 2. What gates live activity (handover §6.2)

**Every open 1440 lot gets an activity. No opt-in tag.**

The retired 30408 discovery relied on a seller-opt-in `live_chat` tag; a 1440
create has no such tag (`sdk/commerce/auctions/auctionForm.ts` records
`enableLiveChat` among the removed knobs). Adding a content field would be a
protocol change needing its own ADR; creating the activity on demand would make
the room's existence depend on a viewer. So discovery is `{ kinds: [1440], since,
limit }` and openness is decided **per lot** from its end (committed 1449 when
the chain published one, else create-derived), skipping a lot whose end has
passed or which states no readable end.

## 3. What `starts` means (handover §6.3)

**The root create's own `created_at`.**

A 1440 carries no scheduled start: the 30408 `start_at`/`end_at` scheduling tags
are gone (`sdk/commerce/auctions/arena/arenaCreate.ts` reads only the create
content). There is no "starts at" field on a 1440 to prefer, so the activity's
`starts` is the create's `created_at`.

## 4. Two-source end, never blurred (handover §4.1)

The activity's `ends`/`status` follow the same rule the lot page follows
(`ui/auction/arena/model.ts`, `endSource`):

- **committed end** — the kind-1449 the chain published while the lot is open,
  at the highest anchored height, when one exists;
- **create-derived end** — `root.created_at + durationSec` otherwise;

a create-derived end is never presented as the committed end.

## 5. E2E gate (handover §7)

**The Playwright video gate is waived for this PR.** The arena has no seed or
verdict source (`scripts/gen_auctions.ts` is 30408-only; the only arena harnesses
need a live chain, relay and mint), so building one is far larger than this
repoint. This PR lands with unit + integration proof:

- worker unit tests (`contextvm/tools/__tests__/live-activity-worker.test.ts`):
  discovery is `1440` with no `#live_chat`; the published coordinate is
  `1440:<seller>:<d>`; an ended lot is skipped;
- chat query tests (`platform/web/messaging/liveChat.test.ts`): the `#a`
  coordinate is `1440:<seller>:<d>`, never `30408:`;
- `nip53` / `liveChatRead` tests: the retired `30408` family is rejected.

Recorded in the PR description as required by the handover.
