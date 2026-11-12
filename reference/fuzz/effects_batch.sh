#!/bin/bash
# Usage: effects_batch.sh <dir> <count> <seed> <workers>
set -e
DIR=$1; COUNT=$2; SEED=$3; W=$4
HERE=$(cd "$(dirname "$0")" && pwd)
python3 "$HERE/audit_fuzz.py" "$DIR" "$COUNT" "$SEED"
STEP=$(( (COUNT + W - 1) / W ))
for ((w=0; w<W; w++)); do
  python3 "$HERE/effects_ref_run.py" "$DIR" $((w*STEP)) $(((w+1)*STEP)) "$DIR/effects-$w.json" &
done
wait
node "$HERE/effects_compare.mjs" "$DIR" "$DIR"/effects-*.json > "$DIR/effects-result.txt" 2>&1 || true
touch "$DIR/effects-done"
