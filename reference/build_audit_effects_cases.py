"""Builds test/fixtures/audit-effects/cases.json: small histories (as for the audit), the evidence file and the issues file that go with them, and the plan
that `audit-plan` must print (docs/audit-effects.md). Each history is built here with git; the expected plan is written here by hand with the helpers
below, computed again with audit_effects_ref.py, and the generator stops when the two differ. A commit id is written @label@ everywhere; the ids are the
same in any build, because the commits are made with a fixed committer and time.
Usage: build_audit_effects_cases.py <out cases.json>"""
import copy, json, os, re, subprocess, sys, tempfile, shutil
sys.path.insert(0, os.path.dirname(__file__))
import audit_effects_ref as ref
import audit_lib as L
from audit_lib import D, name, rec, rput, put, drop, index, ROWS, with_status, g1, TREES

OUT = sys.argv[1]
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
CASES = []
W = TREES['world']
NOW = '2026-11-10T03:00:00Z'
SET, PIN, WF = '.github/record-keeper/settings.yml', '.github/record-keeper.yml', '.github/workflows/records-integrity.yml'
HEX0 = '1' * 40
HEAD, OLD = 'e' * 40, 'd' * 40
TEXT = {
    'A-01': 'was started or last run from a commit that is not in the history of the head',
    'A-02': 'is a record file under a number that another file name had before',
    'A-03': 'is an act that was not approved as the protocol asks',
    'P-01': 'was deleted, renamed or moved; a record is never removed',
    'P-02': 'is sealed and its text has changed',
    'P-06': 'says it is accepted and has no seal that verifies',
    'P-13': 'has an erratum that changes the sealed text and has not been open for 48 hours',
    'P-15': "has a workflow other than the kit's that names the check",
    'P-19': 'is accepted and has an applies-to item that no file matches',
    'S-05': 'has a key that is not a setting',
    'V-08': 'has record numbers that are not 0001, 0002, 0003 and so on without a gap',
    'V-32': 'has an index row for a record that does not exist',
}
INTRO = ('The audit of the default branch found this. It is updated on every run and closed when the violation no longer stands. '
         'To resolve it: revert the commit, add an erratum to the record, or add a note to its Known deviations that names the commit.')
RESOLVED = 'No violation of this kind stands. Closed by the audit.'


# ---- building histories (copied from build_audit_cases.py) -------------------------------------------------------------------------------
def commit(label, changes=(), message=None, parents=None):
    return {'id': label, 'changes': list(changes), 'message': message if message is not None else f'commit {label}', 'parents': parents}


def dump(tree): return [put(p, c) if isinstance(c, str) else {'symlink': p, 'target': c[1]} for p, c in tree.items()]


def apply_tree(before, changes):
    t = dict(before)
    for op in changes:
        if 'write' in op: t[op['write']] = (op.get('mode', '100644'), op['content'])
        elif 'remove' in op: t.pop(op['remove'], None)
        elif 'symlink' in op: t[op['symlink']] = ('120000', op['target'])
    for path in list(t):
        parts = path.split('/')
        for i in range(1, len(parts)): t.pop('/'.join(parts[:i]), None)
    return t


def fill(text, ids): return re.sub(r'@([a-z0-9]+)@', lambda m: ids[m.group(1)], text)


def stream(label, tree, message, parents):
    def data(b): return b'data %d\n' % len(b) + b + b'\n'
    s = b'commit refs/heads/' + label.encode() + b'\ncommitter T <t@example.com> 0 +0000\n' + data(message.encode())
    if parents: s += b'from refs/heads/' + parents[0].encode() + b'\n' + b''.join(b'merge refs/heads/' + q.encode() + b'\n' for q in parents[1:])
    s += b'deleteall\n'
    for path, (mode, content) in sorted(tree.items()):
        pb = path.encode()
        s += b'M ' + mode.encode() + b' inline ' + pb + b'\n' + data(content.encode())
    return s


def build(c, work):
    repo = os.path.join(work, c['id'] + '.git')
    subprocess.run(['git', 'init', '-q', '--bare', repo], check=True)
    trees, ids = {}, {}
    for index_, k in enumerate(c['commits']):
        k['parents'] = k['parents'] if k['parents'] is not None else ([c['commits'][index_ - 1]['id']] if index_ > 0 else [])
        before = trees[k['parents'][0]] if k['parents'] else {}
        k['changes'] = [{**op, **({'content': fill(op['content'], ids)} if 'content' in op else {})} for op in k['changes']]
        k['message'] = fill(k['message'], ids)
        trees[k['id']] = apply_tree(before, k['changes'])
        subprocess.run(['git', '-C', repo, 'fast-import', '--quiet'], input=stream(k['id'], trees[k['id']], k['message'], k['parents']), check=True, env=env)
        ids[k['id']] = subprocess.run(['git', '-C', repo, 'rev-parse', k['id']], capture_output=True, text=True, check=True, env=env).stdout.strip()
    return repo, ids


def labels(value, ids):
    """The value with every commit id of the history written @label@."""
    back = {v: k for k, v in ids.items()}
    text = re.sub(r'\b[0-9a-f]{40}\b', lambda m: '@%s@' % back[m.group(0)] if m.group(0) in back else m.group(0), json.dumps(value))
    return json.loads(text)


# ---- the expected plan, written with the words of the page ------------------------------------------------------------------------------
def mark(key): return f'<!-- record-keeper:incident {key} -->'
def vline(place, where, rule, detail=''): return f'- {place}: {where}: [{rule}] {TEXT[rule]}' + (f' ({detail})' if detail else '') + '\n'
def body(key, *lines): return mark(key) + '\n' + INTRO + '\n\n' + ''.join(lines)
def label_of(key):
    subject = key.split(':')[0]
    return 'the repository' if subject == '-' else 'other files' if subject == 'other' else subject
def title(key): return f'Records: {label_of(key)}: [{key.split(":")[1]}] {TEXT[key.split(":")[1]]}'
def lv(commit, kind, file, rule, detail=''): return dict(commit=commit, kind=kind, file=file, rule=rule, detail=detail)
def line_of(violation, folder=D, head=None):
    """The line of a violation of the plan: place, where, rule and detail, as the page says."""
    place = 'the history' if violation['kind'] == 'history' else f'the tip {head}' if violation['kind'] == 'state' else violation['commit']
    where = folder if violation['file'] is None else f"{folder}/{violation['file']}"
    if violation['rule'].startswith('S-'): where = SET + (f":{violation['line']}" if violation.get('line') else '')
    return vline(place, where, violation['rule'], violation['detail'].replace('\u202e', '\\u{202e}'))
