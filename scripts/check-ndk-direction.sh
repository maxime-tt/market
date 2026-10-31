#!/usr/bin/env bash
# NDK DIRECTION guard — the directional successor to the flat footprint tripwire.
# (src/ retired 2026-10-30, d7-s2/B5 J-c — historical src/ references below are
# the retirement record.)
#
# Why this guard exists (A4 reframing, plans/A4-guard-reframing.md §2):
# `scripts/check-ndk-footprint.sh` compares ONE integer across src/, platform/,
# contextvm/ and sdk/, so it cannot tell the three states the NDK-removal
# objective must distinguish:
#
#   1. a capability with a host-injected port   sdk/core/media/blossomUpload.ts (NDK-free)
#                                               + platform/web/media/blossomUploadHost.ts (names the transport)
#                                               -> the TARGET shape, must not be penalised
#   2. a transitional NDK bridge                platform/web/ndk/ndkStore.ts
#                                               -> tolerated, must shrink, must be DECLARED
#   3. legacy NDK under src/                    44 production + 25 test files
#                                               -> must go at D7
#
# The one-way rule this guard protects is the one `sdk/boundary.test.ts:9/:12`
# already enforces per import specifier:
#
#     platform -> sdk   ALLOWED   (the host injects a capability)
#     sdk -> platform   FORBIDDEN (a capability is not a transport)
#
# The boundary test sees import specifiers only. This guard adds the mirror
# statement the objective needs: a `platform/` file that names the NDK transport
# must be a DECLARED bridge to an `sdk/` capability — one ledger row per bridge,
# naming the owner and the `sdk/` target the host injects.
#
# Reads three tracked text files (all under scripts/):
#
#   ndk-direction-baseline.txt   <tree> <kind> <count> <rule>   + `complete=yes|no`
#   ndk-mention-allowlist.txt    <path>|<owner>|<reason>|<reword-by>
#   ndk-bridge-ledger.txt        <repo-path>|<owner>|<sdk-target>|<why-host>|<retire-at>
#
# Rules, and exactly what the baseline number means per rule:
#
#   zero      count = EFFECTIVE files (raw mentions minus allowlisted rows in the
#             same tree+kind). Must be 0. The `sdk/` production rail (M8).
#   allow     count = EFFECTIVE files. Must not exceed the baseline; no ratchet
#             notice (an earned, permanent allowance, e.g. the boundary test's own
#             FORBIDDEN_PACKAGES literal).
#   bridge    count = UNDECLARED files: platform NDK files WITHOUT a valid ledger
#             row (M9). May only fall; growth is blocked unless the new file is
#             declared in the same commit (declare-as-you-touch). The number is
#             the undeclared count, NOT the total — a declared new bridge must not
#             fail the rail (A4 red-team F1).
#   ratchet   count = RAW mention files. May only fall (src/, contextvm/).
#
# `complete=yes` (owner-gated end-state switch, DEFAULT OFF) turns M9 into a hard
# rail: EVERY platform NDK file must have a valid ledger row. It is off while the
# 48 legacy platform files are un-declared, otherwise the wave is red on day one.
#
# Honest limits (do not paper over them):
#   - `bridge` ratchets the undeclared COUNT. A delete-one/add-one substitution of
#     two undeclared files is invisible to it; that is the price of not freezing a
#     48-row per-file deny-list (rejected as over-engineering: 48 owners cannot be
#     attributed today). The `complete=yes` switch is what closes it at the end.
#   - a `ratchet` row whose tree disappears measures 0 and would pass silently,
#     so every measured tree must exist (exit 2 otherwise) — the same precondition
#     `check-src-boundary.sh:65` uses. Re-seed or drop the row at D7.
#
# Exit codes: 0 = OK · 1 = a direction rail failed · 2 = the guard could not run.
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_FILE="$ROOT/scripts/ndk-direction-baseline.txt"
ALLOWLIST_FILE="$ROOT/scripts/ndk-mention-allowlist.txt"
LEDGER_FILE="$ROOT/scripts/ndk-bridge-ledger.txt"

RULES="zero allow bridge ratchet"
SPEC_RE="(from|import[[:space:]]*\(|require[[:space:]]*\()[[:space:]]*['\"][^'\"]+['\"]"
BARE_IMPORT_RE="^[[:space:]]*import[[:space:]]*['\"][^'\"]+['\"]"

fail_run() {
	echo ""
	echo "::error::NDK-direction guard could not run: $*"
	echo "This is not a pass — the guard measured nothing. Fix the cause above."
	exit 2
}

