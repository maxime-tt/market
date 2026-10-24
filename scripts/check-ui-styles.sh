#!/usr/bin/env bash
# UI raw-palette guard (T6.4), modelled on check-ui-assembler.sh / check-instance-literals.sh.
#
# WHY THIS EXISTS
#   Tier 1 of the token contract (ui/AGENTS.md § Tokens,
#   runs/union-1420/TOKEN-ARCHITECTURE-DECISION.md) says a component uses ROLES,
#   never raw palette: `bg-fill-accent`, `text-text-mid`, `border-border-default`.
#   T6.1 → T6.2 converted ~750 occurrences by hand, and a hand migration with no
#   guard re-rots: the next `text-gray-500` someone types is invisible until a
#   reviewer notices. This guard makes the count monotonic so it can only fall.
#
# THE PATTERN (canonical — the baseline is derived from exactly this, so the
# numbers are reproducible; do not "improve" it without re-deriving)
#   (^|[^A-Za-z0-9_-])(bg|text|border|ring|fill|from|to|via|divide|outline|
#   decoration|accent|caret|stroke|shadow)-(white|black|gray|grey|zinc|slate|
#   neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|
#   blue|indigo|violet|purple|fuchsia|pink|rose)(-[0-9]{1,3})?(/[0-9]{1,3})?
#   The leading `(^|[^A-Za-z0-9_-])` is what keeps `text-fill-accent` and
#   `border-border-default` out: `fill` and `border` are prefixes, not hues, so a
#   following `-accent` cannot match the hue alternation, and the boundary stops a
#   match starting mid-identifier.
#
# THE SECOND FAMILY — ARBITRARY VALUES (v3; same 15 prefixes, same debt class)
#   A Tailwind arbitrary value lets the palette skip the theme entirely:
#     (bg|…|shadow)-\[(color:)?( <colour-literal> )(/[0-9]{1,3})?
#   where <colour-literal> is, at the START of the bracket:
#     • a hex literal — #rgb / #rgba / #rrggbb / #rrggbbaa (3, 4, 6 or 8 digits);
#     • a functional literal — rgb( rgba( hsl( hsla( oklch( oklab( lab( lch(
#       color( color-mix(  ;
#     • `var(--brand[-…])` — ruling R5 forbids a component consuming the Tier-0
#       brand identity directly, so `bg-[color:var(--brand-pink)]` is debt too.
#   It is a SECOND family, not an edit of the first: the named-hue family is
#   untouched, so the recorded hue counts and their rows are reproducible
#   byte-for-byte. It carries the SAME rule tags (all must-not-rise).
#
#   THE BOUNDARY (a judgement call, stated for the owner):
#     • The colour literal must be at the START of the bracket (after an optional
#       `color:` type hint). This is the whole reason `shadow-[0_1px_2px_rgba(...)]`
#       is NOT counted: it is a box-shadow GEOMETRY value that merely embeds an
#       rgba for one channel. If we matched a colour literal anywhere inside a
#       bracket we would flag every hand-written box-shadow, a false positive the
#       contract never intended. Anchoring to the start keeps `w-[3px]`,
#       `p-[10px]`, `grid-cols-[1fr_2fr]` and geometry shadows out by construction.
#     • A ROLE reference is not raw palette. `bg-[var(--text-high)]` and
#       `bg-[var(--surface-raised)]` are NOT counted: `--text-high` / `--surface-*`
#       are Tier-1 roles, i.e. the API the contract tells a component to use. Only
#       `var(--brand…` — the Tier-0 identity, forbidden by R5 — is counted inside a
#       bracket. (A `var(--brand…)` outside a bracket is invisible to this guard
#       either way; the point here is that the brand identity must not be smuggled
#       through an arbitrary value.)
#   A non-colour arbitrary value — `w-[3px]`, `p-[10px]`, `grid-cols-[1fr_2fr]`,
#   `grid-cols-[200px_minmax(900px,_1fr)_100px]`, `bg-[url(/x.png)]` — is NOT debt:
#   it carries no palette, so counting it would punish ordinary layout. See
#   EXCLUSIONS 3 and 4.
#
# EXCLUSIONS — each deliberate, each with a reason
#   1. `ui/primitives/**` IS NOT SCANNED. Primitives are generated (ADR-0007 §1a:
#      never hand-edit) and hold 9 remaining raw occurrences (`qr-code` 4, one each
#      in `badge`, `slider`, `dialog`, `sheet`, `alert-dialog`; the last three are
#      `bg-black/50` overlay scrims). The fix there is a generator/template change
#      plus a regeneration, not a manual pass, so reporting them would create debt
#      nothing in this tree can retire.
#   2. NEGATIVE ASSERTIONS ARE NOT DEBT. A `not.toContain(...)` call whose own
#      argument carries a raw literal is a test PROVING the legacy class is gone
#      (e.g. `expect(markup).not.toContain('text-gray-')`). Counting those as debt
#      would be perverse twice over: it would report the migration's own
#      enforcement as unpaid work, and deleting the assertion would "improve" the
#      number while weakening the suite. So they are counted separately under the
#      `enforcement-assertion` rule, which ratchets the OTHER WAY — the guard
#      FAILS if that count falls.
#      The classification is by the assertion's OWN argument, not by the line: a
#      raw literal on the same line but outside a `not.toContain(...)` call is
#      DEBT (so `expect(m).not.toContain('x'); const c = "bg-gray-500";` is one
#      occurrence of debt, not an assertion). See assertion_count()/raw_count().
#   3. NON-COLOUR ARBITRARY VALUES ARE NOT DEBT. `w-[3px]`, `p-[10px]`,
#      `grid-cols-[1fr_2fr]`, `shadow-[0_1px_2px_rgba(0,0,0,0.2)]` carry no
#      palette ROLE violation: the first three are geometry, and the last is a
#      box-shadow whose rgba is one channel of a geometry value, not a colour
#      utility. The second family only fires when the bracket STARTS with a
#      colour literal, so these are excluded by construction, not by a list.
#   4. A ROLE REFERENCE IS NOT RAW PALETTE. `bg-[var(--text-high)]` and
#      `bg-[var(--surface-raised)]` reference Tier-1 ROLES — the API the contract
#      says to use — so they are NOT counted. Only `var(--brand…)` (Tier-0
#      identity, R5) is counted inside a bracket. This is a deliberate judgement:
#      referencing the theme through a role, even in an arbitrary value, is
#      exactly what the contract wants; referencing the brand identity is not.
#
# FILE SCOPE (v3). Every one of `*.ts *.tsx *.js *.jsx *.mjs *.cjs *.mts *.cts
#   *.css` under `ui/` (minus `ui/primitives/**`) is scanned. `.md`/`.mdx` are
#   DELIBERATELY NOT scanned: the contract files (ui/AGENTS.md) quote forbidden
#   spellings on purpose to document them, so scanning markdown would count the
#   documentation of the rule as a violation of it. See RESEED-NOTES.md for the
#   trade-off; adding `.md` is left as a decision for the owner.
#
# RULE TAGS in scripts/ui-styles-baseline.txt
#   raw-palette              ratcheting source debt (must not rise)
#   raw-palette-test         ratcheting debt in a *.test.* file (a fixture that
#                            passes a raw class to a component under test)
#   ratchet-pending-t63      the auction-editor monolith: pinned, owed to T6.3
#   parked-*                 a MISSING ROLE, not a rename (see the registry below);
#                            whitelisted with its reason, still must not rise
#   enforcement-assertion    inverted: must not FALL
#
# THE PARKED REGISTRY (runs/union-1420/T62-TOKEN-TABLE.md §9, restated in
# ui/AGENTS.md § Tokens). Every one is a case where the honest answer is a missing
# role rather than a rename, so the raw utility was LEFT rather than invented
# (R8: a new token needs a named role, its call sites, and a deletion in the same
# commit; budget is 49 <= 50):
#   parked-scrim            an overlay over media. A scrim is not a layout fill.
#                           (`bg-black/95`, `from-black/80`, `bg-black/40…/60`,
#                           `hover:bg-white/20`, the dialog `bg-black/50`.)
#   parked-scheme-black     `bg-black` image letterbox. Must NOT invert; Tier 1 has
#                           no scheme-stable dark (`--text-high` inverts).
#   parked-scheme-white     `bg-white` QR container. Must stay white or the code
#                           stops scanning; `bg-surface-raised` follows the theme
#                           into dark.
#   parked-caller-surface   an alpha hairline/overlay over a background the theme
#                           does not own — a host-supplied hex, a `headerBgColor`
#                           prop, or a className handed to a caller's render prop.
#
# T6.4 HARDENING — the baseline is defended, not trusted
#   1. check mode compares the working scripts/ui-styles-baseline.txt against the
#      committed one (HEAD:scripts/ui-styles-baseline.txt) and FAILS if any row was
#      raised, or if an enforcement-assertion row was lowered. Outside a git work
#      tree, or before the baseline has ever been committed, it prints a one-line
#      warning to stderr and continues — the first commit that adds the file passes.
#   2. --update REFUSES to raise an existing row's number unless --force is given,
#      naming every row it would raise. --update must not be a way to defeat the
#      ratchet.
#   3. Every baseline row is VALIDATED on check, --ratchet and --update: a count
#      that is not a plain non-negative integer, and a rule tag outside the set
#      above, are HARD ERRORS naming the file, the line number and the value. No
#      row is ever a silent exemption (a non-numeric count used to disable a row's
#      comparison with `[: … : integer expression expected` noise and exit 0).
#   4. --ratchet NEVER lowers an enforcement-assertion row (a weakened suite is a
#      regression, not a ratchet opportunity): it keeps the committed value, says
#      so, and exits non-zero. It drops a stale row (file gone) instead of writing
#      `|0`, and it refuses to run at all — and never creates or truncates the
#      file — when the baseline is missing.
#   5. An unknown argument prints usage on stderr and exits 2 (it used to run a
#      full check silently). A brand-new file whose only raw hits are assertion
#      lines is NOT debt: it is reported as `NEW ASSERTION` and does not fail.
#   6. A SYMLINK under ui/ is a HARD ERROR, not a silent skip. `find -type f`
#      never sees a symlinked source file, and the whole guard is blind to it, so
#      `ln -s /tmp/dep.tsx ui/community/linked-dep.tsx` hid a real file that the
#      same content as a real file is caught for. Two ways to "fix" that are both
#      wrong: SKIPPING the link is an escape hatch (raw palette hides behind it),
#      and FOLLOWING it is worse — a link can resolve OUTSIDE ui/, which the
#      boundary rule (the guard scans ui/ only) forbids. So instead of choosing,
#      the guard refuses: any symlink under ui/** whose NAME matches a scanned
#      extension, and ANY symlinked directory under ui/, is a hard error naming
#      the link and its resolved target — in check, --update and --ratchet alike.
#   7. --audit [<range>] — the COMMITTED-EDIT audit. The tamper check in (1)
#      diffs the WORKING baseline against HEAD, so it is blind to an edit that was
#      committed: a baseline landed with a debt row inflated to 999999, or a debt
#      row re-tagged to `enforcement-assertion`, or a row deleted, passes check
#      forever. --audit walks the commits that touched the baseline (default:
#      `git log --follow --format=%H -- scripts/ui-styles-baseline.txt`; or an
#      explicit revision range) and diffs each commit's baseline against its
#      parent's, deriving counts from that commit's OWN tree. It FAILS on a debt
#      row that rose, an enforcement-assertion row that fell, a tag that changed, a
#      row removed while its file still exists at that commit, and a row added
#      whose count does not match the tree; a row added that EQUALS the tree-derived
#      count is legitimate (what --update writes), and the commit that first
#      introduces the baseline is informational. This is the ONLY mechanism that
#      can see a committed edit, so it belongs in the gate battery.
#   8. The tamper check's "row ADDED" branch CARVES OUT the legitimate case: a new
#      row for a file the committed baseline has never seen is fine EXACTLY when it
#      equals the row the tree implies (that is what --update writes for a genuinely
#      new file). Only a new row that does not match the tree — one that exempts
#      (e.g. tags a debt file `enforcement-assertion`) or inflates the count — may
#      fail, and the message says which case it is.
#   9. --ratchet is ATOMIC. It builds the candidate baseline in a temporary file and
#      replaces the real one only when the run is clean; on an enforcement-assertion
#      regression it leaves the baseline byte-untouched and exits 1 — no partial
#      ratchet. (It used to write the partially-lowered baseline AND exit 1.)
#
# Usage:
#   scripts/check-ui-styles.sh                 # check against the baseline
#   scripts/check-ui-styles.sh --update        # rewrite the baseline from the tree (refuses to raise)
#   scripts/check-ui-styles.sh --update --force # rewrite the baseline, allowing raises
#   scripts/check-ui-styles.sh --ratchet       # lower every improved row; keep header/tags/parked (atomic)
#   scripts/check-ui-styles.sh --audit [<range>] # audit the baseline's committed history (see (7))
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="$ROOT/ui"
# Normalise: strip any trailing slash so a future edit cannot turn the exclusion
# pattern into "…/primitives//*", which matches nothing (F-14).
PRIMITIVES_DIR="${UI_DIR%/}/primitives"
PRIMITIVES_DIR="${PRIMITIVES_DIR%/}"
BASELINE="$ROOT/scripts/ui-styles-baseline.txt"