def key_of(v):
    f = v['file']
    return '%s:%s' % ('-' if f is None else f[:4] if re.match(r'^[0-9]{4}-', f) else 'other', v['rule'])


def OPEN(violations, head=None, key=None, lines=None):
    key = key or key_of(violations[0])
    b = body(key, *(lines if lines is not None else [line_of(v, head=head) for v in violations]))
    return ({'action': 'open', 'key': key, 'title': title(key), 'body': b}, {'at': NOW, 'event': 'opened', 'key': key, 'violations': [{k: v for k, v in x.items() if k != 'line'} for x in violations]})
def WITH_NUMBER(action, event, number, violations, head=None, key=None):
    key = key or key_of(violations[0])
    b = body(key, *[line_of(v, head=head) for v in violations])
    return ({'action': action, 'key': key, 'number': number, 'title': title(key), 'body': b}, {'at': NOW, 'event': event, 'key': key, 'violations': violations})
def REOPEN(number, violations, **kw): return WITH_NUMBER('reopen', 'reopened', number, violations, **kw)
def UPDATE(number, violations, **kw): return WITH_NUMBER('update', 'changed', number, violations, **kw)
def CLOSE(key, number, duplicate=None):
    text = (f'Duplicate of #{duplicate}.' if duplicate else RESOLVED)
    log = {'at': NOW, 'event': 'closed', 'key': key, **({'duplicate': duplicate} if duplicate else {}), 'violations': []}
    return ({'action': 'close', 'key': key, 'number': number, 'body': mark(key) + '\n' + text + '\n'}, log)


def PLAN(head, frm, judged, violations, acts=(), excused=0):
    return {'run': {'at': NOW, 'head': head, 'from': frm, 'judged': judged, 'violations': violations, 'excused': excused}, 'failed': violations != 0,
            'issues': [a[0] for a in acts], 'log': [a[1] for a in acts]}


def issue(number, key, state='open', text=None, ttl=None, login='github-actions[bot]', kind='Bot', violations=None, head=None):
    """An issue of the repository as GitHub returns it; by default the very issue the audit would write for the violations."""
    if text is None:
        text = body(key, *[line_of(v, head=head) for v in violations]) if violations is not None else mark(key) + '\n' + 'old text\n'
    return {'number': number, 'state': state, 'title': title(key) if ttl is None else ttl, 'body': text, 'user': None if login is None else {'login': login, 'type': kind}}


# ---- evidence ---------------------------------------------------------------------------------------------------------------------
def rv(uid, state='APPROVED', at='2026-11-09T10:00:00Z', commit_id=HEAD, rid=None):
    return {'id': rid or uid * 100 + len(state), 'user': {'id': uid}, 'state': state, 'commit_id': commit_id, 'submitted_at': at}
def entry(number=7, author=1001, merged='2026-11-09T12:00:00Z', started='2026-11-09T09:00:00Z', reviews=(), head=HEAD):
    return {'pull': {'number': number, 'user': None if author is None else {'id': author}, 'head': {'sha': head}, 'merged_at': merged}, 'started': started, 'reviews': list(reviews)}
NOPULL = {'pull': None, 'started': None, 'reviews': []}


def case(cid, note, commits, *, head=None, frm=None, adopted=False, since=None, evidence=None, evidence_raw=None, evidence_hex=None, issues=None, issues_raw=None,
         now=NOW, plan=None, error=None):
    """error: ('evidence' | 'issues', reason), or ('message', text)."""
    CASES.append(dict(id=cid, note=note, commits=commits, head=head, frm=frm, adopted=adopted, since=since, evidence=evidence, evidence_raw=evidence_raw, evidence_hex=evidence_hex,
                      issues=issues, issues_raw=issues_raw, now=now, plan=plan, error=error))


# ---- trees and changes ------------------------------------------------------------------------------------------------------------------
def owned(approvals=1, owners='[alice/1001, bob/1002]', extra=None):
    return {**W, SET: f'owners: {owners}\napprovals: {approvals}\n', PIN: 'version: 1\n', **(extra or {})}
ROOT = lambda tree=None: commit('c0', dump(tree if tree is not None else owned()))
PINCHG = put(PIN, 'version: 2\n')
PULL7 = 'Merge pull request #7 from a/b'
TAMPER = rput(2, rec(2, 'accepted', True).replace('- Rule 2.', '- Rule 2, changed.'))
TAMPER2 = rput(2, rec(2, 'accepted', True).replace('- Rule 2.', '- Rule 2, changed twice.'))
EDIT4 = rput(4, rec(4, 'rejected', consequences='- Edited.'))
DEL3 = [drop(f'{D}/{name(3)}'), index([r for r in ROWS if r[0] != 3])]
TWO = f'{D}/{name(2)}'
SIMPLE = [ROOT(), commit('c1', [PINCHG], message=PULL7)]
PINDETAIL = lambda have='0', need='1': f'pin {PIN}: {have} of {need} approvals'
PINV = lambda detail: lv('@c1@', 'commit', None, 'A-03', detail)


def single(detail, judged=1):
    return PLAN('@c1@', '@c0@', judged, 1, [OPEN([PINV(detail)])])


def sim(cid, note, ev, plan, tree=None, **kw):
    case(cid, note, [ROOT(tree)] + [SIMPLE[1]], frm='c0', evidence={'@c1@': ev}, plan=plan, **kw)


# ---- group a: where the audit starts ------------------------------------------------------------------------------------------------------
SETTXT = 'owners: [alice/1001]\n'
A_HIST = lambda: [commit('c0', dump(W)), commit('c1', DEL3), commit('c2', [put(SET, SETTXT)]), commit('c3', [EDIT4])]
case('a01-adopted-starts-at-the-settings', 'Record 3 is deleted before the settings file exists. With --adopted the audit starts at the commit that adds the file: only the last commit is judged.',
     A_HIST(), adopted=True, plan=PLAN('@c3@', '@c2@', 1, 0))
