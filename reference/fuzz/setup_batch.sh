#!/bin/bash
# Usage: setup_batch.sh <dir> <count> <seed> <workers>
# A differential fuzz of the core of the setup check: <workers> processes each draw about <count>/<workers> inputs (seeds <seed>, <seed>+1, ...), the Python reference
# answers each, and the Node program answers it again. <dir>/result.txt says how many inputs were compared, how many answers differ, how many inputs reached each
# branch, and which branch no input reached. The Node run also records which lines of the core ran (setup_coverage.mjs).
set -e
DIR=$1; COUNT=$2; SEED=$3; W=$4
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$DIR"
PER=$(( (COUNT + W - 1) / W ))
for ((w=0; w<W; w++)); do
  (
    python3 "$HERE/setup_fuzz.py" "$PER" $((SEED + w)) "$DIR/in-$w.jsonl" > "$DIR/gen-$w.txt"
    NODE_V8_COVERAGE="$DIR/coverage-$w" node "$HERE/setup_compare.mjs" "$DIR/in-$w.jsonl" > "$DIR/cmp-$w.txt" 2>&1 || true
  ) &
done
wait
{ python3 "$HERE/setup_summary.py" "$DIR" || true; mkdir -p "$DIR/coverage"; cp "$DIR"/coverage-*/*.json "$DIR/coverage/" 2>/dev/null; node "$HERE/setup_coverage.mjs" "$DIR/coverage" || true; } > "$DIR/result.txt" 2>&1
touch "$DIR/done"