# The canonical pattern has TWO families: (A) the named hue family — unchanged
# from v1/v2 so the recorded hue counts stay reproducible — and (B) the v3
# arbitrary-value family (see the header). Both share the same 15 utility
# prefixes and the same leading boundary.
RAW_RE='(^|[^A-Za-z0-9_-])(bg|text|border|ring|fill|from|to|via|divide|outline|decoration|accent|caret|stroke|shadow)-((white|black|gray|grey|zinc|slate|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-[0-9]{1,3})?(/[0-9]{1,3})?|\[(color:)?(#([0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{3})|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color-mix|color)\(|var\(--brand[-)])(/[0-9]{1,3})?)'

# The rule tags a baseline row may carry. An unknown tag is a hard error.
KNOWN_RULES='raw-palette raw-palette-test ratchet-pending-t63 parked-scrim parked-scheme-black parked-scheme-white parked-caller-surface enforcement-assertion'

# Files to scan: the v3 extension scope — every JS/TS module under ui/ plus CSS,
# minus the generated primitives. `.md`/`.mdx` are deliberately NOT here (see the
# header, EXCLUSIONS / FILE SCOPE, and RESEED-NOTES.md).
scan_files() {
	find "$UI_DIR" -type f \( \
		-name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
		-o -name '*.mjs' -o -name '*.cjs' -o -name '*.mts' -o -name '*.cts' \
		-o -name '*.css' \
		\) -not -path "$PRIMITIVES_DIR/*" | sort
}

