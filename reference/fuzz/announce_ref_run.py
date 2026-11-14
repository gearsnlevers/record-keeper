"""Gives each scenario of an audit_fuzz.py directory random evidence, random issues and random logins, writes them as files, and asks the Python
reference for the announcement plan (docs/announcements.md). Usage: announce_ref_run.py <dir> <lo> <hi> <out.json>
For scenario i it writes <dir>/n<i>/evidence.json, issues.json and logins.json, and out.json maps i to the answer of the reference."""
import json, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
import announce_ref as ref
import audit_effects_ref as E
import audit_ref
import calendar, time

_audit, _seen = audit_ref.audit, {}


def _cached_audit(repo, head, from_, since, evidence=None):
    """The plan is asked twice for the same history and evidence (once to find the commits, once with the issues): the audit is made once."""
    key = json.dumps([repo, head, from_, since, evidence], sort_keys=True, default=repr)
    if key not in _seen:
        if len(_seen) > 4: _seen.clear()
        _seen[key] = _audit(repo, head, from_, since, evidence)
    return _seen[key]


audit_ref.audit = _cached_audit
NOW = '2026-11-10T03:00:00Z'
BASE_TIME = calendar.timegm(time.strptime('2026-11-09T12:00:00Z', '%Y-%m-%dT%H:%M:%SZ'))
STATES = ['APPROVED', 'APPROVED', 'APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED']
USERS = [1001, 1002, 1003, 9999]


def stamp(seconds): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(seconds))


def random_entry(rng, ids_pool):
    if rng.random() < 0.15: return {'pull': None, 'started': None, 'reviews': []}
    merged = BASE_TIME + rng.randint(-3, 3) * 3600 + rng.choice([0, 0, 1])
    head = rng.choice(['e' * 40, 'd' * 40, rng.choice(ids_pool)])
    pull = {'number': rng.randint(1, 30), 'user': None if rng.random() < 0.05 else {'id': rng.choice(USERS)}, 'head': {'sha': head}, 'merged_at': stamp(merged)}
    started = None if rng.random() < 0.1 else stamp(merged - rng.choice([0, 3600, 7200, 47 * 3600, 48 * 3600, 49 * 3600, 167 * 3600, 168 * 3600, 169 * 3600, 9 * 86400, rng.randint(0, 400) * 3600]) - rng.choice([0, 0, 1]))
    reviews = []
    for n in range(rng.choice([0, 0, 1, 2, 3, 5])):
        at = merged + rng.choice([-100, -10, -1, 0, 0, 1, 10]) * rng.choice([1, 60, 3600])
        reviews.append({'id': 1000 + n, 'user': {'id': rng.choice(USERS)}, 'state': rng.choice(STATES), 'commit_id': rng.choice([head, head, head, 'd' * 40, 'e' * 40]),
                        'submitted_at': stamp(at)})
    return {'pull': pull, 'started': started, 'reviews': reviews}


def approving_entry(rng):
    """An entry that the owners 1001 to 1003 approved, mostly: a long wait, reviews of the head before the merge."""
    merged = BASE_TIME + rng.choice([0, 0, 1])
    head = ''.join(rng.choice('0123456789abcdef') for _ in range(40))
    pull = {'number': rng.randint(1, 3000), 'user': {'id': rng.choice([9999, 9999, 1003, 1004])}, 'head': {'sha': head}, 'merged_at': stamp(merged)}
    started = stamp(merged - rng.choice([0, 3600, 48 * 3600, 170 * 3600, 170 * 3600, 400 * 3600]))
    reviews = []
    for n, uid in enumerate((1001, 1002, 1003)):
        if rng.random() < 0.85:
            reviews.append({'id': 2000 + n, 'user': {'id': uid}, 'state': rng.choice(['APPROVED'] * 8 + ['COMMENTED', 'CHANGES_REQUESTED']), 'commit_id': head if rng.random() < 0.95 else 'd' * 40,
                            'submitted_at': stamp(merged - rng.choice([1, 60, 3600]))})
    return {'pull': pull, 'started': started, 'reviews': reviews}


