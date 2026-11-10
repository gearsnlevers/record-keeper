"""Reference implementation of the owners' approval (docs/approvals.md), in Python, written from the page. It shares no code with the library.
read_reviews(data: bytes) -> ('ok', [review]) or ('error', message); a review is {'id', 'user', 'state', 'commit', 'at'}.
count(owners, needed, head, author, reviews) -> {'have', 'needed', 'met', 'owners': [{'login', 'id', 'how'}]}."""
import json, re

TIME = re.compile(r'[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z')
SAFE = 2 ** 53 - 1


def positive_integer(x):
    if isinstance(x, bool): return False
    if isinstance(x, int): return 1 <= x <= SAFE
    if isinstance(x, float): return x == x and abs(x) != float('inf') and x.is_integer() and 1 <= x <= SAFE
    return False


def _refuse(constant): raise ValueError(constant)


def review_problem(r):
    """Why a decoded entry is not a review, or None."""
    if not isinstance(r, dict): return 'is not an object'
    if not positive_integer(r.get('id')): return 'id is not a positive integer'
    user = r.get('user')
    if user is not None and not (isinstance(user, dict) and positive_integer(user.get('id'))):
        return 'user is neither null nor an object with a positive integer id'
    if not isinstance(r.get('state'), str): return 'state is not text'
    commit = r.get('commit_id')
    if commit is not None and not isinstance(commit, str): return 'commit_id is neither null nor text'
    at = r.get('submitted_at')
    if r['state'] != 'PENDING' and not (isinstance(at, str) and TIME.fullmatch(at)):
        return 'submitted_at is not a time like 2026-11-06T12:00:00Z'
    return None


def read_reviews(data):
    try:
        text = data.decode('utf-8')
        doc = json.loads(text, parse_constant=_refuse)
    except (UnicodeDecodeError, ValueError, RecursionError):
        return ('error', 'is not one JSON document')
    if not isinstance(doc, list): return ('error', 'is not a list')
    pages = [isinstance(x, list) for x in doc]
    if any(pages) and not all(pages): return ('error', 'mixes reviews and pages')
    flat = [r for page in doc for r in page] if doc and all(pages) else doc
    out = []
    for n, r in enumerate(flat, 1):
        why = review_problem(r)
        if why: return ('error', 'entry %d: %s' % (n, why))
        user = r.get('user')
        out.append({'id': int(r['id']), 'user': None if user is None else int(user['id']), 'state': r['state'], 'commit': r.get('commit_id'), 'at': r.get('submitted_at') if isinstance(r.get('submitted_at'), str) else None})
    return ('ok', out)


def count(owners, needed, head, author, reviews):
    results = []
    for owner in owners:
        if owner['id'] == author:
            how = 'author'
        else:
            decisive = [r for r in reviews if r['user'] == owner['id'] and r['state'] not in ('COMMENTED', 'PENDING')]
            if not decisive:
                how = 'none'
            else:
                newest = max(r['at'] for r in decisive)
                latest = [r for r in decisive if r['at'] == newest]
                states = {r['state'] for r in latest}
                if 'CHANGES_REQUESTED' in states: how = 'changes'
                elif 'DISMISSED' in states: how = 'dismissed'
                elif states != {'APPROVED'}: how = 'other'
                elif any((r['commit'] or '').lower() != head for r in latest): how = 'earlier'
                else: how = 'approved'
        results.append({'login': owner['login'], 'id': owner['id'], 'how': how})
    have = sum(1 for r in results if r['how'] in ('author', 'approved'))
    return {'have': have, 'needed': needed, 'met': have >= needed, 'owners': results}


import calendar, time as _time


def epoch(text): return calendar.timegm(_time.strptime(text, '%Y-%m-%dT%H:%M:%SZ'))


def bar(owners, head, author, reviews, since, now, waived):
    """The bar for an amendment (docs/amendments.md); since and now are epoch seconds (since may be None)."""
    if not owners: return {'met': False, 'reason': 'no owners'}
    c = count(owners, len(owners), head, author, reviews)
    if not c['met']: return {'met': False, 'reason': '%d of %d owners' % (c['have'], len(owners))}
    if waived: return {'met': True, 'waived': True}
    if since is None: return {'met': False, 'reason': 'no clock'}
    times = []
    for o in owners:
        if o['id'] == author: continue
        decisive = [r for r in reviews if r['user'] == o['id'] and r['state'] not in ('COMMENTED', 'PENDING')]
        times.append(epoch(max(r['at'] for r in decisive)))
    elapsed = (max(times) if times else now) - since
    if elapsed < 7 * 86400: return {'met': False, 'reason': '%dh of 168h' % (max(0, elapsed) // 3600)}
    return {'met': True}
