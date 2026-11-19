# NOTE: re-running this prints the public APP_PUBKEY (platform/web/routes/index.tsx:48). MASK key-shaped
# literals before committing -- the pre-commit scanner cannot distinguish a public key from a private
# one, and the fix is masking, never --no-verify. See order.md, evidence hazard.
#!/usr/bin/env bash
# Generates research/evidence/02-target-and-gaps.txt for run 2026-11-13-admin-routes.
# Axis: 02-target-and-gaps. READ-ONLY against the base tree.
# Usage: bash runs/2026-11-13-admin-routes/research/evidence/02-target-and-gaps.sh > runs/2026-11-13-admin-routes/research/evidence/02-target-and-gaps.txt 2>&1
set -u
cd "$(dirname "$0")/../../../.." || exit 1
ROOT=$PWD
echo "### repo: $ROOT"
echo "### generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "### base commit named by the order (2326938b3):"
git rev-parse 2326938b3
echo "### HEAD at generation (advances as sibling children commit under runs/; the pin diff ABOVE is the assertion):"
git rev-parse HEAD
echo "### drift from the order's pin: source-tree diff (MUST be empty for the four facts to hold)"
git diff --stat 2326938b3..HEAD -- . ':(exclude)runs/' || true
echo "### files changed 2326938b3..HEAD (all under runs/ if the above is empty)"
git diff --name-only 2326938b3..HEAD
echo

section() { echo; echo "================================================================"; echo "## $*"; echo "================================================================"; }

section "1. THE FOUR PINNED FACTS (order.md lines 41-44)"
echo '--- sdk/core/curation/vanityRead.ts:5 and :7-11 ---'
sed -n '5,11p' sdk/core/curation/vanityRead.ts
echo '--- platform/web/routes/index.tsx:45-58 (APP_PUBKEY + home read) ---'
sed -n '45,58p' platform/web/routes/index.tsx
echo '--- platform/web/storefront/storefrontPublish.ts:59-61 ---'
sed -n '59,61p' platform/web/storefront/storefrontPublish.ts

section "2. THE REGISTRY: kind, d-tag, tag shape, addressable semantics"
echo '--- vanilla registry constant and tag parser (vanityRead.ts:5,30-35) ---'
sed -n '5,5p;30,35p' sdk/core/curation/vanityRead.ts
echo '--- filter construction (authors hard-pinned to appPubkey) vanityRead.ts:21-28 ---'
sed -n '21,28p' sdk/core/curation/vanityRead.ts
echo '--- expiry predicates (vanityRead.ts:44-83) ---'
sed -n '44,83p' sdk/core/curation/vanityRead.ts
echo '--- kind-30000 addressable rule, NIP-01 verbatim ---'
grep -n "30000 <= n < 40000" docs/notes.md 2>/dev/null || echo "(NIP-01 fetched over the network; see 02-target-and-gaps.md for the quoted text)"

section "3. EXPIRY MEASUREMENT — the real functions run against synthetic tags"
echo '(probe source: research/evidence/probe02.ts)'
/home/admin_maxime/.bun/bin/bun run runs/2026-11-13-admin-routes/research/evidence/probe02.ts
echo "--- exit: $? ---"

section "4. WHAT MAKES A PAGE RENDERABLE vs REFUSED"
echo '--- shouldRenderStorefrontPage (storefrontQuery.ts:143-154) ---'
sed -n '143,154p' platform/web/storefront/storefrontQuery.ts
echo '--- version gate (storefrontPage.ts:590-602) ---'
sed -n '590,602p' sdk/commerce/storefront/storefrontPage.ts
echo '--- kind/d/version constants (storefrontPage.ts:31-37) ---'
sed -n '30,37p' sdk/commerce/storefront/storefrontPage.ts
echo '--- every consumer of shouldRenderStorefrontPage (scoped: platform sdk ui) ---'
grep -rn "shouldRenderStorefrontPage" --include=*.ts --include=*.tsx platform sdk ui

