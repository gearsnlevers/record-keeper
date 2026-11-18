"""Builds test/fixtures/setup/cases.json. Every case states the answer it was written to show; the generator runs the Python reference (setup_ref.py) on it and stops
if the two differ. Usage: build_setup_cases.py <out.json>"""
import calendar
import copy
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import setup_ref as ref

HOUR = 3600 * 1000
NOW = calendar.timegm((2026, 11, 18, 12, 0, 0)) * 1000
COMMIT = 'a1' * 20
H1, H2, H3 = '1' * 64, '2' * 64, '3' * 64
RK = '.github/record-keeper/record-keeper.mjs'
AUDIT = '.github/workflows/records-audit.yml'
INTEGRITY = '.github/workflows/records-integrity.yml'
SETTINGS = '.github/record-keeper/settings.yml'
PIN = '.github/record-keeper.yml'
CHECK = 'Records integrity'
SEVERITY = {  # written out again on purpose: the reference and the fixture must agree on it
    'audit-dead': 'error', 'check-not-required': 'error',
    'check-not-strict': 'warning', 'bypass-always': 'warning', 'codeowners-missing': 'warning', 'codeowners-uncovered': 'warning', 'owners-few': 'warning', 'owner-mismatch': 'warning',
    'managed-differs': 'warning', 'manifest-unreadable': 'warning', 'pin-missing': 'warning', 'pin-unusable': 'warning', 'settings-missing': 'warning', 'settings-unusable': 'warning',
    'secret-not-set': 'warning', 'audit-workflow-missing': 'warning', 'audit-record-unreadable': 'warning', 'audit-record-future': 'warning',
    'single-owner': 'notice', 'audit-not-yet': 'notice', 'not-checked': 'notice',
}
ALL = ['settings', 'owners', 'owner-accounts', 'codeowners', 'check-required', 'check-strict', 'bypass', 'pin', 'manifest', 'managed-files', 'secret', 'audit-workflow', 'audit']

decisions, codeowners, times, patterns = [], [], [], []


def utc(year, month, day, hour=0, minute=0, second=0):
    return '%04d-%02d-%02dT%02d:%02d:%02dZ' % (year, month, day, hour, minute, second)


