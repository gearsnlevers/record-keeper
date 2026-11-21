#!/bin/bash
# Usage: length_batch.sh <dir> <count> <seed>
# The differential fuzz of the length that V-10 counts: length_fuzz.py writes about <count> records (pairs of a record without and with its Known deviations and
# Errata sections, records whose sections hold lines that end a section, records that g1 refuses) and what reference 1 says of them; reference 2 and the
# library are compared with it. <dir>/result.txt says how many folders were compared, how many answers differ and how many pairs broke the invariant of the page.
set -e
DIR=$1; COUNT=$2; SEED=$3
HERE=$(cd "$(dirname "$0")" && pwd)
GEN=$(python3 "$HERE/length_fuzz.py" "$COUNT" "$SEED" "$DIR")
node "$HERE/validate_compare_ref2.mjs" "$DIR" > "$DIR/cmp-ref2.txt" 2>&1 || true
node "$HERE/validate_compare.mjs" "$DIR" > "$DIR/cmp-library.txt" 2>&1 || true
{ echo "$GEN"; echo "reference 2: $(tail -1 "$DIR/cmp-ref2.txt")"; echo "library: $(tail -1 "$DIR/cmp-library.txt")"; } > "$DIR/result.txt"
touch "$DIR/done"