section "5. TARGET TYPES: what a route can point at TODAY"
echo '--- the ONLY resolution point: platform/web/routes/$vanityName.tsx (full) ---'
cat -n 'platform/web/routes/$vanityName.tsx'
echo
echo '--- profile/pubkey render path: StorefrontOrProfilePage (signature + fallback) ---'
sed -n '26,27p;63,67p' platform/web/storefront/StorefrontOrProfilePage.tsx
echo
echo '--- storefront address render path: StorefrontAddressPage (author is HARD-PINNED to config.appPublicKey) ---'
sed -n '29,33p' platform/web/storefront/StorefrontAddressPage.tsx
echo
echo '--- listing render path: the product route takes a d-tag or event id, NOT a route target ---'
sed -n '233,245p' platform/web/products/productQuery.ts
echo '--- and no route renders a listing from a name ---'
grep -rn "productSmartQueryOptions" --include=*.tsx platform/web/routes/ || echo '(no route/) consumer of productSmartQueryOptions'
echo
echo '--- external URL: any redirect machinery in the router? ---'
grep -rn "window.location.assign\|window.location.replace\|location.href *=" --include=*.ts --include=*.tsx platform/web/ | grep -v node_modules || echo '(none found in platform/web)'
echo '--- safe href policy for links INSIDE a page (https or in-app only) storefrontPage.ts:59-70 ---'
sed -n '59,69p' sdk/commerce/storefront/storefrontPage.ts

section "6. BLOCK-RENDER AUTHOR ANCHORING (why a page can only show its own author's listings)"
echo '--- StorefrontBlockSlots.tsx doc comment ---'
sed -n '30,46p' platform/web/storefront/StorefrontBlockSlots.tsx

section "7. WRITE / TRUST PATH"
echo '--- who signs the registry: server-side app key (EventSigner) ---'
sed -n '9,30p' platform/server/EventSigner.ts
echo
echo '--- the WebSocket submit path: verify sig -> validate -> RESIGN AS APP KEY ---'
sed -n '20,47p' platform/server/websocket.ts
echo
echo '--- the validator: general events require admin, NOT editor ---'
sed -n '35,48p;74,95p' platform/server/EventValidator.ts
echo
echo '--- the client-side list publish resolves owner but signs with the USER signer ---'
sed -n '24,35p' platform/web/curationContext.ts
echo
echo '--- role lists live at kind 30000 with d=admins / d=editors ---'
sed -n '8,13p' sdk/core/curation/curationLists.ts

section "8. ADMIN/EDITOR GATING AS IT IS"
grep -rn "export const useAmIAdmin" -A 16 platform/web/app-settings/appSettingsQuery.ts
echo '--- isAdmin / isOwner / isEditor predicates ---'
sed -n '148,161p' sdk/core/curation/curationRead.ts

section "9. RESERVED NAMES AND NAME GRAMMAR (a route named 'home' must be legal)"
echo "--- reserved name count ---"
grep -c "^	'" platform/server/VanityManager.ts
echo '--- is "home" reserved? ---'
grep -n "'home'" platform/server/VanityManager.ts || echo 'NOT in RESERVED_NAMES'
echo '--- name grammar (VanityManager.ts:182-186) ---'
sed -n '182,186p' platform/server/VanityManager.ts
echo '--- does "home" pass? ---'
/home/admin_maxime/.bun/bin/bun -e 'const r=/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/; for (const n of ["home","featured","shop","h"]) console.log(n, r.test(n))'

section "10. DOCUMENTS THAT COULD SPECIFY THE REQUIREMENTS"
echo '--- ADR statuses (Accepted vs Proposed) ---'
for f in docs/adr/ADR-*.md; do s=$(awk '/^## Status/{getline; getline; print; exit}' "$f" | tr -d '\r'); echo "$(basename "$f"): $s"; done
echo -n 'ADR count / Accepted count: '
tot=0; acc=0; for f in docs/adr/ADR-*.md; do tot=$((tot+1)); s=$(awk '/^## Status/{getline; getline; print; exit}' "$f" | tr -d '\r'); case "$s" in Accepted*) acc=$((acc+1));; esac; done; echo "$tot / $acc"
echo
echo '--- ADR-0006 Module 3 (routing tiers + typed-target extension), the closest thing to a spec ---'
sed -n '195,214p' docs/adr/ADR-0006-cms-and-nostr-native-page-building.md
echo
echo '--- ADR-0006 Module 4 publishing gate (who may author) ---'
sed -n '236,244p' docs/adr/ADR-0006-cms-and-nostr-native-page-building.md
echo
echo '--- notes/DECISION-home-composition.md §7 (the blocker) ---'
sed -n '151,180p' notes/DECISION-home-composition.md

