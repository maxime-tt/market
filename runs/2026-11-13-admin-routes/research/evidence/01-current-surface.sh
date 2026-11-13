#!/usr/bin/env bash
# 01-current-surface — evidence generator. Run from the BASE repo root.
# Every line of the .txt this produces comes from a command here; the file is
# never hand-edited. Regenerate with:
#   bash runs/2026-11-13-admin-routes/research/evidence/01-current-surface.sh \
#     > runs/2026-11-13-admin-routes/research/evidence/01-current-surface.txt
set -u

REPO=/home/admin_maxime/work/market
cd "$REPO" || exit 1

run() {
	printf '\n$ %s\n' "$*"
	bash -c "$*" 2>&1
}

# show FILE FROM TO  — numbered lines FROM..TO (inclusive), 1-based, as `file:line`
show() {
	printf '\n$ nl -ba %s | sed -n "%s,%s p"\n' "$1" "$2" "$3"
	awk -v a="$2" -v b="$3" 'NR>=a&&NR<=b{printf "%6d\t%s\n", NR, $0}' "$1"
}

printf '=== 01-current-surface evidence ===\n'
printf 'generated: '; date -u '+%Y-%m-%dT%H:%M:%SZ'
printf 'generator: %s\n' "$0"

printf '\n\n### SECTION 0 — base identity\n'
run "git rev-parse HEAD"
run "git rev-parse --abbrev-ref HEAD"
run "git status --porcelain | wc -l"
run "git log -1 --format='%H %ci %s'"

printf '\n\n### SECTION 0b — drift: HEAD vs the pinned base\n'
run "git merge-base --is-ancestor 2326938b3 HEAD && echo 'PINNED BASE IS AN ANCESTOR OF HEAD' || echo 'BASE IS NOT AN ANCESTOR'"
run "git log --oneline 2326938b3..HEAD"
run "git diff --name-only 2326938b3 HEAD"
run "git diff --stat 2326938b3 HEAD | tail -2"

printf '\n\n### SECTION 1 — inventory: every tracked file whose name says vanity\n'
run "git ls-files | grep -i vanity"
run "git grep -c -i vanity -- . | sort -t: -k2 -rn | head -20"
run "git grep -n -i vanity -- . | wc -l"

printf '\n\n### SECTION 2 — the registry definition (kind, d tag, tag shape)\n'
show sdk/core/curation/vanityRead.ts 1 45
show sdk/core/curation/vanityRead.ts 44 102
show platform/server/VanityManager.ts 57 75
show platform/server/VanityManager.ts 97 117
show platform/server/ZapPurchaseManager.ts 392 419

printf '\n\n### SECTION 3 — the author: who signs the registry event\n'
show platform/server/EventSigner.ts 1 31
show platform/server/EventHandler.ts 55 82
show platform/server/EventHandler.ts 100 130
show platform/server/EventHandler.ts 231 262

printf '\n\n### SECTION 4 — expiry semantics\n'
show sdk/config/vanity.ts 91 120
show sdk/config/vanity.ts 130 205
show platform/server/ZapPurchaseManager.ts 90 110
show platform/server/ZapPurchaseManager.ts 186 207
show platform/server/ZapPurchaseManager.ts 238 262
show platform/server/VanityManager.ts 46 56
run "git grep -n 'VANITY_PRICING' -- platform | grep -v '\\.test\\.'"

printf '\n\n### SECTION 5 — writers: the only code path that publishes kind 30000 d=vanity-urls\n'
run "git grep -n 'vanity-urls' -- . | grep -v '\\.test\\.' | grep -v '^docs/'"
run "git grep -n 'registryDTag' -- platform/server"
show platform/server/http/zapPurchase.ts 13 60
show platform/web/payments/zapPurchase.ts 21 81
run "git grep -n 'vanity' -- sdk/core/curation/curationPublish.ts || echo 'NONE: no SDK publisher for the vanity registry'"
run "git grep -n 'vanity' -- sdk/core/curation/index.ts"

printf '\n\n### SECTION 6 — readers: SDK read, React binding, store adapter, route, sync hook\n'
show platform/web/config/vanityBinding.ts 72 129
show platform/web/config/vanityStore.ts 1 40
show platform/web/app/useVanitySync.ts 1 25
run "git grep -n 'useVanitySync' -- platform/web"
run "git grep -n 'vanityState\\|vanityStore\\|useVanityState\\|vanityActions' -- platform ui sdk | grep -v '\\.test\\.'"
show sdk/core/query/queryKeyFactory.ts 100 112
show platform/web/app/AppMonitors.tsx 1 30

printf '\n\n### SECTION 7 — resolution today: the route and its two targets\n'
show 'platform/web/routes/$vanityName.tsx' 1 42
show platform/web/storefront/StorefrontOrProfilePage.tsx 1 68
show platform/web/storefront/StorefrontAddressPage.tsx 1 68
show platform/web/storefront/storefrontQuery.ts 62 102
show platform/web/storefront/storefrontQuery.ts 119 155
show platform/web/routeTree.gen.ts 70 80
show platform/web/routeTree.gen.ts 290 302
show platform/web/routes/sellerRoute.test.tsx 40 65

printf '\n\n### SECTION 8 — the home coordinate and the storefront publish coordinate (order premises 3 and 4)\n'
show platform/web/routes/index.tsx 42 60
show platform/web/routes/index.tsx 74 115
show platform/web/storefront/storefrontPublish.ts 10 71

printf '\n\n### SECTION 9 — dashboard surfaces that exist today\n'
run "git ls-files 'platform/web/routes/_dashboard-layout/**' | sort"
run "for f in platform/web/routes/_dashboard-layout/dashboard/app-settings/*.tsx platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx; do echo \"--- \$f\"; grep -n -E 'amIAdmin|amIEditor|amIOwner|AccessDenied|permission|createFileRoute' \"\$f\"; done"
show platform/web/routes/_dashboard-layout/dashboard/account/profile-page.tsx 1 28
show platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx 33 60
show platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx 172 200
show platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx 310 330
run "grep -n -i 'vanity' ui/nav/model.ts"
run "git grep -n 'vanity' -- platform/web/storefront/StorefrontBuilder.tsx"

printf '\n\n### SECTION 10 — admin/editor gating: how the app decides\n'
show sdk/core/curation/curationLists.ts 1 16
show sdk/core/curation/curationRead.ts 65 83
show sdk/core/curation/curationRead.ts 145 165
show platform/web/app-settings/appSettingsQuery.ts 105 125
show platform/web/app-settings/appSettingsQuery.ts 190 217
show platform/server/AdminManager.ts 18 40
show platform/server/EditorManager.ts 18 40
show platform/server/EventValidator.ts 19 95
show platform/server/EventHandler.ts 240 262
show platform/web/curationContext.ts 20 36
show platform/web/app-settings/appSettingsPublish.ts 60 105
show platform/web/app/useRootRedirects.ts 20 50

printf '\n\n### SECTION 11 — drift check: the docs against the code\n'
run "git grep -n -E 'api/vanity/invoice|404|useStorefrontSync' -- docs/vanity-urls.md"
run "git grep -rn 'api/vanity' -- platform || echo 'NONE: no /api/vanity route exists'"
show docs/vanity-urls.md 88 94

printf '\n\n=== end of evidence ===\n'