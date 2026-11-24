"""Generates inputs for the differential fuzz of the core of the setup check (docs/setup-check.md): random decisions, random CODEOWNERS files with paths, and random
times, each with the answer of the Python reference (setup_ref.py). Usage: setup_fuzz.py <count> <seed> <out.jsonl>

It does not draw its inputs blindly. A decision starts from a repository in which nothing is wrong and is then damaged at random in the places the page lists, with
the edges of every limit (48 hours to the second, five minutes to the second, 30 owners, 8 paths) chosen more often than chance would; the CODEOWNERS files are made of
the parts of the six paths that the check asks about, so that a pattern matches them often enough to be told from one that does not. The last line it prints is
what it counted: how many inputs reached each branch (setup_summary.py adds the counts of the workers up and says which branch no input reached)."""
import calendar
import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import setup_ref as ref  # noqa: E402

HOUR = 3600 * 1000
NOW = calendar.timegm((2026, 11, 18, 12, 0, 0)) * 1000
CHECK = 'Records integrity'
SEGMENTS = ['.github', 'workflows', 'records-audit.yml', 'records-integrity.yml', 'records-updater.yml', 'records-setup-check.yml', 'record-keeper', 'record-keeper.yml', 'settings.yml', 'docs', 'a', 'b', 'x.md']
GLOBS = ['*', '**', 'records-*.yml', '*.yml', '*.md', 'record-*', 'a*', '*b', '*a*b*', 'settings.*']
OWNERS = ['@a', '@b', '@org/team', 'x@example.com', '@alice-1']
BAD_OWNERS = ['alice', '@', '@-x', '@a/', 'a@b', '@' + 'a' * 40]
BAD_PATTERNS = ['!x', '/a[b]', '/a?', 'a\\b', '/', '//', '/a//b', '/a**b', '**b', '/' + '/'.join(['a'] * 13), 'a' * 301, '/a[']
PATHS = ['.github/record-keeper/settings.yml', '.github/record-keeper.yml', '.github/workflows/records-integrity.yml', '.github/workflows/records-audit.yml', '.github/workflows/records-setup-check.yml', '.github/workflows/records-updater.yml']
LOGINS = ['alice', 'bob', 'carol', 'dave-1', 'eve', 'Frank', 'g', 'h-h']
WHY = ['GET /x answered 403', 'GET /y answered 502: bad', 'the answer is not what the check needs', 'timeout', 'x\ny', '::error::z']
HEX = '0123456789abcdef'


def sha(r):
    return ''.join(r.choice(HEX) for _ in range(64))