# Raw-palette occurrences INSIDE a `not.toContain(...)` call — an enforcement
# assertion, not debt. Counting only the call's own argument (rather than the
# whole line) is what keeps a raw literal elsewhere on the same line classified
# as debt (F-11).
assertion_count() {
	local n
	n="$( { grep -Eo 'not\.toContain\([^)]*\)' "$1" 2>/dev/null || true; } \
		| { grep -Eo "$RAW_RE" || true; } | wc -l )"
	printf '%s' "${n// /}"
}

# Every raw-palette occurrence in the file, assertion or not.
total_raw_count() {
	local n
	n="$( { grep -Eo "$RAW_RE" "$1" 2>/dev/null || true; } | wc -l )"
	printf '%s' "${n// /}"
}

# Raw-palette occurrences that are DEBT: everything outside an assertion call.
raw_count() {
	local t a
	t="$(total_raw_count "$1")"
	a="$(assertion_count "$1")"
	printf '%s' "$(( t - a ))"
}

# Default rule for a file the baseline does not know about. A test file in any
# scanned extension is raw-palette-test; anything else is raw-palette debt.
default_rule() {
	case "$1" in
		*.test.tsx | *.test.ts | *.test.jsx | *.test.js | *.test.mjs | \
		*.test.cjs | *.test.mts | *.test.cts) printf 'raw-palette-test' ;;
		*) printf 'raw-palette' ;;
	esac
}