V_DEL = [lv('@c1@', 'commit', None, 'V-08'), lv('@c1@', 'commit', '0003-third.md', 'P-01')]
case('a02-from-the-first-commit-judges-the-same-history', 'The same history from its first commit: the deletion is judged, one issue for the gap in the numbers and one for the record.',
     A_HIST(), frm='c0', plan=PLAN('@c3@', '@c0@', 3, 2, [OPEN([V_DEL[0]]), OPEN([V_DEL[1]])]))
case('a03-no-commit-holds-the-settings', 'A history in which the settings file never exists is not an adopted repository.', [commit('c0', dump(W)), commit('c1', [EDIT4])], adopted=True,
     error=('message', 'no commit of the history holds .github/record-keeper/settings.yml'))
case('a04-the-settings-are-in-the-first-commit', 'The first commit holds the file: it is the start, and it is not judged.', [ROOT(), commit('c1', [EDIT4])], adopted=True, plan=PLAN('@c1@', '@c0@', 1, 0))
case('a05-a-link-is-not-the-file', 'The file is first a symbolic link and then a file: the start is the commit where it is a file.',
     [commit('c0', dump(W)), commit('c1', [{'symlink': SET, 'target': 'elsewhere'}]), commit('c2', [put(SET, SETTXT)]), commit('c3', [EDIT4])], adopted=True, plan=PLAN('@c3@', '@c2@', 1, 0))
case('a06-deleted-and-added-again', 'The file is added, deleted and added again: the start is the first time.',
     [commit('c0', dump(W)), commit('c1', [put(SET, SETTXT)]), commit('c2', [drop(SET)]), commit('c3', [put(SET, SETTXT)]), commit('c4', [EDIT4])], adopted=True, plan=PLAN('@c4@', '@c1@', 3, 0))

# ---- group b: acts against the evidence -----------------------------------------------------------------------------------------------------
sim('b01-the-author-is-an-owner', 'The author is an owner: the author counts, so one approval of one is met.', entry(author=1001), PLAN('@c1@', '@c0@', 1, 0))
sim('b02-no-owner-approved', 'The author is nobody the settings name and nobody reviewed.', entry(author=9999), single(PINDETAIL()))
sim('b03-an-owner-approved-the-head', 'An owner approved the head commit of the pull request, before the merge.', entry(author=9999, reviews=[rv(1002)]), PLAN('@c1@', '@c0@', 1, 0))
sim('b04-approved-an-earlier-head', 'The approval names another commit than the head of the pull request.', entry(author=9999, reviews=[rv(1002, commit_id=OLD)]), single(PINDETAIL()))
sim('b05-approved-after-the-merge', 'The approval came one second after the merge: it does not count.', entry(author=9999, reviews=[rv(1002, at='2026-11-09T12:00:01Z')]), single(PINDETAIL()))
sim('b06-approved-at-the-second-of-the-merge', 'The approval came in the second of the merge: it counts.', entry(author=9999, reviews=[rv(1002, at='2026-11-09T12:00:00Z')]), PLAN('@c1@', '@c0@', 1, 0))
sim('b07-changes-requested-later', 'An owner approved and then asked for changes before the merge.', entry(author=9999, reviews=[rv(1002, at='2026-11-09T10:00:00Z'), rv(1002, 'CHANGES_REQUESTED', at='2026-11-09T11:00:00Z')]), single(PINDETAIL()))
sim('b08-changes-requested-after-the-merge', 'The request for changes came after the merge: it is left out, and the approval stands.',
    entry(author=9999, reviews=[rv(1002, at='2026-11-09T10:00:00Z'), rv(1002, 'CHANGES_REQUESTED', at='2026-11-09T13:00:00Z')]), PLAN('@c1@', '@c0@', 1, 0))
sim('b09-no-pull-request', 'The act reached the branch some other way: no pull request contains the commit.', NOPULL, single(f'pin {PIN}: no pull request'))
sim('b10-two-approvals-needed', 'Two approvals are needed and one owner gave one.', entry(author=9999, reviews=[rv(1002)]), single(PINDETAIL('1', '2')), tree=owned(approvals=2))
sim('b11-the-author-was-deleted', 'The account of the author is gone (user is null): nobody counts as the author.', entry(author=None), single(PINDETAIL()))
case('b12-two-acts-one-issue', 'A change of the pin and of the workflow, both unapproved: two violations of one key, so one issue with two lines.',
     [ROOT(), commit('c1', [PINCHG, put(WF, 'name: Records integrity\n')], message=PULL7)], frm='c0', evidence={'@c1@': entry(author=9999)},
     plan=PLAN('@c1@', '@c0@', 1, 2, [OPEN([PINV(PINDETAIL()), lv('@c1@', 'commit', None, 'A-03', f'workflow {WF}: 0 of 1 approvals')])]))

OWN3 = put(SET, 'owners: [alice/1001, bob/1002, carol/1003]\napprovals: 1\n')
def owners_case(cid, note, ev, plan):
    case(cid, note, [ROOT(), commit('c1', [OWN3], message=PULL7)], frm='c0', evidence={'@c1@': ev}, plan=plan)
BOB_LATE = [rv(1002, at='2026-11-09T11:00:00Z')]
OWNV = lambda reason: PLAN('@c1@', '@c0@', 1, 1, [OPEN([lv('@c1@', 'commit', None, 'A-03', f'owners {SET}: {reason}')])])
owners_case('b13-new-owner-all-approved-and-waited', 'A third owner is added: every owner of the base approved, and the last approval came more than seven days after the check started.',
            entry(author=1001, started='2026-11-01T00:00:00Z', reviews=BOB_LATE), PLAN('@c1@', '@c0@', 1, 0))
