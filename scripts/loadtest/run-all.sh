#!/usr/bin/env bash
# Chạy toàn bộ kịch bản tải tuần tự (dùng 127.0.0.1 để tránh nhiễu resolve "localhost"), rồi dọn dữ liệu test.
cd "$(dirname "$0")"
for s in browse home auth cart events checkout; do node scenarios.cjs $s > results/$s.log 2>&1; done
node flash.cjs > results/flash.log 2>&1
docker exec -i tubu_pg psql -U tubu -d tubutree_perf < cleanup-test-data.sql > results/cleanup.log 2>&1
echo DONE > results/run-all.done
