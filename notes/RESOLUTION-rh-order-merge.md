# Resolution — merging `d7s2/rh-result-order` into `unite/1420-all`

The branch is one commit, `047484564` "render the service's ranking, not the relays'
arrival race" (+109/−3 across `rabbitholeClient.ts` and its test). It no longer merges
mechanically: the parallel session has since changed `rabbitholeClient.ts` (relay
verdicts as `{relay, reason}`, the derived client deadline, streaming frame dispatch),
so the single conflict is a **union**, not a choice.

Do it in a branch off the current head, not in the live worktree:

```
git -C /home/admin_maxime/work/market worktree add ~/work/wt-rh-order \
  -b d7s2/rh-order-merge unite/1420-all
cd ~/work/wt-rh-order && git merge d7s2/rh-result-order
```

`platform/web/browse/rabbitholeClient.test.ts` auto-merges — keep it as merged.
In `platform/web/browse/rabbitholeClient.ts`, keep every current hunk and apply the
branch's three additions:

1. **After** `const relaysByCoordinate = new Map<string, string[]>()`, add:

```ts
	// The index's hit order IS the service's relevance order, and the `event`
	// frames arrive in whatever order the relays happen to answer.
	const hitRank = new Map<string, number>()
```

2. **In the `search` frame's hit loop**, capture the rank by position before the
   existing relay bookkeeping continues:

```ts
				for (const [rank, hit] of (frame.hits ?? []).entries()) {
					if (hit.event_id && !hitRank.has(hit.event_id)) hitRank.set(hit.event_id, rank)
					if (!hit.relays_seen || hit.relays_seen.length === 0) continue
					/* …the existing relaysByEventId / relaysByCoordinate lines… */
				}
```

3. **Before the function's returns**, order the products and use the ordered list in
   both return paths (`indexOnly` and `toBrowseSearchResult`):

```ts
	const ranked = orderByHitRank(products, hitRank)
```

4. **Append** the helper (verbatim from the branch):

```ts
function orderByHitRank(products: BrowseProduct[], hitRank: Map<string, number>): BrowseProduct[] {
	if (hitRank.size === 0) return products
	const UNRANKED = Number.MAX_SAFE_INTEGER
	return products
		.map((product, arrival) => ({ product, arrival, rank: hitRank.get(product.eventId) ?? UNRANKED }))
		.sort((a, b) => a.rank - b.rank || a.arrival - b.arrival)
		.map((entry) => entry.product)
}
```

Ranking keys on `event_id` **only** — the index slugs a hit's `coordinate` with
title-derived text, so a coordinate key can rank the wrong product. Products no hit
named stay in arrival order after the ranked ones (real data, just unranked).

## Why this is the right union

Measured before the fix on the live app, query `cold wallet`: the index returned
OneKey Classic 1S first and the UI rendered it **eighth**, behind a music magazine and
a painting, purely because a slower relay delivered its payload later. The service's
ranking was being computed, streamed and then discarded.

## Acceptance

`bun test --isolate platform/web/browse` (the branch added two tests, both proven RED
before the fix), `bunx tsc --noEmit` ≤193 sites, `prettier --check`. Then commit, push
the branch to `fork` and `nostr`, and merge it into `unite/1420-all` once that
worktree is clean of the other session's in-flight edits.