owners_case('b14-new-owner-exactly-seven-days', 'Exactly 168 hours between the start and the last approval.', entry(author=1001, started='2026-11-02T11:00:00Z', reviews=BOB_LATE), PLAN('@c1@', '@c0@', 1, 0))
owners_case('b15-new-owner-one-second-short', 'One second short of seven days: 167 whole hours.', entry(author=1001, started='2026-11-02T11:00:01Z', reviews=BOB_LATE), OWNV('167h of 168h'))
owners_case('b16-new-owner-too-soon', 'The owners approved two hours after the check started.', entry(author=1001, started='2026-11-09T09:00:00Z', reviews=BOB_LATE), OWNV('2h of 168h'))
owners_case('b17-new-owner-no-clock', 'The check never ran on the head: there is no start.', entry(author=1001, started=None, reviews=BOB_LATE), OWNV('no clock'))
owners_case('b18-new-owner-one-owner-missing', 'Only the author of the two owners counts.', entry(author=1001, started='2026-11-01T00:00:00Z'), OWNV('1 of 2 owners'))
case('b19-no-owners-no-bar', 'The settings of the base name nobody: the settings act is met by nobody either.', [ROOT(owned(approvals=1, owners='[]')), commit('c1', [OWN3], message=PULL7)], frm='c0',
     evidence={'@c1@': entry(author=1001, started='2026-11-01T00:00:00Z')},
     plan=PLAN('@c1@', '@c0@', 1, 2, [OPEN([lv('@c1@', 'commit', None, 'A-03', f'owners {SET}: no owners'), lv('@c1@', 'commit', None, 'A-03', f'settings {SET}: 0 of 1 approvals')])]))

def H(lines): return 'sha256:' + __import__('hashlib').sha256(('\n'.join(lines) + '\n').encode()).hexdigest()
def sl(n, status='accepted', **kw): return g1.seal_g1(rec(n, status, **kw).encode())
def ent(n, prev_hash, prev_seal, seal, reason='Fixed a typo.', date='2026-11-08'):
    return [f'### Erratum {n}', '', f'- date: {date}', f'- previous entry: {prev_hash}', f'- previous seal: {prev_seal}', f'- seal: {seal}', f'- reason: {reason}']
def dev(n, cite, reason='A one-off.', date='2026-11-08'): return [f'### Deviation {n}', '', f'- date: {date}', f'- case: {cite}', f'- reason: {reason}']
def txt(entries): return '\n\n'.join('\n'.join(e) for e in entries)
C1 = '- Effect 2, corrected.'
E1 = ent(1, 'none', sl(2), sl(2, consequences=C1))
ERRATUM = rput(2, rec(2, 'accepted', sl(2, consequences=C1), consequences=C1, errata=txt([E1])))
def erratum_case(cid, note, started, plan):
    case(cid, note, [ROOT(), commit('c1', [ERRATUM], message=PULL7)], frm='c0', evidence={'@c1@': entry(author=1001, started=started)}, plan=plan)
P13 = lambda detail: PLAN('@c1@', '@c0@', 1, 1, [OPEN([lv('@c1@', 'commit', name(2), 'P-13', detail)])])
erratum_case('b20-erratum-too-soon', 'An erratum that changes the seal, merged one hour after the check started: the 48 hours of the pull request check are judged again.', '2026-11-09T11:00:00Z', P13('1h of 48h'))
erratum_case('b21-erratum-exactly-48-hours', 'Exactly 48 hours is enough.', '2026-11-07T12:00:00Z', PLAN('@c1@', '@c0@', 1, 0))
erratum_case('b22-erratum-one-second-short', 'One second short of 48 hours: 47 whole hours.', '2026-11-07T12:00:01Z', P13('47h of 48h'))
erratum_case('b23-erratum-without-a-start', 'The check never ran on the head: no clock.', None, P13('no clock'))

def readme_gens(rows, gens):
    out = ['# Decision records', '', 'Some words about the records.', '', '## Generations', '', '| Generation | Record | Status |', '| - | - | - |']
    out += [f'| {g} | [{n:04d}]({name(n)}) | {status} |' for g, n, status in gens]
    out += ['', '## Index', '', '| # | Title | Status |', '| - | - | - |']
    out += [f'| {n:04d} | [{L.title(n)}]({name(n)}) | {status} |' for n, status in rows]
    return '\n'.join(out) + '\n'
GENS = [('g1', 1, 'accepted')]
AROWS = [(1, 'superseded by 0007'), (2, 'accepted'), (3, 'proposed'), (4, 'rejected'), (5, 'superseded by 0006'), (6, 'accepted'), (7, 'accepted')]
PROTO = owned(extra={f'{D}/README.md': readme_gens(ROWS, GENS)})
def amend(**kw): return [rput(1, with_status(1, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[1], **kw)), put(f'{D}/README.md', readme_gens(AROWS, GENS))]
AMEND7 = f'{D}/{name(7)}'
def amend_case(cid, note, ev, plan, **kw):
    case(cid, note, [ROOT(PROTO), commit('c1', amend(**kw), message=PULL7)], frm='c0', evidence={'@c1@': ev}, plan=plan)
amend_case('b24-amendment-approved-and-waited', 'A record that replaces the protocol record: every owner approved, eight days after the start.', entry(author=1001, started='2026-11-01T00:00:00Z', reviews=BOB_LATE), PLAN('@c1@', '@c0@', 1, 0))
amend_case('b25-amendment-too-soon', 'The same, two days after the start: an act of a record, so the issue is that of record 7.', entry(author=1001, started='2026-11-09T09:00:00Z', reviews=BOB_LATE),
           PLAN('@c1@', '@c0@', 1, 1, [OPEN([lv('@c1@', 'commit', name(7), 'A-03', f'amendment {AMEND7}: 2h of 168h')])]))
amend_case('b26-amendment-waived', 'With the reason in emergency the seven days are waived, and a missing start does not matter; the owners must all approve.', entry(author=1001, started=None, reviews=BOB_LATE),
           PLAN('@c1@', '@c0@', 1, 0), keys='emergency: The hash function is broken.')
amend_case('b27-amendment-waived-one-owner-missing', 'Waived, but only the author of the two owners approved.', entry(author=1001, started=None),
           PLAN('@c1@', '@c0@', 1, 1, [OPEN([lv('@c1@', 'commit', name(7), 'A-03', f'amendment {AMEND7}: 1 of 2 owners')])]), keys='emergency: The hash function is broken.')