def utc(ms):
    moment = time.gmtime(ms // 1000)
    return '%04d-%02d-%02dT%02d:%02d:%02dZ' % moment[:6]


def when(r, delta=None):
    """A time written as the audit writes it: near the limits (48 hours, five minutes), or anywhere, or something that is not a time."""
    choice = r.random()
    if delta is not None:
        return utc(NOW - delta)
    if choice < 0.30:
        return utc(NOW - r.randint(0, 47 * HOUR))
    if choice < 0.45:
        return utc(NOW - 48 * HOUR + r.choice([-2000, -1000, 0]))
    if choice < 0.58:
        return utc(NOW - 48 * HOUR - r.choice([0, 1000, 2000, HOUR, 10 * HOUR, 200 * HOUR]))
    if choice < 0.68:
        return utc(NOW + r.choice([0, 1000, 60 * 1000, 5 * 60 * 1000, 5 * 60 * 1000 - 1000]))
    if choice < 0.76:
        return utc(NOW + r.choice([5 * 60 * 1000 + 1000, 6 * 60 * 1000, HOUR, 30 * HOUR]))
    return broken_time(r)


def broken_time(r):
    base = list(utc(NOW - r.randint(0, 70 * HOUR)))
    kind = r.randint(0, 11)
    text = ''.join(base)
    if kind == 0:
        return text[:-1]
    if kind == 1:
        return text.replace('T', ' ')
    if kind == 2:
        return text[:5] + '13' + text[7:]
    if kind == 3:
        return text[:5] + '02-30' + text[10:]
    if kind == 4:
        return text[:11] + '24' + text[13:]
    if kind == 5:
        return text[:-1] + '.000Z'
    if kind == 6:
        return text + '\n'
    if kind == 7:
        return '1969-12-31T23:59:59Z'
    if kind == 8:
        return text[:-1] + '+00:00'
    if kind == 9:
        return text[:17] + '60Z'
    if kind == 10:
        return text.lower()
    return r.choice(['', 'yesterday', '0000-01-01T00:00:00Z', '2026-1-1T00:00:00Z', '٢026-11-18T12:00:00Z'])


def maybe(r, p):
    return r.random() < p


def gen_settings(r):
    state = r.choices(['read', 'absent', 'unreadable'], [88, 6, 6])[0]
    if state != 'read':
        return {'state': state}
    owners = []
    n = r.choices([0, 1, 2, 3, 5, 29, 30, 31, 33], [6, 14, 40, 14, 6, 2, 3, 3, 2])[0]
    ids = r.sample(range(1000, 9000), n)
    for i, identity in enumerate(ids):
        owners.append({'login': LOGINS[i] if i < len(LOGINS) and maybe(r, 0.9) else 'o%d' % i, 'id': identity})
    problems = []
    if maybe(r, 0.25):
        for _ in range(r.choice([1, 1, 1, 2, 3])):
            problems.append({'rule': r.choice(['S-02', 'S-03', 'S-04', 'S-05', 'S-06', 'S-07']), 'line': None if maybe(r, 0.1) else r.randint(1, 20)})
    return {'state': 'read', 'problems': problems, 'owners': owners, 'approvals': r.choices([1, 2, 3, 4, 99], [24, 56, 8, 6, 6])[0]}


def gen_codeowners(r, mode=None):
    state = r.choices(['read', 'absent', 'unreadable'], [88, 6, 6])[0]
    path = r.choice(['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'])
    if state == 'absent':
        return {'state': 'absent', 'path': ''}
    if state == 'unreadable':
        return {'state': 'unreadable', 'path': path}
    return {'state': 'read', 'path': path, 'text': gen_codeowners_text(r, 'sane' if mode is None else mode)}


def pattern(r, bad=0.0):
    if maybe(r, bad):
        return r.choice(BAD_PATTERNS)
    parts = []
    for _ in range(r.choices([1, 2, 3, 4], [30, 40, 22, 8])[0]):
        parts.append(r.choice(SEGMENTS) if maybe(r, 0.72) else r.choice(GLOBS))
    if maybe(r, 0.12):
        parts = [r.choice(['**', '**', '*', 'x.md']) for _ in range(r.choice([2, 3, 4, 5]))] + [r.choice(SEGMENTS)]
    text = '/'.join(parts)
    if maybe(r, 0.55):
        text = '/' + text
    if maybe(r, 0.35):
        text += '/'
    return text


def gen_codeowners_text(r, mode, bad=0.04):
    lines = []
    if mode == 'sane':
        if maybe(r, 0.4):
            lines.append(r.choice(['/.github/', '.github/', '/.github', '*', '/.github/workflows/', '/.github/record-keeper/', '/.github/workflows/records-*.yml', '/.github/**', '**/workflows/*.yml']) + ' ' + ' '.join(r.sample(OWNERS, r.choice([1, 1, 2]))))
    for _ in range(r.choice([0, 1, 2, 3, 4, 6])):
        kind = r.random()
        if kind < 0.07:
            lines.append('')
        elif kind < 0.14:
            lines.append('# ' + r.choice(['who', 'the kit', '/.github/ @a']))
        elif kind < 0.20:
            lines.append(r.choice(['  ', '\t']))
        else:
            owners = [r.choice(OWNERS) for _ in range(r.choice([0, 1, 1, 2, 3]))]
            if maybe(r, bad):
                owners.append(r.choice(BAD_OWNERS))
            line = pattern(r, bad) + (r.choice([' ', '\t', '  ', ' \t ']) if owners else '') + r.choice([' ', '\t']).join(owners)
            if maybe(r, 0.15):
                line += r.choice([' # c', '\t#c', ' #', ' # @x y'])
            if maybe(r, 0.10):
                line = r.choice([' ', '\t']) + line
            if maybe(r, 0.08):
                line += r.choice([' ', '\t'])
            lines.append(line)
    eol = '\r\n' if maybe(r, 0.1) else '\n'
    text = eol.join(lines)
    if maybe(r, 0.8):
        text += eol
    return text


def gen_pin(r):
    state = r.choices(['read', 'absent', 'refused'], [86, 7, 7])[0]
    if state == 'absent':
        return {'state': 'absent'}
    if state == 'refused':
        return {'state': 'refused', 'code': r.choice(['pin-text', 'pin-line', 'pin-key', 'pin-duplicate', 'pin-value', 'pin-missing'])}
    return {'state': 'read', 'source': r.choice(['example/kit', 'o.x/k-1']), 'version': r.choice(['v1.0.0', 'v1.2.3-rc.1', 'v10.0.0']), 'commit': 'a1' * 20, 'channel': r.choice(['stable', 'prerelease'])}


def gen_release(r, paths):
    state = r.choices(['read', 'not-checked', 'unlisted', 'no-asset', 'refused'], [80, 6, 5, 4, 5])[0]
    if state == 'not-checked':
        return {'state': state, 'why': r.choice(WHY)}
    if state == 'refused':
        return {'state': state, 'code': r.choice(['manifest-json', 'manifest-tag', 'manifest-commit-moved', 'manifest-path', 'manifest-large', 'release-duplicate'])}
    if state != 'read':
        return {'state': state}
    files = [{'path': p, 'sha256': sha(r), 'size': r.randint(0, 5000)} for p in paths]
    blocks = [{'path': 'AGENTS.md', 'sha256': sha(r), 'size': r.randint(60, 900)}] if maybe(r, 0.5) else []
    return {'state': 'read', 'secrets': r.choice([['RECORD_KEEPER_TOKEN'], ['RECORD_KEEPER_TOKEN'], [], ['OTHER'], ['OTHER', 'RECORD_KEEPER_TOKEN']]), 'upToDate': r.choice([True, True, False, None]), 'files': files, 'blocks': blocks}


def gen_tree(r, release):
    tree = {}
    if release['state'] != 'read':
        return tree
    mode = r.choices(['all-right', 'some', 'many'], [60, 30, 10])[0]
    for f in release['files']:
        wrong = mode == 'many' or (mode == 'some' and maybe(r, 0.3))
        if wrong:
            kind = r.choice(['absent', 'other', 'sha', 'size', 'null', 'unlisted'])
            if kind == 'absent':
                tree[f['path']] = {'kind': 'absent'}
            elif kind == 'other':
                tree[f['path']] = {'kind': 'other'}
            elif kind == 'sha':
                tree[f['path']] = {'kind': 'file', 'sha256': sha(r), 'size': f['size']}
            elif kind == 'size':
                tree[f['path']] = {'kind': 'file', 'sha256': f['sha256'], 'size': f['size'] + r.choice([-1, 1, 100])}
            elif kind == 'null':
                tree[f['path']] = {'kind': 'file', 'sha256': None, 'size': f['size']}
            # 'unlisted': the path is not in the tree at all, and so it is missing
        else:
            tree[f['path']] = {'kind': 'file', 'sha256': f['sha256'], 'size': f['size']}
    for f in release['blocks']:
        # the file that holds a block is not a file of the release: its states are the ones of the runner (absent, a folder, too large, no markers, markers that are refused, a block)
        wrong = mode == 'many' or (mode == 'some' and maybe(r, 0.5))
        if wrong:
            kind = r.choice(['absent', 'other', 'large', 'none', 'refused', 'sha', 'size', 'unlisted'])
            if kind in ('absent', 'other', 'large'):
                tree[f['path']] = {'kind': kind}
            elif kind == 'none':
                tree[f['path']] = {'kind': 'block', 'state': 'none'}
            elif kind == 'refused':
                tree[f['path']] = {'kind': 'block', 'state': 'refused', 'why': r.choice(['partial-line', 'begin-without-end', 'end-without-begin', 'reversed', 'doubled'])}
            elif kind == 'sha':
                tree[f['path']] = {'kind': 'block', 'state': 'one', 'sha256': sha(r), 'size': f['size']}
            elif kind == 'size':
                tree[f['path']] = {'kind': 'block', 'state': 'one', 'sha256': f['sha256'], 'size': f['size'] + r.choice([-1, 1, 100])}
        else:
            tree[f['path']] = {'kind': 'block', 'state': 'one', 'sha256': f['sha256'], 'size': f['size']}
    return tree


def gen_github(r, owners):
    github = {}
    github['repo'] = {'ok': True, 'branch': r.choice(['main', 'trunk', 'release/next'])} if maybe(r, 0.93) else {'ok': False, 'why': r.choice(WHY)}
    if maybe(r, 0.9):
        rules = []
        ids = r.sample([11, 12, 4101, 7, 99], r.choice([1, 1, 1, 2, 3]))
        for identity in ids:
            if maybe(r, 0.82):
                checks = r.choice([[CHECK], [CHECK, 'Test gate'], ['Test gate'], ['records integrity'], [], [CHECK + ' ']])
                rules.append({'id': identity, 'checks': checks, 'strict': maybe(r, 0.6)})
        github['rules'] = {'ok': True, 'rules': rules}
    else:
        github['rules'] = {'ok': False, 'why': r.choice(WHY)}
    github['classic'] = r.choices([{'ok': True, 'requires': False}, {'ok': True, 'requires': True}, {'ok': False, 'why': r.choice(WHY)}], [70, 15, 15])[0]
    bypass = {}
    for rule in github['rules'].get('rules', []):
        identity = rule['id']
        if maybe(r, 0.04):
            continue
        roll = r.random()
        if roll < 0.08:
            bypass[str(identity)] = {'ok': False, 'why': r.choice(WHY)}
        elif roll < 0.18:
            bypass[str(identity)] = {'ok': True, 'name': 'ruleset %d' % identity, 'actors': None}
        else:
            actors = []
            for _ in range(r.choice([0, 0, 1, 1, 2, 3])):
                actors.append({'type': r.choice(['RepositoryRole', 'Team', 'Integration', 'OrganizationAdmin', 'DeployKey']), 'id': None if maybe(r, 0.1) else r.randint(1, 20), 'mode': r.choice(['pull_request', 'pull_request', 'always', 'exempt', 'other'])})
            bypass[str(identity)] = {'ok': True, 'name': r.choice(['protect main', 'x', 'a: b']), 'actors': actors}
    github['bypass'] = bypass
    accounts = {}
    for owner in owners:
        roll = r.random()
        if roll < 0.04:
            continue
        if roll < 0.10:
            accounts[str(owner['id'])] = {'ok': False, 'why': r.choice(WHY)}
        elif roll < 0.16:
            accounts[str(owner['id'])] = {'ok': True, 'login': None}
        elif roll < 0.30:
            accounts[str(owner['id'])] = {'ok': True, 'login': r.choice(LOGINS + ['github-actions[bot]'])}
        elif roll < 0.45:
            accounts[str(owner['id'])] = {'ok': True, 'login': ''.join(c.upper() if maybe(r, 0.5) else c.lower() for c in owner['login'])}
        else:
            accounts[str(owner['id'])] = {'ok': True, 'login': owner['login']}
    github['accounts'] = accounts
    roll = r.random()
    if roll < 0.07:
        github['lastRun'] = {'ok': False, 'why': r.choice(WHY)}
    elif roll < 0.13:
        github['lastRun'] = {'ok': True, 'state': 'unreadable', 'why': r.choice(['not JSON in UTF-8', 'not an object with an at', 'larger than 64 KiB'])}
    elif roll < 0.30:
        github['lastRun'] = {'ok': True, 'state': 'absent'}
    else:
        github['lastRun'] = {'ok': True, 'state': 'record', 'at': None if maybe(r, 0.04) else when(r)}
    if maybe(r, 0.9):
        roll = r.random()
        if roll < 0.08:
            github['age'] = {'ok': False, 'why': r.choice(WHY)}
        elif roll < 0.18:
            github['age'] = {'ok': True, 'at': None}
        elif roll < 0.25:
            github['age'] = {'ok': True, 'at': broken_time(r)}
        else:
            github['age'] = {'ok': True, 'at': when(r)}
    return github


def gen_base(r, settings):
    """The settings of the base of a pull request: not read, none, or a file whose owners and number of approvals are the head's, or not."""
    roll = r.random()
    if roll < 0.35:
        return {'state': 'not-read'}
    if roll < 0.50:
        return {'state': 'absent'}
    owners = list(settings.get('owners', []))
    kind = r.choice(['same', 'same', 'reordered', 'other approvals', 'fewer owners', 'more owners', 'other login', 'nobody'])
    if kind == 'reordered':
        owners = list(reversed(owners))
    elif kind == 'fewer owners':
        owners = owners[:-1]
    elif kind == 'more owners':
        owners = owners + [{'login': 'zed', 'id': 9999}]
    elif kind == 'other login':
        owners = [dict(owner, login=owner['login'] + 'x') for owner in owners]
    elif kind == 'nobody':
        owners = []
    return {'state': 'read', 'approvals': r.choice([2, 3]) if kind == 'other approvals' else r.choice([1, 1, 1, 2]), 'owners': owners}


def gen_healthy(r):
    """A repository in which nothing is wrong, with a little that varies: how many owners, which branch, how long ago the audit ran."""
    owners = [{'login': LOGINS[i], 'id': 2000 + i} for i in range(r.choice([2, 2, 3, 4]))]
    paths = ['.github/record-keeper/record-keeper.mjs', '.github/workflows/records-audit.yml'][:r.choice([1, 2])]
    files = [{'path': p, 'sha256': sha(r), 'size': r.randint(1, 900)} for p in paths]
    blocks = [{'path': 'AGENTS.md', 'sha256': sha(r), 'size': r.randint(60, 900)}] if maybe(r, 0.5) else []
    identity = r.choice([11, 4101])
    return {
        'now': NOW, 'local': False, 'own': False, 'event': r.choice(['schedule', 'workflow_dispatch', None]), 'secretSet': True,
        'settings': {'state': 'read', 'problems': [], 'owners': owners, 'approvals': 2}, 'baseSettings': {'state': 'not-read'},
        'codeowners': {'state': 'read', 'path': '.github/CODEOWNERS', 'text': r.choice(['/.github/ @a\n', '* @a @b\n', '.github/ @org/team # all\n', '/.github/**  @a\n'])},
        'pin': {'state': 'read', 'source': 'example/kit', 'version': 'v1.0.0', 'commit': 'a1' * 20, 'channel': 'stable'},
        'release': {'state': 'read', 'secrets': ['RECORD_KEEPER_TOKEN'], 'upToDate': r.choice([True, None]), 'files': files, 'blocks': blocks},
        'tree': {**{f['path']: {'kind': 'file', 'sha256': f['sha256'], 'size': f['size']} for f in files}, **{f['path']: {'kind': 'block', 'state': 'one', 'sha256': f['sha256'], 'size': f['size']} for f in blocks}},
        'auditWorkflow': 'file',
        'github': {
            'repo': {'ok': True, 'branch': r.choice(['main', 'trunk'])},
            'rules': {'ok': True, 'rules': [{'id': identity, 'checks': [CHECK, 'Test gate'], 'strict': True}]},
            'classic': {'ok': True, 'requires': False},
            'bypass': {str(identity): {'ok': True, 'name': 'protect', 'actors': [{'type': 'RepositoryRole', 'id': 5, 'mode': 'pull_request'}]}},
            'accounts': {str(o['id']): {'ok': True, 'login': o['login'].upper()} for o in owners},
            'lastRun': {'ok': True, 'state': 'record', 'at': utc(NOW - r.randint(0, 48 * HOUR))},
        },
    }


def gen_decision(r):
    if maybe(r, 0.06):
        return gen_healthy(r)
    settings = gen_settings(r)
    owners = settings.get('owners', [])
    pin = gen_pin(r)
    paths = r.sample(['.github/record-keeper/record-keeper.mjs', '.github/record-keeper/setup-check.mjs', '.github/workflows/records-audit.yml', '.github/workflows/records-setup-check.yml', '.github/record-keeper/p1.mjs', '.github/record-keeper/p2.mjs', '.github/record-keeper/p3.mjs',
                      '.github/record-keeper/p4.mjs', '.github/record-keeper/p5.mjs', '.github/record-keeper/p6.mjs', '.github/record-keeper/p7.mjs', '.github/record-keeper/p8.mjs', '.github/record-keeper/p9.mjs'], r.choice([1, 2, 3, 4, 9, 10, 13]))
    release = gen_release(r, paths)
    local = maybe(r, 0.10)
    own = maybe(r, 0.07)
    github = None if local else gen_github(r, owners)
    if local:
        release = {'state': 'not-checked', 'why': '--local'}
    decision = {
        'now': NOW, 'local': local, 'own': own,
        'event': r.choice([None, 'schedule', 'workflow_dispatch', 'pull_request']),
        'secretSet': r.choice([True, False, None]),
        'settings': settings, 'baseSettings': gen_base(r, settings), 'codeowners': gen_codeowners(r), 'pin': pin, 'release': release,
        'tree': gen_tree(r, release), 'auditWorkflow': r.choices(['file', 'absent', 'other'], [88, 8, 4])[0],
        'github': github,
    }
    # the pin of the base of a pull request, which the runner reads only for one finding: left out when it was not asked for
    if maybe(r, 0.75):
        decision['basePin'] = {'state': r.choice(['not-read', 'absent', 'absent', 'present'])}
    return decision


def ownership(r):
    """A CODEOWNERS file and the paths to ask about: the six that the check asks about, and others made of the same parts."""
    text = gen_codeowners_text(r, 'any', bad=0.10)
    paths = list(PATHS)
    for _ in range(r.choice([3, 6, 10])):
        paths.append('/'.join(r.choice(SEGMENTS) for _ in range(r.randint(1, 5))))
    return text, paths


def classify(item, expect):
    """The branches of the decision that an input reached, as text."""
    hits = set()
    kind = item['kind']
    if kind == 'utc':
        hits.add('utc ' + ('time' if expect is not None else 'not a time'))
        return hits
    if kind == 'codeowners':
        parsed = ref.parse_codeowners(item['text'])
        hits.add('codeowners file with %s rules' % ('no' if not parsed['rules'] else 'some'))
        for u in parsed['unreadable']:
            hits.add('codeowners unreadable: ' + u['reason'])
        if parsed['unreadable'] and parsed['rules']:
            hits.add('codeowners file with rules and unreadable lines')
        for rule in parsed['rules']:
            p = rule['pattern']
            hits.add('pattern ' + ('anchored' if p.startswith('/') else 'not anchored'))
            if p.endswith('/'):
                hits.add('pattern folder')
            if '*' in p.rstrip('/').split('/')[-1] and p.rstrip('/').split('/')[-1] != '**':
                hits.add('pattern wild last part')
            if '**' in p.split('/'):
                hits.add('pattern with **')
            if p.rstrip('/').split('/')[-1] == '**':
                hits.add('pattern ending in **')
            if p.lstrip('/').startswith('**'):
                hits.add('pattern starting with **')
            if not rule['owners']:
                hits.add('pattern with no owner')
            if len(rule['owners']) > 1:
                hits.add('pattern with several owners')
            for o in rule['owners']:
                hits.add('owner ' + ('team' if '/' in o else 'email' if not o.startswith('@') else 'user'))
        for path_, owners in expect['owners'].items():
            hits.add('path owned' if owners else 'path not owned')
        if '\r' in item['text']:
            hits.add('codeowners with carriage returns')
        return hits
    answer = expect
    for f in answer['findings']:
        hits.add('finding ' + f['code'])
        if f['code'] == 'not-checked':
            hits.add('not-checked ' + f['detail'].split(':')[0])
    for t in answer['passed']:
        hits.add('passed ' + t)
    for looked in answer['notLookedAt']:
        hits.add('not looked at ' + looked['topic'])
    inp = item['input']
    s = inp['settings']
    hits.add('settings ' + s['state'])
    if s['state'] == 'read':
        hits.add('settings problems ' + ('0' if not s['problems'] else '1' if len(s['problems']) == 1 else '2 or more'))
        if any(p['line'] is None for p in s['problems']):
            hits.add('settings problem with no line')
        hits.add('owners ' + ('few' if len(s['owners']) < s['approvals'] else 'enough'))
        if len(s['owners']) == 0:
            hits.add('owners none')
        if len(s['owners']) == 30:
            hits.add('owners exactly 30')
        if len(s['owners']) > 30:
            hits.add('owners more than 30')
        hits.add('approvals %s' % ('1' if s['approvals'] == 1 else 'more'))
        base = inp['baseSettings']
        if s['approvals'] == 1:
            said = any(f['code'] == 'single-owner' for f in answer['findings'])
            if inp['event'] != 'pull_request':
                hits.add('approvals 1, not a pull request: ' + ('said' if said else 'silent'))
            else:
                hits.add('approvals 1, pull request, base %s: %s' % (base['state'] if base['state'] != 'read' else (
                    'other approvals' if base['approvals'] != 1 else 'same owners' if sorted(o['login'] + '/' + str(o['id']) for o in base['owners']) == sorted(o['login'] + '/' + str(o['id']) for o in s['owners']) else 'other owners'),
                    'said' if said else 'silent'))
        elif any(f['code'] == 'single-owner' for f in answer['findings']):
            hits.add('single-owner said with approvals other than 1')
    hits.add('local' if inp['local'] else 'not local')
    if inp['own']:
        hits.add('own repository')
    hits.add('event %s' % inp['event'])
    hits.add('secretSet %s' % inp['secretSet'])
    c = inp['codeowners']
    hits.add('codeowners ' + c['state'])
    if c['state'] == 'read':
        parsed = ref.parse_codeowners(c['text'])
        if parsed['unreadable']:
            hits.add('decision with unreadable codeowners')
        else:
            bare = [p for p in ref.COVERED if not ref.owners_of(parsed['rules'], p)]
            hits.add('codeowners covers %s' % ('all' if not bare else 'some' if len(bare) < 6 else 'none'))
            for p in bare:
                hits.add('codeowners uncovered ' + p)
    hits.add('pin ' + inp['pin']['state'])
    if inp['pin']['state'] == 'refused':
        hits.add('pin refused ' + inp['pin']['code'])
    hits.add('release ' + inp['release']['state'])
    hits.add('auditWorkflow ' + inp['auditWorkflow'])
    if inp['release']['state'] == 'read' and not inp['local'] and not inp['own'] and inp['pin']['state'] == 'read':
        rel = inp['release']
        hits.add('release upToDate %s' % rel['upToDate'])
        hits.add('release secrets %s' % ('names the secret' if 'RECORD_KEEPER_TOKEN' in rel['secrets'] else 'does not'))
        if 'RECORD_KEEPER_TOKEN' in rel['secrets']:
            said = ('not looked at' if any(l['topic'] == 'secret' for l in answer['notLookedAt']) else 'not-set' if any(f['code'] == 'secret-not-set' for f in answer['findings'])
                    else 'not checked' if any(f['code'] == 'not-checked' and f['detail'].startswith('secret:') for f in answer['findings']) else 'found fine')
            hits.add('secret, event %s, secretSet %s: %s' % (inp['event'], inp['secretSet'], said))
        differing = 0
        for f in rel['files']:
            t = inp['tree'].get(f['path'])
            if t is None:
                hits.add('file not in the tree')
                differing += 1
            elif t['kind'] == 'absent':
                hits.add('file absent')
                differing += 1
            elif t['kind'] == 'other':
                hits.add('file not a file')
                differing += 1
            elif t['sha256'] is None:
                hits.add('file with no digest')
                differing += 1
            elif t['sha256'] != f['sha256']:
                hits.add('file with another digest')
                differing += 1
            elif t['size'] != f['size']:
                hits.add('file with another size')
                differing += 1
            else:
                hits.add('file as released')
        for f in rel['blocks']:
            t = inp['tree'].get(f['path'])
            if t is None:
                hits.add('block not in the tree')
            elif t['kind'] in ('absent', 'other', 'large'):
                hits.add('block file ' + t['kind'])
            elif t['state'] == 'none':
                hits.add('block no markers')
            elif t['state'] == 'refused':
                hits.add('block refused ' + t['why'])
            elif t['sha256'] != f['sha256']:
                hits.add('block with another digest')
            elif t['size'] != f['size']:
                hits.add('block with another size')
            else:
                hits.add('block as released')
        hits.add('release has %s' % ('a block' if rel['blocks'] else 'no block'))
        hits.add('files differing %s' % ('0' if differing == 0 else '1' if differing == 1 else '2 to 8' if differing <= 8 else 'more than 8'))
    g = inp['github']
    if g is not None:
        hits.add('repo ' + ('ok' if g['repo']['ok'] else 'not ok'))
        if g['repo']['ok']:
            hits.add('rules ' + ('ok' if g['rules']['ok'] else 'not ok'))
            if g['rules']['ok']:
                req = [x for x in g['rules']['rules'] if ref.CHECK in x['checks']]
                hits.add('rules requiring %s' % (len(req) if len(req) < 2 else '2 or more'))
                hits.add('rules entries %s' % ('0' if not g['rules']['rules'] else 'some'))
                hits.add('classic ' + ('not ok' if not g['classic']['ok'] else 'requires' if g['classic']['requires'] else 'does not require'))
                if not req:
                    hits.add('no ruleset requires, branch protection ' + ('not read' if not g['classic']['ok'] else 'requires' if g['classic']['requires'] else 'read and does not'))
                    if g['classic']['ok'] and not g['classic']['requires']:
                        # the finding is a notice on the pull request that installs the kit (the head has a pin, the base has none), and the error in every other state
                        severity = next(f['severity'] for f in answer['findings'] if f['code'] == 'check-not-required')
                        base_pin = 'left out' if 'basePin' not in inp else inp['basePin']['state']
                        if severity == 'notice':
                            hits.add('check-not-required notice, head pin ' + inp['pin']['state'])
                        elif inp['event'] != 'pull_request':
                            hits.add('check-not-required error, not a pull request, basePin ' + base_pin)
                        elif inp['pin']['state'] == 'absent':
                            hits.add('check-not-required error, pull request, no pin of the head, basePin ' + base_pin)
                        else:
                            hits.add('check-not-required error, pull request with a pin, basePin ' + base_pin)
                elif not g['classic']['ok']:
                    hits.add('a ruleset requires, branch protection not read')
                if req:
                    hits.add('requiring %s' % ('strict' if any(x['strict'] for x in req) else 'not strict'))
                    if len({x['id'] for x in req}) > 1:
                        hits.add('several rulesets')
                    for identity in {x['id'] for x in req}:
                        b = g['bypass'].get(str(identity))
                        if b is None:
                            hits.add('bypass not read')
                        elif not b['ok']:
                            hits.add('bypass ruleset not ok')
                        elif b['actors'] is None:
                            hits.add('bypass list hidden')
                        else:
                            hits.add('bypass actors %s' % ('none' if not b['actors'] else 'some'))
                            for a in b['actors']:
                                hits.add('bypass mode ' + ('pull_request' if a['mode'] == 'pull_request' else 'other'))
                                if a['id'] is None:
                                    hits.add('bypass actor without id')
            hits.add('lastRun ' + (g['lastRun']['state'] if g['lastRun']['ok'] else 'not ok'))
            if g['lastRun']['ok'] and g['lastRun']['state'] == 'record':
                at = ref.parse_utc(g['lastRun']['at'])
                if at is None:
                    hits.add('record at not a time')
                elif at - inp['now'] > ref.SKEW_MS:
                    hits.add('record at in the future')
                elif at - inp['now'] == ref.SKEW_MS:
                    hits.add('record at exactly 5 minutes ahead')
                elif at > inp['now']:
                    hits.add('record at ahead within 5 minutes')
                elif inp['now'] - at > ref.MAX_AGE_MS:
                    hits.add('record at dead')
                elif inp['now'] - at == ref.MAX_AGE_MS:
                    hits.add('record at exactly 48 hours')
                else:
                    hits.add('record at alive')
            if g['lastRun']['ok'] and g['lastRun']['state'] == 'absent' and inp['auditWorkflow'] == 'file':
                age = g.get('age')
                if age is None:
                    hits.add('age not read')
                elif not age['ok']:
                    hits.add('age not ok')
                elif age['at'] is None:
                    hits.add('age none')
                else:
                    since = ref.parse_utc(age['at'])
                    if since is None:
                        hits.add('age not a time')
                    elif inp['now'] - since > ref.MAX_AGE_MS:
                        hits.add('age dead')
                    elif inp['now'] - since == ref.MAX_AGE_MS:
                        hits.add('age exactly 48 hours')
                    else:
                        hits.add('age young')
        if s['state'] == 'read' and s['owners'] and not inp['local']:
            kinds = set()
            for o in s['owners'][:30]:
                a = g['accounts'].get(str(o['id']))
                if a is None:
                    kinds.add('account not read')
                elif not a['ok']:
                    kinds.add('account not ok')
                elif a['login'] is None:
                    kinds.add('account none')
                elif a['login'] == o['login']:
                    kinds.add('account same')
                elif a['login'].lower() == o['login'].lower():
                    kinds.add('account same but for the capitals')
                else:
                    kinds.add('account another login')
            hits.update(kinds)
    if len(answer['findings']) > 5:
        hits.add('more than 5 findings')
    if not answer['findings']:
        hits.add('no finding')
    if any(f['severity'] == 'error' for f in answer['findings']):
        hits.add('an error')
        if sum(1 for f in answer['findings'] if f['severity'] == 'error') > 1:
            hits.add('two errors')
    return hits


def main():
    count, seed, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    hits = {}
    r = random.Random(seed)
    with open(out, 'w') as handle:
        for i in range(count):
            roll = i % 8
            if roll < 5:
                item = {'kind': 'decision', 'input': gen_decision(r)}
                expect = ref.decide(item['input'])
            elif roll < 7:
                text, paths = ownership(r)
                parsed = ref.parse_codeowners(text)
                item = {'kind': 'codeowners', 'text': text, 'paths': paths}
                expect = {'rules': parsed['rules'], 'unreadable': parsed['unreadable'], 'owners': {p: ref.owners_of(parsed['rules'], p) for p in paths}}
            else:
                item = {'kind': 'utc', 'text': when(r) if maybe(r, 0.7) else broken_time(r)}
                expect = ref.parse_utc(item['text'])
            for key in classify(item, expect):
                hits[key] = hits.get(key, 0) + 1
            item['expect'] = expect
            handle.write(json.dumps(item) + '\n')
    print('%d inputs; %s' % (count, json.dumps(hits, sort_keys=True)))


main()
