#!/usr/bin/env bash
cd "$(dirname "$0")"
for s in auth cart events checkout; do node scenarios.cjs $s > results/$s.log 2>&1; done
node flash.cjs > results/flash.log 2>&1
echo DONE > results/run-rest.done