def amend_table(**kw): return amend(**kw)[:2] + [put(f'{D}/README.md', readme_gens(AROWS, GENS + [('g2', 7, 'accepted')]))]
case('b27a-the-waiver-is-for-one-act', 'The record that replaces the protocol record has the reason in emergency and the table of generations changes too: the first act is waived and the second is not, and without a start it has no clock. The reason is that of its own act, and the table is not a record, so the issue is that of no record.',
     [ROOT(PROTO), commit('c1', amend_table(keys='emergency: The hash function is broken.'), message=PULL7)], frm='c0', evidence={'@c1@': entry(author=1001, started=None, reviews=BOB_LATE)},
     plan=PLAN('@c1@', '@c0@', 1, 1, [OPEN([lv('@c1@', 'commit', None, 'A-03', f'amendment {D}/README.md: no clock')])]))

ACC7 = [rput(7, rec(7, 'accepted', True)), index(ROWS + [(7, 'accepted')])]
NOTE7 = rput(7, rec(7, 'accepted', True, deviations=txt([dev(1, 'commit @c1@')])))
ACC7_V = lv('@c1@', 'commit', name(7), 'A-03', f'accept {D}/{name(7)}: no pull request')
case('b28-an-acceptance-with-no-pull-request', 'A record is accepted by a push: the issue is that of the record.', [ROOT(), commit('c1', ACC7)], frm='c0', evidence={'@c1@': NOPULL},
     plan=PLAN('@c1@', '@c0@', 1, 1, [OPEN([ACC7_V])]))
case('b29-a-note-excuses-the-violation', 'The record gets a note that names the commit; the note itself is an act, approved by its author. The violation is excused and no issue is opened.',
     [ROOT(), commit('c1', ACC7), commit('c2', [NOTE7], message=PULL7)], frm='c0', evidence={'@c1@': NOPULL, '@c2@': entry(author=1001)},
     plan=PLAN('@c2@', '@c0@', 2, 0, excused=1))
case('b30-the-note-is-not-approved-either', 'The same, and the commit that adds the note was pushed too: the first violation is excused, the second is not.',
     [ROOT(), commit('c1', ACC7), commit('c2', [NOTE7])], frm='c0', evidence={'@c1@': NOPULL, '@c2@': NOPULL},
     plan=PLAN('@c2@', '@c0@', 2, 1, [OPEN([lv('@c2@', 'commit', name(7), 'A-03', f'deviation {D}/{name(7)}: no pull request')])], excused=1))
case('b31-evidence-for-a-commit-without-an-act-is-ignored', 'An entry for a commit that carries no act is not read for anything.', [ROOT(), commit('c1', [EDIT4])], frm='c0',
     evidence={'@c1@': entry(author=9999), '@c0@': NOPULL}, plan=PLAN('@c1@', '@c0@', 1, 0))
case('b32-no-act-no-evidence', 'An empty evidence file is enough when no commit carries an act.', [ROOT(), commit('c1', [EDIT4])], frm='c0', evidence={}, plan=PLAN('@c1@', '@c0@', 1, 0))
case('b33-an-entry-is-missing', 'A commit carries an act and the evidence has no entry for it: an error, not a violation.', SIMPLE, frm='c0', evidence={},
     error=('message', 'no evidence for the commit @c1@'))
case('b34-without-evidence-the-acts-are-not-judged', 'No evidence file: the audit lists the acts and judges nothing about them, as before.', SIMPLE, frm='c0', plan=PLAN('@c1@', '@c0@', 1, 0))

# ---- group c: an evidence file that does not fit --------------------------------------------------------------------------------------------
def bad(cid, note, reason, **kw):
    case(cid, note, SIMPLE, frm='c0', error=('evidence', reason), **kw)
GOOD = lambda **over: {'@c1@': {**entry(), **over}}
bad('c01-not-json', 'Not one JSON document.', 'is not one JSON document', evidence_raw='{')
bad('c02-not-utf-8', 'Not UTF-8.', 'is not one JSON document', evidence_hex='ff7b7d')
bad('c03-a-list', 'The document is a list.', 'is not an object', evidence_raw='[]')
bad('c04-null', 'The document is null.', 'is not an object', evidence_raw='null')
bad('c05-short-key', 'A key that is not a commit id.', 'abc: is not a full commit id', evidence={'abc': entry()})
bad('c06-upper-case-key', 'A commit id in upper case.', 'ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD: is not a full commit id', evidence={'ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD': entry()})
bad('c07-control-in-key', 'A key with a control character is shown escaped.', 'a\\u{a}b: is not a full commit id', evidence={'a\nb': entry()})
bad('c08-value-not-an-object', 'A value that is a number.', '@c1@: is not an object with the keys pull, reviews and started', evidence={'@c1@': 1})
bad('c09-key-missing', 'No started.', '@c1@: is not an object with the keys pull, reviews and started', evidence={'@c1@': {'pull': None, 'reviews': []}})
bad('c10-key-extra', 'A fourth key.', '@c1@: is not an object with the keys pull, reviews and started', evidence=GOOD(extra=1))
bad('c11-pull-not-an-object', 'pull is a number.', '@c1@: pull: is not null or an object', evidence=GOOD(pull=5))
bad('c12-number-zero', 'The number is 0.', '@c1@: pull: number is not a positive integer', evidence={'@c1@': {**entry(), 'pull': {**entry()['pull'], 'number': 0}}})
bad('c13-number-text', 'The number is text.', '@c1@: pull: number is not a positive integer', evidence={'@c1@': {**entry(), 'pull': {**entry()['pull'], 'number': '7'}}})
bad('c14-number-fraction', 'The number is not whole.', '@c1@: pull: number is not a positive integer', evidence={'@c1@': {**entry(), 'pull': {**entry()['pull'], 'number': 1.5}}})
bad('c15-user-text', 'user is text.', '@c1@: pull: user is neither null nor an object with a positive integer id', evidence={'@c1@': {**entry(), 'pull': {**entry()['pull'], 'user': 'alice'}}})
bad('c16-user-id-zero', 'The id of the user is 0.', '@c1@: pull: user is neither null nor an object with a positive integer id', evidence={'@c1@': {**entry(), 'pull': {**entry()['pull'], 'user': {'id': 0}}}})
bad('c17-head-missing', 'No head.', '@c1@: pull: head.sha is not a full commit id', evidence={'@c1@': {**entry(), 'pull': {k: v for k, v in entry()['pull'].items() if k != 'head'}}})
bad('c18-head-short', 'A short sha.', '@c1@: pull: head.sha is not a full commit id', evidence={'@c1@': {**entry(), 'pull': {**entry()['pull'], 'head': {'sha': 'abc123'}}}})
bad('c19-merged-at-missing', 'Not merged: no time.', '@c1@: pull: merged_at is not a time like 2026-11-07T12:00:00Z', evidence={'@c1@': {**entry(), 'pull': {**entry()['pull'], 'merged_at': None}}})
bad('c20-merged-at-not-a-day', 'A day that does not exist.', '@c1@: pull: merged_at is not a time like 2026-11-07T12:00:00Z', evidence={'@c1@': {**entry(), 'pull': {**entry()['pull'], 'merged_at': '2026-02-30T00:00:00Z'}}})
bad('c21-started-text', 'started is not a time.', '@c1@: started: is neither null nor a time like 2026-11-07T12:00:00Z', evidence=GOOD(started='yesterday'))
bad('c22-started-with-offset', 'A time with an offset instead of Z.', '@c1@: started: is neither null nor a time like 2026-11-07T12:00:00Z', evidence=GOOD(started='2026-11-09T09:00:00+00:00'))
bad('c23-reviews-not-a-list', 'reviews is an object.', '@c1@: reviews: is not a list', evidence=GOOD(reviews={}))
bad('c24-a-review-does-not-fit', 'A review without a state.', '@c1@: reviews: entry 2: state is not text', evidence=GOOD(reviews=[rv(1002), {'id': 5, 'user': {'id': 1}}]))
bad('c25-the-first-key-is-reported', 'Two bad entries: the one with the smaller key (as bytes) is reported.', '0000000000000000000000000000000000000000: started: is neither null nor a time like 2026-11-07T12:00:00Z',
    evidence={'ffffffffffffffffffffffffffffffffffffffff': {**entry(), 'pull': 5}, '0000000000000000000000000000000000000000': {**entry(), 'started': 5}})
