#!/usr/bin/env bash
# Every test, cheapest first, with a wall-clock time for each.
# Each one has its own watchdog, so this cannot hang.
cd "$(dirname "$0")/.." || exit 1
fail=0
for t in fallback-models three-site dest missile rail impact traffic crash bank order flight console mobile; do
  s=$SECONDS
  out=$(node "test/$t.js" 2>&1)
  took=$((SECONDS - s))
  bad=$(printf '%s\n' "$out" | grep -cE '^!! |^ERR |^CON |\*\*\* WRONG')
  printf '%-18s %4ss  %s\n' "$t" "$took" \
    "$([ "$bad" -eq 0 ] && echo 'ok' || echo "$bad problem(s) — rerun: node test/$t.js")"
  [ "$bad" -eq 0 ] || fail=1
done
exit $fail
