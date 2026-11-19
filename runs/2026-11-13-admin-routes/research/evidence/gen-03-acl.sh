# NOTE: re-running this prints the public APP_PUBKEY (platform/web/routes/index.tsx:48). MASK key-shaped
# literals before committing -- the pre-commit scanner cannot distinguish a public key from a private
# one, and the fix is masking, never --no-verify. See order.md, evidence hazard.
#!/usr/bin/env bash
# APPENDS the ACL-ruling evidence block to 03-consumers-and-acceptance.txt.
# Run from the repo root after gen-03.sh:
#   bash runs/2026-11-13-admin-routes/research/evidence/gen-03-acl.sh
# Never hand-edit the output; re-run this script.
set -u
REPO=/home/admin_maxime/work/market
cd "$REPO" || exit 1
OUT=runs/2026-11-13-admin-routes/research/evidence/03-consumers-and-acceptance.txt

section() { printf '\n\n===== %s =====\n' "$*"; }
cmd() { printf '\n$ %s\n' "$*"; eval "$@" 2>&1; }

{
printf '\n\n###############################################################################\n'
printf '# APPENDIX — ACL ruling folded in (%s)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '# source: runs/2026-11-13-admin-routes/ruling-acl.md\n'
printf '###############################################################################\n'

section "the ruling"
cmd "wc -l runs/2026-11-13-admin-routes/ruling-acl.md"
cmd "sed -n '11,31p' runs/2026-11-13-admin-routes/ruling-acl.md"
cmd "sed -n '57,66p' runs/2026-11-13-admin-routes/ruling-acl.md"

section "A1 (editor out-of-grant): roles carry NO path dimension"
cmd "sed -n '194,212p' platform/web/app-settings/appSettingsQuery.ts"
printf '\n>>> any path/grant dimension in the role query?\n'
cmd "grep -n -i 'path\\|grant\\|scope' platform/web/app-settings/appSettingsQuery.ts platform/web/app-settings/appSettingsPublish.ts"
printf '\n>>> the only path-scoped gate in the app:\n'
cmd "sed -n '24,44p' platform/web/app/useRootRedirects.ts"
printf '\n>>> the house "refused" component:\n'
cmd "sed -n '59,70p' ui/settings/operator-settings-views.tsx"
printf '\n>>> who uses it:\n'
cmd "grep -rn 'SettingsAccessDenied' --include=*.tsx platform ui | sort"

section "A2 (paid request on a held path): tier-blind conflict rule"
cmd "sed -n '86,94p' platform/server/VanityManager.ts"
cmd "sed -n '150,166p' sdk/config/vanity.ts"
printf '\n>>> does either mention admin/editor/tier?\n'
cmd "grep -rn -i 'admin\\|editor\\|tier' platform/server/VanityManager.ts sdk/config/vanity.ts"

section "A3 (used after validUntil): resolution decides, warning does not"
cmd "sed -n '133,145p' sdk/config/vanity.ts"
cmd "sed -n '95,110p' sdk/config/vanity.ts"
cmd "sed -n '60,66p' sdk/core/curation/vanityRead.ts"
printf '\n>>> the only pre-lapse warning surface (self-serve vanity page):\n'
cmd "grep -n 'formatExpiration\\|daysLeft\\|isExpiringSoon\\|isExpired' platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx | head -20"
cmd "grep -n 'getExpiredVanityForPubkey' -A 8 sdk/core/curation/vanityRead.ts"

section "A4 (admin removes another tier's route): no removal path exists"
printf '>>> writers of the vanity registry under platform/web (kind 30000 / d=vanity-urls):\n'
cmd "grep -rn \"vanity-urls\\|VANITY_REGISTRY\\|30000\" --include=*.ts --include=*.tsx platform/web | grep -v test | sort"
printf '\n>>> the only writer at all is the server zap-purchase path:\n'
cmd "grep -rn 'VanityManager\\|handleVanityEvent\\|registryEventKind' --include=*.ts platform | sort"

section "A5 (default held by a lapsed reservation): default is a constant today"
cmd "sed -n '53,58p' platform/web/routes/index.tsx"
cmd "sed -n '100,103p' platform/web/routes/index.tsx"
cmd "grep -n 'shouldRenderStorefrontPage' platform/web/routes/index.tsx platform/web/storefront/StorefrontAddressPage.tsx platform/web/storefront/StorefrontOrProfilePage.tsx"

section "no 404 surface: nothing renders a notFound state"
cmd "grep -rn 'notFoundComponent\\|notFoundMode\\|defaultNotFoundComponent' --include=*.tsx --include=*.ts platform | head"

section "test files the ACL paths need — absent today (measured)"
for f in sdk/core/curation/routeAcl.test.ts \
         sdk/core/curation/routeTable.test.ts \
         platform/server/VanityManager.test.ts \
         platform/web/routes/homeDefault.test.tsx \
         e2e/tests/managed-routes.spec.ts; do
  printf '\n$ test -e %s\n' "$f"
  if [ -e "$f" ]; then echo "EXISTS"; else echo "ABSENT"; fi
done
printf '\n>>> the affected tests that DO exist:\n'
cmd "ls -1 sdk/core/curation/curationRead.test.ts sdk/core/curation/vanityReadWorkflows.test.ts platform/web/storefront/storefrontQuery.test.ts platform/web/storefront/StorefrontAddressPage.test.tsx platform/web/routes/sellerRoute.test.tsx platform/web/app/routeComposition.test.ts ui/nav/model.test.ts"
printf '\n>>> is there any test at all for routes/index.tsx (the default)?\n'
cmd "ls platform/web/routes/ | grep -i 'index'"

section "gates re-confirmed for this appendix (measured)"
printf '\n$ NODE_OPTIONS=--max-old-space-size=12288 bun bunx tsc --noEmit | grep -c "error TS"\n'
NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bun bunx tsc --noEmit >/tmp/tsc03b.out 2>&1
printf 'tsc exit=%s errorTS=%s\n' "$?" "$(grep -c 'error TS' /tmp/tsc03b.out)"
} >>"$OUT" 2>&1

printf 'appended to %s (now %s lines)\n' "$OUT" "$(wc -l <"$OUT")"