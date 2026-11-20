"""Adds up the answers of the workers of agent_batch.sh and says which branches of the block functions no scenario reached. Usage: agent_summary.py <dir>
Reads gen-*.txt (what agent_fuzz.py counted) and cmp-*.txt (what agent_compare.mjs found); exits 1 when a branch was not reached or an answer differs."""
import glob
import json
import os
import re
import sys

dir_ = sys.argv[1]
hits, inputs, differences, broken, compared = {}, 0, 0, 0, 0
for path in sorted(glob.glob(os.path.join(dir_, 'gen-*.txt'))):
    text = open(path).read()
    inputs += int(text.split(' inputs;', 1)[0])
    for key, value in json.loads(text.split(' inputs; ', 1)[1]).items():
        hits[key] = hits.get(key, 0) + value
for path in sorted(glob.glob(os.path.join(dir_, 'cmp-*.txt'))):
    text = open(path).read()
    found = re.search(r'(\d+) inputs, (\d+) differences, (\d+) broken', text)
    compared += int(found.group(1))
    differences += int(found.group(2))
    broken += int(found.group(3))
    if int(found.group(2)) or int(found.group(3)):
        print(text)

WHYS = ['partial-line', 'begin-without-end', 'end-without-begin', 'reversed', 'doubled']
VIEWS = ['none', 'one', 'refused']
WANTED = ['read none', 'read none fenced', 'read one'] + ['read refused ' + why for why in WHYS]
WANTED += ['read one in a file with CRLF', 'read in a file with a lone carriage return', 'read one that ends the file', 'read one that starts the file', 'read in a file with a fence']
WANTED += ['splice create', 'splice append', 'splice replace', 'splice current'] + ['splice refused ' + why for why in WHYS + ['not-text', 'fence', 'invalid-block']] + ['refusal does not write']
WANTED += ['splice replace with text before and after', 'splice replace at an edge'] + ["splice append with separator %r" % s for s in (b'', b'\n', b'\n\n')]
WANTED += ['diff %s to %s: %s' % (a, b, c) for a in VIEWS for b in VIEWS for c in ('changed', 'same') if not (a != b and c == 'same') and not (a == b == 'none' and c == 'changed')]
WANTED += ['diff of files that differ, and the same to agents']
missing = [key for key in WANTED if hits.get(key, 0) == 0]
print(inputs, 'scenarios generated,', compared, 'lines compared,', differences, 'differences,', broken, 'broken')
width = max(len(key) for key in hits)
for key in sorted(hits):
    print('%8d  %s' % (hits[key], key))
print('branches never hit:', 'none' if not missing else ', '.join(missing))
written = sum(len(open(path).read().splitlines()) for path in glob.glob(os.path.join(dir_, 'in-*.jsonl')))
sys.exit(1 if missing or differences or broken or compared != written else 0)
