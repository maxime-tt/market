# Ruling — D1 and D3 accepted; D8 reframed as multi-page publishing; lists flagged as follow-up

Owner, 2026-11-13. His words verbatim, then what binds the design.

> "as for D1 and D3, they sound good to me, similar to the existing mechanisms, happy to run with those.
> meanwhile for D8, I feel the 'admin's page can be the home' is a misunderstanding - people should be
> able to publish multiple pages, under multiple paths, specifically admins/editors should be able to
> publish many pages (e.g. a weekly featured page) which can be found under unique custom paths (i.e.
> featured-13-11-2026) and more general paths that will point to the most recent page like /featured.
> A single admin / editor could have hundreds of custom browse pages created throughout their instance.
> Ensure that specific requirement is met by the design. Otherwise, we also need a way to link to any
> product, and I would point an easy mechanism to be 'by list', such that the admin can add multiple
> products to a list, and then name that specific list in the CMS to display those items. List
> management is currently only blacklist and featured list, and we need to expand it such that all
> users are able to use lists more generally in the app, but this should be a follow up point that you
> should take note of."

## 1. D1 and D3 — ACCEPTED, settled

Both stands as the proposal's leanthem. No further work. D1: the app key signs after the server checks
the receipt; D3: new reservation with no usable receipt fails **closed**, an existing unexpired one
during a relay outage keeps being honoured (**stale-while-error**). The cost of D1 is accepted with eyes
open: a reservation is the operator's statement, not a third-party-verifiable credential.

## 2. D8 — REFRAMED. The question was wrong, not the answer

The proposal asked "should the home be a page an admin can author". **That is a misunderstanding of the
requirement.** The requirement is not about *who* authors the home; it is that **many pages are
publishable under many paths**:

- **people** publish multiple pages, under multiple paths;
- **admins and editors publish many pages** — a weekly featured page being the example;
- each carries a **unique custom path** (`featured-13-11-2026`);
- and a **general path** points at the most recent page of that kind (`/featured`);
- scale: **a single admin/editor could have hundreds** of custom browse pages across their instance.

So the design must satisfy, as a hard requirement:

- **R1 — many pages per author.** Not one page per author, not one page per name. Hundreds.
- **R2 — a unique path per page**, distinct for each published page.
- **R3 — a series/general path that resolves to the NEWEST page in that series.** `/featured` is not a
  fixed target; it is a dynamic resolution whose answer changes as new pages are published. (This is a
  new resolution mode: "latest in series", not "point at a thing".)
- **R4 — the home is just one more path** (the default route), not a privileged special case.

### The structural consequence, flagged before anyone builds — D4 and this requirement collide

The proposal's D4 lean is **"one name, one entry"**, justified by the registry being a **single
replaceable kind-30000 event rewritten wholesale** (`sdk/core/curation/vanityRead.ts:5`). That works for
a handful of vanity names. **It cannot carry hundreds of pages per author**, for three independent
reasons, and this must be settled rather than discovered later:

1. **One event has one size ceiling**, and hundreds of page entries plus NIP-01 tag encoding will reach
   it. A protocol that breaks at the scale the owner just named is not a protocol.
2. **Write amplification and lost updates.** Rewriting the whole table on every change means two authors
   publishing simultaneously clobber each other — the exact lost-update race already flagged for
   adversarial review, made certain by scale rather than merely possible.
3. **Authorship.** Each page is authored by the admin/editor who made it, and should be **their own
   signed event** — not a line inside an app-key-signed blob. D1's lean (the app key signs) is about
   *reservations the app is paid for*; it should not be stretched to mean every admin's page is
   published under the app's key.

**Therefore the likely shape** — to be argued and measured, not assumed: pages become **per-page
addressable events** (the storefront page document already exists as kind 30024, authored by the page's
author), and the "route table" becomes a **resolution and index layer over them** rather than the
storage. The registry keeps what it is genuinely good at — the small, scarce, app-key-signed namespace
of *reserved* names — while paths bound to pages are read from the pages themselves (or from a per-author
index). The proposal must be revised to say which, with the consequence of each.

## 3. Product linking by list — NOTED AS FOLLOW-UP, but it shapes the reference model now

- Need: **a way to link to any product**, and the owner's suggested mechanism is **"by list"** — an
  admin adds multiple products to a list, then **names that list in the CMS** to display those items.
- Today list management is **only a blacklist and a featured list**; the requirement is to **expand it so
  all users can use lists generally** in the app.
- **Explicitly a follow-up point**, to be taken note of — not built in this increment.

**What it changes now anyway:** the CMS reference model must have room for a **"list" reference** whose
meaning is "the members of the named list", so that the follow-up is an addition rather than a
re-architecture. A design that only understands "a coordinate" or "a pubkey" would have to be reopened.

## 4. What this means for the work in flight

- **Increment 1** (the framework-free route table): its wire format and parser are probably still right,
  but it must not foreclose R1–R4 — no "one page per name" assumption baked in, and the target type must
  be able to grow a series/latest resolution and a list reference.
- **The adversarial review**: the multi-writer question is no longer hypothetical. A single rewritten
  table with hundreds of pages and several concurrent authors is a guaranteed collision, so the review's
  finding on that point decides whether D4 survives at all.
- **The design must be revised** to meet R1–R4 with a measured answer, each option with its consequence.