case('c26-a-whole-number-written-with-a-fraction', 'The number 7.0 is a whole number.', SIMPLE, frm='c0', evidence_raw='{"@c1@": {"pull": {"number": 7.0, "user": {"id": 1001}, "head": {"sha": "%s"}, "merged_at": "2026-11-09T12:00:00Z"}, "started": null, "reviews": []}}' % HEAD,
     plan=PLAN('@c1@', '@c0@', 1, 0))
case('c27-reviews-in-pages', 'The reviews as a list of pages.', SIMPLE, frm='c0', evidence={'@c1@': {**entry(author=9999), 'reviews': [[rv(1002)], []]}}, plan=PLAN('@c1@', '@c0@', 1, 0))

# ---- group d: an issues file that does not fit ------------------------------------------------------------------------------------------------
def badi(cid, note, reason, **kw): case(cid, note, SIMPLE, frm='c0', error=('issues', reason), **kw)
OK_ISSUE = lambda **over: {'number': 1, 'state': 'open', 'title': 't', 'body': 'b', 'user': {'login': 'x', 'type': 'User'}, **over}
badi('d01-not-json', 'Not JSON.', 'is not one JSON document', issues_raw='[')
badi('d02-not-a-list', 'An object.', 'is not a list', issues_raw='{}')
badi('d03-mixed', 'A page and an issue.', 'mixes issues and pages', issues_raw='[[], {}]')
badi('d04-entry-not-an-object', 'A number as an entry.', 'entry 2: is not an object', issues=[OK_ISSUE(), 5])
badi('d05-number', 'A number of zero.', 'entry 1: number is not a positive integer', issues=[OK_ISSUE(number=0)])
badi('d06-state', 'A state that is neither.', 'entry 1: state is neither open nor closed', issues=[OK_ISSUE(state='all')])
badi('d07-title', 'A title that is not text.', 'entry 1: title is not text', issues=[OK_ISSUE(title=None)])
badi('d08-body', 'A body that is a number.', 'entry 1: body is neither null nor text', issues=[OK_ISSUE(body=5)])
badi('d09-user', 'A user without a type.', 'entry 1: user is neither null nor an object with the text login and type', issues=[OK_ISSUE(user={'login': 'x'})])
badi('d10-the-count-includes-pull-requests', 'A pull request comes first; the numbering still counts it.', 'entry 2: number is not a positive integer', issues=[{'pull_request': {}}, OK_ISSUE(number='x')])
case('d11-a-pull-request-need-not-fit', 'An entry with a pull_request key is not read any further.', SIMPLE, frm='c0', issues=[{'pull_request': {}, 'number': 'x'}], plan=PLAN('@c1@', '@c0@', 1, 0))
case('d12-issues-in-pages', 'Issues as a list of pages, an empty one among them.', SIMPLE, frm='c0', issues=[[OK_ISSUE()], []], plan=PLAN('@c1@', '@c0@', 1, 0))
case('d13-no-user-and-no-body', 'An issue of an account that is gone and without a body is read, and ignored.', SIMPLE, frm='c0', issues=[OK_ISSUE(user=None, body=None)], plan=PLAN('@c1@', '@c0@', 1, 0))

# ---- group e: what the plan does with the issues ------------------------------------------------------------------------------------------
TAMPERED = [ROOT(), commit('c1', [TAMPER])]
V02, V06 = lv('@c1@', 'commit', name(2), 'P-02', 'line 17'), lv('@c1@', 'commit', name(2), 'P-06', 'seal does not match')
K02, K06 = '0002:P-02', '0002:P-06'
def tamper_case(cid, note, issues, acts, **kw):
    case(cid, note, TAMPERED, frm='c0', issues=issues, plan=PLAN('@c1@', '@c0@', 1, 2, acts), **kw)
case('e01-nothing-found-nothing-planned', 'A clean history and no issues.', [ROOT(), commit('c1', [EDIT4])], frm='c0', issues=[], plan=PLAN('@c1@', '@c0@', 1, 0))
case('e02-no-from', 'Without a start every commit is judged, the first against an empty tree; the run record says there was no start.', [ROOT(), commit('c1', [EDIT4])], issues=[], plan=PLAN('@c1@', None, 2, 0))
tamper_case('e03-two-violations-two-issues', 'A sealed record edited by a push: two rules, so two issues, in the order of their keys.', [], [OPEN([V02]), OPEN([V06])])
tamper_case('e04-nothing-to-change', 'Both issues exist and say exactly what the audit would write: nothing is done, and the run still fails.',
            [issue(11, K02, violations=[V02]), issue(12, K06, violations=[V06])], [])
