#!/usr/bin/env bash
# OPT-20261002-005: assert staged index still non-empty before pre-commit exits.
# Long random-test windows race with parallel Agent / Session Hub / auto-commit
# that may `git reset` / clear the index; without this guard git can create an
# empty commit once the hook returns success.
#
# Usage (sourced from pre-commit.node after tests pass):
#   STAGED_COUNT_AT_START=N  rt_assert_staged_preserved
#
# Env:
#   PRECOMMIT_SKIP_STAGED_GUARD=1  — emergency bypass (documented only)

rt_assert_staged_preserved() {
  if [ "${PRECOMMIT_SKIP_STAGED_GUARD:-}" = "1" ]; then
    echo "WARN: PRECOMMIT_SKIP_STAGED_GUARD=1 — skipping staged-index guard" >&2
    return 0
  fi
  local start="${STAGED_COUNT_AT_START:-0}"
  case "$start" in
    ''|*[!0-9]*) start=0 ;;
  esac
  if [ "$start" -le 0 ]; then
    return 0
  fi
  local now
  now="$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d '[:space:]')"
  case "$now" in
    ''|*[!0-9]*) now=0 ;;
  esac
  if [ "$now" -le 0 ]; then
    echo "ERROR: staged index was cleared during pre-commit (had ${start} path(s), now empty)." >&2
    echo "       Aborting to avoid an empty commit (OPT-20261002-005)." >&2
    echo "       Likely race: parallel Agent/Session Hub/auto-commit ran git reset" >&2
    echo "       while this hook's random tests were still running." >&2
    echo "       Re-stage your files and commit again; avoid concurrent git reset" >&2
    echo "       in the same worktree during long pre-commit windows." >&2
    return 1
  fi
  return 0
}
