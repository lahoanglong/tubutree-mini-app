#!/usr/bin/env bash
# Một luồng race suite trên cụm Postgres chạy thẳng riêng.
# Dùng: race-shard.sh <worktree> <shard> <tổng> <cổng pg> <outdir>
# Spec rớt được chạy lại riêng một lần: rớt do tải máy (P2028, P1001, timeout) khác lỗi code.
set -uo pipefail
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
WT=$1; SHARD=$2; TOTAL=$3; PORT=$4; OUT=$5
T=$(dirname "$0")
mkdir -p "$OUT"
LOG=$OUT/race-$SHARD.log
bash $T/pg-native.sh start $PORT >/dev/null || { echo "SHARD $SHARD: không dựng được cụm $PORT"; exit 1; }
bash $T/pg-native.sh createdb $PORT tubutree_it >/dev/null 2>&1 || { echo "SHARD $SHARD: createdb lỗi"; exit 1; }
export DATABASE_URL="postgresql://tubu@127.0.0.1:$PORT/tubutree_it?schema=public"
cd $WT/apps/api
npx prisma migrate deploy > $OUT/race-$SHARD-migrate.log 2>&1 || { echo "SHARD $SHARD: migrate lỗi"; exit 1; }
npx jest -c test/integration-race/jest.config.js --runInBand --shard=$SHARD/$TOTAL > $LOG 2>&1
code=$?
echo "SHARD $SHARD lần 1 exit $code: $(grep -E '^Tests:' $LOG)"
if [ $code -ne 0 ]; then
  grep -E '^FAIL ' $LOG | awk '{print $2}' | sort -u > $OUT/race-$SHARD-failed.txt
  : > $OUT/race-$SHARD-rerun.log
  while read -r f; do
    [ -z "$f" ] && continue
    npx jest -c test/integration-race/jest.config.js --runInBand "$f" >> $OUT/race-$SHARD-rerun.log 2>&1 \
      && echo "RERUN PASS $f" || echo "RERUN FAIL $f"
  done < $OUT/race-$SHARD-failed.txt
fi
echo "SHARD $SHARD DONE"