command -v grep >/dev/null 2>&1 || fail_run "grep is not available on PATH"
[ -r "$BASELINE_FILE" ] || fail_run "baseline file is missing or unreadable: scripts/ndk-direction-baseline.txt"
[ -r "$ALLOWLIST_FILE" ] || fail_run "allowlist is missing or unreadable: scripts/ndk-mention-allowlist.txt"
[ -r "$LEDGER_FILE" ] || fail_run "ledger is missing or unreadable: scripts/ndk-bridge-ledger.txt"

ERRORS=()
err() { ERRORS+=("$1"); }

# --- path helpers ------------------------------------------------------------

# Normalise an absolute path textually (no symlink resolution, no existence need).
normpath() {
	local p="$1" part
	local -a parts=() out=()
	IFS='/' read -r -a parts <<<"$p"
	for part in "${parts[@]}"; do
		case "$part" in
			'' | '.') continue ;;
			'..')
				if [ ${#out[@]} -gt 0 ]; then unset 'out[${#out[@]}-1]'; fi
				;;
			*) out+=("$part") ;;
		esac
	done
	local IFS='/'
	echo "/${out[*]}"
}

# A path (relative to the repo root) is a test file when it sits in __tests__/ or
# carries a test/spec suffix. Mirrors the production/test split used by the
# footprint guard and the auctions guard.
is_test_path() {
	case "$1" in
		*/__tests__/* | *.test.ts | *.test.tsx | *.spec.ts | *.spec.tsx) return 0 ;;
	esac
	return 1
}

# Import specifiers of a file (repo-relative). Value imports, `import type`,
# require() and static side-effect imports all match; prose/comments do not.
import_specs() {
	local rel="$1"
	{
		grep -oE "$SPEC_RE" "$ROOT/$rel" 2>/dev/null || true
		grep -oE "$BARE_IMPORT_RE" "$ROOT/$rel" 2>/dev/null || true
	} | sed -E "s/^.*['\"]([^'\"]+)['\"]\$/\1/" | sort -u
}

# True when the file carries an NDK *import specifier* (not a comment mention).
has_ndk_import() {
	[ -n "$(import_specs "$1" | grep -E '^@nostr-dev-kit/' || true)" ]
}

# Files under a tree (repo-relative) that mention @nostr-dev-kit in .ts/.tsx.
# The include filter is deliberate: sdk/ carries evidence .md/.sh/.txt mentions
# that are not source files and must not trip a direction rail.
mention_files() {
	local tree="$1"
	[ -d "$ROOT/$tree" ] || return 0
	grep -rl "@nostr-dev-kit" --include="*.ts" --include="*.tsx" "$ROOT/$tree" 2>/dev/null |
		sed "s|^$ROOT/||" | sort || true
}

# Candidate repo-relative paths an import specifier can resolve to.
candidate_paths() {
	local from="$1" spec="$2" base cand
	case "$spec" in
		'@sdk/'*) cand="sdk/${spec#@sdk/}" ;;
		'./'* | '../'*)
			base="$(dirname "$ROOT/$from")"
			cand="$(normpath "$base/$spec")"
			cand="${cand#"$ROOT"/}"
			;;
		*) return 0 ;;
	esac
	printf '%s\n' "$cand" "$cand".ts "$cand".tsx "$cand"/index.ts "$cand"/index.tsx
}

# True when `$1` (repo-relative platform file) imports `$2` (repo-relative sdk
# target: a directory or a concrete file).
imports_target() {
	local from="$1" target="$2" spec cand tpath
	tpath="$(normpath "$ROOT/$target")"
	while IFS= read -r spec; do
		[ -n "$spec" ] || continue
		while IFS= read -r cand; do
			[ -n "$cand" ] || continue
			if [ -d "$ROOT/$target" ]; then
				case "$cand" in
					"$target" | "$target"/*) return 0 ;;
				esac
			fi
			if [ "$(normpath "$ROOT/$cand")" = "$tpath" ]; then return 0; fi
		done < <(candidate_paths "$from" "$spec")
	done < <(import_specs "$from")
	return 1
}

# --- allowlist ---------------------------------------------------------------
# <path>|<owner>|<reason>|<reword-by>
# A row exempts a *mention*, never an import: the file must contain no NDK import
# specifier, so the allowlist cannot smuggle a transport into sdk/.
declare -A ALLOWED=()
ALLOW_ROWS=0
allow_lineno=0
while IFS= read -r raw || [ -n "$raw" ]; do
	allow_lineno=$((allow_lineno + 1))
	line="${raw%$'\r'}"
	case "$line" in '' | '#'*) continue ;; esac
	IFS='|' read -r apath aowner areason areword extra <<<"$line"
	if [ -n "${extra:-}" ]; then
		err "ndk-mention-allowlist.txt:${allow_lineno}: expected 4 fields, found more: '$line'"
		continue
	fi
	for field in "$apath" "$aowner" "$areason" "$areword"; do
		if [ -z "${field:-}" ]; then
			err "ndk-mention-allowlist.txt:${allow_lineno}: empty field in '$line'"
		fi
	done
	if [ ! -e "$ROOT/$apath" ]; then
		err "ndk-mention-allowlist.txt:${allow_lineno}: stale row — '$apath' does not exist"
		continue
	fi
	if ! grep -q "@nostr-dev-kit" "$ROOT/$apath" 2>/dev/null; then
		err "ndk-mention-allowlist.txt:${allow_lineno}: stale row — '$apath' no longer mentions @nostr-dev-kit; delete the row"
		continue
	fi
	if has_ndk_import "$apath"; then
		err "ndk-mention-allowlist.txt:${allow_lineno}: '$apath' IMPORTS @nostr-dev-kit — the allowlist is for comment-only mentions, not transports"
		continue
	fi
	ALLOWED["$apath"]=1
	ALLOW_ROWS=$((ALLOW_ROWS + 1))
done <"$ALLOWLIST_FILE"

# --- bridge ledger -----------------------------------------------------------
# <repo-path>|<owner>|<sdk-target>|<why-host>|<retire-at>
# Per row: (1) path exists · (2) path is under platform/ · (3) sdk-target resolves
# to an existing FILE **or** DIRECTORY under sdk/ · (4) the target itself carries
# zero NDK import specifiers (a capability, not a transport) · (5) the platform
# file imports the declared target (the direction proof) · (6) owner non-empty ·
# (7) retire-at is not the placeholder '-'.
declare -A DECLARED=()
LEDGER_ROWS=0
M10=0
ledger_lineno=0
while IFS= read -r raw || [ -n "$raw" ]; do
	ledger_lineno=$((ledger_lineno + 1))
	line="${raw%$'\r'}"
	case "$line" in '' | '#'*) continue ;; esac
	IFS='|' read -r lpath lowner ltarget lwhy lretire lextra <<<"$line"
	row="ndk-bridge-ledger.txt:${ledger_lineno}"
	if [ -n "${lextra:-}" ]; then
		err "$row: expected 5 fields, found more: '$line'"
		continue
	fi
	if [ -z "${lpath:-}" ] || [ -z "${lowner:-}" ] || [ -z "${ltarget:-}" ] || [ -z "${lretire:-}" ]; then
		err "$row: empty required field in '$line' (path|owner|sdk-target|why-host|retire-at)"
		continue
	fi
	bad=0
	if [ ! -f "$ROOT/$lpath" ]; then
		err "$row: stale row — bridge path '$lpath' does not exist"
		bad=1
	fi
	case "$lpath" in
		platform/*) ;;
		*) err "$row: '$lpath' is not under platform/ — a bridge lives in the host, never in sdk/ (src/ is gone)" ; bad=1 ;;
	esac
	case "$ltarget" in
		sdk/*) ;;
		*) err "$row: sdk-target '$ltarget' is not under sdk/" ; bad=1 ;;
	esac
	target_ok=0
	if [ -e "$ROOT/$ltarget" ]; then
		target_ok=1
		case "$ltarget" in
			sdk/*)
				# (4) a capability, not a transport: zero NDK import specifiers in the target.
				target_ndk=0
				if [ -d "$ROOT/$ltarget" ]; then
					while IFS= read -r tfile; do
						[ -n "$tfile" ] || continue
						trel="${tfile#"$ROOT"/}"
						if has_ndk_import "$trel"; then target_ndk=$((target_ndk + 1)); fi
					done < <(find "$ROOT/$ltarget" -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | sort)
				elif has_ndk_import "$ltarget"; then
					target_ndk=1
				fi
				if [ "$target_ndk" != "0" ]; then
					err "$row: sdk-target '$ltarget' imports @nostr-dev-kit — a bridge target must be the NDK-free capability"
					target_ok=0
				fi
				;;
		esac
	else
		err "$row: sdk-target '$ltarget' does not exist (expected a file or a directory under sdk/)"
		M10=$((M10 + 1))
	fi
	if [ "$target_ok" = "1" ] && [ -f "$ROOT/$lpath" ]; then
		if ! imports_target "$lpath" "$ltarget"; then
			err "$row: '$lpath' does not import its declared sdk-target '$ltarget' — the ledger must name the injected capability"
			M10=$((M10 + 1))
			target_ok=0
		fi
	fi
	if [ "$lretire" = "-" ]; then
		err "$row: retire-at must name a wave/date, not the '-' placeholder"
		bad=1
	fi
	LEDGER_ROWS=$((LEDGER_ROWS + 1))
	if [ "$bad" = "0" ] && [ "$target_ok" = "1" ]; then
		DECLARED["$lpath"]=1
	fi
done <"$LEDGER_FILE"

# --- baseline rows -----------------------------------------------------------
declare -A BASE=() RULE_OF=() SEEN=()
ROWS=()
COMPLETE=""
baseline_lineno=0
while IFS= read -r raw || [ -n "$raw" ]; do
	baseline_lineno=$((baseline_lineno + 1))
	line="${raw%$'\r'}"
	case "$line" in
		'#'*)
			body="${line#\#}"
			body="${body#"${body%%[![:space:]]*}"}"
			case "$body" in
				complete=yes | complete=no)
					if [ -n "$COMPLETE" ] && [ "$COMPLETE" != "${body#complete=}" ]; then
						fail_run "baseline sets complete= more than once (line ${baseline_lineno})"
					fi
					COMPLETE="${body#complete=}"
					;;
			esac
			continue
			;;
		'') continue ;;
	esac
	case "$line" in
		complete=yes | complete=no)
			if [ -n "$COMPLETE" ] && [ "$COMPLETE" != "${line#complete=}" ]; then
				fail_run "baseline sets complete= more than once (line ${baseline_lineno})"
			fi
			COMPLETE="${line#complete=}"
			continue
			;;
	esac
	read -r tree kind count rule extra <<<"$line"
	if [ -z "${tree:-}" ] || [ -z "${kind:-}" ] || [ -z "${count:-}" ] || [ -z "${rule:-}" ]; then
		fail_run "baseline line ${baseline_lineno} is not '<tree> <kind> <count> <rule>': '$line'"
	fi
	if [ -n "${extra:-}" ]; then
		fail_run "baseline line ${baseline_lineno} has trailing fields: '$line'"
	fi
	if ! [[ "$count" =~ ^[0-9]+$ ]]; then
		fail_run "baseline line ${baseline_lineno} has a non-numeric count: '$line'"
	fi
	case "$kind" in production | test) ;; *) fail_run "baseline line ${baseline_lineno} has unknown kind '$kind'" ;; esac
	if ! printf '%s\n' $RULES | grep -qx "$rule"; then
		fail_run "baseline line ${baseline_lineno} has unknown rule '$rule' (allowed: $RULES)"
	fi
	key="$tree|$kind"
	if [ -n "${SEEN[$key]+set}" ]; then
		fail_run "baseline line ${baseline_lineno} duplicates the '$tree $kind' row"
	fi
	SEEN["$key"]=1
	BASE["$key"]="$count"
	RULE_OF["$key"]="$rule"
	ROWS+=("$key")
done <"$BASELINE_FILE"

[ -n "$COMPLETE" ] || fail_run "baseline is missing the 'complete=yes|no' switch (default it to complete=no until every platform NDK file is declared)"
[ "${#ROWS[@]}" -gt 0 ] || fail_run "baseline has no rows — the guard would measure nothing"

# --- measure -----------------------------------------------------------------
M8="n/a" M9_SEEN=0
SRC_PROD="n/a" SRC_TEST="n/a" SDK_RAW=0 PLATFORM_TOTAL=0
declare -A CUR=() DETAIL=()

for key in "${ROWS[@]}"; do
	tree="${key%%|*}"
	kind="${key##*|}"
	base="${BASE[$key]}"
	rule="${RULE_OF[$key]}"
	if [ ! -d "$ROOT/$tree" ]; then
		fail_run "tree $tree/ does not exist — refusing to measure a partial tree (re-seed or drop the '$tree $kind' row)"
	fi
	raw=0
	eff=0
	undeclared=0
	total=0
	while IFS= read -r rel; do
		[ -n "$rel" ] || continue
		if is_test_path "$rel"; then
			[ "$kind" = "test" ] || continue
		else
			[ "$kind" = "production" ] || continue
		fi
		raw=$((raw + 1))
		if [ -z "${ALLOWED[$rel]+set}" ]; then eff=$((eff + 1)); fi
		if [ -z "${DECLARED[$rel]+set}" ]; then
			undeclared=$((undeclared + 1))
		else
			total=$((total + 1))
		fi
	done < <(mention_files "$tree")

	case "$rule" in
		zero | allow) cur=$eff ;;
		bridge) cur=$undeclared ;;
		ratchet) cur=$raw ;;
		*) fail_run "internal: unhandled rule '$rule'" ;;
	esac
	CUR["$key"]=$cur

	if [ "$rule" = "zero" ] && [ "$base" != "0" ]; then
		err "baseline row '$tree $kind' uses rule zero but a non-zero baseline ($base); a zero rail has no allowance"
	fi

	marker=""
	if [ "$rule" = "zero" ]; then
		if [ "$cur" -gt 0 ]; then
			marker="  <== MUST BE 0"
		fi
	elif [ "$cur" -gt "$base" ]; then
		marker="  <== GREW"
	fi
	if [ "$cur" -gt "$base" ] && [ "$rule" != "zero" ]; then
		case "$rule" in
			allow) err "$tree $kind effective mentions rose from $base to $cur — declare the file in ndk-mention-allowlist.txt (comment-only) or remove the import" ;;
			bridge) err "$tree $kind undeclared NDK files rose from $base to $cur — a new platform NDK file must carry a row in ndk-bridge-ledger.txt (declare-as-you-touch)" ;;
			ratchet) err "$tree $kind NDK mentions rose from $base to $cur" ;;
		esac
	fi
	if [ "$rule" = "zero" ] && [ "$cur" -gt 0 ]; then
		err "$tree $kind effective mentions = $cur; this rail must be 0 (raw $raw, allowlisted $((raw - eff)))"
	fi
	if [ "$rule" = "bridge" ]; then
		PLATFORM_TOTAL=$((PLATFORM_TOTAL + raw))
	fi

	case "$tree:$kind" in
		sdk:production)
			SDK_RAW=$raw
			M8=$eff
			;;
		src:production) SRC_PROD=$cur ;;
		src:test) SRC_TEST=$cur ;;
	esac

	if [ "$rule" = "ratchet" ] && [ "$cur" -lt "$base" ]; then
		marker="$marker  (decreased — lower the baseline in the same PR)"
	fi

	DETAIL["$key"]="raw=$raw effective=$eff undeclared=$undeclared declared=$total"
done

# --- report ------------------------------------------------------------------
# M9 is measured across ALL of platform/ (production + test): the end-state invariant
# is "every remaining platform NDK file has a valid ledger row", and that includes the
# ndkSignerAdapter test, which retires with its adapter (48 at the seed). The per-row
# `bridge` rails ratchet only the production subset (a test file can never be a bridge).
M9=0
PLATFORM_TOTAL=0
while IFS= read -r rel; do
	[ -n "$rel" ] || continue
	PLATFORM_TOTAL=$((PLATFORM_TOTAL + 1))
	if [ -z "${DECLARED[$rel]+set}" ]; then M9=$((M9 + 1)); fi
done < <(mention_files platform)
if [ "$COMPLETE" = "yes" ] && [ "$M9" -gt 0 ]; then
	err "complete=yes but $M9 platform/ NDK file(s) have no valid ledger row (M9) — declare every bridge or retire the file"
fi
echo "NDK direction guard (rails: sdk zero · platform declared bridges · src ratchet)"
printf '  %-16s %-11s %5s %5s  %-8s %s\n' TREE KIND CUR BASE RULE DETAIL
for key in "${ROWS[@]}"; do
	printf '  %-16s %-11s %5s %5s  %-8s %s\n' \
		"${key%%|*}" "${key##*|}" "${CUR[$key]:-0}" "${BASE[$key]}" "${RULE_OF[$key]}" "${DETAIL[$key]:-}"
done
echo "  ledger: $LEDGER_ROWS row(s), allowlist: $ALLOW_ROWS row(s), complete=$COMPLETE"
echo "metrics: M8 sdk-production-effective=$M8 (raw $SDK_RAW) · M9 platform-undeclared=$M9 (of $PLATFORM_TOTAL platform NDK files) · M10 ledger-target-failures=$M10 · src=$SRC_PROD+$SRC_TEST"

if [ ${#ERRORS[@]} -gt 0 ]; then
	echo ""
	echo "::error::NDK direction guard failed:"
	printf '  %s\n' "${ERRORS[@]}"
	echo ""
	echo "platform -> sdk is the allowed direction (a host injects an sdk capability);"
	echo "sdk -> platform is forbidden (sdk/boundary.test.ts:9/:12). A platform file that"
	echo "names the NDK transport must be a DECLARED bridge: add a row to"
	echo "scripts/ndk-bridge-ledger.txt naming the owner and the sdk/ capability it injects."
	exit 1
fi

echo "OK"
exit 0