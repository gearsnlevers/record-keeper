"""Adds up the answers of the workers of setup_batch.sh and says which branches of the core of the setup check no input reached. Usage: setup_summary.py <dir>
Reads gen-*.txt (what setup_fuzz.py counted) and cmp-*.txt (what setup_compare.mjs found); exits 1 when a branch was not reached or an answer differs."""
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

# What a run must have reached: every finding, every topic that is checked and every topic that is not, every state of every part of the input, both sides of every limit.
CODES = ['audit-dead', 'check-not-required', 'check-not-strict', 'bypass-always', 'codeowners-missing', 'codeowners-uncovered', 'owners-few', 'owner-mismatch', 'managed-differs', 'manifest-unreadable', 'pin-missing', 'pin-unusable',
         'settings-missing', 'settings-unusable', 'secret-not-set', 'audit-workflow-missing', 'audit-record-unreadable', 'audit-record-future', 'single-owner', 'audit-not-yet', 'not-checked']
TOPICS = ['github', 'repository', 'rules', 'strict', 'bypass', 'accounts', 'codeowners', 'own', 'release', 'secret', 'audit', 'age']
PASSED = ['settings', 'owners', 'owner-accounts', 'codeowners', 'check-required', 'check-strict', 'bypass', 'pin', 'manifest', 'managed-files', 'secret', 'audit-workflow', 'audit']
PATHS = ['.github/record-keeper/settings.yml', '.github/record-keeper.yml', '.github/workflows/records-integrity.yml', '.github/workflows/records-audit.yml', '.github/workflows/records-setup-check.yml', '.github/workflows/records-updater.yml']
REASONS = ['a pattern longer than 300 characters', 'a pattern that starts with !', 'a pattern with \\, [, ] or ?', 'a pattern with no name', 'a pattern with an empty part', 'a pattern with more than 12 parts', 'a pattern with ** inside a name',
           'an owner that is not @name, @org/team or an e-mail address']
WANTED = ['finding ' + code for code in CODES] + ['not-checked ' + topic for topic in TOPICS] + ['passed ' + topic for topic in PASSED]
WANTED += ['settings read', 'settings absent', 'settings unreadable', 'settings problems 0', 'settings problems 1', 'settings problems 2 or more', 'settings problem with no line', 'owners few', 'owners enough', 'owners none', 'owners exactly 30',
           'owners more than 30', 'approvals 1', 'approvals more', 'local', 'not local', 'own repository', 'event None', 'event schedule', 'event workflow_dispatch', 'event pull_request', 'secretSet True', 'secretSet False', 'secretSet None']
WANTED += ['codeowners read', 'codeowners absent', 'codeowners unreadable', 'decision with unreadable codeowners', 'codeowners covers all', 'codeowners covers some', 'codeowners covers none'] + ['codeowners uncovered ' + path for path in PATHS]
WANTED += ['pin read', 'pin absent', 'pin refused'] + ['pin refused ' + code for code in ['pin-text', 'pin-line', 'pin-key', 'pin-duplicate', 'pin-value', 'pin-missing']]
WANTED += ['release read', 'release not-checked', 'release unlisted', 'release no-asset', 'release refused', 'release upToDate True', 'release upToDate False', 'release upToDate None', 'release secrets names the secret', 'release secrets does not']
WANTED += ['file not in the tree', 'file absent', 'file not a file', 'file with no digest', 'file with another digest', 'file with another size', 'file as released', 'files differing 0', 'files differing 1', 'files differing 2 to 8', 'files differing more than 8']
WANTED += ['auditWorkflow file', 'auditWorkflow absent', 'auditWorkflow other', 'repo ok', 'repo not ok', 'rules ok', 'rules not ok', 'rules requiring 0', 'rules requiring 1', 'rules requiring 2 or more', 'rules entries 0', 'rules entries some']
WANTED += ['classic not ok', 'classic requires', 'classic does not require', 'requiring strict', 'requiring not strict', 'several rulesets', 'bypass not read', 'bypass ruleset not ok', 'bypass list hidden', 'bypass actors none', 'bypass actors some',
           'bypass mode pull_request', 'bypass mode other', 'bypass actor without id']
WANTED += ['lastRun not ok', 'lastRun unreadable', 'lastRun absent', 'lastRun record', 'record at not a time', 'record at in the future', 'record at exactly 5 minutes ahead', 'record at ahead within 5 minutes', 'record at dead',
           'record at exactly 48 hours', 'record at alive', 'age not read', 'age not ok', 'age none', 'age not a time', 'age dead', 'age exactly 48 hours', 'age young']
WANTED += ['account not read', 'account not ok', 'account none', 'account same', 'account same but for the capitals', 'account another login', 'no finding', 'more than 5 findings', 'an error', 'two errors']
WANTED += ['utc time', 'utc not a time', 'codeowners file with no rules', 'codeowners file with some rules', 'codeowners file with rules and unreadable lines', 'codeowners with carriage returns']
WANTED += ['codeowners unreadable: ' + reason for reason in REASONS]
WANTED += ['pattern anchored', 'pattern not anchored', 'pattern folder', 'pattern wild last part', 'pattern with **', 'pattern ending in **', 'pattern starting with **', 'pattern with no owner', 'pattern with several owners', 'owner team', 'owner email',
           'owner user', 'path owned', 'path not owned']
missing = [key for key in WANTED if hits.get(key, 0) == 0]
print(inputs, 'inputs generated,', compared, 'compared,', differences, 'differences')
for key in sorted(hits):
    print('%8d  %s' % (hits[key], key))
print('branches never hit:', 'none' if not missing else ', '.join(missing))
sys.exit(1 if missing or differences or compared != inputs else 0)
