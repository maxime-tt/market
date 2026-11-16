---
module: roles
kind: module
schema: architecture
applies: core@0.1
inherits: [core]
implements: []
opt-out: []
test-support: ['roles.test.ts', 'roleChange.test.ts', 'rolesRead.test.ts', 'rolesPublish.test.ts', 'identity.test.ts']
levels:
  objective: present
  technical-spec: present — the four roles and their precedence, the two list records, the nine role
    transitions and their invariants (owner-protected, last-admin, no-list, already/not-member), and
    the identity seam that is an input and never a fetch
  implementation: present — dependency-free TypeScript, framework-free and store-free: pure functions
    over plain records plus two reads over the host's EventReadContext and one publish over
    EventPublishContext
  tests: present — the predicate, transition, read and publish suites, run by
    `bun test --isolate sdk/core/roles/`
contract:
  entry: index.ts
  operations:
    [getUserRoleForPubkey, isAdmin, isOwner, isEditor, getFormattedAdmins, getFormattedEditors,
     parseAdminSettings, parseEditorSettings, planRoleChange, resolveUserPubkey,
     readAdminSettingsWorkflow, readEditorSettingsWorkflow, publishRoleChangeWorkflow]
  exports:
    [getUserRoleForPubkey, isAdmin, isOwner, isEditor, getFormattedAdmins, getFormattedEditors,
     parseAdminSettings, parseEditorSettings, planRoleChange, resolveUserPubkey,
     readAdminSettingsWorkflow, readEditorSettingsWorkflow, publishRoleChangeWorkflow]
  types:
    [UserRole, AdminSettings, EditorSettings, RoleListsState, RoleChange, RoleChangePlan,
     RoleChangeIssue, RoleChangePublishOutcome]
implementations:
  - id: ts
    lang: typescript
    dir: .
    entry: index.ts
    package: null
    install: [bun, install]
    build: []
    test: [bun, test]
    typecheck: [bunx, tsc, --noEmit]
    needs: [core, curation]
access:
  group: m_roles
  read: [self]
  write: [self]
  exec: [self]
consumers:
  - '`platform/web/app-settings/appSettingsQuery.ts`, the react-query binding for the two list reads and
    the `useAmIAdmin` / `useUserRole` hooks'
  - '`platform/web/app-settings/appSettingsPublish.ts`, which turns a role-change plan into the two
    signed list events'
  - '`platform/web/routes/_dashboard-layout/dashboard/app-settings/team.tsx`, the team screen'
naming:
  reserves: the four role names (owner, admin, editor, user), the role-change verbs, the issue codes
  does_not: no curation-list noun (featured, blacklist, vanity), no event kind, no d-tag, no relay,
    no store, no React and no hook name appears in this module
source:
  decision: owner ruling 2026-11-16 — the role/permission logic already works but is mis-filed in
    `sdk/core/curation`; move it to its own module with the platform roles as first-class concepts,
    delete the old path rather than shimming it
---

# roles — what a pubkey may do on this instance

**The job, in one sentence** — decide what a pubkey may do on this instance: which of the four platform
roles it holds, whether a proposed role change is legal, and how the two role lists are read and
republished.

**What it is.** Two list records (`AdminSettings`, `EditorSettings`) parsed out of the app's kind-30000
`d=admins` / `d=editors` events, a closed set of predicates over them, a pure planner that turns a
requested transition into the lists to republish, and three host-bound operations: two reads over the
host's `EventReadContext` and one publish over `EventPublishContext`. Everything above the host seam is a
plain function over plain data — no ambient state, no cache, no class.

**What it is not.** It does not own the wire catalogue: `CURATION_LISTS` (whose `admins` / `editors` rows
stay put), `readCurationListItems`, `buildCurationListFilter` and the generic `publishCurationListWorkflow`
remain in `curation`, and this module imports them **by file path** (`../curation/curationLists`,
`../curation/curationRead`, `../curation/curationPublish`), never through `../curation`'s barrel —
`curation` imports nothing from here, so the SDK's flat index gains no cycle. It does not fetch identity:
there is no `ndk.activeUser`, no store and no React in the module; `resolveUserPubkey` _maps_ an `AuthUser`
the host hands in. And it does not decide _who_ is signed in — that is `auth`'s.

