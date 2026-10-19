#!/usr/bin/env bash
# Source-boundary guard for the src/ retirement.
#
# src/ is transitional: it will be deleted once its contents have moved to
# sdk/, ui/ and platform/. Until then every import edge that crosses a tree
# boundary is a little more of src/ cemented in place, so each direction is
# frozen at a committed baseline and may only ratchet downward.
#
# The six measured directions are every cross-tree edge that touches src/:
#
#   platform/ -> src/     code outside src/ reaching into it
#   ui/       -> src/     "
#   sdk/      -> src/     "
#   src/      -> platform/   src/ reaching out, which keeps it alive
#   src/      -> ui/         "
#   src/      -> sdk/        "
#
# Each direction is counted twice: "production" files and "test" files, so a
# test suite that keeps importing src/ cannot hide behind the production
# number. An "import statement" is a static `from '...'`, a dynamic
# `import('...')` (including type-level `import('...').Type` predicates) or a
# `require('...')` — which also covers `import type { X } from '...'` and
# `export ... from '...'`. Bare side-effect imports (`import '...'`) are not
# counted; the only two in the tree are same-tree CSS imports today.
#
# Resolution follows tsconfig: `@/*` -> src/, `@sdk/*` -> sdk/, `@ui/*` ->
# ui/, `@platform/*` -> platform/; relative specifiers are normalised against
# the importing file before the tree is taken from their first path segment.
#
# Exit codes:
#   0  every count is at or below its baseline
#   1  at least one count exceeded its baseline
#   2  the guard could not run (missing tool, unreadable tree, bad baseline)
#
# When a change REDUCES a count, lower scripts/src-boundary-baseline.txt in
# the same PR so the guard ratchets downward.
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_FILE="$ROOT/scripts/src-boundary-baseline.txt"
TREES=(src ui sdk platform)
DIRECTIONS=("platform src" "ui src" "sdk src" "src platform" "src ui" "src sdk")

fail_run() {
	echo ""
	echo "::error::Source-boundary guard could not run: $*"
	echo "This is not a pass — the guard measured nothing. Fix the cause above."
	exit 2
}

command -v grep >/dev/null 2>&1 || fail_run "grep is not available on PATH"
command -v awk >/dev/null 2>&1 || fail_run "awk is not available on PATH"
[ -r "$BASELINE_FILE" ] || fail_run "baseline file is missing or unreadable: scripts/src-boundary-baseline.txt"

for tree in "${TREES[@]}"; do
	[ -d "$ROOT/$tree" ] || fail_run "tree $tree/ does not exist — refusing to measure a partial tree"
	[ -r "$ROOT/$tree" ] || fail_run "tree $tree/ is unreadable"
done

CURRENT="$(mktemp)"
ERRORS="$(mktemp)"
trap 'rm -f "$CURRENT" "$CURRENT.raw" "$ERRORS"' EXIT

# Capture "file:import-clause" for every import statement in the four trees.
SPEC_RE="(from|import[[:space:]]*\\(|require[[:space:]]*\\()[[:space:]]*['\"][^'\"]+['\"]"
set +e
(
	cd "$ROOT" &&
		grep -rHoE "$SPEC_RE" \
			--include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
			--include='*.mjs' --include='*.cjs' --include='*.svelte' \
			"${TREES[@]}"
) >"$CURRENT.raw" 2>"$ERRORS"
status=$?
set -e
case "$status" in
0) ;;
1) : >"$CURRENT.raw" ;; # grep found no import statements at all
*) fail_run "grep failed while scanning the trees: $(head -n3 "$ERRORS")" ;;
esac

