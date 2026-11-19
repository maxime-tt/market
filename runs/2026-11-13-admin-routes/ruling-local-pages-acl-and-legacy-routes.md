# Ruling — local page storage, pubkey-tiered ACL, and legacy routes must be superseded

Owner, 2026-11-13. Answers to the three raises from the consolidation. His words are authority.

## 1. No relay round-trip for served data — and the "private-use relay" model

> "you should be storing that data locally. Which is anyways meant to be the case, so note that - no
> relay round trip for served data such as pages. However, an interesting nuance is that if that data
> is stored as blossom or nostr data, then you are basically hosting a private relay for the server's
> own personal use. I think that's where I'd differ with the plebeian relay's architecture - we want a
> private use relay that only stores critical data that needs to be available, not a general use,
> publicly writable relay with the consequences that come along with it (such as the current out of
> memory errors). The pages can equally be stored in different formats in a custom database in a more
> efficient way, I don't mind. Just, no nostr round trip for a page that is in a set route - since that
> also decides on the page being able service search engines / SEO, page previews etc. It must have
> instant responses."

Binding:

- **A page at a set route is served from local storage. No relay round-trip on the read path.** This
  supersedes increment 1's "fetch the event by id at request time" — the single riskiest item in the
  plan (`report-consolidation.md` §4) is **now a non-question**: we do not read the relay to serve a
  bound page.
- **Storage format is the implementer's choice.** "a custom database in a more efficient way, I don't
  mind." So the routing table (already a file) and the page store may use whatever format serves the
  requirement; nothing is bound to JSON or to events-on-disk.
- **The mental model is a PRIVATE-USE store**, not a public relay: *"a private use relay that only
  stores critical data that needs to be available, not a general use, publicly writable relay."*
  The **out-of-memory errors are named as the symptom** of the public-writable model. Consequence:
  whatever ingest path exists must be **write-restricted** (specific pubkeys, specific kinds), not an
  open relay.
- **The driver is not just speed: it is SEO.** *"that also decides on the page being able to serve
  search engines / SEO, page previews etc. It must have instant responses."* So server-side rendering
  of bound pages is **in scope for the requirement**, not an optimisation. Note the current server is
  documented in its own code as *"a SPA + config + nip05 host"* (`platform/server/startup.ts:56-57`),
  so this is a real departure from the current shape — and `platform/server/ogMeta.ts` is the existing
  toehold (it already renders meta server-side).

## 2. The ACL — tiered by Nostr public key, and a signed event is the credential

> "ACL is simple: tiered access by nostr public key. That's what we currently do and we can eventually
> extend it, but the current model of app -> admin/owner -> editor -> no acl is fine and will do for our
> current purposes. The write should be a nostr signed event and can find the right way to send those
> events to the app, whether it's writing to the app relay (which might only accept a specific set of
> events from specific pubkeys) or listening to public relays (which might be more expensive resource
> wise and anyways would have a similar filter list)."

Binding:

- **The actor is the signing pubkey of an event.** That closes the plan's open question O-1
  (`ARCHITECTURE.md` §10) **without NIP-98**: the credential is a signed Nostr event, and the tier is
  looked up by pubkey. The existing WS path — signature-checked then re-signed
  (`platform/server/websocket.ts:30` → `EventHandler.ts:238`) — is the template.
- **Tiers, as ruled:** `app` (the instance itself) → `admin/owner` → `editor` → **no ACL**. Note this
  is a **four-level** model with `app` above admin, superseding the three-tier ACL in
  `ruling-acl.md` for *authority* purposes.
- **Writes are signed events; the TRANSPORT is deliberately left open** — "can find the right way to
  send those events to the app": either the app's own relay (write-restricted to specific pubkeys) or
  listening to public relays with a filter list. So transport is an implementation choice, and the
  private-relay model of §1 is one valid answer.
- **Consequence:** a **lease is not a tier.** A lease grants a *path*; a tier grants *authority*.
  The same person may hold both, either, or neither, and the design must not conflate them.

## 3. Compiled-in routes MUST be superseded — the plan's refusal is REVERSED