rel() { printf '%s' "${1#"$ROOT/"}"; }
abs() { printf '%s' "$ROOT/$1"; }

# ---- symlink guard (T6.4 hardening, fix 6) --------------------------------
# Does a file NAME fall under the scan scope's extension list?
name_matches_scan() {
	case "$1" in
		*.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.mts | *.cts | *.css) return 0 ;;
		*) return 1 ;;
	esac
}

# A symlink under ui/ is never silently skipped and never followed. Prints one
# SYMLINK line per offending link and leaves the result in the global `symfail`
# (0 = clean). Called by check, --update and --ratchet alike.
symlink_check() {
	symfail=0
	[ -d "$UI_DIR" ] || return 0
	local link name target
	while IFS= read -r link; do
		[ -n "$link" ] || continue
		name="$(basename "$link")"
		target="$(readlink -f "$link" 2>/dev/null || true)"
		[ -n "$target" ] || target='(broken symlink)'
		if [ -d "$link" ]; then
			printf 'SYMLINK  %s -> %s — a SYMLINKED DIRECTORY under ui/ is a hard error: the scan would either skip everything below it (an escape hatch) or follow it outside ui/ (the boundary rule forbids that); replace it with a real directory\n' "$(rel "$link")" "$target"
			symfail=1
		elif name_matches_scan "$name"; then
			printf 'SYMLINK  %s -> %s — a symlinked source file is a hard error: silently skipping it is an escape hatch, and following it could leave ui/ (the boundary rule forbids that); replace it with a real file\n' "$(rel "$link")" "$target"
			symfail=1
		fi
	done < <(find "$UI_DIR" -type l 2>/dev/null | sort)
	return 0
}

# The count the guard derives from a path's content AT a given commit's tree, by
# the candidate row's own tag class (assertion vs debt). -1 if the path is absent
# at that commit. Used only by --audit.
count_at_commit() { # <commit> <path> <rule>
	local c="$1" p="$2" r="$3" tf n
	tf="$(mktemp)"
	if ! git -C "$ROOT" show "$c:$p" >"$tf" 2>/dev/null; then
		rm -f "$tf"
		printf -- '-1'
		return 0
	fi
	if [ "$r" = 'enforcement-assertion' ]; then
		n="$(assertion_count "$tf")"
	else
		n="$(raw_count "$tf")"
	fi
	rm -f "$tf"
	printf '%s' "$n"
}

rule_is_known() {
	local r
	for r in $KNOWN_RULES; do [ "$r" = "$1" ] && return 0; done
	return 1
}

# Hard error for a malformed baseline row: names the file, the line number and the
# offending value, then exits non-zero. Not a warning — a bad row must never be a
# silent exemption.
baseline_bad() { # <file> <lineno> <message>
	printf 'check-ui-styles: BAD BASELINE  %s:%s: %s\n' "$1" "$2" "$3" >&2
	exit 1
}

# Validate every data row of a baseline file BEFORE any arithmetic on its counts.
# Rejects (a) a count that is not a plain non-negative integer — non-numeric,
# empty, whitespace-only, or CRLF-contaminated — and (b) an unknown rule tag.
baseline_validate() { # <file>
	local file="$1" lineno=0 raw line path rule count value
	[ -f "$file" ] || return 0
	while IFS= read -r raw || [ -n "$raw" ]; do
		lineno=$((lineno + 1))
		# A blank or comment line is not a data row.
		case "$raw" in ''|'#'*) continue ;; esac
		case "$raw" in *'|'*) ;; *) continue ;; esac
		# Drop a trailing inline comment, as load_baseline does.
		line="${raw%%#*}"
		case "$line" in *'|'*) ;; *) continue ;; esac
		path='' rule='' count=''
		IFS='|' read -r path rule count <<<"$line"
		# Strip ASCII spaces only: "\r", "\t" or letters must stay and be rejected.
		value="${count// /}"
		case "$value" in
			'')
				baseline_bad "$file" "$lineno" "empty (or whitespace-only) count in row '$line'" ;;
			*[!0-9]*)
				baseline_bad "$file" "$lineno" "count '$value' is not a plain non-negative integer (CRLF-contaminated or non-numeric) in row '$line'" ;;
		esac
		if ! rule_is_known "$rule"; then
			baseline_bad "$file" "$lineno" "unknown rule tag '${rule}' in row '$line' (known: $KNOWN_RULES)"
		fi
	done < "$file"
	return 0
}

declare -A BASE_RULE=() BASE_COUNT=()
load_baseline() {
	[ -f "$BASELINE" ] || return 0
	while IFS='|' read -r path rule count; do
		case "$path" in ''|'#'*) continue ;; esac
		BASE_RULE["$path"]="$rule"
		BASE_COUNT["$path"]="${count// /}"
	done < <(sed 's/#.*//' "$BASELINE" | grep -E '\|' || true)
}