section "11. NEGATIVE SEARCH: does ANY document specify a default-route flag?"
grep -rni "default route\|default-route\|isDefault\|is_default\|mark.*default\|defaultPage" docs/ notes/*.md AGENTS.md 2>/dev/null | grep -vi "defaultCurrency\|defaultTheme" || echo '(NO MATCH: no document in the repo specifies a default-route flag)'
echo
echo '--- does `/` ever consult the vanity registry? ---'
grep -n "vanity" platform/web/routes/index.tsx || echo '(NO MATCH: `/` never reads the registry)'

section "12. COUNTS QUOTED IN THE REPORT"
echo -n 'route files in platform/web/routes: '; ls platform/web/routes/*.tsx | wc -l
echo -n 'files matching shouldRenderStorefrontPage (non-test): '; grep -rl "shouldRenderStorefrontPage" --include=*.ts --include=*.tsx platform sdk ui | wc -l
echo -n 'storefront block schemas in the discriminated union (order says twelve): '; sed -n '/^export const StorefrontBlockSchema = z.discriminatedUnion/,/^])/p' sdk/commerce/storefront/storefrontPage.ts | grep -c "BlockSchema,"
echo -n 'members of STOREFRONT_BLOCK_TYPES (the props-only subset): '; sed -n '/^export const STOREFRONT_BLOCK_TYPES = \[/,/^] as const/p' sdk/commerce/storefront/storefrontPage.ts | grep -c "^\s*'"
echo '--- the three in the union but NOT in STOREFRONT_BLOCK_TYPES (data-bound blocks) ---'
comm -23 <(sed -n '/^export const StorefrontBlockSchema = z.discriminatedUnion/,/^])/p' sdk/commerce/storefront/storefrontPage.ts | grep -o "[A-Za-z]*BlockSchema" | sed 's/BlockSchema//' | grep -v '^Storefront$' | sort) <(sed -n '/^export const STOREFRONT_BLOCK_TYPES = \[/,/^] as const/p' sdk/commerce/storefront/storefrontPage.ts | grep -o "'[A-Za-z]*'" | tr -d "'" | sort)
echo -n 'VanityEntry fields: '; sed -n '7,11p' sdk/core/curation/vanityRead.ts | grep -c ":\s"

section "13. THE ACL RULING (runs/2026-11-13-admin-routes/ruling-acl.md) — what backs each tier in CODE"
echo '--- tier 1 ADMIN: role predicate + the validator allowing admins a general write ---'
sed -n '148,151p' sdk/core/curation/curationRead.ts
echo '--- tier 2 EDITOR: role predicate, and the ONLY event class an editor may write (kind 10000) ---'
sed -n '158,161p' sdk/core/curation/curationRead.ts
sed -n '74,83p' platform/server/EventValidator.ts
echo '--- is there ANY per-path editor grant in the codebase? ---'
grep -rni "editorGrant\|pathGrant\|grantedPath\|editorPaths\|per-path\|allowedPaths" --include=*.ts --include=*.tsx platform sdk ui || echo '(NO MATCH: no per-path editor grant exists anywhere in code)'
echo '--- tier 3 PREMIUM/RESERVATION: the purchase mechanism that exists (zap -> registry entry) ---'
grep -n "zapLabel\|registryEventKind\|registryDTag" platform/server/VanityManager.ts | head
echo '--- reservations are user-initiated today: the dashboard purchase entry point ---'
grep -n "purchaseVanityForPubkey\|LightningPaymentProcessor" platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx | head
echo '--- is there ANY DNS-domain reservation anywhere? ---'
grep -rni "custom domain\|customDomain\|dns.*reserve\|reserve.*domain" --include=*.ts --include=*.tsx platform sdk ui || echo '(NO MATCH: no DNS/domain reservation concept in code)'
echo '--- the ruling itself ---'
sed -n '1,66p' runs/2026-11-13-admin-routes/ruling-acl.md

echo
echo "### END"