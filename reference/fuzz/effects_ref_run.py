"""Gives each scenario of an audit_fuzz.py directory random evidence and random issues, writes them as files, and asks the Python reference for the
plan (docs/audit-effects.md). Usage: effects_ref_run.py <dir> <lo> <hi> <out.json>
For scenario i it writes <dir>/e<i>/evidence.json (not always) and issues.json, and out.json maps i to the arguments and the answer of the reference."""
import calendar, json, os, random, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import audit_effects_ref as ref
import audit_ref

HERE = os.path.dirname(os.path.abspath(__file__))
TEXTS = ref.rule_texts(os.path.join(HERE, '..', '..', 'record-keeper.mjs'))
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


def random_issues(rng, keys, bodies):
    out, number = [], 1
    for key in keys + [rng.choice(['0001:P-02', '0002:P-06', '-:A-01', 'other:V-08', '0009:P-02']) for _ in range(rng.choice([0, 0, 1, 2]))]:
        for _ in range(rng.choice([0, 1, 1, 1, 2, 3])):
            kind = rng.random()
            user = {'login': 'github-actions[bot]', 'type': 'Bot'}
            if kind < 0.08: user = {'login': 'someone', 'type': 'User'}
            elif kind < 0.11: user = {'login': 'github-actions[bot]', 'type': 'User'}
            elif kind < 0.13: user = None
            body = bodies.get(key) if rng.random() < 0.55 and key in bodies else '<!-- record-keeper:incident %s -->%sold\n' % (key, rng.choice(['\n', '\r\n', ' \n']))
            title = (bodies.get(key + '#title') if key in bodies and rng.random() < 0.7 else None) or 'old title'
            out.append({'number': number, 'state': rng.choice(['open', 'open', 'closed']), 'title': title, 'body': body, 'user': user})
            number += rng.choice([1, 1, 3])
    if rng.random() < 0.2: out.append({'number': number + 50, 'state': 'open', 'title': 'a pull request', 'body': None, 'user': None, 'pull_request': {}})
    rng.shuffle(out)
    return out


def main():
    d, lo, hi, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    scenarios = json.load(open(os.path.join(d, 'scenarios.json')))[lo:hi]
    result = {}
    for s in scenarios:
        i = s['id']
        rng = random.Random(1000003 * i + 17)
        folder = os.path.join(d, f'e{i}')
        os.makedirs(folder, exist_ok=True)
        adopted = rng.random() < 0.15
        base = None
        try:
            base = audit_ref.audit(s['repo'], s['head'], s['from'], s['since'])
        except Exception as e:  # a head the reference cannot audit
            result[str(i)] = {'error': 'reference: %s' % e}
            continue
        pool = [x['commit'] for x in base['acts']] or ['f' * 40]
        evidence = None
        if rng.random() < 0.8:
            evidence = {}
            for commit in sorted({a['commit'] for a in base['acts']}):
                if rng.random() < 0.03: continue
                evidence[commit] = random_entry(rng, pool)
            for _ in range(rng.choice([0, 0, 1])): evidence[rng.choice(['a', 'b', 'c']) * 40] = random_entry(rng, pool)
        args = {'adopted': adopted, 'from': None if adopted else s['from'], 'since': s['since']}
        ev_bytes = None if evidence is None else json.dumps(evidence).encode()
        if ev_bytes is not None: open(os.path.join(folder, 'evidence.json'), 'wb').write(ev_bytes)
        parsed = None
        if ev_bytes is not None:
            kind, parsed = ref.read_evidence(ev_bytes)
            assert kind == 'ok', parsed
        # the plan with no issues gives the keys and the bodies that the issues of this scenario are made from
        kind, first = ref.plan(s['repo'], s['head'], adopted, args['from'], s['since'], parsed, [], NOW, TEXTS)
        bodies, keys = {}, []
        if kind == 'ok':
            for issue in first['issues']:
                bodies[issue['key']] = issue['body']
                bodies[issue['key'] + '#title'] = issue['title']
                keys.append(issue['key'])
        issues = random_issues(rng, keys, bodies)
        open(os.path.join(folder, 'issues.json'), 'w').write(json.dumps(issues))
        kind, issues_read = ref.read_issues(json.dumps(issues).encode())
        assert kind == 'ok', issues_read
        kind, got = ref.plan(s['repo'], s['head'], adopted, args['from'], s['since'], parsed, issues_read, NOW, TEXTS)
        result[str(i)] = {'args': args, 'evidence': ev_bytes is not None, 'kind': kind, 'answer': got}
    json.dump(result, open(out, 'w'))


main()