baseline_rows() { # path|rule|count for every file that has anything to report
	local f rel_path rule debt asserted
	# `while … read` (not `for f in $(scan_files)`) so a path containing a space
	# is counted and seeded by --update instead of being word-split away (F-06).
	while IFS= read -r f; do
		[ -n "$f" ] || continue
		rel_path="$(rel "$f")"
		debt="$(raw_count "$f")"
		asserted="$(assertion_count "$f")"
		rule="${BASE_RULE[$rel_path]:-$(default_rule "$rel_path")}"
		[ "$debt" = "0" ] && [ "$asserted" = "0" ] && continue
		if [ "$asserted" != "0" ]; then
			printf '%s|enforcement-assertion|%s\n' "$rel_path" "$asserted"
		fi
		[ "$debt" = "0" ] && continue
		printf '%s|%s|%s\n' "$rel_path" "$rule" "$debt"
	done < <(scan_files)
}

write_baseline() {
	{
		printf '%s\n' \
			'# UI raw-palette baseline — T6.4 ratcheting guard (scripts/check-ui-styles.sh).' \
			'# Format: <path>|<rule>|<count>.  Rules: raw-palette, raw-palette-test,' \
			'#   ratchet-pending-t63, parked-scrim, parked-scheme-black,' \
			'#   parked-scheme-white, parked-caller-surface, enforcement-assertion.' \
			'# The guard FAILS if a debt row RISES, and fails if an enforcement-assertion' \
			'# row FALLS (deleting a test that proves the legacy class is gone is a regression).' \
			'# Lower debt rows when a migration removes occurrences; drop a row at zero.' \
			'# parked-* rows are MISSING-ROLE cases, not renames — see the reasons in the' \
			'# header of scripts/check-ui-styles.sh and ui/AGENTS.md § Tokens.' \
			'# ui/primitives/** is excluded (generated; ADR-0007 §1a).' \
			'# Re-seed with: scripts/check-ui-styles.sh --update'
		baseline_rows
	} > "$BASELINE"
}

# ---- baseline tamper guard (T6.4 hardening) -------------------------------
# The check below compares the TREE against the baseline; this compares the working
# baseline against the COMMITTED one, so raising a debt row (or lowering an
# enforcement-assertion row) in the baseline itself no longer passes silently.
baseline_tamper_check() {
	local repo_root rel_base committed_tmp
	if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		echo "check-ui-styles: not a git work tree — skipping baseline tamper check" >&2
		return 0
	fi
	repo_root="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
	rel_base="$BASELINE"
	[ -n "$repo_root" ] && rel_base="${BASELINE#"$repo_root"/}"
	if ! git -C "$ROOT" cat-file -e "HEAD:$rel_base" 2>/dev/null; then
		echo "check-ui-styles: HEAD has no $rel_base — skipping baseline tamper check" >&2
		return 0
	fi
	committed_tmp="$(mktemp)"
	if ! git -C "$ROOT" show "HEAD:$rel_base" >"$committed_tmp" 2>/dev/null; then
		rm -f "$committed_tmp"
		echo "check-ui-styles: cannot read HEAD:$rel_base — skipping baseline tamper check" >&2
		return 0
	fi
	local -A T_RULE=() T_COUNT=()
	local path rule count old new f derived ddebt
	while IFS='|' read -r path rule count; do
		case "$path" in ''|'#'*) continue ;; esac
		T_RULE["$path"]="$rule"
		T_COUNT["$path"]="${count// /}"
	done < <(sed 's/#.*//' "$committed_tmp" | grep -E '\|' || true)
	rm -f "$committed_tmp"

	# A committed debt row that went UP, or an enforcement-assertion row that went DOWN.
	if [ "${#T_COUNT[@]}" -gt 0 ]; then
		for path in "${!T_COUNT[@]}"; do
			rule="${T_RULE[$path]}"
			old="${T_COUNT[$path]}"
			new="${BASE_COUNT[$path]:-0}"
			if [ "$new" -gt "$old" ] 2>/dev/null; then
				echo "BASELINE TAMPER  $path ($rule) $old -> $new — the row was RAISED; revert scripts/ui-styles-baseline.txt"
				fail=1
			elif [ "$rule" = "enforcement-assertion" ] && [ "$new" -lt "$old" ] 2>/dev/null; then
				echo "BASELINE TAMPER  $path ($rule) $old -> $new — an enforcement-assertion row was LOWERED; that weakens the suite"
				fail=1
			fi
		done
	fi
	# A row that is not committed at all but appears in the working baseline. A new
	# row is LEGITIMATE exactly when it equals what the tree implies for that path —
	# that is what --update writes for a genuinely new file. Only a new row that does
	# NOT match the tree (one that exempts or inflates) is tampering, and the message
	# says which case it is (fix 8).
	if [ "${#BASE_COUNT[@]}" -gt 0 ]; then
		for path in "${!BASE_COUNT[@]}"; do
			rule="${BASE_RULE[$path]}"
			[ -n "${T_COUNT[$path]:-}" ] && continue
			new="${BASE_COUNT[$path]}"
			f="$(abs "$path")"
			if [ "$rule" = "enforcement-assertion" ]; then
				derived="$(assertion_count "$f")"
				ddebt="$(raw_count "$f")"
				if [ "$new" = "$derived" ] && [ "$ddebt" = "0" ]; then
					continue
				fi
				if [ "$ddebt" != "0" ]; then
					echo "BASELINE TAMPER  $path ($rule) absent -> $new — a new row tags the file enforcement-assertion, but the tree has $ddebt raw-palette occurrence(s) this row would EXEMPT"
				else
					echo "BASELINE TAMPER  $path ($rule) absent -> $new — a new row was ADDED that does not match the tree (the tree derives $derived assertion occurrence(s))"
				fi
				fail=1
				continue
			fi
			derived="$(raw_count "$f")"
			if [ "$new" = "$derived" ]; then
				continue
			fi
			if [ "$new" -gt "$derived" ] 2>/dev/null; then
				echo "BASELINE TAMPER  $path ($rule) absent -> $new — a new row was ADDED and INFLATES the count (the tree has $derived)"
			else
				echo "BASELINE TAMPER  $path ($rule) absent -> $new — a new row was ADDED and UNDERSTATES the count (the tree has $derived); a debt row cannot be smaller than the tree"
			fi
			fail=1
		done
	fi
	return 0
}