awk -F'\t' '
function norm(path,   n, c, i, k, st, out) {
	n = split(path, c, "/")
	k = 0
	for (i = 1; i <= n; i++) {
		if (c[i] == "" || c[i] == ".") continue
		if (c[i] == "..") { if (k > 0) k--; continue }
		st[++k] = c[i]
	}
	out = ""
	for (i = 1; i <= k; i++) out = out (i > 1 ? "/" : "") st[i]
	return out
}
function tree_of(spec, from,   d, rel, n, c) {
	if (spec == "@platform" || spec ~ /^@platform\//) return "platform"
	if (spec == "@sdk"      || spec ~ /^@sdk\//)      return "sdk"
	if (spec == "@ui"       || spec ~ /^@ui\//)       return "ui"
	if (spec == "@"         || spec ~ /^@\//)         return "src"
	if (spec ~ /^\./) {
		d = from
		sub(/\/[^\/]*$/, "", d)
		rel = norm(d "/" spec)
		n = split(rel, c, "/")
		return c[1]
	}
	return ""
}
BEGIN { OFS = "\t" }
{
	i = index($0, ":")
	if (i == 0) next
	from = substr($0, 1, i - 1)
	clause = substr($0, i + 1)
	sub(/^[^'\''"]*['\''"]/, "", clause)
	sub(/['\''"].*$/, "", clause)
	spec = clause

	split(from, pathparts, "/")
	ftree = pathparts[1]
	if (ftree != "src" && ftree != "ui" && ftree != "sdk" && ftree != "platform") next

	target = tree_of(spec, from)
	if (target == "" || target == ftree) next

	base = from
	sub(/.*\//, "", base)
	kind = "production"
	if (base ~ /\.(test|spec)\./ || from ~ /(__tests__|\/tests)\//) kind = "test"

	key = ftree SUBSEP target SUBSEP kind
	count[key]++
	fkey = key SUBSEP from
	if (!(fkey in seen)) { seen[fkey] = 1; files[key]++ }
}
END {
	for (k in count) {
		split(k, parts, SUBSEP)
		print parts[1], parts[2], parts[3], count[k], files[k] + 0
	}
}
' "$CURRENT.raw" | sort >"$CURRENT"

declare -A BASE_IMPORTS=() BASE_FILES=()
line_no=0
while IFS=$' \t' read -r from arrow to kind base_imports base_files extra; do
	line_no=$((line_no + 1))
	case "$from" in '' | '#'*) continue ;; esac
	if [ "$arrow" != "->" ] || [ -n "${extra:-}" ]; then
		fail_run "baseline line is malformed: '$from $arrow $to $kind $base_imports ${base_files:-}'"
	fi
	case "$kind" in production | test) ;; *) fail_run "baseline line has unknown kind '$kind'" ;; esac
	if ! [[ "$base_imports" =~ ^[0-9]+$ && "${base_files:-x}" =~ ^[0-9]+$ ]]; then
		fail_run "baseline line has non-numeric counts: '$from -> $to $kind'"
	fi
	key="$from|$to|$kind"
	BASE_IMPORTS[$key]="$base_imports"
	BASE_FILES[$key]="$base_files"
done <"$BASELINE_FILE"

for direction in "${DIRECTIONS[@]}"; do
	read -r from to <<<"$direction"
	for kind in production test; do
		key="$from|$to|$kind"
		[ -n "${BASE_IMPORTS[$key]+set}" ] || fail_run "baseline is missing the '$from -> $to $kind' line"
	done
done

declare -A CUR_IMPORTS=() CUR_FILES=()
while IFS=$'\t' read -r from to kind count files; do
	[ -n "${from:-}" ] || continue
	key="$from|$to|$kind"
	CUR_IMPORTS[$key]="$count"
	CUR_FILES[$key]="$files"
done <"$CURRENT"

echo "Source-boundary footprint (cross-tree import statements, current / baseline):"
gre_w=()
for direction in "${DIRECTIONS[@]}"; do
	read -r from to <<<"$direction"
	for kind in production test; do
		key="$from|$to|$kind"
		cur="${CUR_IMPORTS[$key]:-0}"
		cur_f="${CUR_FILES[$key]:-0}"
		base="${BASE_IMPORTS[$key]}"
		base_f="${BASE_FILES[$key]}"
		marker=""
		if [ "$cur" -gt "$base" ] || [ "$cur_f" -gt "$base_f" ]; then
			marker="  <== GREW"
			gre_w+=("$key")
		elif [ "$cur" -lt "$base" ] || [ "$cur_f" -lt "$base_f" ]; then
			marker="  (decreased)"
		fi
		printf '  %-9s -> %-10s %-10s %4s / %-4s imports  %3s / %-3s files%s\n' \
			"$from/" "$to/" "$kind" "$cur" "$base" "$cur_f" "$base_f" "$marker"
	done
done

if [ "${#gre_w[@]}" -gt 0 ]; then
	echo ""
	for key in "${gre_w[@]}"; do
		IFS='|' read -r from to kind <<<"$key"
		cur="${CUR_IMPORTS[$key]:-0}"
		cur_f="${CUR_FILES[$key]:-0}"
		base="${BASE_IMPORTS[$key]}"
		base_f="${BASE_FILES[$key]}"
		if [ "$cur" -gt "$base" ]; then
			echo "::error::Source boundary grew: $from/ -> $to/ $kind imports increased from $base to $cur (+$((cur - base)))."
		fi
		if [ "$cur_f" -gt "$base_f" ]; then
			echo "::error::Source boundary grew: $from/ -> $to/ $kind files increased from $base_f to $cur_f (+$((cur_f - base_f)))."
		fi
	done
	echo ""
	echo "Nothing outside src/ may depend on src/, and src/ must not grow new"
	echo "dependencies on the trees that replace it. Move the import to the sdk/ui/"
	echo "platform seam it belongs to instead of adding a line to"
	echo "scripts/src-boundary-baseline.txt. If an edge is genuinely unavoidable,"
	echo "raise the baseline in a dedicated commit that explains why."
	exit 1
fi

lowered=0
for direction in "${DIRECTIONS[@]}"; do
	read -r from to <<<"$direction"
	for kind in production test; do
		key="$from|$to|$kind"
		if [ "${CUR_IMPORTS[$key]:-0}" -lt "${BASE_IMPORTS[$key]}" ] ||
			[ "${CUR_FILES[$key]:-0}" -lt "${BASE_FILES[$key]}" ]; then
			lowered=1
		fi
	done
done

if [ "$lowered" -eq 1 ]; then
	echo ""
	echo "::notice::Source-boundary footprint decreased. Lower the matching counts in"
	echo "scripts/src-boundary-baseline.txt within this PR so the guard ratchets downward."
fi

echo "OK"
