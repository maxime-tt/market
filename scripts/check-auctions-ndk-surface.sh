#!/usr/bin/env bash
# Auctions NDK-surface guard (ADR-0002, auctions publish seam).
#
# Fails if any PRODUCTION file in the auctions file set imports @nostr-dev-kit
# directly (a value import or `import type`) or touches the NDK store singleton
# (ndkActions / ndkStore). Auctions relay I/O, signing, and identity must go
# through the first-party seam at src/lib/nostr/io.ts instead.
#
# Scope: the production auctions file set only (tests are out of scope).
#
# Coverage (review 2026-09-18, item 1): the file set is NOT a hand-pinned list.
# It is assembled from pinned files that MUST exist plus glob families that MUST
# each match at least one file. If a pinned path disappears, or a family matches
# nothing, the guard FAILS instead of printing `OK` over a smaller (or empty)
# set — a silently blind guard is a gate regression. `scanned N` alone is not
# coverage evidence, so the coverage check runs before the grep. The unit tests
# set AUCTIONS_GUARD_REQUIRE_COVERAGE=0 for their throwaway repos; the real repo
# always runs strict.
#
# Retarget (wave 7, D1/D4): the auction surface no longer lives under
# `src/publish/auctions.tsx` / `src/queries/auctions.tsx` — those are one-line
# re-export shims over `platform/web/auctions/`. The pinned entries now name the
# seams that own that surface (the sdk publish/read modules plus the two
# platform bindings), while the shims and every `src/` auction file still in the
# tree keep dedicated glob families so no coverage was dropped.
#
# Out of scope (named, not silently ignored): the wallet stores under
# `src/lib/stores/` — `walletOps.ts` reads the active signer and the NDK bridge,
# and `cashu.ts` is imported by every wallet consumer — carry NDK-surface hits of
# their own, but they are not auction files: the auctions-line migration put its
# relay I/O, signing and identity behind `src/lib/nostr/io.ts` instead. The
# earlier ADR-0002 assignment of the shared wallet store to the auctions team is
# SUPERSEDED: migrating it is explicitly OUT OF SCOPE for this migration and was
# tracked separately. That store — the relay-backed NIP-60 wallet store — has
# since been deleted with the wallet cut. These files are deliberately NOT in the
# scanned set and NOT in the #1252 allowlist below.
#
# First-party wrapper: `src/lib/nostr/ndk-events.ts` re-exports NDK types and is
# part of the seam, not an auction file — auction files may import it. Six scanned
# files use it. This gate's literal `@nostr-dev-kit` grep cannot distinguish the
# wrapper from a direct import; the wrapper lives outside the scanned set and is
# the sanctioned pattern.
#
# Allowlist: NIP-59 / private-claim encryption needs the raw active signer
# object, which the library-agnostic I/O seam does not expose. Such files are
# gated on the signer-capability migration (PR #1252) and carry an explicit
# ALLOWLIST entry below. Do NOT re-export the NDK store under another name to
# slip past this guard — allowlist the file and cite #1252 instead.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Unit tests stage throwaway repos with a handful of files and set this to 0.
REQUIRE_COVERAGE="${AUCTIONS_GUARD_REQUIRE_COVERAGE:-1}"

# Surface-shrink floor (A4-S3). The coverage check above catches a family that
# matches NOTHING, but a family can be thinned file-by-file and still pass. This
# floor makes the scanned-set size itself a tripwire: `scanned N` may not fall
# below MIN_SCANNED. Seeded from MEASUREMENT at unite/1420-all tip 06cc831c
# (Wave G-b): `scanned 112 production file(s)`. A fused retirement commit that
# legitimately shrinks the set MUST lower this number in the SAME commit (the
# E0 fusion rule above) — never around it. Enforced only against the real repo
# (REQUIRE_COVERAGE=1); staged throwaway repos opt out with the same switch.
MIN_SCANNED="${AUCTIONS_GUARD_MIN_SCANNED:-112}"

# #1252-gated allowlist — paths relative to the repo root. EMPTY since A3.3
# (2026-10-29): the one #1252-gated file, src/lib/auctions/
# privateAuctionClaimMessage.ts, flipped onto the auth composition root's
# signer capability accessor (`getActiveSignerCapability`) + `asEncryptingSigner`
# and stopped touching the raw NDK signer entirely. I-a A2 S2 (2026-10-29) then
# moved the pure module to sdk/commerce/auctions/privateAuctionClaimMessage.ts
# (scanned via the sdk/commerce/auctions/*.ts family), moved the two
# ambient-signer helpers to platform/web/ndkReadContext.ts (host adapter code,
# deliberately outside this guard's file set — it reads the signer through the
# capability, never the raw NDK signer), and deleted the src/lib/auctions/*.ts
# family with the file. A file that genuinely needs the raw signer again must
# re-open this list with a comment citing #1252.
ALLOWLIST=()

