#!/usr/bin/env bash
# Lượt đo thứ 3 (sạch nhất): KHÔNG lấy mẫu docker stats giữa chừng, 12s/lần, ramp ngắn.
cd "$(dirname "$0")"
export FIX_SEC=12 RAMP_SEC=10
for s in home browse cart checkout auth events; do
  case $s in home) R=2,4,8,16;; events) R=4,16,64;; *) R=4,8,16,32,64;; esac
  RAMP=$R node scenarios.cjs $s > results/$s.log 2>&1
done
echo DONE > results/run-all2.done