**Role precedence and fail-closed rule.** `owner` beats `admin` beats `editor` beats `user`, and
`getUserRoleForPubkey` reports the highest. Owner is the first entry of the admin list, falling back to
the app pubkey when the list has no `p` items. `''`, `null` and `undefined` settings or pubkeys are always
`false` / `'user'`. Membership is an **exact** `includes` match on the stored hex string, not
`isHexPubkey`'s case-insensitive regex, so a differently-cased pubkey is simply not an admin — that
behaviour is pinned rather than "fixed", because a case-insensitive compare on identity is a decision, not
a cleanup. Both directions matter and both are pinned in `roles.test.ts`: returning `false` from `isAdmin`
locks a real admin out of `/dashboard/app-settings`, and returning `true` grants publish rights.

**The transition invariants.** Nine verbs — `addAdmin`, `removeAdmin`, `addEditor`, `removeEditor`,
`promoteEditorToAdmin`, `demoteAdminToEditor`, `promoteUserToEditor`, `demoteEditorToUser`,
`removeFromAllRoles` — and a closed `RoleChangeIssue` set: `no-admin-list`, `no-editor-list`,
`already-admin`, `already-editor`, `not-admin`, `not-editor`, `last-admin`, `owner-protected`, `no-roles`.
Four invariants hold across all of them, and the branch order inside `planRoleChange` _is_ the invariant
set:

- **`owner-protected`** — the owner is never demoted or removed by a plan.
- **`last-admin`** — the admin list never empties. Editors may become empty; only admins may not.
- **`no-admin-list` / `no-editor-list`** — a missing list (`null`) is not the empty list (`[]`): a
  transition that needs the list refuses rather than inventing one.
- **`already-*` / `not-*`** — idempotence is a refusal, not a silent no-op, so the caller can tell
  "nothing to do" from "done".

**The read asymmetry is contract.** `readAdminSettingsWorkflow` returns `null` when no admin list exists;
`readEditorSettingsWorkflow` returns the empty editor record. That looks like a bug and is the pre-drain
behaviour both consumers rely on — `rolesRead.test.ts` pins both shapes so a later refactor does not
"harmonise" them. Both throw `'App pubkey is required'` on a missing app pubkey, both fetch exactly one
coordinate, and the newest `created_at` wins.

**The files this module owns.** `roles.md` (this document); `roles/index.ts` (the barrel); `roles/types.ts`
(`UserRole`, the two settings records, `RoleListsState`, `RoleChange`, `RoleChangePlan`,
`RoleChangeIssue`); `roles/roles.ts` (parsers, predicates, formatters, `getUserRoleForPubkey`);
`roles/roleChange.ts` (`planRoleChange`); `roles/rolesRead.ts` (the two reads and a private newest-event
helper); `roles/rolesPublish.ts` (`publishRoleChangeWorkflow` and `RoleChangePublishOutcome`);
`roles/identity.ts` (`resolveUserPubkey`). The five suites declared in `test-support:` sit beside them and
are out of contract.

## What this module is not

**Not dependency-free at the bottom.** It sits _above_ `curation`, because the two role lists are rows in
the same kind-30000 catalogue as the featured lists and are published through the same generic list
workflow. Duplicating that catalogue here would mean two places knowing kind 30000; the generic must not
depend on the specific. Lowering those primitives into a module of their own is a second extraction, not
this move.

**Not a publisher of its own wire format.** `publishRoleChangeWorkflow` decides _which_ lists go out and
in _what order_ (admins first) and reports the outcome; the event shape, the item validation and the
signing are `curation`'s and the host's. The publish is **not atomic**: a refusal on the editors list
leaves the already-published admins event in place, and the outcome says which list failed.

**Not the server's authority model.** `platform/server` keeps a second, in-memory `AdminManager` /
`EditorManager` representation of the same authority. This module does not touch it and does not make the
two one model.