LOGINS = ['alice', 'bob', 'carol', 'a-b', 'x' * 39, 'u1', 'dave', 'erin', 'frank', 'newname']


def random_logins(rng):
    out = {}
    for uid in (1001, 1002, 1003, 1004, 1005, 1006, 9999, 5):
        r = rng.random()
        if r < 0.7: out[str(uid)] = rng.choice(LOGINS)
        elif r < 0.78: out[str(uid)] = None
    return out


def random_issues(rng, keys):
    out, number = [], 1
    for key in keys:
        if rng.random() < 0.45: continue
        user = {'login': 'github-actions[bot]', 'type': 'Bot'}
        r = rng.random()
        if r < 0.1: user = {'login': 'someone', 'type': 'User'}
        elif r < 0.15: user = {'login': 'github-actions[bot]', 'type': 'User'}
        elif r < 0.18: user = None
        first = '<!-- record-keeper:announcement %s -->%s' % (key, rng.choice(['', '', '', '\r', ' x']))
        out.append({'number': number, 'state': rng.choice(['open', 'closed']), 'title': 'Act', 'body': first + '\nText.\n', 'user': user})
        number += rng.choice([1, 2])
    for _ in range(rng.choice([0, 0, 1])):
        out.append({'number': number + 7, 'state': 'open', 'title': 'old', 'body': '<!-- record-keeper:incident -:A-03 -->\nold\n', 'user': {'login': 'github-actions[bot]', 'type': 'Bot'}})
    rng.shuffle(out)
    return out


def main():
    d, lo, hi, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    scenarios = json.load(open(os.path.join(d, 'scenarios.json')))[lo:hi]
    result = {}
    for s in scenarios:
        i = s['id']
        rng = random.Random(1000033 * i + 5)
        folder = os.path.join(d, f'n{i}')
        os.makedirs(folder, exist_ok=True)
        from_ = E.adoption(s['repo'], s['head'])
        if from_ is None:
            result[str(i)] = {'kind': 'error', 'answer': 'no commit of the history holds %s' % E.SETTINGS_PATH}
            continue
        try:
            base = audit_ref.audit(s['repo'], s['head'], from_, None)
        except Exception as e:
            result[str(i)] = {'error': 'reference: %s' % e}
            continue
        pool = [x['commit'] for x in base['acts']] or ['f' * 40]
        evidence = {}
        for commit in sorted({a['commit'] for a in base['acts']}):
            if rng.random() < 0.02: continue
            evidence[commit] = random_entry(rng, pool) if rng.random() < 0.2 else approving_entry(rng)
        ev_bytes = json.dumps(evidence).encode()
        open(os.path.join(folder, 'evidence.json'), 'wb').write(ev_bytes)
        kind, parsed = E.read_evidence(ev_bytes)
        assert kind == 'ok', parsed
        # the plan with no issues gives the commits that would be announced; some of them get an issue
        kind, first = ref.plan(s['repo'], s['head'], parsed, [], {}, NOW)
        keys = [a['key'] for a in first['announcements']] if kind == 'ok' else []
        issues = random_issues(rng, keys + [rng.choice(['a', 'b']) * 40 for _ in range(rng.choice([0, 1]))])
        open(os.path.join(folder, 'issues.json'), 'w').write(json.dumps(issues))
        kind, issues_read = E.read_issues(json.dumps(issues).encode())
        assert kind == 'ok', issues_read
        logins = random_logins(rng)
        open(os.path.join(folder, 'logins.json'), 'w').write(json.dumps(logins))
        kind, logins_read = ref.read_logins(json.dumps(logins).encode())
        assert kind == 'ok', logins_read
        kind, got = ref.plan(s['repo'], s['head'], parsed, issues_read, logins_read, NOW)
        result[str(i)] = {'kind': kind, 'answer': got}
    json.dump(result, open(out, 'w'))


main()