# ---- committed-edit audit (T6.4 hardening, fix 7) -------------------------
# The tamper check above diffs the WORKING baseline against HEAD, so it cannot see
# an edit that was committed — a baseline that landed with a debt row inflated to
# 999999, or re-tagged, or with a row deleted, passes check forever. This walks the
# commits that touched the baseline and compares each commit's baseline against its
# parent's, deriving counts from that commit's OWN tree. Range defaults to every
# commit that touched scripts/ui-styles-baseline.txt.
run_audit() { # <range-or-empty>
	local range="$1" repo_root rel_base commits c parent pfile cfile
	local checked=0 violations=0
	if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		echo "check-ui-styles: --audit requires a git work tree" >&2
		exit 1
	fi
	repo_root="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
	rel_base="$BASELINE"
	[ -n "$repo_root" ] && rel_base="${BASELINE#"$repo_root"/}"
	if [ -n "$range" ]; then
		commits="$(git -C "$ROOT" rev-list "$range" 2>/dev/null || true)"
	else
		commits="$(git -C "$ROOT" log --follow --format=%H -- "$rel_base" 2>/dev/null || true)"
	fi
	while IFS= read -r c; do
		[ -n "$c" ] || continue
		checked=$((checked + 1))
		local short subj nrows
		short="$(git -C "$ROOT" rev-parse --short "$c" 2>/dev/null || printf '%s' "$c")"
		subj="$(git -C "$ROOT" log -1 --format=%s "$c" 2>/dev/null || true)"
		parent="$(git -C "$ROOT" rev-parse --verify --quiet "$c^" 2>/dev/null || true)"
		if [ -z "$parent" ] || ! git -C "$ROOT" cat-file -e "$parent:$rel_base" 2>/dev/null; then
			nrows="$( { git -C "$ROOT" show "$c:$rel_base" 2>/dev/null || true; } | sed 's/#.*//' | grep -cE '\|' || true )"
			printf -- '--audit: %s "%s" — informational: this commit INTRODUCES the baseline (%s row(s)); nothing to compare\n' "$short" "$subj" "$nrows"
			continue
		fi
		pfile="$(mktemp)"
		cfile="$(mktemp)"
		git -C "$ROOT" show "$parent:$rel_base" >"$pfile" 2>/dev/null || true
		git -C "$ROOT" show "$c:$rel_base" >"$cfile" 2>/dev/null || true
		local -A P_RULE=() P_COUNT=() C_RULE=() C_COUNT=()
		local path rule count
		while IFS='|' read -r path rule count; do
			case "$path" in ''|'#'*) continue ;; esac
			P_RULE["$path"]="$rule"
			P_COUNT["$path"]="${count// /}"
		done < <(sed 's/#.*//' "$pfile" | grep -E '\|' || true)
		while IFS='|' read -r path rule count; do
			case "$path" in ''|'#'*) continue ;; esac
			C_RULE["$path"]="$rule"
			C_COUNT["$path"]="${count// /}"
		done < <(sed 's/#.*//' "$cfile" | grep -E '\|' || true)
		rm -f "$pfile" "$cfile"
		local v=0 prule pr cr cc derived
		# Rows present in both: tag change, a debt rise, an enforcement-assertion fall.
		for path in "${!C_COUNT[@]}"; do
			[ -n "${P_COUNT[$path]:-}" ] || continue
			prule="${P_RULE[$path]}"
			pr="${P_COUNT[$path]}"
			cr="${C_RULE[$path]}"
			cc="${C_COUNT[$path]}"
			if [ "$cr" != "$prule" ]; then
				printf 'AUDIT VIOLATION  %s %s (%s) -> (%s) — the row TAG CHANGED; a tag is a ratchet direction, not a label to edit\n' "$short" "$path" "$prule" "$cr"
				v=$((v + 1))
				continue
			fi
			if [ "$cr" = "enforcement-assertion" ]; then
				if [ "$cc" -lt "$pr" ] 2>/dev/null; then
					printf 'AUDIT VIOLATION  %s %s (%s) %s -> %s — an enforcement-assertion row FELL; the suite was weakened\n' "$short" "$path" "$cr" "$pr" "$cc"
					v=$((v + 1))
				fi
			else
				if [ "$cc" -gt "$pr" ] 2>/dev/null; then
					printf 'AUDIT VIOLATION  %s %s (%s) %s -> %s — a debt row ROSE; the ratchet was laundered into history\n' "$short" "$path" "$cr" "$pr" "$cc"
					v=$((v + 1))
				fi
			fi
		done
		# A row removed while its file still exists at this commit.
		for path in "${!P_COUNT[@]}"; do
			[ -n "${C_COUNT[$path]:-}" ] && continue
			if git -C "$ROOT" cat-file -e "$c:$path" 2>/dev/null; then
				printf 'AUDIT VIOLATION  %s %s (%s %s) — the row was REMOVED while the file still exists at this commit\n' "$short" "$path" "${P_RULE[$path]}" "${P_COUNT[$path]}"
				v=$((v + 1))
			fi
		done
		# A row added whose count must equal what THIS commit's tree derives.
		for path in "${!C_COUNT[@]}"; do
			[ -n "${P_COUNT[$path]:-}" ] && continue
			cr="${C_RULE[$path]}"
			cc="${C_COUNT[$path]}"
			derived="$(count_at_commit "$c" "$path" "$cr")"
			if [ "$cc" != "$derived" ]; then
				printf 'AUDIT VIOLATION  %s %s (%s) absent -> %s — a row was ADDED whose count does not match this commit tree (the tree derives %s)\n' "$short" "$path" "$cr" "$cc" "$derived"
				v=$((v + 1))
			fi
		done
		violations=$((violations + v))
		printf -- '--audit: %s "%s" — %s row(s) at this commit, %s violation(s)\n' "$short" "$subj" "${#C_COUNT[@]}" "$v"
	done <<<"$commits"
	printf -- '--audit: %s commit(s) checked, %s violation(s)\n' "$checked" "$violations"
	[ "$violations" -eq 0 ] || exit 1
	exit 0
}

