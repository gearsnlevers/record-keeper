"""Builds test/fixtures/approval/cases.json. Every case states the answer it was written to show; the generator runs the Python reference
(approval_ref.py) on it and stops if the two differ. Usage: build_approval_cases.py <out.json>"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import approval_ref as ref

HEAD = 'a1b2c3d4e5' * 4
OLD = '0f' * 20
HEAD256 = 'c3' * 32
ALICE, BOB, CAROL = ('alice', 1001), ('bob', 1002), ('carol', 1003)
T1, T2, T3 = '2026-11-01T09:00:00Z', '2026-11-02T09:00:00Z', '2026-11-03T09:00:00Z'

counts, files = [], []
_next = [100]


def R(user, state, at, commit=HEAD, id=None):
    """A review as the count reads it."""
    if id is None:
        _next[0] += 1
        id = _next[0]
    return {'id': id, 'user': user, 'state': state, 'commit': commit, 'at': at}


def C(id, note, owners, needed, reviews, how, author=7, head=HEAD):
    """how: the result of each owner, in the order of the owners."""
    have = sum(1 for h in how if h in ('author', 'approved'))
    counts.append({'id': id, 'note': note, 'owners': [{'login': l, 'id': i} for l, i in owners], 'approvals': needed, 'head': head, 'author': author, 'reviews': reviews,
                   'expect': {'have': have, 'needed': needed, 'met': have >= needed, 'owners': [{'login': l, 'id': i, 'how': h} for (l, i), h in zip(owners, how)]}})


# ---------------------------------------------------------------- the count
C('c01-no-owners', 'nobody can approve: the count is 0 and is never met', [], 2, [], [])
C('c02-one-approval', 'an owner approves the head commit', [ALICE], 1, [R(1001, 'APPROVED', T1)], ['approved'])
C('c03-author-counts', 'the author is an owner and has no review', [ALICE], 1, [], ['author'], author=1001)
C('c04-author-and-one', 'two owners needed: the author and another that approves', [ALICE, BOB], 2, [R(1002, 'APPROVED', T1)], ['author', 'approved'], author=1001)
C('c05-one-of-two', 'one of two needed approvals', [ALICE, BOB], 2, [R(1001, 'APPROVED', T1)], ['approved', 'none'])
C('c06-earlier-commit', 'an approval of an earlier commit does not count', [ALICE], 1, [R(1001, 'APPROVED', T1, OLD)], ['earlier'])
C('c07-changes-after-approval', 'a later request for changes takes the approval back', [ALICE], 1, [R(1001, 'APPROVED', T1), R(1001, 'CHANGES_REQUESTED', T2)], ['changes'])
C('c08-approval-after-changes', 'a later approval replaces a request for changes', [ALICE], 1, [R(1001, 'CHANGES_REQUESTED', T1, OLD), R(1001, 'APPROVED', T2)], ['approved'])
C('c09-dismissed-alone', 'a dismissed review is not an approval', [ALICE], 1, [R(1001, 'DISMISSED', T1)], ['dismissed'])
C('c10-approval-then-dismissed', 'a dismissal after an approval takes it back', [ALICE], 1, [R(1001, 'APPROVED', T1), R(1001, 'DISMISSED', T2)], ['dismissed'])
C('c11-dismissed-then-approval', 'an approval after a dismissal counts', [ALICE], 1, [R(1001, 'DISMISSED', T1, OLD), R(1001, 'APPROVED', T2)], ['approved'])
C('c12-comment-after-approval', 'a comment does not take an approval back', [ALICE], 1, [R(1001, 'APPROVED', T1), R(1001, 'COMMENTED', T2)], ['approved'])
C('c13-comment-only', 'a comment is not an approval', [ALICE], 1, [R(1001, 'COMMENTED', T1)], ['none'])
C('c14-pending-only', 'a pending review has not been submitted', [ALICE], 1, [R(1001, 'PENDING', None)], ['none'])
C('c15-pending-after-approval', 'a pending review does not take an approval back', [ALICE], 1, [R(1001, 'APPROVED', T1), R(1001, 'PENDING', None)], ['approved'])
C('c16-same-second-approval-and-changes', 'two reviews of one second: the owner does not count', [ALICE], 1, [R(1001, 'APPROVED', T1), R(1001, 'CHANGES_REQUESTED', T1)], ['changes'])
C('c17-same-second-two-commits', 'two approvals of one second, one for an earlier commit', [ALICE], 1, [R(1001, 'APPROVED', T1), R(1001, 'APPROVED', T1, OLD)], ['earlier'])
C('c18-same-second-approval-dismissed', 'an approval and a dismissal of one second', [ALICE], 1, [R(1001, 'APPROVED', T1), R(1001, 'DISMISSED', T1)], ['dismissed'])
C('c19-same-second-two-approvals', 'two approvals of the head commit in one second', [ALICE], 1, [R(1001, 'APPROVED', T1), R(1001, 'APPROVED', T1)], ['approved'])
C('c20-unknown-state-latest', 'a state that is not known takes the approval back', [ALICE], 1, [R(1001, 'APPROVED', T1), R(1001, 'MERGED', T2)], ['other'])
C('c21-unknown-state-older', 'an approval after an unknown state counts', [ALICE], 1, [R(1001, 'MERGED', T1), R(1001, 'APPROVED', T2)], ['approved'])
C('c22-changes-beats-dismissed', 'with both in one second the request for changes is the answer', [ALICE], 1, [R(1001, 'DISMISSED', T1), R(1001, 'CHANGES_REQUESTED', T1)], ['changes'])
C('c23-dismissed-beats-unknown', 'with both in one second the dismissal is the answer', [ALICE], 1, [R(1001, 'MERGED', T1), R(1001, 'DISMISSED', T1)], ['dismissed'])
C('c24-unknown-beats-approval', 'with both in one second the unknown state is the answer', [ALICE], 1, [R(1001, 'APPROVED', T1), R(1001, 'MERGED', T1)], ['other'])
C('c25-not-an-owner', 'the reviews of an account that is not an owner count for nothing', [ALICE], 1, [R(2000, 'APPROVED', T1)], ['none'])
C('c26-author-not-an-owner', 'an author that is not an owner counts for nothing', [ALICE], 1, [], ['none'], author=2000)
C('c27-twice-counted-once', 'an owner that approves twice counts once', [ALICE, BOB], 2, [R(1001, 'APPROVED', T1), R(1001, 'APPROVED', T2)], ['approved', 'none'])
C('c28-author-with-reviews', 'the author is an owner: reviews do not matter', [ALICE], 1, [R(1001, 'CHANGES_REQUESTED', T1)], ['author'], author=1001)
C('c29-deleted-user', 'a review of a deleted account is read and ignored', [ALICE], 1, [R(None, 'APPROVED', T1)], ['none'])
C('c30-more-needed-than-owners', 'more approvals needed than there are owners: never met', [ALICE], 2, [R(1001, 'APPROVED', T1)], ['approved'])
C('c31-three-of-two', 'all three approve and two are needed', [ALICE, BOB, CAROL], 2, [R(1001, 'APPROVED', T1), R(1002, 'APPROVED', T1), R(1003, 'APPROVED', T1)], ['approved', 'approved', 'approved'])
C('c32-two-of-three', 'two of three needed', [ALICE, BOB, CAROL], 3, [R(1001, 'APPROVED', T1), R(1002, 'APPROVED', T1)], ['approved', 'approved', 'none'])
C('c33-commit-case', 'a commit id is compared without regard to case', [ALICE], 1, [R(1001, 'APPROVED', T1, HEAD.upper())], ['approved'])
C('c34-commit-null', 'an approval of no commit is not an approval of the head', [ALICE], 1, [R(1001, 'APPROVED', T1, None)], ['earlier'])
C('c35-commit-prefix', 'a commit id is compared whole', [ALICE], 1, [R(1001, 'APPROVED', T1, HEAD[:12])], ['earlier'])
C('c36-commit-longer', 'a commit id with more characters is another commit', [ALICE], 1, [R(1001, 'APPROVED', T1, HEAD + 'a')], ['earlier'])
C('c37-sha256', 'a 64-digit commit id', [ALICE], 1, [R(1001, 'APPROVED', T1, HEAD256)], ['approved'], head=HEAD256)
C('c38-order-of-file', 'the position in the file does not matter, the time does', [ALICE], 1, [R(1001, 'CHANGES_REQUESTED', T2), R(1001, 'APPROVED', T1)], ['changes'])
C('c39-order-of-file-2', 'the same, the other way round', [ALICE], 1, [R(1001, 'APPROVED', T2), R(1001, 'CHANGES_REQUESTED', T1, OLD)], ['approved'])
C('c40-changes-then-comment', 'a comment does not take back a request for changes', [ALICE], 1, [R(1001, 'CHANGES_REQUESTED', T1), R(1001, 'COMMENTED', T2)], ['changes'])
C('c41-dismissed-then-comment', 'nor a dismissal', [ALICE], 1, [R(1001, 'DISMISSED', T1), R(1001, 'COMMENTED', T2)], ['dismissed'])
C('c42-owners-keep-their-order', 'the result is in the order of the settings, not of the IDs', [BOB, ALICE], 1, [R(1001, 'APPROVED', T1)], ['none', 'approved'])
C('c43-years-compare', 'times compare as times: a later year', [ALICE], 1, [R(1001, 'CHANGES_REQUESTED', '2025-12-31T23:59:59Z', OLD), R(1001, 'APPROVED', '2026-01-01T00:00:00Z')], ['approved'])
C('c44-seconds-compare', 'times compare to the second', [ALICE], 1, [R(1001, 'APPROVED', '2026-11-06T10:00:00Z'), R(1001, 'CHANGES_REQUESTED', '2026-11-06T10:00:01Z')], ['changes'])
C('c45-hours-compare', 'times compare in hours', [ALICE], 1, [R(1001, 'APPROVED', '2026-11-06T09:59:59Z', OLD), R(1001, 'COMMENTED', '2026-11-06T10:00:00Z'), R(1001, 'APPROVED', '2026-11-06T10:00:00Z')], ['approved'])
C('c46-another-owner-changes', 'a request for changes of one owner does not touch the other', [ALICE, BOB], 1, [R(1001, 'APPROVED', T1), R(1002, 'CHANGES_REQUESTED', T2)], ['approved', 'changes'])
C('c47-latest-is-all-that-counts', 'only the latest reviews are read: an old request for changes is replaced', [ALICE], 1, [R(1001, 'CHANGES_REQUESTED', T1, OLD), R(1001, 'COMMENTED', T2), R(1001, 'APPROVED', T3)], ['approved'])
C('c48-approval-of-old-after-new', 'the latest decisive review is of an earlier commit', [ALICE], 1, [R(1001, 'APPROVED', T1), R(1001, 'APPROVED', T2, OLD)], ['earlier'])
C('c49-single-owner-mode', 'approvals 1 with the owner as author', [ALICE], 1, [], ['author'], author=1001)
C('c50-single-owner-other-opens', 'approvals 1: someone else opens the pull request and the owner approves', [ALICE], 1, [R(1001, 'APPROVED', T1)], ['approved'], author=2000)
C('c51-single-owner-not-yet', 'approvals 1: someone else opens it and nobody approved', [ALICE], 1, [], ['none'], author=2000)
C('c52-author-equals-reviewer-id-type', 'a large ID matches exactly', [('big', 999999999999999)], 1, [R(999999999999999, 'APPROVED', T1)], ['approved'])
C('c53-near-id', 'an ID that differs by one does not match', [('big', 999999999999999)], 1, [R(999999999999998, 'APPROVED', T1)], ['none'])
C('c54-login-is-not-matched', 'two owners with one login and different IDs are two owners', [('alice', 1001), ('alice', 1002)], 2, [R(1002, 'APPROVED', T1), R(1001, 'APPROVED', T1)], ['approved', 'approved'])

# ---------------------------------------------------------------- the reviews file
def good(hex_id, user, state, at, commit=HEAD, **more):
    d = {'id': hex_id, 'user': None if user is None else {'id': user, 'login': 'x'}, 'state': state, 'commit_id': commit, 'submitted_at': at}
    d.update(more)
    return d


def F(id, note, text, expect):
    files.append({'id': id, 'note': note, 'text': text, 'expect': expect})


def read(*reviews):
    return {'reviews': [{'id': r['id'], 'user': None if r['user'] is None else r['user']['id'], 'state': r['state'], 'commit': r['commit_id'], 'at': r.get('submitted_at')} for r in reviews]}


def err(message): return {'error': message}


a = good(11, 1001, 'APPROVED', T1)
b = good(12, 1002, 'CHANGES_REQUESTED', T2, OLD)
dump = json.dumps
F('f01-empty-list', 'no reviews', '[]', {'reviews': []})
F('f02-one', 'one review', dump([a]), read(a))
F('f03-two', 'two reviews', dump([a, b]), read(a, b))
F('f04-pages', 'a list of pages, as gh api --paginate --slurp writes it', dump([[a], [b]]), read(a, b))
F('f05-empty-pages', 'pages with no review', '[[], []]', {'reviews': []})
F('f06-one-empty-page', 'one empty page', '[[]]', {'reviews': []})
f_deleted = good(13, None, 'APPROVED', T1)
F('f07-deleted-user', 'a deleted account: user is null', dump([f_deleted]), read(f_deleted))
F('f08-extra-fields', 'fields that are not read are ignored', dump([good(14, 1001, 'APPROVED', T1, body='x', html_url='https://example.com', author_association='OWNER')]), read(good(14, 1001, 'APPROVED', T1)))
f_pending = good(15, 1001, 'PENDING', None)
F('f09-pending-null-time', 'a pending review has no time', dump([f_pending]), read(f_pending))
f_pending2 = {'id': 16, 'user': {'id': 1001}, 'state': 'PENDING', 'commit_id': HEAD}
F('f10-pending-no-time-key', 'or no key for it', dump([f_pending2]), {'reviews': [{'id': 16, 'user': 1001, 'state': 'PENDING', 'commit': HEAD, 'at': None}]})
f_nocommit = good(17, 1001, 'APPROVED', T1, None)
F('f11-null-commit', 'commit_id may be null', dump([f_nocommit]), read(f_nocommit))
f_nocommit_key = {'id': 18, 'user': {'id': 1001}, 'state': 'COMMENTED', 'submitted_at': T1}
F('f12-no-commit-key', 'or absent', dump([f_nocommit_key]), {'reviews': [{'id': 18, 'user': 1001, 'state': 'COMMENTED', 'commit': None, 'at': T1}]})
f_unknown = good(19, 1001, 'SOMETHING_NEW', T1)
F('f13-unknown-state', 'a state that is not known is read as it is', dump([f_unknown]), read(f_unknown))
F('f14-whitespace', 'white space around the document', ' \n[ ]\n ', {'reviews': []})
F('f15-float-ids', 'a number written 1001.0 is the integer 1001', '[{"id": 20.0, "user": {"id": 1.001e3}, "state": "APPROVED", "commit_id": null, "submitted_at": "%s"}]' % T1, {'reviews': [{'id': 20, 'user': 1001, 'state': 'APPROVED', 'commit': None, 'at': T1}]})
F('f16-largest-id', 'the largest ID that a double holds exactly', '[{"id": 9007199254740991, "user": {"id": 9007199254740991}, "state": "COMMENTED", "commit_id": null, "submitted_at": "%s"}]' % T1, {'reviews': [{'id': 9007199254740991, 'user': 9007199254740991, 'state': 'COMMENTED', 'commit': None, 'at': T1}]})
F('f17-duplicate-keys', 'the last of two equal keys is read, as JSON readers do', '[{"id": 0, "id": 21, "user": null, "state": "COMMENTED", "commit_id": null, "submitted_at": "%s"}]' % T1, {'reviews': [{'id': 21, 'user': None, 'state': 'COMMENTED', 'commit': None, 'at': T1}]})
F('f18-time-edge', 'the last second of a day and of a year', dump([good(22, 1001, 'APPROVED', '2026-12-31T23:59:59Z'), good(23, 1001, 'APPROVED', '2026-01-01T00:00:00Z')]), read(good(22, 1001, 'APPROVED', '2026-12-31T23:59:59Z'), good(23, 1001, 'APPROVED', '2026-01-01T00:00:00Z')))

times = ['2026-01-01T00:00:00Z', '2026-02-09T09:09:09Z', '2026-03-10T10:10:10Z', '2026-04-19T19:19:19Z', '2026-05-20T20:20:20Z', '2026-06-29T23:59:59Z', '2026-07-30T12:30:45Z', '2026-08-31T01:02:03Z', '2026-09-15T15:45:15Z', '2026-10-01T04:05:06Z', '2026-11-11T11:11:11Z', '2026-12-12T21:22:23Z']
tr = [good(30 + i, 1001, 'COMMENTED', t, None) for i, t in enumerate(times)]
F('f19-times-of-every-shape', 'times with every digit class: months 01 to 12, days 01 to 31, hours 00 to 23, minutes and seconds up to 59', dump(tr), read(*tr))
F('e01-not-json', 'text that is not JSON', 'x', err('is not one JSON document'))
F('e02-two-documents', 'gh api --paginate without --slurp writes one document for each page', '[][]', err('is not one JSON document'))
F('e03-empty-file', 'an empty file', '', err('is not one JSON document'))
F('e04-trailing-comma', 'a trailing comma', '[,]', err('is not one JSON document'))
F('e05-nan', 'NaN is not JSON', '[NaN]', err('is not one JSON document'))
F('e06-bom', 'a byte order mark', '﻿[]', err('is not one JSON document'))
F('e07-not-utf8', 'bytes that are not UTF-8', {'hex': '5b22ff225d'}, err('is not one JSON document'))
F('e08-object', 'an object', '{}', err('is not a list'))
F('e09-string', 'a string', '"x"', err('is not a list'))
F('e10-null', 'null', 'null', err('is not a list'))
F('e11-number', 'a number', '1', err('is not a list'))
F('e12-mixed', 'reviews and pages together', dump([[], a]), err('mixes reviews and pages'))
F('e13-mixed-2', 'the other way round', dump([a, []]), err('mixes reviews and pages'))
F('e14-list-in-page', 'a list inside a page', '[[[]]]', err('entry 1: is not an object'))
F('e15-number-entry', 'an entry that is a number', '[1]', err('entry 1: is not an object'))
F('e16-null-entry', 'an entry that is null', '[null]', err('entry 1: is not an object'))
F('e17-string-entry', 'an entry that is a string', '["a"]', err('entry 1: is not an object'))
F('e18-second-entry', 'the entries are counted from 1', dump([a, 5]), err('entry 2: is not an object'))
F('e19-counted-across-pages', 'and across pages', dump([[a], [b, 7]]), err('entry 3: is not an object'))
F('e20-no-id', 'no id', dump([{k: v for k, v in a.items() if k != 'id'}]), err('entry 1: id is not a positive integer'))
for i, (value, label) in enumerate([('"1"', 'a string'), ('0', 'zero'), ('-1', 'a negative number'), ('1.5', 'a fraction'), ('true', 'a boolean'), ('null', 'null'), ('9007199254740992', 'more than a double holds exactly'), ('1e400', 'a number too large for a double'), ('[1]', 'a list')]):
    F('e21%s-id-%s' % ('abcdefghi'[i], label.replace(' ', '-')), 'id is %s' % label, '[{"id": %s, "user": null, "state": "COMMENTED", "commit_id": null, "submitted_at": "%s"}]' % (value, T1), err('entry 1: id is not a positive integer'))
USER = 'user is neither null nor an object with a positive integer id'
for i, (value, label) in enumerate([('"x"', 'a string'), ('1', 'a number'), ('{}', 'an object without an id'), ('{"id": 0}', 'an object with id 0'), ('{"id": "1"}', 'an object with a string id'), ('{"id": 1.5}', 'an object with a fraction as id'), ('[]', 'a list'), ('true', 'true')]):
    F('e22%s-user-%s' % ('abcdefgh'[i], label.replace(' ', '-')), 'user is %s' % label, '[{"id": 1, "user": %s, "state": "COMMENTED", "commit_id": null, "submitted_at": "%s"}]' % (value, T1), err('entry 1: ' + USER))
F('e23-no-user-key', 'no user key: it is not null either', dump([{k: v for k, v in a.items() if k != 'user'}]), read({**a, 'user': None}))
F('e24-state-number', 'state is a number', dump([{**a, 'state': 1}]), err('entry 1: state is not text'))
F('e25-state-null', 'state is null', dump([{**a, 'state': None}]), err('entry 1: state is not text'))
F('e26-no-state', 'no state', dump([{k: v for k, v in a.items() if k != 'state'}]), err('entry 1: state is not text'))
F('e27-commit-number', 'commit_id is a number', dump([{**a, 'commit_id': 5}]), err('entry 1: commit_id is neither null nor text'))
F('e28-commit-list', 'commit_id is a list', dump([{**a, 'commit_id': []}]), err('entry 1: commit_id is neither null nor text'))
TIMEMSG = 'submitted_at is not a time like 2026-11-06T12:00:00Z'
for i, (value, label) in enumerate([('"2026-11-06 12:00:00"', 'a space for the T'), ('"2026-11-06T12:00:00+00:00"', 'an offset'), ('"2026-13-06T12:00:00Z"', 'month 13'), ('"2026-00-06T12:00:00Z"', 'month 0'), ('"2026-11-32T12:00:00Z"', 'day 32'), ('"2026-11-00T12:00:00Z"', 'day 0'), ('"2026-11-06T24:00:00Z"', 'hour 24'), ('"2026-11-06T12:60:00Z"', 'minute 60'), ('"2026-11-06T12:00:60Z"', 'second 60'), ('"2026-11-06T12:00:00z"', 'a lowercase z'), ('"2026-11-06T12:00:00.000Z"', 'fractions of a second'), ('"2026-11-06T12:00:00"', 'no Z'), ('"26-11-06T12:00:00Z"', 'a two-digit year'), ('"2026-11-06T12:00:00Z "', 'a space after'), ('" 2026-11-06T12:00:00Z"', 'a space before'), ('1', 'a number'), ('null', 'null'), ('""', 'an empty string')]):
    F('e29%s-time-%s' % ('abcdefghijklmnopqr'[i], label.replace(' ', '-')), 'submitted_at has %s' % label, '[{"id": 1, "user": null, "state": "APPROVED", "commit_id": null, "submitted_at": %s}]' % value, err('entry 1: ' + TIMEMSG))
F('e30-comment-without-time', 'a comment without a time is refused: only a pending review has none', dump([{**a, 'state': 'COMMENTED', 'submitted_at': None}]), err('entry 1: ' + TIMEMSG))
F('e31-pending-with-bad-time', 'the time of a pending review is not looked at: text is kept as it is', dump([{**f_pending, 'submitted_at': 'later'}]), {'reviews': [{'id': 15, 'user': 1001, 'state': 'PENDING', 'commit': HEAD, 'at': 'later'}]})
F('e31b-pending-with-number-time', 'and what is not text is read as no time', dump([{**f_pending, 'submitted_at': 5}]), {'reviews': [{'id': 15, 'user': 1001, 'state': 'PENDING', 'commit': HEAD, 'at': None}]})
F('e32-first-problem-only', 'only the first problem of an entry is reported', '[{"id": 0, "state": 1}]', err('entry 1: id is not a positive integer'))
F('e33-order-of-checks', 'id, user, state, commit_id, time: in that order', '[{"id": 1, "user": 1, "state": 1}]', err('entry 1: ' + USER))
F('e34-order-of-checks-2', 'state before commit_id', '[{"id": 1, "user": null, "state": 1, "commit_id": 1}]', err('entry 1: state is not text'))
F('e35-order-of-checks-3', 'commit_id before the time', '[{"id": 1, "user": null, "state": "APPROVED", "commit_id": 1}]', err('entry 1: commit_id is neither null nor text'))
F('e36-large-then-bad', 'a bad entry after good ones', dump([a, a, a, {'id': 'x'}]), err('entry 4: id is not a positive integer'))


# ---------------------------------------------------------------- the bar for an amendment (docs/amendments.md)
bars = []
NOW = '2026-11-20T00:00:00Z'
D0 = '2026-11-01T00:00:00Z'      # since


def B(id, note, owners, reviews, expect, author=7, since=D0, now=NOW, waived=False, head=HEAD):
    bars.append({'id': id, 'note': note, 'owners': [{'login': l, 'id': i} for l, i in owners], 'head': head, 'author': author, 'reviews': reviews, 'since': since, 'now': now, 'waived': waived, 'expect': expect})


MET = {'met': True}
B('b01-no-owners', 'nobody can approve', [], [], {'met': False, 'reason': 'no owners'})
B('b02-no-owners-waived', 'a waiver does not help without owners', [], [], {'met': False, 'reason': 'no owners'}, waived=True)
B('b03-one-of-two', 'one owner approved, the other did not', [ALICE, BOB], [R(1001, 'APPROVED', '2026-11-10T00:00:00Z')], {'met': False, 'reason': '1 of 2 owners'})
B('b04-none-of-two', 'no owner approved', [ALICE, BOB], [], {'met': False, 'reason': '0 of 2 owners'})
B('b05-both-after-eight-days', 'both approved eight days after the head was first seen', [ALICE, BOB], [R(1001, 'APPROVED', '2026-11-09T00:00:00Z'), R(1002, 'APPROVED', '2026-11-09T00:00:00Z')], MET)
B('b06-exactly-seven-days', 'the last approval comes exactly seven days after since', [ALICE, BOB], [R(1001, 'APPROVED', '2026-11-08T00:00:00Z'), R(1002, 'APPROVED', '2026-11-08T00:00:00Z')], MET)
B('b07-one-second-short', 'one second short of seven days', [ALICE, BOB], [R(1001, 'APPROVED', '2026-11-07T23:59:59Z'), R(1002, 'APPROVED', '2026-11-07T23:59:59Z')], {'met': False, 'reason': '167h of 168h'})
B('b08-last-approval-counts', 'the first approval is old enough and the last is not', [ALICE, BOB], [R(1001, 'APPROVED', '2026-11-15T00:00:00Z'), R(1002, 'APPROVED', '2026-11-03T05:00:00Z')], MET)
B('b09-last-approval-too-early', 'both approvals came three days after since', [ALICE, BOB], [R(1001, 'APPROVED', '2026-11-04T00:00:00Z'), R(1002, 'APPROVED', '2026-11-04T10:00:00Z')], {'met': False, 'reason': '82h of 168h'})
B('b10-later-comment-does-not-move-it', 'a comment after the approval is no approval', [ALICE], [R(1001, 'APPROVED', '2026-11-03T00:00:00Z'), R(1001, 'COMMENTED', '2026-11-19T00:00:00Z')], {'met': False, 'reason': '48h of 168h'})
B('b11-reapproval-after-the-wait', 'an owner approves again after the wait: the latest approval is the time', [ALICE], [R(1001, 'APPROVED', '2026-11-02T00:00:00Z'), R(1001, 'APPROVED', '2026-11-12T00:00:00Z')], MET)
B('b12-author-and-an-approval', 'the author counts without a time; the other owner approved after the wait', [ALICE, BOB], [R(1002, 'APPROVED', '2026-11-12T00:00:00Z')], MET, author=1001)
B('b13-author-and-an-early-approval', 'the author counts without a time; the other owner approved too early', [ALICE, BOB], [R(1002, 'APPROVED', '2026-11-02T00:00:00Z')], {'met': False, 'reason': '24h of 168h'}, author=1001)
B('b14-author-alone-uses-now', 'the only owner is the author: the time is now, nineteen days after since', [ALICE], [], MET, author=1001)
B('b15-author-alone-too-early', 'the only owner is the author and now is three days after since', [ALICE], [], {'met': False, 'reason': '72h of 168h'}, author=1001, now='2026-11-04T00:00:00Z')
B('b16-no-clock', 'no time is given for the head', [ALICE], [R(1001, 'APPROVED', '2026-11-19T00:00:00Z')], {'met': False, 'reason': 'no clock'}, since=None)
B('b17-waived', 'waived: every owner approved, no clock is asked', [ALICE, BOB], [R(1001, 'APPROVED', T1), R(1002, 'APPROVED', T1)], {'met': True, 'waived': True}, since=None, waived=True)
B('b18-waived-not-all', 'waived, but an owner did not approve', [ALICE, BOB], [R(1001, 'APPROVED', T1)], {'met': False, 'reason': '1 of 2 owners'}, since=None, waived=True)
B('b19-approval-before-since', 'an approval that came before since: negative time', [ALICE], [R(1001, 'APPROVED', '2026-10-30T00:00:00Z')], {'met': False, 'reason': '0h of 168h'})
B('b20-since-in-the-future', 'since after now, the author alone', [ALICE], [], {'met': False, 'reason': '0h of 168h'}, author=1001, since='2026-12-01T00:00:00Z')
B('b21-earlier-commit-is-not-approval', 'an approval of an earlier commit', [ALICE], [R(1001, 'APPROVED', '2026-11-15T00:00:00Z', OLD)], {'met': False, 'reason': '0 of 1 owners'})
B('b22-changes-requested-after', 'a request for changes after the approval', [ALICE, BOB], [R(1001, 'APPROVED', '2026-11-12T00:00:00Z'), R(1002, 'APPROVED', '2026-11-12T00:00:00Z'), R(1002, 'CHANGES_REQUESTED', '2026-11-13T00:00:00Z')], {'met': False, 'reason': '1 of 2 owners'})
B('b23-three-owners', 'three owners, all approved after the wait', [ALICE, BOB, CAROL], [R(1001, 'APPROVED', '2026-11-10T00:00:00Z'), R(1002, 'APPROVED', '2026-11-11T00:00:00Z'), R(1003, 'APPROVED', '2026-11-12T00:00:00Z')], MET)
B('b24-three-owners-in-any-order', 'three owners; the latest approval is the one that counts, whoever gave it', [ALICE, BOB, CAROL], [R(1001, 'APPROVED', '2026-11-10T00:00:00Z'), R(1002, 'APPROVED', '2026-11-11T00:00:00Z'), R(1003, 'APPROVED', '2026-11-05T12:00:00Z')], MET)
B('b25-hours-are-whole', 'the hours are whole: 100 hours and 59 minutes', [ALICE], [R(1001, 'APPROVED', '2026-11-05T04:59:00Z')], {'met': False, 'reason': '100h of 168h'})
B('b26-same-second', 'two approvals of one second', [ALICE], [R(1001, 'APPROVED', '2026-11-09T00:00:00Z'), R(1001, 'APPROVED', '2026-11-09T00:00:00Z')], MET)
B('b27-the-wait-across-a-leap-day', 'the wait is counted in seconds, across a leap day', [ALICE], [R(1001, 'APPROVED', '2028-03-04T00:00:00Z')], MET, since='2028-02-26T00:00:00Z', now='2028-03-10T00:00:00Z')
B('b29-pending-review-has-no-time', 'a pending review of an owner who approved has no time and is not an approval', [ALICE], [R(1001, 'APPROVED', '2026-11-03T00:00:00Z'), R(1001, 'PENDING', None)], {'met': False, 'reason': '48h of 168h'})
B('b28-not-an-owner-approves', 'the reviews of an account that is not an owner', [ALICE], [R(2000, 'APPROVED', '2026-11-15T00:00:00Z')], {'met': False, 'reason': '0 of 1 owners'})

# ---------------------------------------------------------------- check against the reference
failed = 0
for c in counts:
    got = ref.count([{'login': o['login'], 'id': o['id']} for o in c['owners']], c['approvals'], c['head'], c['author'], c['reviews'])
    if got != c['expect']:
        failed += 1
        print('DIFFERENT', c['id'], '\n  intended', c['expect'], '\n  reference', got)
for c in bars:
    got = ref.bar([{'login': o['login'], 'id': o['id']} for o in c['owners']], c['head'], c['author'], c['reviews'], None if c['since'] is None else ref.epoch(c['since']), ref.epoch(c['now']), c['waived'])
    if got != c['expect']:
        failed += 1
        print('DIFFERENT', c['id'], '\n  intended', c['expect'], '\n  reference', got)
for f in files:
    data = bytes.fromhex(f['text']['hex']) if isinstance(f['text'], dict) else f['text'].encode('utf-8')
    kind, got = ref.read_reviews(data)
    want = f['expect']
    ok = (kind == 'error' and want == {'error': got}) or (kind == 'ok' and want == {'reviews': got})
    if not ok:
        failed += 1
        print('DIFFERENT', f['id'], '\n  intended', want, '\n  reference', kind, got)
if failed:
    print(failed, 'cases differ'); sys.exit(1)
ids = [c['id'] for c in counts] + [c['id'] for c in bars] + [f['id'] for f in files]
assert len(ids) == len(set(ids)), 'ids repeat'
out = {'counts': counts, 'bars': bars, 'files': [{**f, **({'hex': f['text']['hex']} if isinstance(f['text'], dict) else {})} for f in files]}
for f in out['files']:
    if 'hex' in f: del f['text']
with open(sys.argv[1], 'w', encoding='utf-8') as fh:
    json.dump(out, fh, ensure_ascii=True, indent=1)
    fh.write('\n')
print(len(counts), 'count cases,', len(bars), 'bar cases,', len(files), 'file cases; the reference agrees with all of them')