tamper_case('e05-the-body-differs', 'An open issue with an older body is updated; the other is left alone.', [issue(11, K02), issue(12, K06, violations=[V06])], [UPDATE(11, [V02])])
tamper_case('e06-the-title-differs', 'Only the title differs.', [issue(11, K02, violations=[V02], ttl='Records: old title'), issue(12, K06, violations=[V06])], [UPDATE(11, [V02])])
tamper_case('e07-closed-issues-are-reopened', 'Two closed issues of one key: the one with the lowest number is reopened; the other stays closed.',
            [issue(20, K02, 'closed'), issue(15, K02, 'closed'), issue(12, K06, violations=[V06])], [REOPEN(15, [V02])])
tamper_case('e08-a-closed-issue-with-the-right-text', 'A closed issue is reopened also when its text is right.', [issue(9, K02, 'closed', violations=[V02]), issue(12, K06, violations=[V06])], [REOPEN(9, [V02])])
tamper_case('e09-duplicates', 'Two open issues of one key: the lower number is kept, the other is closed as a duplicate.',
            [issue(11, K02, violations=[V02]), issue(13, K02, violations=[V02]), issue(12, K06, violations=[V06])], [CLOSE(K02, 13, duplicate=11)])
tamper_case('e10-duplicates-and-an-old-body', 'The same, and the issue that is kept is out of date: it is updated, and the duplicate closed.',
            [issue(14, K02, violations=[V02]), issue(13, K02), issue(12, K06, violations=[V06])], [UPDATE(13, [V02]), CLOSE(K02, 14, duplicate=13)])
tamper_case('e11-three-duplicates', 'Three open issues: two are closed, in the order of their numbers.', [issue(5, K02, violations=[V02]), issue(8, K02, violations=[V02]), issue(6, K02, violations=[V02]), issue(12, K06, violations=[V06])],
            [CLOSE(K02, 6, duplicate=5), CLOSE(K02, 8, duplicate=5)])
tamper_case('e12-a-stranger-with-the-marker', 'An issue with the marker written by a person is not read: the audit opens its own.',
            [issue(11, K02, violations=[V02], login='mallory', kind='User'), issue(12, K06, violations=[V06])], [OPEN([V02])])
tamper_case('e13-a-user-named-like-the-bot', 'Right name, wrong kind of account.', [issue(11, K02, violations=[V02], kind='User'), issue(12, K06, violations=[V06])], [OPEN([V02])])
tamper_case('e14-another-bot', 'A bot, but another one.', [issue(11, K02, violations=[V02], login='dependabot[bot]'), issue(12, K06, violations=[V06])], [OPEN([V02])])
tamper_case('e15-no-account', 'An issue of an account that is gone.', [issue(11, K02, violations=[V02], login=None), issue(12, K06, violations=[V06])], [OPEN([V02])])
tamper_case('e16-pull-requests-are-not-issues', 'An entry with a pull_request key that carries the marker and the right text is a pull request, and does not count.',
            [{**issue(11, K02, violations=[V02]), 'pull_request': {}}, issue(12, K06, violations=[V06])], [OPEN([V02])])
tamper_case('e17-a-carriage-return-after-the-marker', 'The editor of GitHub may have made the line ending CRLF: the marker is still read, and the body is written again with line feeds.',
            [issue(11, K02, text=body(K02, line_of(V02)).replace(mark(K02) + '\n', mark(K02) + '\r\n', 1)), issue(12, K06, violations=[V06])], [UPDATE(11, [V02])])
tamper_case('e18-the-marker-must-be-the-whole-line', 'A marker followed by a space is not the marker.', [issue(11, K02, text=mark(K02) + ' \nold\n'), issue(12, K06, violations=[V06])], [OPEN([V02])])
tamper_case('e19-the-marker-must-be-the-first-line', 'A marker on the second line is not the marker.', [issue(11, K02, text='Look:\n' + body(K02, line_of(V02))), issue(12, K06, violations=[V06])], [OPEN([V02])])
tamper_case('e20-a-marker-that-is-not-a-key', 'A marker with text that is not a key of the audit.', [issue(11, K02, text='<!-- record-keeper:incident 0002:P-2 -->\nx\n'), issue(12, K06, violations=[V06])], [OPEN([V02])])
tamper_case('e21-a-key-that-no-longer-stands-is-closed', 'An open issue of a key with no violation is closed with the resolved text; a closed one is left alone.',
            [issue(30, '0009:P-02'), issue(31, '0008:P-02', 'closed'), issue(12, K06, violations=[V06]), issue(11, K02, violations=[V02])], [CLOSE('0009:P-02', 30)])
tamper_case('e22-a-key-with-no-violation-and-two-open-issues', 'Both are closed with the resolved text, not as duplicates.',
            [issue(31, '0009:P-02'), issue(30, '0009:P-02'), issue(12, K06, violations=[V06]), issue(11, K02, violations=[V02])], [CLOSE('0009:P-02', 30), CLOSE('0009:P-02', 31)])
tamper_case('e23-an-issue-of-a-stranger-is-never-closed', 'An open issue with an unknown key written by a person is not touched.',
            [issue(30, '0009:P-02', login='mallory', kind='User'), issue(12, K06, violations=[V06]), issue(11, K02, violations=[V02])], [])
case('e24-an-excused-violation-closes-the-issue', 'A note names the commit that broke the seal: both violations are excused, and the issues are closed.',
     [ROOT(), commit('c1', [TAMPER]), commit('c2', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'commit @c1@')])).replace('- Rule 2.', '- Rule 2, changed.'))])], frm='c0',
     issues=[issue(11, K02, violations=[V02]), issue(12, K06, violations=[V06])], plan=PLAN('@c2@', '@c0@', 2, 0, [CLOSE(K02, 11), CLOSE(K06, 12)], excused=2))
case('e25-the-same-record-twice', 'The record is edited by two pushes. The second edit is of a record that no longer verifies, so only P-06 is repeated: its issue has a line for each commit, in the order of the history.',
     [ROOT(), commit('c1', [TAMPER]), commit('c2', [TAMPER2])], frm='c0', issues=[],
     plan=PLAN('@c2@', '@c0@', 2, 3, [OPEN([V02]), OPEN([V06, lv('@c2@', 'commit', name(2), 'P-06', 'seal does not match')])]))
