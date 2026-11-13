# NOTE: re-running this prints the public APP_PUBKEY (platform/web/routes/index.tsx:48). MASK key-shaped
# literals before committing -- the pre-commit scanner cannot distinguish a public key from a private
# one, and the fix is masking, never --no-verify. See order.md, evidence hazard.
#!/usr/bin/env bash
# Generates 03-consumers-and-acceptance.txt. Run from the repo root:
#   bash runs/2026-11-13-admin-routes/research/evidence/gen-03.sh
# Never hand-edit the output; re-run this script.
set -u
REPO=/home/admin_maxime/work/market
cd "$REPO" || exit 1
OUT=runs/2026-11-13-admin-routes/research/evidence/03-consumers-and-acceptance.txt
BUN=/home/admin_maxime/.bun/bin/bun

section() { printf '\n\n===== %s =====\n' "$*"; }
cmd() { printf '\n$ %s\n' "$*"; eval "$@" 2>&1; }

{
printf 'generated %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'repo %s\n' "$REPO"

section "base identity"
cmd "git rev-parse HEAD"
cmd "git log --oneline -1"
cmd "git status --porcelain --untracked-files=no | head -5"

section "consumers: every reader of a resolved route (grep)"
cmd "grep -rn 'resolveVanity\\|VANITY_REGISTRY\\|vanityStore\\|vanityBinding\\|useStorefrontAddressPage\\|StorefrontAddressPage\\|shouldRenderStorefrontPage\\|useStorefrontPage' --include=*.ts --include=*.tsx platform sdk ui | sort"

section "storage of vanilla config: sdk/config/vanity.ts RESERVED_NAMES + resolveVanity"
cmd "grep -n 'RESERVED_NAMES = \\|^\\s*resolveVanity\\|isVanityAvailable:\\|isValidVanityName:' sdk/config/vanity.ts"
cmd "sed -n '50,90p' sdk/config/vanity.ts"

section "the registry read (kind / d-tag / tag shape / expiry)"
cmd "sed -n '1,40p' sdk/core/curation/vanityRead.ts"
cmd "sed -n '44,66p' sdk/core/curation/vanityRead.ts"

section "route: home"
cmd "sed -n '48,60p' platform/web/routes/index.tsx"
cmd "sed -n '100,114p' platform/web/routes/index.tsx"

section "route: vanity"
cmd 'sed -n 9,42p "platform/web/routes/\$vanityName.tsx"'

section "route: profile"
cmd 'cat "platform/web/routes/profile.\$profileId.tsx"'

section "component: StorefrontAddressPage"
cmd "sed -n '29,68p' platform/web/storefront/StorefrontAddressPage.tsx"

section "component: StorefrontOrProfilePage"
cmd "sed -n '26,68p' platform/web/storefront/StorefrontOrProfilePage.tsx"

section "storefrontQuery.ts: the render predicate and the address read"
cmd "sed -n '75,102p' platform/web/storefront/storefrontQuery.ts"
cmd "sed -n '128,154p' platform/web/storefront/storefrontQuery.ts"

section "producer: builder live href from vanity lookup"
cmd "sed -n '89,102p' platform/web/storefront/StorefrontBuilder.tsx"

section "admin gate is a literal path prefix"
cmd "grep -n 'isAdminRoute\\|amIAdmin\\|navigate({ to:' platform/web/app/useRootRedirects.ts"

section "dashboard nav table (where a management page registers)"
cmd "sed -n '161,178p' ui/nav/model.ts"
cmd "sed -n '43,46p' ui/nav/model.test.ts"

section "server-side registry owner (write side, not a render resolver)"
cmd "grep -rn 'VanityManager' --include=*.ts --include=*.tsx platform | grep -v 'platform/server/VanityManager.ts'"

section "hardcoded route-name literals"
cmd "grep -n \"'featured'\\|'home'\" platform/web/routes/index.tsx"

section "reserved-name collision check: is 'home' or 'featured' reserved?"
cmd "grep -c \"'home'\" sdk/config/vanity.ts; grep -c \"'featured'\" sdk/config/vanity.ts"

section "tests: candidate files (unit + component)"
cmd "ls -1 sdk/core/curation/*.test.ts platform/web/storefront/*.test.ts* platform/web/routes/*.test.tsx platform/web/app/routeComposition.test.ts ui/nav/model.test.ts platform/boundary.test.ts sdk/boundary.test.ts ui/boundary.test.ts"

section "tests: e2e specs touching the resolved-route surface"
cmd "grep -rln \"goto('/')\\|storefront\\|app-settings\" e2e/tests | sort"

section "GATE 1: typecheck baseline (measured)"
printf '\n$ NODE_OPTIONS=--max-old-space-size=12288 %s bunx tsc --noEmit | grep -c "error TS"\n' "$BUN"
NODE_OPTIONS=--max-old-space-size=12288 "$BUN" bunx tsc --noEmit >/tmp/tsc03.out 2>&1
printf 'tsc exit=%s\n' "$?"
printf 'error TS lines=%s\n' "$(grep -c 'error TS' /tmp/tsc03.out)"
printf 'first 3 error lines:\n'
grep 'error TS' /tmp/tsc03.out | head -3

section "GATE 2: focused unit/component run on the affected files (measured)"
printf '\n$ %s test --isolate <5 files>\n' "$BUN"
"$BUN" test --isolate \
  platform/web/storefront/storefrontQuery.test.ts \
  platform/web/storefront/StorefrontAddressPage.test.tsx \
  platform/web/routes/sellerRoute.test.tsx \
  platform/web/app/routeComposition.test.ts \
  sdk/core/curation/curationRead.test.ts 2>&1 | tail -25

section "GATE 2b: per-file verdict (measured)"
for f in platform/web/storefront/storefrontQuery.test.ts \
         platform/web/storefront/StorefrontAddressPage.test.tsx \
         platform/web/routes/sellerRoute.test.tsx \
         platform/web/app/routeComposition.test.ts \
         sdk/core/curation/curationRead.test.ts; do
  printf '\n$ %s test --isolate %s\n' "$BUN" "$f"
  "$BUN" test --isolate "$f" 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)|Cannot find package' | head -6
