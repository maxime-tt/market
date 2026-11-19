# Ruling — the ACL for routes and pages (2026-11-13)

Owner's words, verbatim, because this is the answer to the run's trust question and it binds the
design:

> "the 'ACL' between admins, editors and regular (premium/paid) users, will be such that admins have
> full control over the app and its pages, editors will be able to create and publish pages to new
> places and will be granted specific access to specific paths, and then premium/paid users will be
> able to reserve a path/domain for themselves as part of their store."

## The three tiers, decomposed

1. **Admin — full control over the app and its pages.** Not merely "can edit every route": controls
   the app and its pages, i.e. can create, modify, remove and reassign *any* route, including one
   held by an editor or reserved by a paying user. Also the tier that can author the **default**
   route.
2. **Editor — can create and publish pages to new places, and is granted specific access to specific
   paths.** Two distinct powers, and the second is the interesting one: creation is broad, but
   *access* is **per-path and explicitly granted**. So authority is not purely role-based — a route
   entry carries who may touch it, and an editor's grant names paths rather than conferring a blanket
   right.
3. **Premium/paid — may reserve a path/domain for themselves as part of their store.** A reservation,
   not an assignment: self-interested (their own store), **time-bounded by implication of payment**,
   and attached to a user rather than granted by an admin.

## What this resolves immediately

- **The expiry problem has an answer.** The existing registry's `validUntil` is exactly the shape of a
  paid reservation's term. So: **admin and editor routes are permanent; a reservation is a term that
  lapses** (with renewal). The existing field is not an obstacle to be worked around — it is the
  reservation's own semantics. *(Axis 02 was asked to enumerate expiry options; this is the ruling.)*
- **The trust question stops being open.** The registry is authored by the app key today; the tiers
  above say *who is allowed to cause a change*, not yet *who signs it*. That remains a design choice
  and is the next thing to settle (below).

## What it leaves open — settle in the proposal, each with a lean

1. **Who signs a self-service reservation.** A paying user reserving a path is not the app key, and
   the registry is app-key authored. Options: the app key signs on the user's behalf after checking
   entitlement (simple, but the app key becomes an authority that can rewrite any entry); or a
   separate user-authored reservation event the app key *acknowledges* (more honest, more moving
   parts). State the lean and what each gives up.
2. **Is a reservation self-service or admin-approved?** "Will be able to" reads as self-service, but
   nothing says the grant is automatic. Say which, and whether an admin can veto or reclaim.
3. **What proves entitlement.** Whatever decides "this user has paid for this path" — and what
   happens when that evidence is unavailable. Fails closed or fails open is a decision, not a default.
4. **Conflict precedence.** An admin route, an editor grant and a reservation can name the same path.
   Which wins, and is the loser told? Admin-full-control implies admin wins; the other two need a rule.
5. **Lapse and renewal.** When a reservation expires: does the name free immediately, is there a grace
   window, and can someone else take it in the gap? A paying user losing a storefront path with no
   notice is the failure mode to design against.
6. **What "path/domain" means.** A route name in this app (`/home`), or an actual DNS domain? The
   example given is a path. Do not assume the wider reading; state the narrower one used and flag it.
7. **Naming rules and collisions.** Case (the existing registry lowercases names), permitted
   characters, reserved words, and collision with real routes and profile names.

## The negative paths the acceptance must now cover (added to axis 03)

- an editor attempting to touch a path **not** in their grant → refused, and the refusal is a visible
  state, not a silent no-op;
- a premium user attempting a path already held by an admin or editor route → refused, with the
  reason stated;
- a reservation used after its `validUntil` → no longer resolves, and the holder is told *before* it
  lapses;
- an admin removing another tier's route → takes effect, and the affected holder is informed;
- the **default** route occupied by a reservation that lapses → `/` must not blank out; it falls back.
