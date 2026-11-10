"""Differential fuzz of the owners' approval. Usage: approval_fuzz.py <count> <seed> <out.jsonl>
Each output line is an input and the answer of the Python reference: {"kind": "count", ...} or {"kind": "file", "hex": ..., "expect": ...}."""
import json, os, random, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import approval_ref as ref

HEADS = ['a1b2c3d4e5' * 4, 'c3' * 32]
OTHER = ['0f' * 20, 'a1b2c3d4e5' * 3 + 'a1b2c3d4e', 'a1b2c3d4e5' * 4 + 'a', '']
STATES = ['APPROVED'] * 6 + ['CHANGES_REQUESTED'] * 3 + ['COMMENTED'] * 2 + ['DISMISSED'] * 2 + ['PENDING', 'MERGED', 'approved', '']
TIMES = ['2026-11-01T09:00:00Z', '2026-11-01T09:00:01Z', '2026-11-01T10:00:00Z', '2026-11-02T09:00:00Z', '2025-12-31T23:59:59Z', '2026-01-01T00:00:00Z']
LOGINS = ['alice', 'bob', 'carol', 'dave', 'x-y']


def scenario(r):
    n_owners = r.choice([0, 1, 2, 2, 3, 4])
    ids = r.sample(range(1, 8), n_owners)
    owners = [{'login': r.choice(LOGINS), 'id': i} for i in ids]
    head = r.choice(HEADS)
    reviews = []
    for k in range(r.choice([0, 1, 2, 3, 4, 6, 8, 12])):
        state = r.choice(STATES)
        commit = r.choice([head, head, head, head.upper(), None, r.choice(OTHER)])
        reviews.append({'id': 100 + k, 'user': r.choice([None] + list(range(1, 9))), 'state': state, 'commit': commit,
                        'at': None if state == 'PENDING' and r.random() < 0.7 else r.choice(TIMES)})
    return {'kind': 'count', 'owners': owners, 'needed': r.choice([1, 1, 2, 2, 3, 4]), 'head': head, 'author': r.choice([None] + list(range(1, 9))) or 99, 'reviews': reviews}


def bar_scenario(r):
    if r.random() < 0.65:
        # owners that mostly do approve, so that the clock is reached
        ids = r.sample(range(1, 8), r.choice([1, 1, 2, 2, 3]))
        owners = [{'login': r.choice(LOGINS), 'id': i} for i in ids]
        head = r.choice(HEADS)
        author = r.choice(ids + [99, 99]) if r.random() < 0.5 else 99
        reviews = []
        for k, i in enumerate(ids):
            for _ in range(r.choice([0, 1, 1, 1, 1, 2])):
                state = 'APPROVED' if r.random() < 0.9 else r.choice(STATES)
                reviews.append({'id': 100 + 10 * k + len(reviews), 'user': i, 'state': state, 'commit': head if r.random() < 0.95 else r.choice(OTHER),
                                'at': None if state == 'PENDING' else r.choice(TIMES)})
        s = {'owners': owners, 'head': head, 'author': author, 'reviews': reviews}
    else:
        s = scenario(r)
    stamps = [x['at'] for x in s['reviews'] if x['at']] or TIMES
    base = ref.epoch(r.choice(stamps))
    offset = r.choice([0, 1, 3600, 7 * 86400 - 1, 7 * 86400, 7 * 86400 + 1, 6 * 86400, 8 * 86400, 30 * 86400, -86400, 100, 7 * 86400 - 3599])
    since = None if r.random() < 0.1 else base - offset
    now = ref.epoch(r.choice(TIMES)) + r.choice([0, 86400, 8 * 86400, 30 * 86400])
    return {'kind': 'bar', 'owners': s['owners'], 'head': s['head'], 'author': s['author'], 'reviews': s['reviews'], 'since': since, 'now': now, 'waived': r.random() < 0.2}


