#!/bin/bash
# Usage: agent_batch.sh <dir> <count> <seed> <workers>
# A differential fuzz of the block functions of the updater (readBlock, spliceBlock, blockChanged): <workers> processes each draw about <count>/<workers> scenarios (seeds
# <seed>, <seed>+1, ...), each of three lines (agent_fuzz.py); the Python reference answers each, and the Node program answers it again. <dir>/result.txt says how many lines
# were compared, how many answers differ, how many scenarios reached each branch, which branch no scenario reached, and which lines of the functions never ran.
set -e
DIR=$1; COUNT=$2; SEED=$3; W=$4
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$DIR"
PER=$(( (COUNT + W - 1) / W ))
for ((w=0; w<W; w++)); do
  (
    python3 "$HERE/agent_fuzz.py" "$PER" $((SEED + w)) "$DIR/in-$w.jsonl" > "$DIR/gen-$w.txt"
    NODE_V8_COVERAGE="$DIR/coverage-$w" node "$HERE/agent_compare.mjs" "$DIR/in-$w.jsonl" > "$DIR/cmp-$w.txt" 2>&1 || true
  ) &
done
wait
{ python3 "$HERE/agent_summary.py" "$DIR" || true; mkdir -p "$DIR/coverage"; cp "$DIR"/coverage-*/*.json "$DIR/coverage/" 2>/dev/null; node "$HERE/agent_coverage.mjs" "$DIR/coverage" || true; } > "$DIR/result.txt" 2>&1
touch "$DIR/done"