> "the compiled-in routes will have to be superceded by pages that are placed in the new routing
> system's routing tree. I wouldn't CMS-rebuild all those pages but would still consider their contents
> modular, such as replacing a navigation bar or otherwise for a dashboard section if possible. That
> goes into the 'what' and not the 'how' of the routing vs. the routing contents which will be our next
> step. So short answer: legacy routes will need to be superceded and re-pointed by the routing tree to
> the specific pages. I would take advantage of this and turn these pages into more elegant,
> modularized and component-based pages that serve as 'sub-apps' with their sub-paths (browse
> experience, seller dashboard, buyer/orders dashboard, and more...) Such that we are never building a
> monolith up again."

Binding, and it **reverses** `ARCHITECTURE.md` §10 item 5 / `report-consolidation.md` §5 item 5:

- **Legacy compiled-in routes are re-pointable by the routing tree.** `/dashboard` and its siblings are
  **not** an exception and **not** refused by the validator. The validator must **allow** binding a
  compiled-in path (with a warning, not a refusal).
- **Not a CMS rebuild.** Their *contents* become modular — *"replacing a navigation bar or otherwise
  for a dashboard section"* — i.e. **replaceable regions inside a page**, not page-by-page
  reconstruction.
- **The direction of travel:** legacy pages become **modular sub-apps with their own sub-paths**
  (browse experience, seller dashboard, buyer/orders dashboard, …) *"so that we are never building a
  monolith up again."*
- **Sequencing is explicit:** superseding/re-pointing is routing; the modular contents are the
  **next step** after routing. So the plan must be able to re-point a legacy path *without* requiring
  the page to be modularised first.

## The questions these answers open — with a lean each

The owner expects iteration on this, so these are stated rather than resolved.

1. **What is the page store, and does the app render server-side?** Serving a page locally is now
   required, and SEO/instant response is the driver. Options: (a) store the page *definition* and
   render server-side on request; (b) store a rendered copy produced at publish time; (c) keep the SPA
   for the app and prerender only bound pages. **Lean: (b) for bound pages — render at publish, store
   the result — plus the existing `ogMeta.ts` path for previews.** It gives instant responses and SEO
   with no SSR framework migration, and it keeps the SPA for interactive app surfaces. Needs a ruling
   because it decides whether the app gains an SSR tier at all.
2. **Does the app run a relay, and is it the one the auctions use?** "a private use relay that only
   stores critical data" implies a store with a write allowlist. Options: one instance serving both
   the public auctions role and the private app role (with filters), or two roles kept separate.
   **Lean: separate roles; the public/auctions relay is not made the app's private store.** The
   out-of-memory symptom he named is an argument against mixing them.
3. **Is the private store a relay at all?** He said "if that data is stored as blossom or nostr data,
   then you are basically hosting a private relay" — i.e. the relay framing is a *consequence* of
   choosing event-shaped storage. Since format is free, this is open. **Lean: store natively (the
   format that serves the requirement) and treat the relay as, at most, the write transport.**
4. **How modular is "modular"?** Replaceable regions inside a compiled page (a navbar slot) versus a
   page shell that mounts a compiled sub-app. **Lean: a shell with named slots that the sub-app owns
   internally** — it matches "I wouldn't CMS-rebuild all those pages" while making contents
   replaceable.
5. **Do sub-app sub-paths live in the routing tree while leases stay top-level?** The owner wants
   sub-apps *with sub-paths*; leases are top-level-only. **Lean: yes, and they do not conflict** —
   programmed routes may be arbitrarily deep; only *leases* are restricted to top level.
6. **Does re-pointing a legacy path require the page to keep working?** If `/dashboard` is bound to a
   new page, the old compiled tree may still be reachable by URL. **Lean: one binding per path, the
   binding wins, and the legacy URL is not served in parallel** — otherwise two truths, which is the
   class of bug this whole run exists to avoid.
7. **Operational, but it is the symptom he named: the relay's memory.** A write-restricted private
   store answers the architecture; the current OOM is the operational proof that the public-writable
   model is wrong. Worth a separate look, not part of this increment.