def ago(ms):
    """The time written as GitHub writes it, `ms` before now."""
    return utc(*time.gmtime((NOW - ms) // 1000)[:6])


def healthy():
    """A repository in which nothing is wrong: it adopted v1.0.0, has two owners, a ruleset that requires the check, the audit ran three hours ago."""
    return {
        'now': NOW, 'local': False, 'own': False, 'event': 'schedule', 'secretSet': True,
        'settings': {'state': 'read', 'problems': [], 'owners': [{'login': 'alice', 'id': 1001}, {'login': 'bob', 'id': 1002}], 'approvals': 2},
        'baseSettings': {'state': 'not-read'},
        'codeowners': {'state': 'read', 'path': '.github/CODEOWNERS', 'text': '# the kit\n/.github/ @alice @bob\n'},
        'pin': {'state': 'read', 'source': 'example/kit', 'version': 'v1.0.0', 'commit': COMMIT, 'channel': 'stable'},
        'release': {'state': 'read', 'secrets': ['RECORD_KEEPER_TOKEN'], 'upToDate': True, 'files': [
            {'path': RK, 'sha256': H1, 'size': 100}, {'path': AUDIT, 'sha256': H2, 'size': 200}, {'path': INTEGRITY, 'sha256': H3, 'size': 300}]},
        'tree': {RK: {'kind': 'file', 'sha256': H1, 'size': 100}, AUDIT: {'kind': 'file', 'sha256': H2, 'size': 200}, INTEGRITY: {'kind': 'file', 'sha256': H3, 'size': 300}},
        'auditWorkflow': 'file',
        'github': {
            'repo': {'ok': True, 'branch': 'main'},
            'rules': {'ok': True, 'rules': [{'id': 11, 'checks': [CHECK], 'strict': True}]},
            'classic': {'ok': True, 'requires': False},
            'bypass': {'11': {'ok': True, 'name': 'protect main', 'actors': [{'type': 'RepositoryRole', 'id': 5, 'mode': 'pull_request'}]}},
            'accounts': {'1001': {'ok': True, 'login': 'alice'}, '1002': {'ok': True, 'login': 'Bob'}},
            'lastRun': {'ok': True, 'state': 'record', 'at': ago(3 * HOUR)},
        },
    }


def without(*topics):
    return [topic for topic in ALL if topic not in topics]


def finding(code, detail=''):
    return {'code': code, 'severity': SEVERITY[code], 'detail': detail}


def case(id, note, edit=None, findings=(), passed=None, looked=()):
    """A decision. `edit` changes a copy of the healthy repository; `findings` are (code, detail) in the order that is expected; `passed` are the topics found fine; `looked` are
    the (topic, why) that were not looked at."""
    state = healthy()
    if edit is not None:
        edit(state)
    if passed is None and state['release'].get('secrets') == [] and state['event'] == 'pull_request':
        passed = without('secret')   # the helper of a pull request asks for no secret, so that the secret is not judged
    decisions.append({'id': id, 'note': note, 'input': state, 'expect': {'findings': [finding(*item) for item in findings], 'passed': ALL if passed is None else passed,
                                                                             'notLookedAt': [{'topic': topic, 'why': why} for topic, why in looked]}})


def g(state):
    return state['github']


def local(state):
    state['local'] = True
    state['github'] = None
    state['release'] = {'state': 'not-checked', 'why': '--local'}


def owners(*pairs):
    def edit(state):
        state['settings']['owners'] = [{'login': login, 'id': number} for login, number in pairs]
    return edit


def chain(*edits):
    def edit(state):
        for step in edits:
            step(state)
    return edit


def set_rules(*rules):
    def edit(state):
        g(state)['rules'] = {'ok': True, 'rules': [{'id': a, 'checks': b, 'strict': c} for a, b, c in rules]}
    return edit


def set_last(**fields):
    def edit(state):
        g(state)['lastRun'] = dict({'ok': True}, **fields)
    return edit


def pull_request(base):
    """A run for a pull request whose base has these settings. The release asks for no secret, so that the notice about it (a pull request is given none) is not in the way."""
    def edit(state):
        state['event'] = 'pull_request'
        state['baseSettings'] = base
        state['release']['secrets'] = []
    return edit


def single(*pairs):
    def edit(state):
        state['settings']['approvals'] = 1
        state['settings']['owners'] = [{'login': login, 'id': number} for login, number in pairs]
    return edit


def silent(state):
    g(state)['lastRun'] = {'ok': True, 'state': 'absent'}


def aged(**fields):
    def edit(state):
        silent(state)
        g(state)['age'] = fields
    return edit


# ---- the healthy repository, and what is true of every one ---------------------------------------------------------------------------------------------
case('h-0', 'a repository in which nothing is wrong has no finding, and every check is found fine')
case('h-1', 'the audit ran 47 hours ago: still alive', set_last(state='record', at=ago(47 * HOUR)))
case('h-2', 'the audit ran exactly 48 hours ago: not older than two days', set_last(state='record', at=ago(48 * HOUR)))
case('h-3', 'the audit ran 48 hours and a second ago: dead', set_last(state='record', at=ago(48 * HOUR + 1000)),
     [('audit-dead', 'the last run was at %s, more than two days ago' % ago(48 * HOUR + 1000))], without('audit'))

# ---- the settings and the owners ---------------------------------------------------------------------------------------------------------------------
case('s-0', 'no settings file: no owner is known, so nothing that depends on the owners is judged', lambda s: s['settings'].clear() or s['settings'].update({'state': 'absent'}),
     [('settings-missing', '')], without('settings', 'owners', 'owner-accounts'))
case('s-1', 'a settings file that is not a regular file of text', lambda s: s['settings'].clear() or s['settings'].update({'state': 'unreadable'}),
     [('settings-unusable', 'not a regular file of text')], without('settings', 'owners', 'owner-accounts'))
case('s-2', 'one problem in the settings: its rule and its line; the owners that were read are still judged', lambda s: s['settings'].update({'problems': [{'rule': 'S-05', 'line': 3}]}),
     [('settings-unusable', 'S-05 at line 3')], without('settings'))
case('s-3', 'several problems: the first, and how many more', lambda s: s['settings'].update({'problems': [{'rule': 'S-03', 'line': 2}, {'rule': 'S-07', 'line': 5}, {'rule': 'S-07', 'line': 9}]}),
     [('settings-unusable', 'S-03 at line 2 and 2 more')], without('settings'))
case('s-4', 'a problem that has no line', lambda s: s['settings'].update({'problems': [{'rule': 'S-02', 'line': None}]}),
     [('settings-unusable', 'S-02')], without('settings'))
case('s-12', 'two problems: the first, and one more', lambda s: s['settings'].update({'problems': [{'rule': 'S-03', 'line': 2}, {'rule': 'S-07', 'line': 5}]}),
     [('settings-unusable', 'S-03 at line 2 and 1 more')], without('settings'))
case('s-5', 'one owner where two approvals are needed', chain(owners(('alice', 1001))),
     [('owners-few', '1 listed, 2 needed')], without('owners'))
case('s-6', 'no owner at all: nothing to ask GitHub about', chain(owners()),
     [('owners-few', '0 listed, 2 needed')], without('owners', 'owner-accounts'))
case('s-7', 'the single-owner mode on a schedule: nothing is said, whatever the settings were before', lambda s: (owners(('alice', 1001))(s), s['settings'].update({'approvals': 1}), s.update({'baseSettings': {'state': 'absent'}})))
case('s-8', 'the single-owner mode with two owners listed, on a manual run of the workflow: nothing is said', lambda s: (s['settings'].update({'approvals': 1}), s.update({'event': 'workflow_dispatch', 'baseSettings': {'state': 'absent'}})))
case('s-9', 'three approvals needed, two owners', lambda s: s['settings'].update({'approvals': 3}), [('owners-few', '2 listed, 3 needed')], without('owners'))
case('s-10', 'the single-owner mode with no owner, on a pull request that starts it: both are said', lambda s: (single()(s), pull_request({'state': 'absent'})(s)),
     [('owners-few', '0 listed, 1 needed'), ('single-owner', '')], without('owners', 'owner-accounts', 'secret'))
case('s-11', 'the notice does not depend on a problem in another line', lambda s: (s['settings'].update({'approvals': 1, 'problems': [{'rule': 'S-05', 'line': 1}]}), pull_request({'state': 'absent'})(s)),
     [('settings-unusable', 'S-05 at line 1'), ('single-owner', '')], without('settings', 'secret'))

# ---- the accounts of the owners ----------------------------------------------------------------------------------------------------------------------
case('a-0', 'an owner whose login is another one on GitHub', lambda s: g(s)['accounts'].update({'1001': {'ok': True, 'login': 'carol'}}),
     [('owner-mismatch', 'alice/1001: GitHub says carol')], without('owner-accounts'))
case('a-1', 'logins are compared without regard to case: Bob is bob', lambda s: g(s)['accounts'].update({'1002': {'ok': True, 'login': 'BOB'}}))
case('a-2', 'an ID that no account has', lambda s: g(s)['accounts'].update({'1002': {'ok': True, 'login': None}}),
     [('owner-mismatch', 'bob/1002: no account has this ID')], without('owner-accounts'))
case('a-3', 'an account that could not be read: not checked, and no pass', lambda s: g(s)['accounts'].update({'1001': {'ok': False, 'why': 'GET /user/1001 answered 403'}}),
     [('not-checked', 'accounts: alice/1001: GET /user/1001 answered 403')], without('owner-accounts'))
case('a-4', 'an account that was not asked for', lambda s: g(s)['accounts'].pop('1002'), [('not-checked', 'accounts: bob/1002: not read')], without('owner-accounts'))
case('a-5', 'two owners that are wrong: both are said, in the order of the settings', lambda s: g(s)['accounts'].update({'1001': {'ok': True, 'login': 'x'}, '1002': {'ok': True, 'login': None}}),
     [('owner-mismatch', 'alice/1001: GitHub says x'), ('owner-mismatch', 'bob/1002: no account has this ID')], without('owner-accounts'))
case('a-6', 'one owner is wrong and one cannot be read: both are said', lambda s: g(s)['accounts'].update({'1001': {'ok': True, 'login': 'x'}, '1002': {'ok': False, 'why': 'timeout'}}),
     [('owner-mismatch', 'alice/1001: GitHub says x'), ('not-checked', 'accounts: bob/1002: timeout')], without('owner-accounts'))
case('a-7', 'two accounts that cannot be read: one notice that names both', lambda s: g(s)['accounts'].update({'1001': {'ok': False, 'why': 'a'}, '1002': {'ok': False, 'why': 'b'}}),
     [('not-checked', 'accounts: alice/1001: a; bob/1002: b')], without('owner-accounts'))
case('a-8', 'a login that differs only in what is not a letter', lambda s: g(s)['accounts'].update({'1001': {'ok': True, 'login': 'alice-'}}),
     [('owner-mismatch', 'alice/1001: GitHub says alice-')], without('owner-accounts'))
many = [('o%d' % n, 2000 + n) for n in range(31)]
case('a-9', 'more owners than the check asks about: the first 30 are read, and the others are said', lambda s: (owners(*many)(s), g(s)['accounts'].update({str(i): {'ok': True, 'login': l} for l, i in many})),
     [('not-checked', 'accounts: 1 more owners')], without('owner-accounts'))
case('a-10', 'exactly 30 owners, all read', lambda s: (owners(*many[:30])(s), g(s)['accounts'].update({str(i): {'ok': True, 'login': l} for l, i in many})))
case('a-11', 'an account that is not read when the repository is not either: the accounts do not depend on the repository', lambda s: g(s).update({'repo': {'ok': False, 'why': 'x'}}),
     [('not-checked', 'repository: x')], without('check-required', 'check-strict', 'bypass', 'audit-workflow', 'audit'))
case('a-12', 'a login that GitHub writes with other capitals, and an ID that is not a number of 4 digits', lambda s: (owners(('Alice', 7))(s), s['settings'].update({'approvals': 1}), g(s)['accounts'].update({'7': {'ok': True, 'login': 'aLICE'}})))

# ---- the single-owner mode is said once: by the pull request that starts it, or changes the owners while it is on ---------------------------------------------------
ALICE = {'login': 'alice', 'id': 1001}
BOB = {'login': 'bob', 'id': 1002}
base_read = lambda approvals, *owners_: {'state': 'read', 'approvals': approvals, 'owners': list(owners_)}
case('so-1', 'a pull request puts the mode on: the base has no settings file', lambda s: (single(('alice', 1001))(s), pull_request({'state': 'absent'})(s)), [('single-owner', '')])
case('so-2', 'a pull request puts the mode on: the base wants two approvals', lambda s: (single(('alice', 1001))(s), pull_request(base_read(2, ALICE, BOB))(s)), [('single-owner', '')])
case('so-3', 'a pull request puts the mode on: the base says 3 approvals and names the same owner', lambda s: (single(('alice', 1001))(s), pull_request(base_read(3, ALICE))(s)), [('single-owner', '')])
case('so-4', 'the base is in the mode already, with the same owner: nothing is said', lambda s: (single(('alice', 1001))(s), pull_request(base_read(1, ALICE))(s)))
case('so-5', 'the base is in the mode already, with the same owners in another order: nothing is said', lambda s: (single(('alice', 1001), ('bob', 1002))(s), pull_request(base_read(1, BOB, ALICE))(s)))
case('so-6', 'a pull request changes the owner of the mode: another owner at the base', lambda s: (single(('alice', 1001))(s), pull_request(base_read(1, BOB))(s)), [('single-owner', '')])
case('so-7', 'a pull request adds an owner to the mode', lambda s: (single(('alice', 1001), ('bob', 1002))(s), pull_request(base_read(1, ALICE))(s)), [('single-owner', '')])
case('so-8', 'a pull request changes the login of an owner who is the same account', lambda s: (single(('alice', 1001))(s), pull_request(base_read(1, {'login': 'alice2', 'id': 1001}))(s)), [('single-owner', '')])
case('so-9', 'the settings of the base could not be read, or were not asked for: nothing is said', lambda s: (single(('alice', 1001))(s), pull_request({'state': 'not-read'})(s)))
case('so-10', 'a pull request that ends the mode says nothing', lambda s: pull_request(base_read(1, ALICE))(s))
case('so-11', 'a pull request that leaves the mode off says nothing, whatever the base says', lambda s: pull_request({'state': 'absent'})(s))
case('so-12', 'a manual run of the workflow never says it', lambda s: (single(('alice', 1001))(s), s.update({'event': 'workflow_dispatch', 'baseSettings': {'state': 'absent'}})))
case('so-13', 'a run with no event, as a person starts it, never says it', lambda s: (single(('alice', 1001))(s), s.update({'event': None, 'baseSettings': {'state': 'absent'}})))
case('so-14', 'a schedule never says it', lambda s: (single(('alice', 1001))(s), s.update({'event': 'schedule', 'baseSettings': base_read(2, ALICE, BOB)})))
case('so-15', 'a run for a pull request with --local says nothing: the base is not asked for', lambda s: (single(('alice', 1001))(s), local(s), s.update({'event': 'pull_request'})),
     [('not-checked', 'github: the command line says --local')],
     without('owner-accounts', 'check-required', 'check-strict', 'bypass', 'manifest', 'managed-files', 'secret', 'audit-workflow', 'audit'))
case('so-16', 'on a pull request the secret is not judged, and the notice about the mode is made all the same', lambda s: (single(('alice', 1001))(s), s.update({'event': 'pull_request', 'baseSettings': {'state': 'absent'}})),
     [('single-owner', ''), ('not-checked', 'secret: a run for a pull request is not given the secrets')], without('secret'))

# ---- CODEOWNERS --------------------------------------------------------------------------------------------------------------------------------------
case('c-0', 'no CODEOWNERS file', lambda s: s['codeowners'].update({'state': 'absent', 'path': ''}), [('codeowners-missing', '')], without('codeowners'))
case('c-1', 'a CODEOWNERS file that is not a small file of text', lambda s: s['codeowners'].update({'state': 'unreadable', 'path': 'CODEOWNERS'}),
     [('not-checked', 'codeowners: CODEOWNERS is not a small file of text')], without('codeowners'))
case('c-2', 'one owner for every file', lambda s: s['codeowners'].update({'text': '* @alice\n'}))
case('c-3', 'only the workflows are owned: the settings and the pin are not', lambda s: s['codeowners'].update({'text': '/.github/workflows/ @alice\n'}),
     [('codeowners-uncovered', '.github/record-keeper/settings.yml, .github/record-keeper.yml')], without('codeowners'))
case('c-4', 'the last pattern that matches wins, and it may give no owner', lambda s: s['codeowners'].update({'text': '/.github/ @alice\n/.github/record-keeper.yml\n'}),
     [('codeowners-uncovered', '.github/record-keeper.yml')], without('codeowners'))
case('c-5', 'a later pattern that gives the owner back', lambda s: s['codeowners'].update({'text': '/.github/ @alice\n/.github/record-keeper.yml\n/.github/record-keeper.yml @bob\n'}))
case('c-6', 'a pattern that cannot be read: the whole file is not checked', lambda s: s['codeowners'].update({'text': '/.github/ @alice\n/docs/[ab].md @bob\n'}),
     [('not-checked', 'codeowners: .github/CODEOWNERS line 2: a pattern with \\, [, ] or ?')], without('codeowners'))
case('c-7', 'an owner that is not a name: the line is not read', lambda s: s['codeowners'].update({'text': '/.github/ alice\n'}),
     [('not-checked', 'codeowners: .github/CODEOWNERS line 1: an owner that is not @name, @org/team or an e-mail address')], without('codeowners'))
case('c-8', 'teams and e-mail addresses are owners', lambda s: s['codeowners'].update({'text': '/.github/ @example/maintainers dev@example.com # the kit\n'}))
case('c-9', 'nothing is owned', lambda s: s['codeowners'].update({'text': '# empty\n\n'}),
     [('codeowners-uncovered', '.github/record-keeper/settings.yml, .github/record-keeper.yml, .github/workflows/records-integrity.yml, .github/workflows/records-audit.yml, .github/workflows/records-setup-check.yml, .github/workflows/records-updater.yml')],
     without('codeowners'))
case('c-10', 'CODEOWNERS at the root is read', lambda s: s['codeowners'].update({'path': 'CODEOWNERS', 'text': '/.github/ @alice\n'}))
case('c-11', 'the first unreadable line is the one that is said', lambda s: s['codeowners'].update({'text': '\n!x @a\n/y[ @a\n'}),
     [('not-checked', 'codeowners: .github/CODEOWNERS line 2: a pattern that starts with !')], without('codeowners'))

# ---- the rules of the default branch -----------------------------------------------------------------------------------------------------------------
case('r-0', 'no rule requires the check', set_rules(), [('check-not-required', 'main')], without('check-required', 'check-strict', 'bypass'))
case('r-1', 'rules that require other checks', set_rules((11, ['Test gate'], True)), [('check-not-required', 'main')], without('check-required', 'check-strict', 'bypass'))
case('r-2', 'the name of the check is compared as it is', set_rules((11, ['records integrity', 'Records integrity '], True)), [('check-not-required', 'main')], without('check-required', 'check-strict', 'bypass'))
case('r-3', 'branch protection could not be read, and no ruleset requires the check: a notice, and no error', lambda s: (set_rules()(s), g(s).update({'classic': {'ok': False, 'why': 'GET answered 403'}})),
     [('not-checked', 'branch protection: GET answered 403')], without('check-required', 'check-strict', 'bypass'))
case('r-4', 'branch protection requires the check and no ruleset does: required, but whether it is up to date is not said', lambda s: (set_rules()(s), g(s).update({'classic': {'ok': True, 'requires': True}})),
     [('not-checked', 'strict: the check is required by branch protection, and not by a ruleset')], without('check-strict', 'bypass'))
case('r-5', 'the rule requires the check but does not require branches to be up to date', set_rules((11, [CHECK], False)), [('check-not-strict', 'main')], without('check-strict'))
case('r-6', 'two rules require the check and one of them is strict', set_rules((11, [CHECK], False), (12, [CHECK, 'Test gate'], True)),
     [('not-checked', 'bypass: ruleset 12: not read')], without('bypass'))
case('r-7', 'the release says that up to date is not wanted: no finding, and no pass', lambda s: (set_rules((11, [CHECK], False))(s), s['release'].update({'upToDate': False})), [], without('check-strict'))
case('r-8', 'the release says nothing about up to date: it is wanted', lambda s: (set_rules((11, [CHECK], False))(s), s['release'].update({'upToDate': None})), [('check-not-strict', 'main')], without('check-strict'))
case('r-9', 'the release cannot be read: up to date is wanted', lambda s: (set_rules((11, [CHECK], False))(s), s['release'].clear(), s['release'].update({'state': 'unlisted'})),
     [('check-not-strict', 'main'), ('manifest-unreadable', 'v1.0.0 is not in the list of releases of example/kit')], without('check-strict', 'manifest', 'managed-files', 'secret'))
case('r-10', 'a rule of the check that does not require it and one that does', set_rules((12, ['Test gate'], True), (11, [CHECK], True)))
case('r-11', 'the rules cannot be read', lambda s: g(s).update({'rules': {'ok': False, 'why': 'GET /repos/x/rules/branches/main answered 403'}}),
     [('not-checked', 'rules: GET /repos/x/rules/branches/main answered 403')], without('check-required', 'check-strict', 'bypass'))
case('r-12', 'the repository cannot be read: nothing of the default branch and nothing of the audit is judged', lambda s: g(s).update({'repo': {'ok': False, 'why': 'GET /repos/x answered 404'}}),
     [('not-checked', 'repository: GET /repos/x answered 404')], without('check-required', 'check-strict', 'bypass', 'audit-workflow', 'audit'))
case('r-13', 'a bypass actor in the mode always', lambda s: g(s)['bypass'].update({'11': {'ok': True, 'name': 'protect main', 'actors': [{'type': 'RepositoryRole', 'id': 5, 'mode': 'always'}]}}),
     [('bypass-always', 'protect main: RepositoryRole 5, mode always')], without('bypass'))
case('r-14', 'a mode that is not the mode of a pull request is said, whatever its name', lambda s: g(s)['bypass'].update({'11': {'ok': True, 'name': 'r', 'actors': [
    {'type': 'Team', 'id': 9, 'mode': 'exempt'}, {'type': 'RepositoryRole', 'id': 5, 'mode': 'pull_request'}, {'type': 'DeployKey', 'id': None, 'mode': 'always'}]}}),
     [('bypass-always', 'r: Team 9, mode exempt'), ('bypass-always', 'r: DeployKey without an ID, mode always')], without('bypass'))
case('r-15', 'the token was not shown the bypass list: no finding, and it is not looked at', lambda s: g(s)['bypass'].update({'11': {'ok': True, 'name': 'protect main', 'actors': None}}),
     [], without('bypass'), [('bypass', 'ruleset 11: the token cannot see the bypass list')])
case('r-16', 'the ruleset could not be read', lambda s: g(s)['bypass'].update({'11': {'ok': False, 'why': 'GET /repos/x/rulesets/11 answered 403'}}),
     [('not-checked', 'bypass: ruleset 11: GET /repos/x/rulesets/11 answered 403')], without('bypass'))
case('r-17', 'no bypass actor at all', lambda s: g(s)['bypass'].update({'11': {'ok': True, 'name': 'protect main', 'actors': []}}))
case('r-18', 'two rulesets that carry the rule: both are read, in the order of their numbers', lambda s: (set_rules((20, [CHECK], True), (3, [CHECK], False))(s), g(s)['bypass'].update({
    '3': {'ok': True, 'name': 'three', 'actors': [{'type': 'OrganizationAdmin', 'id': 1, 'mode': 'always'}]}, '20': {'ok': True, 'name': 'twenty', 'actors': None}})),
     [('bypass-always', 'three: OrganizationAdmin 1, mode always')], without('bypass'), [('bypass', 'ruleset 20: the token cannot see the bypass list')])
case('r-19', 'two rules of one ruleset: read once', lambda s: set_rules((11, [CHECK], False), (11, [CHECK], True))(s))
case('r-20', 'the ruleset that does not carry the rule is not read', lambda s: (set_rules((11, [CHECK], True), (30, ['Test gate'], True))(s)))
case('r-21', 'a ruleset that was not read, and a bypass that is always: both are said', lambda s: (set_rules((11, [CHECK], True), (12, [CHECK], True))(s), g(s)['bypass'].update({
    '11': {'ok': True, 'name': 'a', 'actors': [{'type': 'Integration', 'id': 3, 'mode': 'always'}]}, '12': {'ok': False, 'why': 'x'}})),
     [('bypass-always', 'a: Integration 3, mode always'), ('not-checked', 'bypass: ruleset 12: x')], without('bypass'))
case('r-22', 'a rule not strict but required: the manifest asks for up to date', lambda s: (set_rules((11, [CHECK], False))(s), s['release'].update({'upToDate': True})), [('check-not-strict', 'main')], without('check-strict'))
case('r-24', 'two rulesets that carry the rule and cannot be seen: one notice that names both, in the order of their numbers', lambda s: (set_rules((12, [CHECK], True), (11, [CHECK], True))(s), g(s)['bypass'].update({
    '11': {'ok': False, 'why': 'x'}, '12': {'ok': True, 'name': 'twelve', 'actors': None}})),
     [('not-checked', 'bypass: ruleset 11: x')], without('bypass'), [('bypass', 'ruleset 12: the token cannot see the bypass list')])
case('r-29', 'two rulesets that carry the rule and are not shown to the token: one entry that names both, in the order of their numbers', lambda s: (set_rules((12, [CHECK], True), (11, [CHECK], True))(s), g(s)['bypass'].update({
    '11': {'ok': True, 'name': 'eleven', 'actors': None}, '12': {'ok': True, 'name': 'twelve', 'actors': None}})),
     [], without('bypass'), [('bypass', 'ruleset 11: the token cannot see the bypass list; ruleset 12: the token cannot see the bypass list')])
case('r-30', 'two rulesets that carry the rule and cannot be read, or were not asked for: one notice that names both, in the order of their numbers', lambda s: (set_rules((12, [CHECK], True), (11, [CHECK], True))(s), g(s)['bypass'].clear(), g(s)['bypass'].update({
    '11': {'ok': False, 'why': 'x'}})),
     [('not-checked', 'bypass: ruleset 11: x; ruleset 12: not read')], without('bypass'))
case('r-25', 'branch protection could not be read, but a ruleset requires the check: nothing is said of it', lambda s: g(s).update({'classic': {'ok': False, 'why': 'GET answered 403'}}))
case('r-26', 'branch protection could not be read, and the rules require other checks only: a notice, and no error', lambda s: (set_rules((11, ['Test gate'], True))(s), g(s).update({'classic': {'ok': False, 'why': 'timeout'}})),
     [('not-checked', 'branch protection: timeout')], without('check-required', 'check-strict', 'bypass'))
case('r-27', 'branch protection could be read and does not require the check, and no ruleset does: the error', lambda s: (set_rules()(s), g(s).update({'classic': {'ok': True, 'requires': False}})),
     [('check-not-required', 'main')], without('check-required', 'check-strict', 'bypass'))
case('r-28', 'branch protection could be read and requires the check, and the rules require other checks only: required, and not known whether up to date', lambda s: (set_rules((11, ['Test gate'], True))(s), g(s).update({'classic': {'ok': True, 'requires': True}})),
     [('not-checked', 'strict: the check is required by branch protection, and not by a ruleset')], without('check-strict', 'bypass'))
case('r-23', 'a default branch with a slash in its name', lambda s: (g(s).update({'repo': {'ok': True, 'branch': 'release/next'}}), set_rules()(s)),
     [('check-not-required', 'release/next')], without('check-required', 'check-strict', 'bypass'))

# ---- --local, and the repository of the kit -----------------------------------------------------------------------------------------------------------
case('l-0', 'with --local nothing that GitHub holds is judged, and it is said once', local, [('not-checked', 'github: the command line says --local')],
     without('owner-accounts', 'check-required', 'check-strict', 'bypass', 'manifest', 'managed-files', 'secret', 'audit-workflow', 'audit'))
case('l-1', 'with --local the files are still read: the settings, CODEOWNERS and the pin', lambda s: (local(s), s['settings'].update({'approvals': 1}), s['codeowners'].update({'state': 'absent', 'path': ''}), s['pin'].clear(), s['pin'].update({'state': 'absent'})),
     [('codeowners-missing', ''), ('pin-missing', ''), ('not-checked', 'github: the command line says --local')],
     ['settings', 'owners'])
case('l-2', 'the repository of the kit has no pin of its own and nothing installed: no pin is asked for, and it is not looked at', lambda s: (s.update({'own': True}), s['pin'].clear(), s['pin'].update({'state': 'absent'})),
     [], without('pin', 'manifest', 'managed-files', 'secret'), [('own', 'this is the repository of the kit: install.json is at its root')])
case('l-3', 'the repository of the kit, with --local', lambda s: (local(s), s.update({'own': True})),
     [('not-checked', 'github: the command line says --local')],
     without('owner-accounts', 'check-required', 'check-strict', 'bypass', 'pin', 'manifest', 'managed-files', 'secret', 'audit-workflow', 'audit'), [('own', 'this is the repository of the kit: install.json is at its root')])

# ---- the pin, the pinned release, the files that were installed, the secret ----------------------------------------------------------------------------
case('p-0', 'no pin', lambda s: (s['pin'].clear(), s['pin'].update({'state': 'absent'})), [('pin-missing', '')], without('pin', 'manifest', 'managed-files', 'secret'))
case('p-1', 'a pin that cannot be read: the reason of the updater', lambda s: (s['pin'].clear(), s['pin'].update({'state': 'refused', 'code': 'pin-line'})), [('pin-unusable', 'pin-line')], without('pin', 'manifest', 'managed-files', 'secret'))
case('p-2', 'the manifest of the pinned release could not be read now', lambda s: s['release'].update({'state': 'not-checked', 'why': 'GET /repos/example/kit/releases answered 502'}),
     [('not-checked', 'release: GET /repos/example/kit/releases answered 502')], without('manifest', 'managed-files', 'secret'))
case('p-3', 'the pinned release is not in the list', lambda s: s['release'].update({'state': 'unlisted'}),
     [('manifest-unreadable', 'v1.0.0 is not in the list of releases of example/kit')], without('manifest', 'managed-files', 'secret'))
case('p-4', 'the pinned release has no manifest', lambda s: s['release'].update({'state': 'no-asset'}), [('manifest-unreadable', 'v1.0.0 has no release-manifest.json')], without('manifest', 'managed-files', 'secret'))
case('p-5', 'the manifest of the pinned release is refused: the reason of the updater', lambda s: s['release'].update({'state': 'refused', 'code': 'manifest-commit-moved'}),
     [('manifest-unreadable', 'v1.0.0: manifest-commit-moved')], without('manifest', 'managed-files', 'secret'))
case('p-6', 'one file that is not the release\'s', lambda s: s['tree'].update({RK: {'kind': 'file', 'sha256': H2, 'size': 100}}), [('managed-differs', RK + ' (differs)')], without('managed-files'))
case('p-7', 'a file with the digest of the release and another size', lambda s: s['tree'].update({RK: {'kind': 'file', 'sha256': H1, 'size': 101}}), [('managed-differs', RK + ' (differs)')], without('managed-files'))
case('p-8', 'a file that differs, a file that is missing and a folder in its place: in the order of the bytes of the paths', lambda s: s['tree'].update({AUDIT: {'kind': 'absent'}, INTEGRITY: {'kind': 'other'}, RK: {'kind': 'file', 'sha256': None, 'size': 100}}),
     [('managed-differs', '%s (differs), %s (missing), %s (not a file)' % (RK, AUDIT, INTEGRITY))], without('managed-files'))
case('p-9', 'a path that is not in the tree is missing', lambda s: s['tree'].pop(INTEGRITY), [('managed-differs', INTEGRITY + ' (missing)')], without('managed-files'))
many_files = [{'path': '.github/record-keeper/p%02d.mjs' % n, 'sha256': H1, 'size': 1} for n in range(11)]
case('p-10', 'more files than are listed: the first eight, and how many more', lambda s: (s['release'].update({'files': many_files}), s['tree'].clear()),
     [('managed-differs', ', '.join('.github/record-keeper/p%02d.mjs (missing)' % n for n in range(8)) + ', and 3 more')], without('managed-files'))
case('p-11', 'exactly eight files that differ', lambda s: (s['release'].update({'files': many_files[:8]}), s['tree'].clear()),
     [('managed-differs', ', '.join('.github/record-keeper/p%02d.mjs (missing)' % n for n in range(8)))], without('managed-files'))
case('p-12', 'the release does not name the secret: it is not asked for', lambda s: (s['release'].update({'secrets': []}), s.update({'secretSet': False})), [], without('secret'))
case('p-13', 'the secret is not set', lambda s: s.update({'secretSet': False}), [('secret-not-set', '')], without('secret'))
case('p-14', 'a run for a pull request is not given the secrets', lambda s: s.update({'event': 'pull_request', 'secretSet': False}),
     [('not-checked', 'secret: a run for a pull request is not given the secrets')], without('secret'))
case('p-15', 'the workflow did not say whether the secret is set', lambda s: s.update({'secretSet': None}), [('not-checked', 'secret: the workflow did not say whether it is set')], without('secret'))
case('p-16', 'a run by hand with the secret set', lambda s: s.update({'event': 'workflow_dispatch'}))
case('p-17', 'no event is known: the secret is judged all the same', lambda s: s.update({'event': None, 'secretSet': False}), [('secret-not-set', '')], without('secret'))
case('p-18', 'with --local and a pin that is read: the release is not read, and nothing is said of it', lambda s: (local(s), s['codeowners'].update({'state': 'absent', 'path': ''})),
     [('codeowners-missing', ''), ('not-checked', 'github: the command line says --local')], ['settings', 'owners', 'pin'])

# ---- the audit -----------------------------------------------------------------------------------------------------------------------------------------
case('u-0', 'the audit workflow is not in the checkout', lambda s: s.update({'auditWorkflow': 'absent'}), [('audit-workflow-missing', '')], without('audit-workflow'))
case('u-1', 'the audit workflow is a folder', lambda s: s.update({'auditWorkflow': 'other'}), [('audit-workflow-missing', 'not a file')], without('audit-workflow'))
case('u-2', 'the audit ran a week ago', set_last(state='record', at=ago(7 * 24 * HOUR)), [('audit-dead', 'the last run was at %s, more than two days ago' % ago(7 * 24 * HOUR))], without('audit'))
case('u-3', 'a time that is in the future by more than five minutes', set_last(state='record', at=ago(-5 * 60 * 1000 - 1000)), [('audit-record-future', ago(-5 * 60 * 1000 - 1000))], without('audit'))
case('u-4', 'a time that is five minutes in the future: the clocks of two runners', set_last(state='record', at=ago(-5 * 60 * 1000)))
case('u-5', 'a time that is a minute in the future', set_last(state='record', at=ago(-60 * 1000)))
case('u-6', 'the record has no time that is a time', set_last(state='record', at=None), [('audit-record-unreadable', 'at is not a UTC time')], without('audit'))
case('u-7', 'the record has a time in another form', set_last(state='record', at='2026-11-18T09:00:00+00:00'), [('audit-record-unreadable', 'at is not a UTC time')], without('audit'))
case('u-8', 'the record has a day that does not exist', set_last(state='record', at='2026-02-30T09:00:00Z'), [('audit-record-unreadable', 'at is not a UTC time')], without('audit'))
case('u-9', 'the record has a year before 1970', set_last(state='record', at='1969-12-31T23:59:59Z'), [('audit-record-unreadable', 'at is not a UTC time')], without('audit'))
case('u-10', 'the record is not a record', set_last(state='unreadable', why='not JSON in UTF-8'), [('audit-record-unreadable', 'not JSON in UTF-8')], without('audit'))
case('u-11', 'the record could not be read now', lambda s: g(s).update({'lastRun': {'ok': False, 'why': 'GET /repos/x/contents/last-run.json answered 502'}}),
     [('not-checked', 'audit: GET /repos/x/contents/last-run.json answered 502')], without('audit'))
case('u-12', 'no record, and the audit workflow has been on the default branch for three days', aged(ok=True, at=ago(72 * HOUR)),
     [('audit-dead', 'there is no record of a run, and the audit workflow has been in the repository since %s' % ago(72 * HOUR))], without('audit'))
case('u-13', 'no record, and the audit workflow is a day old: its first run is not due', aged(ok=True, at=ago(24 * HOUR)),
     [('audit-not-yet', 'there is no record of a run yet, and the audit workflow is on the default branch since %s' % ago(24 * HOUR))], without('audit'))
case('u-14', 'no record, and the workflow is exactly 48 hours old', aged(ok=True, at=ago(48 * HOUR)),
     [('audit-not-yet', 'there is no record of a run yet, and the audit workflow is on the default branch since %s' % ago(48 * HOUR))], without('audit'))
case('u-15', 'no record, and the workflow is 48 hours and a second old', aged(ok=True, at=ago(48 * HOUR + 1000)),
     [('audit-dead', 'there is no record of a run, and the audit workflow has been in the repository since %s' % ago(48 * HOUR + 1000))], without('audit'))
case('u-16', 'no record, and no commit of the default branch touches the workflow yet', aged(ok=True, at=None),
     [('audit-not-yet', 'there is no record of a run, and the audit workflow is not on the default branch yet')], without('audit'))
case('u-17', 'no record, and the age could not be read', aged(ok=False, why='GET /repos/x/commits answered 403'), [('not-checked', 'age: GET /repos/x/commits answered 403')], without('audit'))
case('u-18', 'no record, and the age was not asked for', silent, [('not-checked', 'age: not read')], without('audit'))
case('u-19', 'no record, and a date that is not a time', aged(ok=True, at='yesterday'), [('not-checked', 'age: the date of the first commit is not a UTC time')], without('audit'))
case('u-20', 'no record and no audit workflow: the missing workflow is said, and nothing is dead', lambda s: (silent(s), s.update({'auditWorkflow': 'absent'})), [('audit-workflow-missing', '')], without('audit-workflow', 'audit'))
case('u-21', 'a record that is old, and no audit workflow: both are said', lambda s: (set_last(state='record', at=ago(5 * 24 * HOUR))(s), s.update({'auditWorkflow': 'absent'})),
     [('audit-dead', 'the last run was at %s, more than two days ago' % ago(5 * 24 * HOUR)), ('audit-workflow-missing', '')], without('audit-workflow', 'audit'))
case('u-22', 'no record and a date in the future: the workflow is not old', aged(ok=True, at=ago(-10 * HOUR)),
     [('audit-not-yet', 'there is no record of a run yet, and the audit workflow is on the default branch since %s' % ago(-10 * HOUR))], without('audit'))
case('u-23', 'a record that is fine does not ask for the age', lambda s: (set_last(state='record', at=ago(HOUR))(s), g(s).update({'age': {'ok': True, 'at': ago(900 * HOUR)}})))

# ---- everything at once: the order of the findings --------------------------------------------------------------------------------------------------
def all_wrong(s):
    s['settings'].update({'approvals': 1, 'owners': [{'login': 'alice', 'id': 1001}]})
    g(s)['accounts'] = {'1001': {'ok': True, 'login': 'zed'}}
    s['codeowners'].update({'state': 'absent', 'path': ''})
    g(s)['rules'] = {'ok': True, 'rules': []}
    s['pin'].clear()
    s['pin'].update({'state': 'absent'})
    s['secretSet'] = False
    s['auditWorkflow'] = 'absent'
    g(s)['lastRun'] = {'ok': True, 'state': 'record', 'at': ago(100 * HOUR)}


case('z-0', 'everything is wrong: errors first, then warnings, then notices, each in the order of the checks', all_wrong,
     [('check-not-required', 'main'), ('audit-dead', 'the last run was at %s, more than two days ago' % ago(100 * HOUR)), ('owner-mismatch', 'alice/1001: GitHub says zed'), ('codeowners-missing', ''),
      ('pin-missing', ''), ('audit-workflow-missing', '')], ['settings', 'owners'])
case('z-1', 'everything is wrong on a pull request that starts the single-owner mode: the notice comes last', lambda s: (all_wrong(s), pull_request({'state': 'absent'})(s)),
     [('check-not-required', 'main'), ('audit-dead', 'the last run was at %s, more than two days ago' % ago(100 * HOUR)), ('owner-mismatch', 'alice/1001: GitHub says zed'), ('codeowners-missing', ''),
      ('pin-missing', ''), ('audit-workflow-missing', ''), ('single-owner', '')], ['settings', 'owners'])

# ---- the patterns of CODEOWNERS ---------------------------------------------------------------------------------------------------------------------------

def owned(id, note, text, expect):
    """`expect` maps a path to the owners that CODEOWNERS gives it, for the paths this case is about."""
    codeowners.append({'id': id, 'note': note, 'text': text, 'unreadable': [], 'owners': expect})


def unreadable(id, note, text, expect):
    codeowners.append({'id': id, 'note': note, 'text': text, 'unreadable': expect, 'owners': {}})


owned('o-0', 'a folder with a slash at both ends', '/.github/ @a\n', {'.github/record-keeper.yml': ['@a'], '.github/workflows/x.yml': ['@a'], 'docs/.github/y': [], '.githubx/y': []})
owned('o-1', 'a folder anywhere: no slash at the start', '.github/ @a\n', {'.github/record-keeper.yml': ['@a'], 'docs/.github/y': ['@a'], 'a': []})
owned('o-2', 'a name without a slash matches a file or a folder at any depth', 'workflows @a\n', {'.github/workflows/x.yml': ['@a'], 'workflows': ['@a'], 'a/workflows': ['@a'], 'workflows.md': []})
owned('o-3', 'a name with a slash at the start is anchored, and covers what is below it', '/.github @a\n', {'.github': ['@a'], '.github/x': ['@a'], 'a/.github/x': []})
owned('o-4', 'a star does not cross a slash, and does not go below the folder', '/.github/workflows/* @a\n', {'.github/workflows/x.yml': ['@a'], '.github/workflows/a/x.yml': [], '.github/x.yml': []})
owned('o-5', 'a star in a name', '/.github/workflows/records-*.yml @a @b\n', {'.github/workflows/records-audit.yml': ['@a', '@b'], '.github/workflows/records-.yml': ['@a', '@b'], '.github/workflows/records.yml': [], '.github/workflows/records-audit.yaml': []})
owned('o-6', 'a star alone matches every file at every depth', '* @a\n', {'x': ['@a'], 'a/b/c': ['@a'], '.github/record-keeper.yml': ['@a']})
owned('o-7', 'a slash and a star matches the top level only', '/* @a\n', {'x': ['@a'], 'a/b': []})
owned('o-8', 'two stars at the end match everything below', '/.github/** @a\n', {'.github/x': ['@a'], '.github/a/b': ['@a'], '.github': []})
owned('o-9', 'two stars at the start match at any depth', '**/workflows/*.yml @a\n', {'.github/workflows/x.yml': ['@a'], 'workflows/x.yml': ['@a'], 'a/b/workflows/x.yml': ['@a'], 'workflows/a/x.yml': []})
owned('o-10', 'two stars in the middle match no folder or many', '/a/**/z @a\n', {'a/z': ['@a'], 'a/b/z': ['@a'], 'a/b/c/z': ['@a'], 'a/b/c/y': [], 'z': []})
owned('o-11', 'the last pattern that matches decides', '* @a\n/.github/ @b\n/.github/record-keeper.yml @c\n', {'x': ['@a'], '.github/y': ['@b'], '.github/record-keeper.yml': ['@c']})
owned('o-12', 'a pattern with no owner takes the owners away', '* @a\n/.github/\n', {'x': ['@a'], '.github/y': []})
owned('o-13', 'a comment on its own line and after the owners', '# a comment\n/x/ @a # who\n  \t/y/\t@b\t@c  \n', {'x/f': ['@a'], 'y/f': ['@b', '@c']})
owned('o-14', 'a line ending in a carriage return', '/x/ @a\r\n/y/ @b\r\n', {'x/f': ['@a'], 'y/f': ['@b']})
owned('o-15', 'a hash that is not at the start of a word is part of the pattern', '/a#b @a\n', {'a#b': ['@a'], 'a': []})
owned('o-16', 'a folder pattern does not match a file of that name', '/docs/ @a\n', {'docs': [], 'docs/x': ['@a']})
owned('o-17', 'a pattern with a name that is a star and more, at the end, does not go below', 'docs/a* @a\n', {'docs/ab': ['@a'], 'docs/ab/c': [], 'x/docs/ab': []})
owned('o-18', 'an owner that is a team and an e-mail', '/x/ @org/team a.b+c@example.com\n', {'x/f': ['@org/team', 'a.b+c@example.com']})
owned('o-19', 'no pattern matches', '/x/ @a\n', {'y': []})
owned('o-20', 'an empty file', '', {'x': []})
owned('o-21', 'a name with several stars', '/a/*b*c* @a\n', {'a/xbyczz': ['@a'], 'a/bc': ['@a'], 'a/cb': [], 'a/b/c': []})
owned('o-22', 'the same name at several depths, and what is below a name that is a file name', 'x @a\n', {'a/x/b': ['@a'], 'a/b/x': ['@a'], 'xx': []})
owned('o-23', 'a pattern that is deeper than the path', '/a/b/c/d @a\n', {'a/b/c': [], 'a/b/c/d': ['@a'], 'a/b/c/d/e': ['@a']})
owned('o-24', 'two stars alone match everything', '** @a\n', {'x': ['@a'], 'a/b': ['@a']})
owned('o-25', 'a star before two stars', '/a/*/**/z @a\n', {'a/b/z': ['@a'], 'a/b/c/z': ['@a'], 'a/z': []})
owned('o-27', 'a comment right after the pattern: no owner', '/x/ # nobody\n/y/ #\n', {'x/f': [], 'y/f': []})
owned('o-26', 'upper and lower case are different', '/Docs/ @a\n', {'docs/x': [], 'Docs/x': ['@a']})
unreadable('x-0', 'a pattern with a bracket', '/a[b] @a\n', [{'line': 1, 'reason': 'a pattern with \\, [, ] or ?'}])
unreadable('x-1', 'a pattern with a question mark', '/a? @a\n', [{'line': 1, 'reason': 'a pattern with \\, [, ] or ?'}])
unreadable('x-2', 'a pattern with a backslash', '/a\\ b @a\n', [{'line': 1, 'reason': 'a pattern with \\, [, ] or ?'}])
unreadable('x-3', 'a negation', '!/a @a\n', [{'line': 1, 'reason': 'a pattern that starts with !'}])
unreadable('x-4', 'a pattern that is a slash', '/ @a\n', [{'line': 1, 'reason': 'a pattern with no name'}])
unreadable('x-5', 'an empty part', '/a//b @a\n', [{'line': 1, 'reason': 'a pattern with an empty part'}])
unreadable('x-6', 'two stars inside a name', '/a**b @a\n', [{'line': 1, 'reason': 'a pattern with ** inside a name'}])
unreadable('x-7', 'a pattern of more than twelve parts', '/' + '/'.join('a' * 1 for _ in range(13)) + ' @a\n', [{'line': 1, 'reason': 'a pattern with more than 12 parts'}])
unreadable('x-8', 'a pattern of twelve parts is read', '/' + '/'.join('a' * 1 for _ in range(12)) + ' @a\n', [])
unreadable('x-9', 'a pattern of more than 300 characters', '/' + 'a' * 300 + ' @a\n', [{'line': 1, 'reason': 'a pattern longer than 300 characters'}])
unreadable('x-10', 'a pattern of exactly 300 characters', 'a' * 300 + ' @a\n', [])
unreadable('x-11', 'an owner without an at sign', '/a b\n', [{'line': 1, 'reason': 'an owner that is not @name, @org/team or an e-mail address'}])
unreadable('x-12', 'an owner that is not an e-mail address', '/a @\n', [{'line': 1, 'reason': 'an owner that is not @name, @org/team or an e-mail address'}])
unreadable('x-13', 'several lines, with the numbers of the lines', '\n/a @a\n# c\n/b[ @a\n!c\n', [{'line': 4, 'reason': 'a pattern with \\, [, ] or ?'}, {'line': 5, 'reason': 'a pattern that starts with !'}])
unreadable('x-14', 'a name of an owner of 40 characters is too long', '/a @' + 'a' * 40 + '\n', [{'line': 1, 'reason': 'an owner that is not @name, @org/team or an e-mail address'}])
unreadable('x-15', 'a name of an owner of 39 characters', '/a @' + 'a' * 39 + '\n', [])
unreadable('x-16', 'a team with a dot, an underscore and a hyphen', '/a @o/t.e_a-m\n', [])
unreadable('x-18', 'a bracket that is closed and not opened', '/a] @a\n', [{'line': 1, 'reason': 'a pattern with \\, [, ] or ?'}])
VALID_OWNERS = ['@a', '@A', '@0', '@a-b', '@a-', '@' + 'a' * 39, '@org/team', '@org/Te_am.x-1', '@org/' + 't' * 100, 'a@b.co', 'A.b_c%d+e-f@x-y.example.com', 'x@a-b.c-d.e', 'a@B.C-d.Ex', '@0/1', '@aB1', '@a1-B2', 'A1@B2.C3', 'z9@y8.x7']
INVALID_OWNERS = ['a', '@', '@-a', '@' + 'a' * 40, '@org/', '@org/' + 't' * 101, '@org/te!am', 'a@b', 'a@.b', 'a@b.', 'a@b..c', '@a/b/c', 'x@@y.z', 'a@b_c.d', '@x.y', 'x!@a', '!@a', '@a.b', '@a_b', '\u00e9@x.y', '@a/b+c']
for n, owner in enumerate(VALID_OWNERS):
    unreadable('xo-%d' % n, 'a pattern with the owner %s, which is read' % json.dumps(owner), '/a %s\n' % owner, [])
for n, owner in enumerate(INVALID_OWNERS):
    unreadable('xi-%d' % n, 'a pattern with the owner %s, which is not read' % json.dumps(owner), '/a %s\n' % owner, [{'line': 1, 'reason': 'an owner that is not @name, @org/team or an e-mail address'}])
unreadable('x-17', 'a pattern that starts with a hash is a comment, with an escape it is not read', '#/a @a\n\\#/b @a\n', [{'line': 2, 'reason': 'a pattern with \\, [, ] or ?'}])

# ---- times ---------------------------------------------------------------------------------------------------------------------------------------------
for text, note in [
    ('2026-11-18T12:00:00Z', 'a time'), ('2026-11-30T12:00:00Z', 'the 30th'), ('2026-04-30T00:00:00Z', 'the 30th of April'), ('2026-12-31T23:59:59Z', 'the 31st'), ('2026-10-20T20:20:20Z', 'a time with the digit 2 and 0 in every part'),
    ('2026-09-09T09:09:09Z', 'a time with 9 in every part'), ('1999-01-01T01:01:01Z', 'the year 1999'), ('2100-02-28T05:15:45Z', 'the year 2100'), ('1970-01-01T00:00:00Z', 'the first second'), ('1970-01-01T00:00:01Z', 'the second second'), ('9999-12-31T23:59:59Z', 'the last year'),
    ('2024-02-29T00:00:00Z', 'a leap day'), ('2026-02-29T00:00:00Z', 'a leap day in a year that is not one'), ('2026-04-31T00:00:00Z', 'the 31st of April'),
    ('2026-13-01T00:00:00Z', 'a thirteenth month'), ('2026-00-01T00:00:00Z', 'a month 0'), ('2026-01-00T00:00:00Z', 'a day 0'), ('2026-01-01T24:00:00Z', 'the hour 24'),
    ('2026-01-01T00:60:00Z', 'the minute 60'), ('2026-01-01T00:00:60Z', 'a leap second'), ('1969-12-31T23:59:59Z', 'before 1970'), ('0000-01-01T00:00:00Z', 'the year 0'),
    ('2026-11-18T12:00:00', 'no zone'), ('2026-11-18T12:00:00z', 'a small z'), ('2026-11-18t12:00:00Z', 'a small t'), ('2026-11-18 12:00:00Z', 'a space'), ('2026-11-18T12:00:00.000Z', 'milliseconds'),
    ('2026-11-18T12:00:00+00:00', 'an offset'), ('2026-11-18T12:00:00Z\n', 'a line feed'), (' 2026-11-18T12:00:00Z', 'a space before'), ('2026-1-18T12:00:00Z', 'a month of one digit'),
    ('', 'nothing'), ('2026-11-18', 'a date'), ('2026-11-18T12:00:00Z2', 'more after'), ('٢026-11-18T12:00:00Z', 'an Arabic-Indic digit'), (None, 'no text'), (7, 'a number'),
]:
    times.append({'text': text, 'note': note, 'expect': ref.parse_utc(text)})

# the times that were written by hand, so that the reference is not the only witness
for text, expect in [('2026-11-18T12:00:00Z', 1795003200000), ('1970-01-01T00:00:00Z', 0), ('1970-01-01T00:00:01Z', 1000), ('2024-02-29T00:00:00Z', 1709164800000)]:
    assert [item for item in times if item['text'] == text][0]['expect'] == expect, text
assert NOW == 1795003200000


bad = 0
for item in decisions:
    got = ref.decide(copy.deepcopy(item['input']))
    if json.dumps(got, sort_keys=True) != json.dumps(item['expect'], sort_keys=True):
        bad += 1
        print('DIFFERENT', item['id'], '\n  intended ', json.dumps(item['expect'], sort_keys=True)[:900], '\n  reference', json.dumps(got, sort_keys=True)[:900])
for item in codeowners:
    parsed = ref.parse_codeowners(item['text'])
    if parsed['unreadable'] != item['unreadable']:
        bad += 1
        print('DIFFERENT', item['id'], parsed['unreadable'])
    for file, owners_ in item['owners'].items():
        if ref.owners_of(parsed['rules'], file) != owners_:
            bad += 1
            print('DIFFERENT', item['id'], file, ref.owners_of(parsed['rules'], file), 'intended', owners_)
ids = [item['id'] for item in decisions + codeowners]
assert len(set(ids)) == len(ids), 'a case id is used twice'
if bad:
    sys.exit('%d cases differ' % bad)

out = {'decisions': decisions, 'codeowners': codeowners, 'times': times}
with open(sys.argv[1], 'w', encoding='utf-8') as handle:
    json.dump(out, handle, ensure_ascii=True, indent=1)
    handle.write('\n')
print(len(decisions), 'decisions,', len(codeowners), 'codeowners,', len(times), 'times')
