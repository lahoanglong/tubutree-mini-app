#!/usr/bin/env bash
# Phán xanh/đỏ cho một thư mục log của gate.sh. Dùng: gate-verdict.sh <outdir> [full]
# Đóng khi thiếu: bước bắt buộc không có log hoặc không có dòng kết quả thì tính đỏ. Lý do: gate.sh từng
# in "gate exit 0" khi jest đỏ (gate 8) và khi race không chạy vì outdir tương đối (gate-rc2-1).
set -uo pipefail
OUT=$1; FULL=${2:-}
RED=""
red() { RED="$RED $1"; }

if [ -f "$OUT/exits.txt" ]; then
  while read -r name code; do [ "$code" != 0 ] && red "$name"; done < "$OUT/exits.txt"
fi

for n in tsc-api tsc-miniapp tsc-web tsc-e2e; do
  [ -f "$OUT/$n.log" ] || { red "$n(thiếu log)"; continue; }
  grep -q 'error TS' "$OUT/$n.log" && red "$n"
done

for n in migrate migrate-status drift partial-idx lint-vars lint-parity; do
  [ -f "$OUT/$n.log" ] || red "$n(thiếu log)"
done
grep -q 'mong đợi \([0-9]*\), có trong DB \1\.' "$OUT/partial-idx.log" 2>/dev/null || red "partial-idx(không khớp)"

L=$OUT/jest-api.log
if ! grep -q '^Tests:' "$L" 2>/dev/null; then red "jest-api(không có kết quả)"
elif grep -qE '^(Tests|Test Suites):.*failed' "$L"; then red "jest-api"; fi

for sh in 1 2; do
  L=$OUT/race-$sh.log
  if ! grep -q '^Tests:' "$L" 2>/dev/null; then red "race-$sh(không có kết quả)"; continue; fi
  grep -qE '^(Tests|Test Suites):.*failed' "$L" || continue
  R=$OUT/race-$sh-rerun.log
  if [ ! -s "$R" ]; then red "race-$sh(đỏ, không chạy lại)"
  elif grep -qE '^Tests:.*failed' "$R" || ! grep -q '^Tests:' "$R"; then red "race-$sh"; fi
done

for n in vitest-miniapp vitest-miniapp-utc vitest-web vitest-web-utc vitest-app-core; do
  L=$OUT/$n.log
  if ! grep -qE 'Tests +[0-9]+ passed' "$L" 2>/dev/null; then red "$n(không có kết quả)"
  elif grep -qE '(Test Files|Tests) +.*failed' "$L"; then red "$n"; fi
done

if [ -n "$FULL" ]; then
  for n in eslint-api eslint-miniapp eslint-web build-api build-web build-miniapp; do
    [ -f "$OUT/$n.log" ] || red "$n(thiếu log)"
  done
  grep -qE '[0-9]+ errors?' "$OUT/eslint-web.log" 2>/dev/null && ! grep -qE '\(0 errors' "$OUT/eslint-web.log" && red "eslint-web"
fi

if [ -n "$RED" ]; then echo "ĐỎ:$RED"; exit 1; fi
echo "XANH: mọi bước bắt buộc có kết quả và không đỏ"