def good_review(r, k):
    d = {'id': r.choice([1 + k, 1 + k, 2 ** 53 - 1, 0, -1, 1.5, '1', None, True, 1e400, 2 ** 53]),
         'user': r.choice([{'id': r.randint(1, 9)}, {'id': r.randint(1, 9), 'login': 'x'}, None, None, {}, {'id': 0}, {'id': '1'}, 'x', 1, [], {'id': 1.0}]),
         'state': r.choice(STATES + [1, None]),
         'commit_id': r.choice([HEADS[0], None, 5, '', [] , 'abc']),
         'submitted_at': r.choice(TIMES + ['2026-11-06 12:00:00', '2026-13-01T00:00:00Z', None, 5, '', '2026-11-06T12:00:00.5Z', '2026-11-06T24:00:00Z', '2026-02-31T10:00:00Z'])}
    if r.random() < 0.6:
        d['id'] = 1 + k
        d['user'] = {'id': r.randint(1, 9)}
        d['state'] = r.choice(STATES[:-2])
        d['commit_id'] = r.choice([HEADS[0], None])
        d['submitted_at'] = r.choice(TIMES)
    for key in list(d):
        if r.random() < 0.04: del d[key]
    if r.random() < 0.2: d['extra'] = r.choice([1, 'x', [1], {'a': 1}])
    return d


def document(r):
    n = r.choice([0, 1, 2, 3, 5])
    items = [good_review(r, k) if r.random() < 0.9 else r.choice([None, 1, 'x', [], [good_review(r, 0)], {}]) for k in range(n)]
    shape = r.random()
    if shape < 0.15 and items: items = [items[:len(items) // 2], items[len(items) // 2:]]
    elif shape < 0.2: items = [items] if r.random() < 0.5 else {'reviews': items}
    elif shape < 0.22: items = r.choice([None, 'x', 5, True])
    return items


def to_bytes(r):
    doc = document(r)
    try:
        text = json.dumps(doc, allow_nan=False, separators=(',', ':') if r.random() < 0.5 else (', ', ': '))
    except ValueError:
        text = '[NaN]'
    data = text.encode('utf-8')
    for _ in range(r.choice([0, 0, 0, 0, 1, 1, 2])):
        if not data: break
        k, i = r.random(), r.randrange(len(data))
        if k < 0.3: data = data[:i] + data[i + 1:]
        elif k < 0.6: data = data[:i] + bytes([r.choice(b'[]{},:"0123456789 \n\t\xff\xef\xbb\xbf-+.eE')]) + data[i:]
        elif k < 0.8: data = data[:i] + bytes([r.choice(b'{}[]," :')]) + data[i + 1:]
        else: data = data + r.choice([b'[]', b' ', b'\n', b',', b'\xef\xbb\xbf'])
    if r.random() < 0.03: data = b'\xef\xbb\xbf' + data
    return data


def main():
    count, seed, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    r = random.Random(seed)
    hits = {}
    with open(out, 'w') as f:
        for _ in range(count):
            pick = r.random()
            if pick < 0.3:
                s = bar_scenario(r)
                s['expect'] = ref.bar(s['owners'], s['head'], s['author'], s['reviews'], s['since'], s['now'], s['waived'])
                key = 'bar ' + ('waived' if s['expect'].get('waived') else 'met' if s['expect']['met'] else 'unmet: ' + ''.join(c for c in s['expect']['reason'] if not c.isdigit()))
                hits[key] = hits.get(key, 0) + 1
            elif pick < 0.6:
                s = scenario(r)
                s['expect'] = ref.count(s['owners'], s['needed'], s['head'], s['author'], s['reviews'])
                for o in s['expect']['owners']: hits[o['how']] = hits.get(o['how'], 0) + 1
                hits['met' if s['expect']['met'] else 'unmet'] = hits.get('met' if s['expect']['met'] else 'unmet', 0) + 1
            else:
                data = to_bytes(r)
                kind, got = ref.read_reviews(data)
                s = {'kind': 'file', 'hex': data.hex(), 'expect': {'error': got} if kind == 'error' else {'reviews': got}}
                key = 'file ok' if kind == 'ok' else 'file error: ' + got.split(': ')[-1]
                hits[key] = hits.get(key, 0) + 1
            f.write(json.dumps(s) + '\n')
    print(count, 'inputs;', dict(sorted(hits.items())))


main()