case('e26-the-history-was-rewritten', 'The start is a commit that is not in the history: A-01, a violation of no file, shown as the history.', [ROOT(), commit('c1', [EDIT4])], frm=HEX0, issues=[],
     plan=PLAN('@c1@', HEX0, 2, 1, [OPEN([lv('@c1@', 'history', None, 'A-01', f'from {HEX0}')])]))
case('e27-a-violation-of-the-tip', 'The loss of a file happened before --since: the tip reports it, with the id of the head in the line.',
     [ROOT({**W, 'README.md': 'r\n', 'lib/c.js': 'c\n', f'{D}/{name(2)}': rec(2, 'accepted', True, keys='applies-to:\n  - README.md\n  - lib/*.js')}), commit('c1', [drop('README.md')]), commit('c2', [EDIT4])],
     frm='c0', since='@c1@', issues=[], plan=PLAN('@c2@', '@c0@', 1, 1, [OPEN([lv('@c2@', 'state', name(2), 'P-19', 'README.md')], head='@c2@')]))
case('e28-a-problem-of-the-settings', 'A settings file with an unknown key: the place is the file and the line.', [ROOT(), commit('c1', [put(SET, 'witnesses: [a]\n')])], frm='c0', issues=[],
     plan=PLAN('@c1@', '@c0@', 1, 1, [OPEN([lv('@c1@', 'commit', None, 'S-05', 'witnesses')], lines=[vline('@c1@', SET + ':1', 'S-05', 'witnesses')])]))
case('e29-a-file-that-is-not-a-record', 'A row of the index for a record that does not exist: the file is README.md, so the key says other.',
     [ROOT(), commit('c1', [index(ROWS + [(9, 'proposed')])])], frm='c0', issues=[], plan=PLAN('@c1@', '@c0@', 1, 1, [OPEN([lv('@c1@', 'commit', 'README.md', 'V-32')])]))
case('e30-a-character-that-hides-text', 'A workflow with a right-to-left override in its name: the line shows it as \\u{202e}.',
     [ROOT(), commit('c1', [put('.github/workflows/x‮.yml', 'name: Records integrity\n')])], frm='c0', issues=[],
     plan=PLAN('@c1@', '@c0@', 1, 1, [OPEN([lv('@c1@', 'commit', None, 'P-15', '.github/workflows/x‮.yml')])]))


# ---- run every case: build the history, run the reference, compare with the plan written above ---------------------------------------------------
def main():
    work = tempfile.mkdtemp(prefix='audit-effects-')
    out, bad_cases = [], 0
    try:
        for c in CASES:
            spec = copy.deepcopy(c)
            repo, ids = build(spec, work)
            head = ids[c['head'] or c['commits'][-1]['id']]
            fl = lambda x: fill(x, ids)
            frm = None if c['frm'] is None else ids.get(c['frm'], c['frm'])
            since = None if c['since'] is None else ids.get(c['since'].strip('@'), c['since'])
            if c['evidence'] is not None: ev_bytes = fl(json.dumps(c['evidence'])).encode()
            elif c['evidence_raw'] is not None: ev_bytes = fl(c['evidence_raw']).encode()
            elif c['evidence_hex'] is not None: ev_bytes = bytes.fromhex(c['evidence_hex'])
            else: ev_bytes = None
            if c['issues'] is not None: is_bytes = fl(json.dumps(c['issues'])).encode()
            elif c['issues_raw'] is not None: is_bytes = fl(c['issues_raw']).encode()
            else: is_bytes = json.dumps([]).encode()
            texts = ref.rule_texts(os.path.join(ROOT_DIR, 'record-keeper.mjs'))
            got = None
            if ev_bytes is not None:
                kind, evidence = ref.read_evidence(ev_bytes)
                if kind == 'error': got = ('error', ('evidence', evidence))
            else: evidence = None
            if got is None:
                kind, issues = ref.read_issues(is_bytes)
                if kind == 'error': got = ('error', ('issues', issues))
            if got is None:
                kind, result = ref.plan(repo, head, c['adopted'], frm, since, evidence, issues, c['now'], texts)
                got = ('error', ('message', result)) if kind == 'error' else ('ok', result)
            if got[0] == 'ok': shown = ('ok', labels(got[1], ids))
            else: shown = ('error', (got[1][0], labels(got[1][1], ids)))
            if c['error'] is not None: want = ('error', tuple(c['error']))
            else: want = ('ok', c['plan'])
            if shown[0] == 'error': shown = ('error', tuple(shown[1]))
            if json.dumps(shown, sort_keys=True, default=list) != json.dumps(want, sort_keys=True, default=list):
                bad_cases += 1
                print('MISMATCH', c['id'], '\n  want', json.dumps(want, default=list)[:1500], '\n  got ', json.dumps(shown, default=list)[:1500])
            commits = [{'id': k['id'], 'parents': built['parents'], 'message': k['message'], 'changes': k['changes']} for k, built in zip(c['commits'], spec['commits'])]
            record = {'id': c['id'], 'note': c['note'], 'commits': commits}
            for key, field in (('head', 'head'), ('from', 'frm'), ('since', 'since')):
                if c[field] is not None: record[key] = c[field]
            if c['adopted']: record['adopted'] = True
            for key in ('evidence', 'evidence_raw', 'evidence_hex', 'issues', 'issues_raw'):
                if c[key] is not None: record[key.replace('_raw', 'Raw').replace('_hex', 'Hex')] = c[key]
            record['now'] = c['now']
            record['expect'] = ({'code': 2, **({'file': c['error'][0], 'reason': c['error'][1]} if c['error'][0] != 'message' else {'message': c['error'][1]})} if c['error'] is not None else {'code': 0, 'plan': c['plan']})
            out.append(record)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    if bad_cases:
        print(bad_cases, 'cases differ from the reference')
        sys.exit(1)
    ids = [r['id'] for r in out]
    assert len(set(ids)) == len(ids), 'ids are not unique'
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'cases': out}, f, ensure_ascii=True, indent=1)
        f.write('\n')
    print(len(out), 'cases')


main()