done

section "why that file fails: missing dependency in this checkout"
cmd "grep -rn 'applesauce-indexeddb' platform/web/indexedDbEventDatabase.ts"
cmd "grep -n 'applesauce-indexeddb' package.json"
cmd "ls -d node_modules/applesauce* 2>/dev/null"

section "test command shapes (from package.json)"
cmd "grep -n 'test:unit\\|test:e2e\"\\|test:integration\\|generate-routes\\|format:check\\|check:ui' package.json"

section "doctrine citations"
cmd "sed -n '18,31p' ui/AGENTS.md"
cmd "sed -n '118,121p' ui/AGENTS.md"
cmd "sed -n '38,55p' sdk/AGENTS.md"
cmd "sed -n '7,20p' sdk/AGENTS.md"
cmd "sed -n '26,32p' platform/web/routes/AGENTS.md"
cmd "sed -n '83,92p' AGENTS.md"
cmd "sed -n '98,116p' AGENTS.md"
cmd "sed -n '172,189p' AGENTS.md"
printf '\n>>> does ROOT AGENTS.md state the read-seam or ui/platform boundary rule?\n'
cmd "grep -n -i 'read.seam\\|stream-first\\|boundary' AGENTS.md"

section "HANDOVER ruling that scopes this surface"
cmd "sed -n '94,105p' notes/HANDOVER-CMS-INTEGRATION.md"

section "DECISION-home-composition §7 tail"
cmd "tail -8 notes/DECISION-home-composition.md"
} >"$OUT" 2>&1

printf 'wrote %s (%s lines)\n' "$OUT" "$(wc -l <"$OUT")"