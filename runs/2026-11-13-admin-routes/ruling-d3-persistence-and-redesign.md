# Ruling — D3 refined, payment-proof persistence, and a commission for independent redesigns

Owner, 2026-11-13. His words, then what binds.

> "I'm starting to think an independent redesign of the architecture based on our needs may bring some
> good candidate designs to life, so please execute those in parallel. Meanwhile a simple solution to
> the 'relay is off' and 'cold start' problem is to persist the zap events and their cryptographic
> signatures in the server's own event-store. That would allow checks to take place with no relay
> connection at all. However I don't know if this fixes the 'first paying user's purchase silently
> deletes every admin route', that sounds like a bigger problem. Let me know how you want us to fix.
> Meanwhile as for D3 - if there is a failed receipt check for a new purchase, then the reservation
> fails. that holds up. I suggest we then improve it such that the reservation is maintained
> throughout the lease. Meanwhile the admin should always be able to reassign specific routes, so if
> there is a failure to renew due to technical problems the admin can always reassign. But again I feel
> that this system is maybe not the right modular design given our new requirements, so I'm curious to
> see one or more independent redesigns based on what we need, based on a routes ownership system,
> payment system to purchase them (zaps, nutzaps), payment verification, and persistence of payment
> proof and of the routes database."

## 1. D3 — refined and settled

- **A failed receipt check for a NEW purchase fails the reservation.** Fail closed. Holds as accepted.
- **Once granted, the reservation is maintained throughout the lease.** Not re-verified on every read;
  the grant is a standing fact for its term. This replaces v1's "stale-while-error" row — which the
  review showed was justified by a doc comment rather than by code — with a **commitment to build**.
  The cold-start hole it left (a rejected read rendering a loading state indefinitely) is closed by
  §2 below, because the check no longer depends on a relay at read time.
- **The admin can always reassign any specific route.** So a renewal failure caused by technical
  problems is recoverable by an admin, and the "loses the name at its term" cost is bounded by that.

## 2. Payment proof and the routes database, persisted server-side — the direction, accepted

Persist **zap/nutzap events and their cryptographic signatures in the server's own event-store**, so a
check needs no relay connection at all. Measured reasons this is the right direction:

- the app **already has** an event store (`sdk/core/event-store/applesauceEventStore.ts`,
  `eventAccess.ts`; server-side persistence is exercised by
  `platform/server/server-bootstrap-persistence.test.ts`), so this is an extension of live machinery,
  not a new subsystem;
- the zap path **does not persist at all today**: `platform/server/ZapPurchaseManager.ts:125-129`
  *skips old receipts to avoid re-processing on server restart*, i.e. it **re-derives from relays every
  time**. That is the cold-start fragility named in the ruling, measured;
- the server already has the manager pattern to host this (`AdminManager`, `EditorManager`,
  `BlacklistManager`, `Nip05Manager`, `BootstrapManager`).

## 3. Does persistence fix the clobber? **No — and here is the mechanism, and the fix**

**It does not, on its own, and it is a different axis.** The destructive behaviour is a **write-path**
fault, not a verification or read fault:

- `publishRegistry()` (`platform/server/ZapPurchaseManager.ts:393-406`) rebuilds the **entire**
  kind-30000 event, serialising from an **in-memory map that only holds `vanity` entries**
  (`VanityManager.ts:97-112` emits only `['vanity', name, pubkey, validUntil]`). Anything that map does
  not know about — every `route` tag, the `route-default` marker, editor grants — is **dropped on the
  next write**.
- So it is **every receipt**, not a race. Persisting the receipt changes nothing about it: the write
  still rebuilds from a partial view and still drops the rest.

**How I would fix it, in order of strength:**

1. **One store, one serialiser.** The publish step must serialise from a store that holds *every* entry
   class — routes, grants, reservations, the default marker. If the persisted routes database is that
   store, the clobber disappears by construction. This is the piece the owner's instinct is right
   about: persistence is **necessary but not sufficient** — it fixes the clobber only if the *same*
   store is what the publish step reads.
2. **Read-modify-write, not rebuild.** A client of a replaceable event must fetch the current event,
   merge its change, and publish the result. The current code never fetches first.
3. **Stop sharing one event between two namespaces.** A scarce, app-signed, paid reservation namespace
   and a many-per-author, author-signed route/page namespace have **different writers, different
   volumes and different trust**; giving them one replaceable event guarantees interference. **One
   writer per event.**
4. **Page paths need not live in that event at all.** Measured: kind 30024 **is addressable** — it
   carries a `d` tag and the code comments it as "one per pubkey" (`storefrontPage.ts:7`), with a
   **fixed** d-tag constant today (`storefrontPublish.ts:60` → `STOREFRONT_PAGE_D_TAG`). Because the
   kind is addressable, **many pages per author is natural**: hundreds of pages = hundreds of `d`
   values, one event each, no shared write, no size ceiling. The fixed d-tag is the only thing making
   it one-page-per-author today.
5. **Pin it with a regression test that does not exist.** Write a reservation, then assert that an admin
   route and the default marker still resolve. Its absence is why this went unnoticed.

## 4. The commission — independent redesigns, in parallel

The owner wants **one or more independent candidate architectures**, designed from the requirements
rather than evolved from v1. Each candidate must address, as one coherent system:

- **a routes ownership system** — who owns a path, what ownership means, how it is transferred;
- **a payment system to purchase routes** — zaps **and nutzaps**;
- **payment verification**;
- **persistence of payment proof** and **persistence of the routes database**;
- the standing requirements: the **three-tier ACL** (admin full control; editor per-path grants;
  premium/paid reservations), **R1–R4** (many pages per author — hundreds; a unique path each; a
  general path resolving to the **newest** page of that kind; the home as just another path), the
  **`list` reference** as a marked follow-up, and the **clobber** of §3 — which each design must either
  make impossible or handle explicitly.

Candidates are independent: each states its **central bet**, and if measurement refutes the bet it says
so rather than defending it. Diversity is the point — three variations of one idea is a failed
commission. The v1 revision already in flight is treated as the **conservative candidate** (minimal
change from v1) for comparison, not as a competitor to be beaten.
