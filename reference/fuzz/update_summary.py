"""Adds up the answers of the workers of update_batch.sh and says which branches of the plan no input reached. Usage: update_summary.py <dir>
Reads gen-*.txt (what update_fuzz.py counted) and cmp-*.txt (what update_compare.mjs found); exits 1 when a branch was not reached or an answer differs."""
import glob
import json
import os
import re
import sys

dir_ = sys.argv[1]
hits, inputs, differences = {}, 0, 0
for path in sorted(glob.glob(os.path.join(dir_, 'gen-*.txt'))):
    text = open(path).read()
    inputs += int(text.split(' inputs;', 1)[0])
    for key, value in json.loads(text.split(' inputs; ', 1)[1]).items():
        hits[key] = hits.get(key, 0) + value
compared = 0
for path in sorted(glob.glob(os.path.join(dir_, 'cmp-*.txt'))):
    text = open(path).read()
    found = re.search(r'(\d+) inputs, (\d+) differences', text)
    compared += int(found.group(1))
    differences += int(found.group(2))
    if int(found.group(2)):
        print(text)

# What a run must have reached: every refusal that the core makes, every part of the plan, both pins, both channels, every kind of plan.
CORE_REFUSALS = ['pin-line', 'pin-key', 'pin-duplicate', 'pin-missing', 'pin-value', 'source-missing', 'source-mismatch', 'release-none', 'release-duplicate', 'release-missing', 'older-than-pin', 'release-moved',
                 'manifest-json', 'manifest-shape', 'manifest-schema', 'manifest-keys', 'manifest-tag', 'manifest-version', 'manifest-commit', 'manifest-commit-moved', 'manifest-generations', 'manifest-node',
                 'manifest-requires', 'manifest-files', 'manifest-entry', 'manifest-kind', 'manifest-path', 'manifest-source', 'manifest-digest', 'manifest-size', 'manifest-duplicate', 'manifest-too-large',
                 'node-version', 'download-missing', 'size-mismatch', 'digest-mismatch', 'path-blocked']
WANTED = ['answer: refused ' + code for code in CORE_REFUSALS] + ['answer: update', 'answer: unchanged', 'answer: current']
WANTED += ['plan has ' + part for part in ['added', 'changed', 'unchanged', 'templates', 'kept', 'remove', 'overwritten']]
WANTED += ['plan has %d or more in %s' % (size, key) for key, size in [('remove', 4), ('added', 4), ('changed', 4), ('overwritten', 3), ('templates', 2), ('kept', 3), ('unchanged', 4)]]
WANTED += ['plan pin changed', 'plan pin same', 'plan first adoption', 'plan repair', 'plan update', 'plan channel stable', 'plan channel prerelease', 'plan with a usable previous manifest', 'warning previous-missing']
WANTED += ['warning previous-unusable ' + code for code in ['manifest-json', 'manifest-shape', 'manifest-schema', 'manifest-keys', 'manifest-tag', 'manifest-version', 'manifest-commit', 'manifest-commit-moved', 'manifest-generations',
                                                          'manifest-node', 'manifest-requires', 'manifest-files', 'manifest-entry', 'manifest-kind', 'manifest-path', 'manifest-source', 'manifest-digest', 'manifest-size',
                                                          'manifest-duplicate']]
WANTED += ['path-blocked at the pin that is ' + kind for kind in ['dir', 'link']] + ['path-blocked at a managed path that is ' + kind for kind in ['dir', 'link', 'other', 'blocked']]
WANTED += ['plan block ' + action for action in ['create', 'append', 'replace', 'current', 'refused']] + ['plan with no block', 'plan block replace overwritten', 'plan block replace kept']
WANTED += ['warning block-refused ' + why for why in ['begin-without-end', 'end-without-begin', 'reversed', 'doubled', 'partial-line', 'not-text', 'fence', 'invalid-block', 'not-a-file', 'too-large']]
WANTED += ['plan block refused ' + why for why in ['begin-without-end', 'end-without-begin', 'reversed', 'doubled', 'partial-line', 'not-text', 'fence', 'invalid-block', 'not-a-file', 'too-large']]
missing = [key for key in WANTED if hits.get(key, 0) == 0]
print(inputs, 'inputs generated,', compared, 'compared,', differences, 'differences')
width = max(len(key) for key in hits)
for key in sorted(hits):
    print('%8d  %s' % (hits[key], key))
print('branches never hit:', 'none' if not missing else ', '.join(missing))
sys.exit(1 if missing or differences or compared != inputs else 0)