usage() {
	cat <<'EOF'
Usage: scripts/check-ui-styles.sh [--update [--force] | --ratchet | --audit [<range>] | --help]

  (no argument)   check the tree against scripts/ui-styles-baseline.txt
  --update        rewrite the baseline from the tree (refuses to raise an existing row)
  --update --force  rewrite the baseline, allowing rows to rise
  --ratchet       lower every improved debt row; drop stale rows; never lower an
                  enforcement-assertion row; ATOMIC — the baseline is replaced only
                  when the run is clean, else it is left byte-untouched (exit 1)
  --audit [<range>]  audit the baseline's OWN committed history. With no range,
                  every commit that touched scripts/ui-styles-baseline.txt. Fails
                  (exit 1) if a committed edit raised a debt row, lowered an
                  enforcement-assertion row, changed a tag, removed a row whose file
                  still exists, or added a row that does not match that commit's tree.
  -h, --help      show this help

An unknown argument is an error (exit 2). A symlink under ui/ is a hard error.
EOF
}

case "${1:-}" in
	'') : ;;                                    # no argument -> check
	--update)
		# Preserve existing rule tags (parked-*, ratchet-pending-t63) — deriving from the
		# tree alone cannot know which rows are missing-role cases rather than debt.
		# T6.4 hardening: refuse to RAISE an existing row's number unless --force is
		# given, naming every row it would raise. --update must not defeat the ratchet.
		baseline_validate "$BASELINE"
		symlink_check
		if [ "$symfail" -ne 0 ]; then
			echo "check-ui-styles: FAILED (symlink under ui/) — refusing to rewrite the baseline" >&2
			exit 1
		fi
		load_baseline
		force=0
		case "${2:-}" in --force) force=1 ;; esac
		raises=""
		while IFS='|' read -r rpath rrule rcount; do
			case "$rpath" in ''|'#'*) continue ;; esac
			old="${BASE_COUNT[$rpath]:-}"
			[ -n "$old" ] || continue
			new="${rcount// /}"
			if [ "$new" -gt "$old" ] 2>/dev/null; then
				raises="${raises}${rpath} (${rrule}) ${old} -> ${new}"$'\n'
			fi
		done < <(baseline_rows)
		if [ -n "$raises" ] && [ "$force" -eq 0 ]; then
			echo "check-ui-styles: --update would RAISE existing baseline row(s):" >&2
			printf '%s' "$raises" >&2
			echo "Refusing to raise — that is how the ratchet is defeated. Re-run with --force to override." >&2
			exit 1
		fi
		if [ "$force" -ne 0 ] && [ -n "$raises" ]; then
			echo "check-ui-styles: --force accepted rising baseline row(s):" >&2
			printf '%s' "$raises" >&2
		fi
		write_baseline
		echo "Wrote $BASELINE"
		exit 0
		;;
	--ratchet)
		# Lower every debt row that improved; keep tags, header, and assertion rows.
		# T6.4 hardening: a missing baseline is a hard refusal — never create or
		# truncate the file (a 0-byte baseline is data loss).
		if [ ! -f "$BASELINE" ]; then
			echo "check-ui-styles: no baseline at $BASELINE — refusing to ratchet (--ratchet must not create one)" >&2
			exit 1
		fi
		baseline_validate "$BASELINE"
		symlink_check
		if [ "$symfail" -ne 0 ]; then
			echo "check-ui-styles: FAILED (symlink under ui/) — refusing to ratchet" >&2
			exit 1
		fi
		load_baseline
		tmp="$(mktemp)"
		ratchet_regressed=0
		{
			sed -n '1,/^[^#]/p' "$BASELINE" | grep '^#' || true
			while IFS='|' read -r path rule count; do
				case "$path" in ''|'#'*) continue ;; esac
				base="${count// /}"
				f="$(abs "$path")"
				if [ ! -f "$f" ]; then
					# Drop a stale row; writing "|0" would be a fiction (F-18).
					echo "check-ui-styles: --ratchet dropping stale row $path ($rule $base) — file is gone" >&2
					continue
				fi
				if [ "$rule" = "enforcement-assertion" ]; then
					# The inverted ratchet: NEVER lower it. A fallen assertion is a
					# weakened suite — a regression, not a ratchet opportunity (F-01).
					cur="$(assertion_count "$f")"
					printf '%s|%s|%s\n' "$path" "$rule" "$base"
					if [ "$cur" -lt "$base" ]; then
						echo "check-ui-styles: --ratchet refuses to lower enforcement-assertion row $path ($cur < $base) — the suite was weakened; that is a regression" >&2
						ratchet_regressed=1
					fi
					continue
				fi
				cur="$(raw_count "$f")"
				if [ "$cur" -lt "$base" ]; then
					printf '%s|%s|%s\n' "$path" "$rule" "$cur"
				else
					printf '%s|%s|%s\n' "$path" "$rule" "$base"
				fi
			done < <(sed 's/#.*//' "$BASELINE" | grep -E '\|' || true)
		} > "$tmp"
		# ATOMIC (fix 9): replace the baseline ONLY on a clean run. An
		# enforcement-assertion regression aborts with the file byte-untouched — the
		# old behaviour wrote the partially-lowered baseline AND exited 1.
		if [ "$ratchet_regressed" -ne 0 ]; then
			rm -f "$tmp"
			echo "check-ui-styles: --ratchet ABORTED — an enforcement-assertion regression was detected; the baseline is byte-untouched (no partial ratchet)" >&2
			exit 1
		fi
		mv "$tmp" "$BASELINE"
		if bash "$0"; then rc=0; else rc=$?; fi
		exit "$rc"
		;;
	--audit)
		run_audit "${2:-}"
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		usage >&2
		exit 2
		;;