# Pinned production files that MUST exist. A missing pinned path means the guard
# is blind: fail (when coverage is enforced) rather than count a ghost. The two
# `src/` shim pins moved here to their successors: the sdk publish workflow and
# read model, plus the platform publish/read bindings that replaced the shims.
PINNED=(
	"$ROOT/sdk/commerce/auctions/workflows.ts"
	"$ROOT/sdk/commerce/auctions/auctionRead.ts"
	"$ROOT/platform/web/auctions/auctionPublish.ts"
	"$ROOT/platform/web/auctions/auctionsQuery.ts"
	"$ROOT/platform/web/routes/_dashboard-layout/dashboard/products/bids.tsx"
)

# E0 obligation (recorded 2026-10-28): the coverage rule above is what enforces
# the src/-slice deletion contract. A slice that deletes the LAST file of a
# src/-only family MUST delete or re-point that family in the SAME commit,
# because the coverage check hard-fails on any family that matches nothing while
# REQUIRE_COVERAGE=1 (verified: deleting src/publish/auctions.tsx alone fails
# with `missing: .../src/publish/auctions.tsx`, exit 1). Conversely, do NOT
# delete a family while its file still exists -- that drops coverage without
# dropping the surface and weakens the guard. The src/-only families pinned
# below are, with the file count measured at 06cc831c (Wave G-b, lane L2; the
# 71f6fb79 figures this block used to quote were 8 and 7 for the two families
# that have since shrunk):
#   src/publish/auctions.tsx                                     1
#   src/queries/auctions.tsx                                     1
#   src/components/Auction*.tsx                                  7
#   src/lib/auction*.ts                                         12
#   src/lib/auction/*.ts                                        14
#   src/lib/auctions/*.ts                                        1 (#1252-gated claim)
#   src/lib/utils/auction*.ts                                    2
#   src/hooks/useAuction*.ts                                     2
#   src/lib/schemas/auction/*.ts                                 5
#   src/components/nostr/AuctionSectionGrid.tsx                  1
#   src/components/sheet-contents/auctions/*.tsx                 2
#   src/components/sheet-contents/NewAuction*.tsx                1
#
# Only THREE of those families are also asserted by
# src/lib/__tests__/auctions-ndk-surface-guard.test.ts, so only they force a
# two-file (script + test) retirement: src/publish/auctions.tsx,
# src/queries/auctions.tsx, and src/lib/auction/*.ts. The fourth — the #1252
# allowlist row src/lib/auctions/privateAuctionClaimMessage.ts — left with its
# whole family in I-a A2 S2 (the module moved to sdk/commerce/auctions/, the
# ambient-signer helpers to platform/web/ndkReadContext.ts), and the guard
# tests were re-pointed to the sdk home in the same fused commit. The other
# eight families need no test edit.
#
# A3.3 (2026-10-29): the #1252 row is RETIRED — the claim file flipped onto
# `getActiveSignerCapability()` + `asEncryptingSigner` and no longer touches
# the raw NDK signer — so the guard now scans it and this script's allowlist is
# empty. The guard-test assertions that pinned the allowlisted shape were
# re-pointed in the same commit (E0 fusion).
#
# Glob families that MUST each match at least one file. These are the
# auction-owned production surfaces: public routes, components, the auction
# library directories, hooks, schemas, and the server-side validator.
GLOBS=(
	"$ROOT"/platform/web/routes/auctions.*.tsx
	# The `src/publish` and `src/queries` auction shims are still in the tree, so
	# they keep coverage as single-file families now that their PINNED entries
	# moved to the sdk/platform seams above. Delete a family only when its file
	# is actually deleted.
	"$ROOT"/src/publish/auctions.tsx
	"$ROOT"/src/queries/auctions.tsx
	"$ROOT"/src/components/Auction*.tsx
	"$ROOT"/src/lib/auction*.ts
	"$ROOT"/src/lib/auction/*.ts
	# `src/lib/auctions/*.ts` was retired here (I-a A2 S2, 2026-10-29): its only member,
	# privateAuctionClaimMessage.ts, moved to sdk/commerce/auctions/ (covered by the
	# sdk/commerce/auctions/*.ts family below) and the two ambient-signer helpers moved to
	# platform/web/ndkReadContext.ts (host adapter code, outside this guard's file set), so the
	# family matches nothing and the coverage check fails by design. Re-add an auctions family
	# if an auction module reappears under src/lib/auctions/.
	"$ROOT"/src/lib/utils/auction*.ts
	# `src/lib/stores/auction*.ts` was retired here: its only member, `auctionWon.ts`, was deleted when the
	# auction-win flow moved onto the notification mechanism (see the C1/C2 increments), so the family matches
	# nothing and the coverage check fails by design. Re-add a stores family if an auction store reappears.
	# `src/hooks/useAuction*.ts` was retired here (I-c-monitors, 2026-10-29): its last member,
	# `useAuctionBidFunding.ts`, moved to `platform/web/auctions/useAuctionBidFunding.ts` (covered by the
	# `platform/web/auctions/*.ts` family below), so the family matches nothing and the coverage check fails
	# by design. Re-add a hooks family if an auction hook reappears under src/.
	"$ROOT"/src/lib/schemas/auction/*.ts
	"$ROOT"/platform/server/auction-validator/*.ts
	"$ROOT"/src/components/nostr/AuctionSectionGrid.tsx
	"$ROOT"/src/components/sheet-contents/auctions/*.tsx
	"$ROOT"/src/components/sheet-contents/NewAuction*.tsx
	"$ROOT"/platform/web/routes/_dashboard-layout/dashboard/products/auctions*.tsx
	# D1 slice-8 destinations: the framework-free auction reader and the React
	# binding the `src/queries/auctions.tsx` shim re-exports. Both families must
	# keep matching at least one file (the coverage rule above), so a future move
	# fails this guard instead of shrinking the scanned set.
	"$ROOT"/sdk/commerce/auctions/*.ts
	"$ROOT"/platform/web/auctions/*.ts
	# D1 slice-8 schema destination: the auction and bid event schemas the reader validates with.
	"$ROOT"/sdk/commerce/auctions/schemas/*.ts
	# Settlement family: the P2PK/settlement descriptor money path in the sdk, and
	# the sdk auction wallet bindings (funds/host) that hold the auction's cashu
	# surface. Both are part of the money path this guard keeps off raw NDK.
	"$ROOT"/sdk/commerce/auctions/settlement*.ts
	"$ROOT"/sdk/commerce/payments/wallet/auction*.ts
)

shopt -s nullglob
FILES=()
missing=()
for f in "${PINNED[@]}"; do
	if [ -e "$f" ]; then
		FILES+=("$f")
	else
		missing+=("$f")
	fi
done
for pattern in "${GLOBS[@]}"; do
	matched=()
	for f in $pattern; do
		if [ -e "$f" ]; then
			matched+=("$f")
		fi
	done
	if [ "${#matched[@]}" -eq 0 ]; then
		missing+=("$pattern")
	else
		FILES+=("${matched[@]}")
	fi
done
shopt -u nullglob

if [ "${#missing[@]}" -gt 0 ]; then
	echo ""
	echo "::error::Auctions NDK-surface guard coverage check failed — the file set is smaller than the gate's claim:"
	printf '  missing: %s\n' "${missing[@]}"
	echo "A pinned path was removed or a glob matched nothing. Fix the file set (or the globs) before trusting a green run."
	if [ "$REQUIRE_COVERAGE" = "1" ]; then
		exit 1
	fi
	echo "(AUCTIONS_GUARD_REQUIRE_COVERAGE=0 — staged test repo; continuing without the coverage gate.)"
fi

allowed() {
	local rel="$1" entry
	for entry in "${ALLOWLIST[@]}"; do
		[ "$entry" = "$rel" ] && return 0
	done
	return 1
}

hits=()
scanned=0
for file in "${FILES[@]}"; do
	case "$file" in
		# `.test.tsx` was a latent gap: a test component under a glob family (e.g.
		# src/components/Auction*.tsx) was scanned as production and flagged.
		*/__tests__/* | *.test.ts | *.test.tsx) continue ;;
	esac
	rel="${file#"$ROOT"/}"
	if allowed "$rel"; then
		continue
	fi
	scanned=$((scanned + 1))
	if matches="$(grep -nE '@nostr-dev-kit|ndkActions|ndkStore' "$file" 2>/dev/null)"; then
		while IFS= read -r line; do
			hits+=("$rel:$line")
		done <<< "$matches"
	fi
done

echo "Auctions NDK-surface guard: scanned $scanned production file(s) (floor $MIN_SCANNED); allowlisted ${#ALLOWLIST[@]} (#1252-gated); coverage strict=${REQUIRE_COVERAGE}"

if [ "$REQUIRE_COVERAGE" = "1" ] && [ "$scanned" -lt "$MIN_SCANNED" ]; then
	echo ""
	echo "::error::Auctions NDK-surface guard scanned $scanned production file(s), below the MIN_SCANNED floor of $MIN_SCANNED."
	echo "The production auction surface has shrunk and this gate is now blind to part of it."
	echo "If the shrink is a real retirement, lower MIN_SCANNED in this script in the SAME commit"
	echo "(scripts/check-auctions-ndk-surface.sh); if it is not, restore the missing file set."
	exit 1
fi

if [ "${#hits[@]}" -gt 0 ]; then
	echo ""
	echo "::error::NDK API surface found in the auctions production file set:"
	printf '  %s\n' "${hits[@]}"
	echo ""
	echo "Route relay I/O, signing, and identity through src/lib/nostr/io.ts."
	echo "If a file genuinely needs the raw signer (NIP-59 / #1252), add it to the"
	echo "ALLOWLIST in this script with a comment citing #1252."
	exit 1
fi

echo "OK"
