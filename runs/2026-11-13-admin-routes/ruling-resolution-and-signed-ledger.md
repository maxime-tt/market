# Ruling — server-side resolution, route-vs-lease, signed instance ledger

Owner, 2026-11-13. Answers to the five open questions, plus one correction to my framing.
His words are the authority; the decomposition below is what binds the design.

## What he ruled

### 1. Who resolves the route — SERVER, and "client preference" means self-hosting only
> "I would point towards making it the server ... you're hitting that server, and the server looks
> it up in this routing table and sends you the page that is listed there ... no client-side
> preference for an app, but the client-side preference is self-hosting. It's not, I edit your
> instance."

- **The server resolves and serves.** The route table is server-side state; an HTTP request for a
  path is answered by the server consulting that table. Not a per-user client preference.
- **The only "client-side" choice is which instance you use at all** — i.e. self-hosting. A user
  does not remap another operator's routes; they run their own instance if they want different ones.
- **Consequence for the candidates:** B's *write discipline* (server re-signs after validating) is
  now required rather than merely preferred, because the server is the enforcement point by ruling.
  The design must state what the server serves when it cannot resolve (see the fork below).

### 2. Route ⇄ page is not one-to-one — one page by default, seller page as the fallback
> "I wouldn't keep it so tight as to say that it can only be one page, but I would say that you
> should have one page there, and if there is no page then it points to the seller's page ...
> a default built page."

- A route should **point at one page** as its normal state. Do not model it as a strict 1:1
  constraint — the relationship is "the page this route currently serves", not an ownership
  invariant between two records.
- **No page configured → the seller's built page** (today's behaviour: the default built page).
- **Subpaths are in scope.** A lease on a path carries the right to subpaths beneath it.
  The design must state the separator rule and the precedence between a parent lease's subpath and
  a child path granted to someone else (this is a real conflict case, not a hypothetical).

### 3. Lease expiry vs admin remap — two different mechanisms, do not conflate
> "you're kind of confounding two things ... when the lease expires ... it should end up with a 404
> ... While an admin doesn't have a lease, he just sets the route ... It's just a route change."

- **A lease is time-bounded and user-held.** On expiry: **404** — the space is gone because the
  lease lapsed and was not renewed. Not a revert to a default, not a silent fallback.
- **An admin route is not a lease.** It is an unbounded route change: "dashboard" may point at a
  custom dashboard page because the admin chose that. No expiry, no 404-on-lapse.
- My earlier framing ("remapped route when the lease expires") conflated these. **Corrected.**
- So the route table has at least two **kinds of binding**: an admin binding (no term, replaced by
  another admin action) and a lease binding (has a term, dies to 404). The design must not model
  them as one row type with an optional expiry, or the 404-on-lapse rule gets lost in the default.

### 4. Enforcement — SERVER-SIDE
> "Again, to me, it sounds like this is server side"

- The server is the layer that stops serving a withdrawn or expired binding. A client-side check is
  at most advisory. (The "page withdrawn" wording confused him; the design should use his words —
  lease expired / lease terminated — rather than "withdrawn", and should state what happens for
  each: **expired → 404**, **terminated by the provider → 404**, both server-enforced.)

### 5. The shareable list IS signed by the instance
> "if the app instance itself was signing the confirmation that these things were actually valid
> leases ... post them to Nostr and share that they are valid ... anyone can verify a public ledger
> of the transactions ... those same signed events can be queried from the server"

- The **instance signs a confirmation** of each valid lease. That signed confirmation is published
  to Nostr as a **public, verifiable ledger** of the transactions.
- **The signed event is also queryable from the server** — the server is the authority; Nostr is the
  shareable mirror. This is the anti-pattern rule applied correctly: the server serves its own
  state, and publishing to Nostr is the *bonus*, not the read path.
- **Consequence:** honoring another instance's leases must be an **opt-in, per-instance list of
  which instances' signatures you accept** — a published list you choose, not an automatic import.
  The owner agreed the bio-style "once seen everywhere" model is opt-in and deferred.

## What this changes in the candidates

- **The read path is the server's own store.** Nostr holds the *published confirmation*, not the
  authority. A relay being down must not stop the instance serving its own routes — this is the
  same rule as the app-settings anti-pattern, and it now applies to routes too.
- **The signature is the instance's, not the app key's alone.** The confirmation event is signed by
  the instance identity and says "this lease is valid"; that is what another instance can verify.
- **404-on-expiry is a hard, tested behaviour**, distinct from "no page configured → seller page".
  These two fallbacks must not be implemented by the same code path, or one will shadow the other.
- **Subpaths need an explicit precedence rule** — not left to "longest match wins" by accident.

## Still open after this ruling

1. **What does the server serve when it cannot resolve a path?** (store unavailable / not yet
   bootstrapped). The anti-pattern rule forbids "depend on the relay", so the answer cannot be "ask
   Nostr". Candidate answers: a local snapshot shipped with the app, an honest 404, or a
   degraded-mode page — each with a different failure story. **This is the remaining fork.**
2. **What identifies "the instance"?** An operator key? A domain? Both? It decides who can verify a
   confirmation and who can be held to it.
3. **Subpath precedence** — parent lease vs child grant on the same prefix.
4. **Does a confirmation cover a lease's whole term**, or is it re-signed on renewal? It decides
   whether a verifier must track many events or one.