esac

# ---- check ----
load_baseline
if [ ! -f "$BASELINE" ]; then
	echo "check-ui-styles: no baseline at $BASELINE — seed it with --update" >&2
	exit 1
fi

# A malformed row is a hard error before any comparison runs: no `[: … : integer
# expression expected` noise, no silently-exempt row.
baseline_validate "$BASELINE"

fail=0
seen=0
total=0

# A symlink under ui/ is a hard error (fix 6): `find -type f` never sees a
# symlinked source file, so skipping it hides raw palette, and following it could
# leave ui/. Only ever ADDS SYMLINK lines and sets fail=1.
symlink_check
if [ "$symfail" -ne 0 ]; then
	fail=1
fi

# T6.4 hardening: defend the baseline itself before trusting it. Only ever ADDS
# BASELINE TAMPER lines and sets fail=1; on a clean tree it prints nothing.
baseline_tamper_check

while IFS='|' read -r path rule base; do
	case "$path" in ''|'#'*) continue ;; esac
	f="$(abs "$path")"
	seen=$((seen + 1))
	if [ ! -f "$f" ]; then
		echo "STALE ROW  $path ($rule $base) — file is gone; drop the row"
		fail=1
		continue
	fi
	# Rows in the baseline that are not in this read pass are handled below.
	if [ "$rule" = "enforcement-assertion" ]; then
		cur="$(assertion_count "$f")"
		total=$((total + cur))
		if [ "$cur" -lt "$base" ]; then
			echo "REGRESSION $path ($rule) $cur < $base — an assertion that proves the legacy class is gone was removed"
			fail=1
		fi
		continue
	fi
	cur="$(raw_count "$f")"
	total=$((total + cur))
	if [ "$cur" -gt "$base" ]; then
		echo "REGRESSION $path ($rule) $cur > $base — raw palette added"
		fail=1
	fi
done < <(sed 's/#.*//' "$BASELINE" | grep -E '\|' || true)

# New debt: a file with raw palette that the baseline has never seen. A file whose
# only raw hits are assertion lines is NOT debt — that is the change the guard
# exists to encourage (F-09).
while IFS='|' read -r path rule count; do
	[ -n "${BASE_RULE[$path]:-}" ] && continue
	if [ "$rule" = "enforcement-assertion" ]; then
		echo "NEW ASSERTION  $path ($rule $count) — not debt: a test proving the legacy class is gone. Add an enforcement-assertion baseline row (run: scripts/check-ui-styles.sh --update) so the inverted ratchet protects it."
		continue
	fi
	echo "NEW DEBT   $path ($rule $count) — no baseline row; migrate it or seed with --update"
	fail=1
done < <(baseline_rows)

if [ "$fail" -ne 0 ]; then
	echo "check-ui-styles: FAILED"
	exit 1
fi

echo "UI raw-palette debt: $total occurrence(s) across $seen baseline row(s) — at or below baseline"
echo "OK"
