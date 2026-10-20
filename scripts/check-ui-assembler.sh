#!/usr/bin/env bash
# ADR-0007 UI assembler-boundary guard, modelled on check-instance-literals.sh.
#
# The ADR-0007 amendment splits ownership:
#   - ui/**            owns components (atoms, molecules, layout, nav, dialogs)
#   - platform/web/routes/** assembles pages from ui/ components and route data
#
# Routes must therefore NOT import @ui/primitives/* directly and must NOT
# define presentational components inline. Existing violations are a ratcheting
# migration baseline, not an endorsement. New violations fail the guard.
#
# When a migration removes violations, lower scripts/ui-assembler-baseline.txt
# in the same PR so the guard ratchets downward. Rows at zero should be removed.
#
# Usage:
#   scripts/check-ui-assembler.sh            # check against baseline
#   scripts/check-ui-assembler.sh --update   # rewrite baseline from current tree
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="$ROOT/scripts/ui-assembler-baseline.txt"
ROUTES_DIR="$ROOT/platform/web/routes"

# Rule 1: direct primitive imports in routes.
PRIMITIVE_RE="from '@ui/primitives/"
# Rule 2: top-level presentational component declarations in routes.
#   function Foo(...)  /  export function Foo(...)  /  const Foo = (...)
COMPONENT_RE='^(export )?(default )?function [A-Z][A-Za-z0-9]*[<(]|^const [A-Z][A-Za-z0-9]* = \('

compute() {
	local out="$1"
	: > "$out"
	while IFS= read -r file; do
		[[ -z "$file" ]] && continue
		local prim comp
		prim="$(grep -cE "$PRIMITIVE_RE" "$file" 2>/dev/null || true)"
		comp="$(grep -cE "$COMPONENT_RE" "$file" 2>/dev/null || true)"
		[[ "$prim" -gt 0 ]] && printf '%s|primitive-import|%s\n' "$file" "$prim" >> "$out"
		[[ "$comp" -gt 0 ]] && printf '%s|inline-component|%s\n' "$file" "$comp" >> "$out"
	done < <(find "$ROUTES_DIR" -name '*.tsx' -type f 2>/dev/null | sed "s#^$ROOT/##" | sort)
	sort -o "$out" "$out"
}

CURRENT="$(mktemp)"
trap 'rm -f "$CURRENT"' EXIT
compute "$CURRENT"

if [[ "${1:-}" == "--update" ]]; then
	{
		echo "# UI assembler-boundary baseline — ADR-0007 §1b/§1d (ui owns components; platform/web assembles)."
		echo "# Format: <file>|<rule>|<count>.  Rules: primitive-import (routes must not import @ui/primitives/*),"
		echo "# inline-component (routes must not define presentational components)."
		echo "# This is a ratcheting migration baseline: the guard fails on any INCREASE."
		echo "# Lower a row when a migration removes a violation; remove the row at zero."
		cat "$CURRENT"
	} > "$BASELINE"
	echo "Wrote $(wc -l < "$CURRENT" | tr -d ' ') row(s) to scripts/ui-assembler-baseline.txt"
	exit 0
fi

# Baseline rows only (strip comments); keep key -> count.
declare -A BASE=()
if [[ -f "$BASELINE" ]]; then
	while IFS='|' read -r file rule count; do
		[[ -z "$file" || "$file" == \#* ]] && continue
		[[ "$count" =~ ^[0-9]+$ ]] || continue
		BASE["$file|$rule"]="$count"
	done < "$BASELINE"
fi

VIOLATIONS="$(mktemp)"
trap 'rm -f "$CURRENT" "$VIOLATIONS"' EXIT
: > "$VIOLATIONS"

CUR_TOTAL=0
BASE_TOTAL=0
for key in "${!BASE[@]}"; do BASE_TOTAL=$((BASE_TOTAL + BASE[$key])); done

while IFS='|' read -r file rule count; do
	[[ -z "$file" ]] && continue
	cur="$count"
	base="${BASE["$file|$rule"]:-0}"
	CUR_TOTAL=$((CUR_TOTAL + cur))
	if [[ "$cur" -gt "$base" ]]; then
		printf '%s|%s|%s -> %s\n' "$file" "$rule" "$base" "$cur" >> "$VIOLATIONS"
	fi
done < "$CURRENT"

# Baseline keys absent from current = improvement; recompute current total only
# from present rows so removals are reflected.
PRESENT_TOTAL="$(awk -F'|' '{s += $3} END {print s + 0}' "$CURRENT")"

echo "UI assembler-boundary footprint: $PRESENT_TOTAL violation(s) (baseline: $BASE_TOTAL)"
echo "  primitive-import: $(awk -F'|' '$2=="primitive-import"{s+=$3} END{print s+0}' "$CURRENT")" \
	" | inline-component: $(awk -F'|' '$2=="inline-component"{s+=$3} END{print s+0}' "$CURRENT")"

if [[ -s "$VIOLATIONS" ]]; then
	echo ""
	echo "::error::ADR-0007 assembler-boundary violations increased:"
	cat "$VIOLATIONS"
	echo ""
	echo "Routes must not import @ui/primitives/* or define presentational"
	echo "components. Extract the component into ui/ (shared, layout, nav, dialogs,"
	echo "wrappers, or a feature directory) and import it from the route via @ui/..."
	echo "See ui/AGENTS.md for the boundary rules."
	exit 1
fi

if [[ "$PRESENT_TOTAL" -lt "$BASE_TOTAL" ]]; then
	echo "::notice::Assembler-boundary footprint decreased. Lower"
	echo "scripts/ui-assembler-baseline.txt within this PR so the guard ratchets downward."
fi

echo "OK"
