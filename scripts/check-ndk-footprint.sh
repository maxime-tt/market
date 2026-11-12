#!/usr/bin/env bash
# NDK footprint guard for the NDK -> applesauce migration.
# (see docs/ndk-to-applesauce-migration-plan.md)
#
# Fails if the number of source files mentioning @nostr-dev-kit has INCREASED
# beyond the committed baseline (the scan covers platform/, contextvm/ and
# sdk/; the literal matches comments and import statements alike, so a mention
# in prose counts — that is the conservative direction). This prevents new NDK
# usage from sneaking in
# while the migration is underway — new relay I/O must route through the
# library-agnostic seam at platform/web/sdkNostrIo.ts instead.
# (J-c, d7-s2/B5, 2026-10-30: src/ deleted; it left the scan scope with its
# 18 NDK test files. The src/lib/nostr/io.ts seam those lines pointed at was
# retired at Checkpoint C1/J-0.)
#
# When a wave REDUCES the footprint, that wave's PR should also lower the
# baseline in scripts/ndk-baseline.txt so the guard ratchets downward.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_FILE="$ROOT/scripts/ndk-baseline.txt"
BASELINE="$(head -n1 "$BASELINE_FILE" | tr -dc '0-9')"

# `sdk/` is in scope: it is the framework-free layer the NDK -> applesauce
# migration lands in first, so a scope that stops at src/platform/contextvm
# cannot see the new home of the surface it is guarding.
matches="$(grep -rl "@nostr-dev-kit" --include="*.ts" --include="*.tsx" "$ROOT/platform" "$ROOT/contextvm" "$ROOT/sdk" 2>/dev/null || true)"
if [ -z "$matches" ]; then
	CURRENT="0"
else
	CURRENT="$(printf '%s\n' "$matches" | wc -l | tr -d ' ')"
fi

echo "NDK footprint: $CURRENT file(s) import @nostr-dev-kit (baseline: $BASELINE)"

if [ "$CURRENT" -gt "$BASELINE" ]; then
	echo ""
	echo "::error::NDK footprint increased from $BASELINE to $CURRENT."
	echo "New NDK usage is blocked during the migration. Route subscribe/fetch/publish"
	echo "through platform/web/sdkNostrIo.ts (the applesauce I/O seam) instead. See"
	echo "docs/ndk-to-applesauce-migration-plan.md for the pattern."
	exit 1
fi

if [ "$CURRENT" -lt "$BASELINE" ]; then
	echo "::notice::NDK footprint decreased. Lower the baseline in"
	echo "scripts/ndk-baseline.txt within this PR so the guard ratchets downward."
fi

echo "OK"
