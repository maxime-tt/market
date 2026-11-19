# Ruling — file-not-database, the resolution ladder, and top-level-only leases

Owner, 2026-11-13. Closes the storage fork and the subpath questions. His words are authority.

## Storage: a file, not a database — and no fallback when it breaks

> "a database is maybe overkill and a single file can do the trick. And if the file is somehow
> unreadable, then that means your site is broken. We don't need to worry about that because that's
> like saying, what if my engine is not working? Well, guess what? Your site is broken. You don't
> have a fallback website after engine X is broken."

- **The routing table is durable server-side state in a single file.** No database, no cache layer,
  no read-through store, no local-snapshot-plus-live-source arrangement.
- **An unreadable table means the site is broken.** That is an accepted failure, not a design gap.
  No degraded mode, no fallback page, no "serve stale routes" story. The operational answer is a
  backup and a monitoring alarm, not an architectural layer.
- **This closes the fork I raised.** My snapshot/degraded-mode proposal is withdrawn: it was solving
  a problem created by over-specifying storage. The simple version is correct.

## The resolution ladder — three rungs, in order

> "you have programmed routes, you have like Nostr wildcards, and then you have 404 ... there would
> be a subpath that catches that wild card there."

1. **Programmed route** — an exact path in the routing table resolves to its binding (page, or a
   parameterised page route). Resolution happens **entirely server-side, with no network call**: no
   relay and no indexer is consulted to decide which path matched.
2. **Parameterised route under a prefix** — e.g. `/item/:eventId`, `/p/:npub`. The pattern is a
   programmed route; the identifier arrives in the URL. **These need no indexer to route.**
   The page itself may then look the object up — that lookup is a **page-level** concern, after
   routing. If it fails, the correct error is "item unavailable", **not** "route not found".
   A bare top-level catch-all (`/:id`) is **rejected**: it competes with every programmed route and
   makes precedence subtle (a mistyped `/auctons` would attempt a lookup instead of 404ing).
   Prefixes keep precedence trivial — **longest programmed prefix wins**.
3. **404** — the honest default. Nothing served that cannot be vouched for.

## Leases: TOP-LEVEL PATHS ONLY — and subpaths go with the parent

> "you cannot lease a sub path directly ... You can only lease a path like a top level path ...
> only a path can be leased and you get all the subpaths with it. Therefore ... if the parent lease
> expires, then all the subpaths go with it as well."

- **A lease is taken on a top-level path only.** No lease may be taken directly on a subpath.
- **A leased path carries its subpaths.** The leaseholder controls what lives beneath it.
- **Parent expires → every subpath beneath it dies with it.** No orphaned bindings. This replaces my
  proposed precedence question: the conflict case I raised (`/shop` leased, `/shop/featured` granted
  to someone else) **cannot arise**, because nobody can hold `/shop/featured` without holding
  `/shop`. The rule is structural, not a tie-break.
- **Consequence for the design:** subpath precedence does NOT need a matching rule. It needs a
  *validation* rule — "can this lease be granted at all?" — answered by "is this a top-level path,
  and is it free?". Simpler than what I proposed.
- **Pages remain addressable by event ID** even under an expired lease (a direct `/subpath`-style
  address to a published event). Noted as the owner's aside; **not part of this build** — it belongs
  to the architecture we have not built yet.

## What this leaves open

1. **What identifies "the instance"** for the signed lease-confirmation ledger — an operator key, a
   domain, or both. Decides who can verify a confirmation and who is accountable for one. **Still
   the one real open question.**
2. **Admin bindings under a leased path.** A leaseholder controls subpaths; an admin can remap
   routes. If both want the same subpath, who wins? The lease is bought and time-bounded, the admin
   binding is unbounded — this is the one precedence question that survives, and it should be ruled
   deliberately rather than left to code order.
