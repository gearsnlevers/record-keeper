"""Builds test/fixtures/announce/cases.json: small histories (as for the audit), the evidence, issues and logins files that go with them, and the plan that
`announce-plan` must print (docs/announcements.md). Each history is built here with git; the expected plan is written here by hand with the helpers below
(the diffs of small files by difflib, the room by a plain loop), computed again with announce_ref.py, and the generator stops when the two differ. A commit
id is written @label@ everywhere; the ids are the same in any build, because the commits are made with a fixed committer and time.
Usage: build_announce_cases.py <out cases.json>"""
import copy, difflib, hashlib, json, os, re, subprocess, sys, tempfile, shutil
sys.path.insert(0, os.path.dirname(__file__))
import announce_ref as ref
import audit_effects_ref as E
from audit_lib import D, name, rec, rput, put, drop, index, ROWS, with_status, g1, TREES

OUT = sys.argv[1]
env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
CASES = []
W = TREES['world']
NOW = '2026-11-10T03:00:00Z'
SET, PIN, WF = '.github/record-keeper/settings.yml', '.github/record-keeper.yml', '.github/workflows/records-integrity.yml'
HEAD, OLD = 'e' * 40, 'd' * 40
INTRO = ('The owners approved an act that is now on the default branch. The audit opens this issue once for each commit and does not change it. '
         'Close it when you have seen it.')
ORDER = ['erratum', 'deviation', 'settings', 'owners', 'amendment', 'pin', 'workflow', 'code']


# ---- building histories (as in build_audit_effects_cases.py) ----------------------------------------------------------------------------
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
        s += b'M ' + mode.encode() + b' inline ' + path.encode() + b'\n' + data(content.encode())
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


# ---- the expected diffs, written by difflib and the object id of git ------------------------------------------------------------------------
def blob(text):
    data = text.encode()
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()


def gdiff(path, old, new):
    """The diff git prints for a file of mode 100644 that is added (old None), deleted (new None) or changed, with full object ids."""
    lines = [f'diff --git a/{path} b/{path}']
    zero = '0' * 40
    if old is None: lines += ['new file mode 100644', f'index {zero}..{blob(new)}', '--- /dev/null', f'+++ b/{path}']
    elif new is None: lines += ['deleted file mode 100644', f'index {blob(old)}..{zero}', f'--- a/{path}', '+++ /dev/null']
    else: lines += [f'index {blob(old)}..{blob(new)} 100644', f'--- a/{path}', f'+++ b/{path}']
    a = [] if old is None else old.split('\n')[:-1]
    b = [] if new is None else new.split('\n')[:-1]
    for row in list(difflib.unified_diff(a, b, n=3, lineterm=''))[2:]:
        m = re.fullmatch(r'@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@', row)
        if m:
            first = int(m.group(1)) - 1 if m.group(2) != '0' else int(m.group(1))   # the index of the first line of the hunk in the old file
            context = [x for x in a[:max(first, 0)] if re.match(r'[A-Za-z_$]', x)]
            if context: row += ' ' + context[-1][:80].rstrip()
        lines.append(row)
    return lines


def block(rows, fence='```'): return [fence + 'diff'] + rows + [fence]


def told_text(owners=(), witnesses=()):
    def join(items): return items[0] if len(items) == 1 else ', '.join(items[:-1]) + ' and ' + items[-1]
    groups = [f'{join(list(items))} ({label})' for items, label in ((owners, 'owners'), (witnesses, 'witnesses')) if items]
    return ', '.join(groups)


def ann(label, number, acts, told, blocks):
    """The issue to open for a commit: acts = [(kind, path)], told = the text after `Told: `, blocks = the lines below each heading."""
    kinds = [k for k in ORDER if any(a[0] == k for a in acts)]
    lines = [f'<!-- record-keeper:announcement @{label}@ -->', INTRO, '', f'- Commit: @{label}@', f'- Pull request: #{number}',
             '- Acts: ' + ', '.join(f'{k} {p}' for k, p in acts), '- Told: ' + told]
    for (kind, path), rows in zip(acts, blocks): lines += ['', f'### {kind} {path}', ''] + rows
    return {'key': f'@{label}@', 'title': f'Act: {", ".join(kinds)} (#{number})', 'body': '\n'.join(lines) + '\n'}


def logged(label, acts, told_ids): return {'at': NOW, 'event': 'announced', 'key': f'@{label}@', 'acts': [{'kind': k, 'path': p} for k, p in acts], 'told': told_ids}


def WANT(*items, lookups=()):
    """items = (announcement, log entry) pairs."""
    return {'announcements': [i[0] for i in items], 'log': [i[1] for i in items], 'lookups': list(lookups)}


NONE = WANT()


# ---- inputs -------------------------------------------------------------------------------------------------------------------------------
def rv(uid, state='APPROVED', at='2026-11-09T10:00:00Z', commit_id=HEAD, rid=None):
    return {'id': rid or uid * 100 + len(state), 'user': {'id': uid}, 'state': state, 'commit_id': commit_id, 'submitted_at': at}


def entry(number=7, author=1001, merged='2026-11-09T12:00:00Z', started='2026-11-09T09:00:00Z', reviews=(), head=HEAD):
    return {'pull': {'number': number, 'user': None if author is None else {'id': author}, 'head': {'sha': head}, 'merged_at': merged}, 'started': started, 'reviews': list(reviews)}


NOPULL = {'pull': None, 'started': None, 'reviews': []}
BOB_LATE = [rv(1002, at='2026-11-09T11:00:00Z')]
BAR_MET = dict(author=1001, started='2026-11-01T00:00:00Z', reviews=BOB_LATE)
LOGINS = {'1001': 'alice', '1002': 'bob', '1003': 'carol', '1004': 'dave'}
ALICE_BOB = told_text(['@alice', '@bob'])


def bot_issue(number, key, state='open', login='github-actions[bot]', kind='Bot', first=None, body_rest='Text.\n'):
    first = first if first is not None else f'<!-- record-keeper:announcement {key} -->'
    return {'number': number, 'state': state, 'title': 'Act: pin (#7)', 'body': first + '\n' + body_rest, 'user': {'login': login, 'type': kind}}


def case(cid, note, commits, *, evidence=None, evidence_raw=None, issues=None, issues_raw=None, logins=None, logins_raw=None, logins_hex=None, now=NOW, want=None, error=None):
    CASES.append(dict(id=cid, note=note, commits=commits, evidence=evidence, evidence_raw=evidence_raw, issues=issues, issues_raw=issues_raw, logins=logins,
                      logins_raw=logins_raw, logins_hex=logins_hex, now=now, want=want, error=error))


def owned(approvals=1, owners='[alice/1001, bob/1002]', witnesses=None, extra=None):
    text = f'owners: {owners}\napprovals: {approvals}\n' + (f'witnesses: {witnesses}\n' if witnesses is not None else '')
    return {**W, SET: text, PIN: 'version: 1\n', **(extra or {})}


ROOT = lambda tree=None: commit('c0', dump(tree if tree is not None else owned()))
PULL7 = 'Merge pull request #7 from a/b'
PIN2 = put(PIN, 'version: 2\n')
PIN_DIFF = lambda a=1, b=2: gdiff(PIN, f'version: {a}\n', f'version: {b}\n')


def one(cid, note, changes, ev, acts, blocks=None, *, tree=None, told=ALICE_BOB, told_ids=(1001, 1002), logins=None, number=7, **kw):
    """A history of two commits with one change; the commit is announced with the acts, or not at all when acts is None."""
    want = NONE if acts is None else WANT((ann('c1', number, acts, told, blocks), logged('c1', acts, list(told_ids))))
    case(cid, note, [ROOT(tree), commit('c1', changes, message=PULL7)], evidence={'@c1@': ev}, logins=LOGINS if logins is None else logins, want=want, **kw)


APPROVED = entry(author=1001)

# ---- group a: which acts are announced ----------------------------------------------------------------------------------------------------
one('a01-pin', 'A change of the pin that its author, an owner, approved: one issue with one act and its diff.', [PIN2], APPROVED, [('pin', PIN)], [block(PIN_DIFF())])
WF_TEXT = 'name: Records integrity\n'
one('a02-workflow', 'A workflow file is added: an act of the workflow, and the diff is a new file.', [put(WF, WF_TEXT)], APPROVED, [('workflow', WF)], [block(gdiff(WF, None, WF_TEXT))])
CODE_TEXT = 'export const x = 1;\n'
one('a03-code', 'A program file of the kit is added: an act of the code.', [put('record-keeper.mjs', CODE_TEXT)], APPROVED, [('code', 'record-keeper.mjs')], [block(gdiff('record-keeper.mjs', None, CODE_TEXT))])
SET_KEYS = 'owners: [alice/1001, bob/1002]\napprovals: 1\nextra-keys: [repos]\n'
one('a04-settings', 'A change of the settings that keeps the owners and the count: an act of the settings only.', [put(SET, SET_KEYS)], APPROVED, [('settings', SET)],
    [block(gdiff(SET, 'owners: [alice/1001, bob/1002]\napprovals: 1\n', SET_KEYS))])
OWN_ONE = 'owners: [alice/1001]\napprovals: 1\n'
one('a05-owners-and-settings', 'Bob is taken off the owners; every owner of the base approved and seven days passed. Two acts, in the order of the audit; the owner who is removed is told too.',
    [put(SET, OWN_ONE)], entry(**BAR_MET), [('settings', SET), ('owners', SET)], [block(gdiff(SET, 'owners: [alice/1001, bob/1002]\napprovals: 1\n', OWN_ONE))] * 2)

SEAL_C = '- Effect 2, corrected.'


def sl(n, status='accepted', **kw): return g1.seal_g1(rec(n, status, **kw).encode())


def H(lines): return 'sha256:' + hashlib.sha256(('\n'.join(lines) + '\n').encode()).hexdigest()


def ent(n, prev_hash, prev_seal, seal, reason='Fixed a typo.', date='2026-11-08'):
    return [f'### Erratum {n}', '', f'- date: {date}', f'- previous entry: {prev_hash}', f'- previous seal: {prev_seal}', f'- seal: {seal}', f'- reason: {reason}']


def dev(n, cite, reason='A one-off.', date='2026-11-08'): return [f'### Deviation {n}', '', f'- date: {date}', f'- case: {cite}', f'- reason: {reason}']


def txt(entries): return '\n\n'.join('\n'.join(e) for e in entries)


TWO = f'{D}/{name(2)}'
OLD2 = rec(2, 'accepted', True)
ERR2 = rec(2, 'accepted', sl(2, consequences=SEAL_C), consequences=SEAL_C, errata=txt([ent(1, 'none', sl(2), sl(2, consequences=SEAL_C))]))
one('a06-erratum', 'An erratum on a sealed record, merged 48 hours after the check started: an act of the erratum, with the diff of the record.', [rput(2, ERR2)],
    entry(author=1001, started='2026-11-07T12:00:00Z'), [('erratum', TWO)], [block(gdiff(TWO, OLD2, ERR2))])
NOTE2 = rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5')]))
one('a07-deviation', 'A deviation note on a sealed record: an act of the deviation.', [rput(2, NOTE2)], APPROVED, [('deviation', TWO)], [block(gdiff(TWO, OLD2, NOTE2))])
ACC7 = [rput(7, rec(7, 'accepted', True)), index(ROWS + [(7, 'accepted')])]
one('a08-acceptance-is-not-announced', 'A record is accepted and approved: the act is an acceptance, which is not announced.', ACC7, APPROVED, None)
one('a09-acceptance-and-pin', 'An acceptance and a change of the pin in one commit: only the pin is in the issue.', ACC7 + [PIN2], APPROVED, [('pin', PIN)], [block(PIN_DIFF())])


def readme_gens(rows, gens):
    out = ['# Decision records', '', 'Some words about the records.', '', '## Generations', '', '| Generation | Record | Status |', '| - | - | - |']
    out += [f'| {g} | [{n:04d}]({name(n)}) | {status} |' for g, n, status in gens]
    out += ['', '## Index', '', '| # | Title | Status |', '| - | - | - |']
    out += [f'| {n:04d} | [{TITLE(n)}]({name(n)}) | {status} |' for n, status in rows]
    return '\n'.join(out) + '\n'


def TITLE(n): return __import__('audit_lib').title(n)


GENS = [('g1', 1, 'accepted')]
AROWS = [(1, 'superseded by 0007'), (2, 'accepted'), (3, 'proposed'), (4, 'rejected'), (5, 'superseded by 0006'), (6, 'accepted'), (7, 'accepted')]
PROTO = owned(extra={f'{D}/README.md': readme_gens(ROWS, GENS)})
AMEND_CHANGES = [rput(1, with_status(1, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[1])), put(f'{D}/README.md', readme_gens(AROWS, GENS))]
AMEND_ACTS = [('amendment', f'{D}/{name(7)}')]
AMEND_DIFFS = [block(gdiff(f'{D}/{name(7)}', None, rec(7, 'accepted', True, supersedes=[1])))]
one('a10-amendment', 'A record replaces the protocol record: every owner approved and seven days passed. The act is that of the new record; the changed index row is not an act of its own.',
    AMEND_CHANGES, entry(**BAR_MET), AMEND_ACTS, AMEND_DIFFS, tree=PROTO)

# ---- group b: only what the owners approved --------------------------------------------------------------------------------------------
one('b01-not-approved', 'Nobody approved the change of the pin: that is an incident, and there is nothing to announce.', [PIN2], entry(author=9999), None)
one('b02-no-pull-request', 'The change reached the branch by a push.', [PIN2], NOPULL, None)
one('b03-the-bar-is-not-met', 'Bob is taken off the owners but only the author approved: the act of the owners is a violation, and the act of the settings, met by one approval, is announced alone.',
    [put(SET, OWN_ONE)], entry(author=1001, started='2026-11-01T00:00:00Z'), [('settings', SET)], [block(gdiff(SET, 'owners: [alice/1001, bob/1002]\napprovals: 1\n', OWN_ONE))])
NOTE7 = rput(7, rec(7, 'accepted', True, deviations=txt([dev(1, 'commit @c1@')])))
NOTE7_PATH = f'{D}/{name(7)}'


def b04_want(ids):
    new = rec(7, 'accepted', True, deviations=txt([dev(1, 'commit ' + ids['c1'])]))
    return WANT((ann('c2', 7, [('deviation', NOTE7_PATH)], ALICE_BOB, [block(gdiff(NOTE7_PATH, rec(7, 'accepted', True), new))]), logged('c2', [('deviation', NOTE7_PATH)], [1001, 1002])))


case('b04-the-note-that-excuses-is-announced', 'A record is accepted by a push (a violation of an acceptance, which is not announced); the note that names the commit excuses it, and the note is approved: it is announced.',
     [ROOT(), commit('c1', ACC7), commit('c2', [NOTE7], message=PULL7)], evidence={'@c1@': NOPULL, '@c2@': entry(author=1001)}, logins=LOGINS, want=b04_want)
one('b05-an-erratum-too-early-is-announced', 'An erratum with no start of the check is a violation of P-13, not of A-03: the owners approved it, so it is announced as well as reported.', [rput(2, ERR2)],
    entry(author=1001, started=None), [('erratum', TWO)], [block(gdiff(TWO, OLD2, ERR2))])

# ---- group c: the issues that exist -----------------------------------------------------------------------------------------------------
PINC = [ROOT(), commit('c1', [PIN2], message=PULL7)]
PIN_ANN = lambda: WANT((ann('c1', 7, [('pin', PIN)], ALICE_BOB, [block(PIN_DIFF())]), logged('c1', [('pin', PIN)], [1001, 1002])))


def issue_case(cid, note, issues, want, **kw):
    case(cid, note, PINC, evidence={'@c1@': APPROVED}, logins=LOGINS, issues=issues, want=want, **kw)


issue_case('c01-already-announced-open', 'An open issue of the bot with the marker of the commit: nothing to do.', [bot_issue(3, '@c1@')], NONE)
issue_case('c02-already-announced-closed', 'A closed issue is an announcement that was seen: nothing to do.', [bot_issue(3, '@c1@', state='closed')], NONE)
issue_case('c03-marker-by-somebody-else', 'The marker in an issue that a person wrote is not an announcement: the audit opens its own.', [bot_issue(3, '@c1@', login='mallory', kind='User')], PIN_ANN())
issue_case('c04-the-bot-name-is-not-enough', 'The login of the bot with the type User: not trusted.', [bot_issue(3, '@c1@', kind='User')], PIN_ANN())
issue_case('c05-another-bot', 'Another bot: not trusted.', [bot_issue(3, '@c1@', login='dependabot[bot]')], PIN_ANN())
issue_case('c06-carriage-return-after-the-marker', 'GitHub keeps the line ending that was written: a carriage return before the line feed is read off.', [bot_issue(3, '@c1@', first='<!-- record-keeper:announcement @c1@ -->\r')], NONE)
issue_case('c07-text-after-the-marker', 'Text after the marker on the same line: the first line is not the marker.', [bot_issue(3, '@c1@', first='<!-- record-keeper:announcement @c1@ --> more')], PIN_ANN())
issue_case('c08-marker-of-another-commit', 'The issue is for another commit: nothing is known of this one.', [bot_issue(3, '9' * 40)], PIN_ANN())
issue_case('c09-an-incident-is-not-an-announcement', 'An incident issue of the audit does not hold back an announcement.',
           [{'number': 3, 'state': 'open', 'title': 'Records: the repository: [A-03] x', 'body': '<!-- record-keeper:incident -:A-03 -->\nText.\n', 'user': {'login': 'github-actions[bot]', 'type': 'Bot'}}], PIN_ANN())
issue_case('c10-marker-not-on-the-first-line', 'The marker on the second line is not the marker.', [bot_issue(3, '@c1@', first='Text', body_rest='<!-- record-keeper:announcement @c1@ -->\n')], PIN_ANN())
issue_case('c11-a-pull-request-is-ignored', 'An entry that is a pull request is not an issue.',
           [{**bot_issue(3, '@c1@'), 'pull_request': {}}], PIN_ANN())
issue_case('c12-a-short-id-is-not-a-key', 'A marker with a short commit id does not belong to the commit.', [bot_issue(3, 'abc1234')], PIN_ANN())

# ---- group d: several commits and the limit -------------------------------------------------------------------------------------------------
TWO_PINS = [ROOT(), commit('c1', [PIN2], message=PULL7), commit('c2', [put(PIN, 'version: 3\n')], message='Merge pull request #8 from a/c')]
case('d01-two-commits-in-order', 'Two commits with an act: two issues, the older first, and the log in the same order.', TWO_PINS,
     evidence={'@c1@': entry(number=7, author=1001), '@c2@': entry(number=8, author=1001)}, logins=LOGINS,
     want=WANT((ann('c1', 7, [('pin', PIN)], ALICE_BOB, [block(PIN_DIFF(1, 2))]), logged('c1', [('pin', PIN)], [1001, 1002])),
               (ann('c2', 8, [('pin', PIN)], ALICE_BOB, [block(PIN_DIFF(2, 3))]), logged('c2', [('pin', PIN)], [1001, 1002]))))
case('d02-the-first-is-announced-already', 'The issue of the older commit exists: only the newer is opened.', TWO_PINS,
     evidence={'@c1@': entry(number=7, author=1001), '@c2@': entry(number=8, author=1001)}, logins=LOGINS, issues=[bot_issue(3, '@c1@')],
     want=WANT((ann('c2', 8, [('pin', PIN)], ALICE_BOB, [block(PIN_DIFF(2, 3))]), logged('c2', [('pin', PIN)], [1001, 1002]))))
case('d03-a-commit-without-an-approved-act-is-left-out', 'The older commit was not approved: only the newer has an issue.',
     TWO_PINS, evidence={'@c1@': entry(number=7, author=9999), '@c2@': entry(number=8, author=1001)}, logins=LOGINS,
     want=WANT((ann('c2', 8, [('pin', PIN)], ALICE_BOB, [block(PIN_DIFF(2, 3))]), logged('c2', [('pin', PIN)], [1001, 1002]))))
MANY = [ROOT()] + [commit(f'c{i}', [put(PIN, f'version: {i + 1}\n')], message=f'Merge pull request #{i + 10} from a/b') for i in range(1, 23)]
case('d04-at-most-twenty', 'Twenty-two commits with an act: the twenty oldest get an issue, and the others wait for the next run.', MANY,
     evidence={f'@c{i}@': entry(number=i + 10, author=1001) for i in range(1, 23)}, logins=LOGINS,
     want=WANT(*[(ann(f'c{i}', i + 10, [('pin', PIN)], ALICE_BOB, [block(PIN_DIFF(i, i + 1))]), logged(f'c{i}', [('pin', PIN)], [1001, 1002])) for i in range(1, 21)]))
case('d05-the-limit-counts-what-is-left', 'The same, with issues for the first three: the twenty that follow.', MANY,
     evidence={f'@c{i}@': entry(number=i + 10, author=1001) for i in range(1, 23)}, logins=LOGINS, issues=[bot_issue(i, f'@c{i}@') for i in (1, 2, 3)],
     want=WANT(*[(ann(f'c{i}', i + 10, [('pin', PIN)], ALICE_BOB, [block(PIN_DIFF(i, i + 1))]), logged(f'c{i}', [('pin', PIN)], [1001, 1002])) for i in range(4, 23)]))
case('d06-before-the-adoption', 'The settings file is added in the second commit: that commit is the start and it is not judged; the act before it is not announced, the act after it is.',
     [commit('c0', dump({**W, PIN: 'version: 1\n'})), commit('c1', [put(SET, 'owners: [alice/1001, bob/1002]\napprovals: 1\n'), put(PIN, 'version: 2\n')]), commit('c2', [put(PIN, 'version: 3\n')], message=PULL7)],
     evidence={'@c2@': entry(author=1001)}, logins=LOGINS, want=WANT((ann('c2', 7, [('pin', PIN)], ALICE_BOB, [block(PIN_DIFF(2, 3))]), logged('c2', [('pin', PIN)], [1001, 1002]))))
case('d07-the-number-is-the-one-of-the-evidence', 'The message of the commit says #7 and the evidence names the pull request 12: the issue says 12.',
     PINC, evidence={'@c1@': entry(number=12, author=1001)}, logins=LOGINS,
     want=WANT((ann('c1', 12, [('pin', PIN)], ALICE_BOB, [block(PIN_DIFF())]), logged('c1', [('pin', PIN)], [1001, 1002]))))
MERGE = [ROOT(), commit('side', [put('side.txt', 'x\n')], parents=['c0']), commit('c1', [PIN2], parents=['c0', 'side'], message=PULL7)]
case('d08-a-merge-commit', 'The commit is a merge: its diff is against the first parent.', MERGE,
     evidence={'@c1@': APPROVED}, logins=LOGINS, want=PIN_ANN())

# ---- group e: whom it tells ---------------------------------------------------------------------------------------------------------------------
one('e01-an-account-that-is-gone', 'The value for bob is null: he is not mentioned, and the text says so with the login of the settings.', [PIN2], APPROVED, [('pin', PIN)], [block(PIN_DIFF())],
    logins={'1001': 'alice', '1002': None}, told=told_text(['@alice', 'bob/1002 (no longer an account)']), told_ids=[1001])
case('e02-an-id-is-not-looked-up', 'The file has no value for bob: the plan says so, and names the id in `lookups`.', PINC, evidence={'@c1@': APPROVED}, logins={'1001': 'alice'},
     want=WANT((ann('c1', 7, [('pin', PIN)], told_text(['@alice', 'bob/1002 (not looked up)']), [block(PIN_DIFF())]), logged('c1', [('pin', PIN)], [1001])), lookups=[1002]))
case('e03-nothing-is-looked-up', 'An empty file: both ids are to look up, in ascending order.', PINC, evidence={'@c1@': APPROVED}, logins={},
     want=WANT((ann('c1', 7, [('pin', PIN)], told_text(['alice/1001 (not looked up)', 'bob/1002 (not looked up)']), [block(PIN_DIFF())]), logged('c1', [('pin', PIN)], [])), lookups=[1001, 1002]))
case('e04-no-lookup-when-nothing-is-opened', 'The issue exists: nobody needs to be told, so nothing is to look up.', PINC, evidence={'@c1@': APPROVED}, logins={}, issues=[bot_issue(3, '@c1@')], want=NONE)
WIT = owned(witnesses='[carol/1003, dave/1004]')
one('e05-witnesses', 'Two witnesses are told after the owners, in a group of their own.', [PIN2], APPROVED, [('pin', PIN)], [block(PIN_DIFF())], tree=WIT,
    told=told_text(['@alice', '@bob'], ['@carol', '@dave']), told_ids=[1001, 1002, 1003, 1004])
one('e06-an-owner-who-is-a-witness-too', 'An account that is an owner and a witness is told once, as an owner.', [PIN2], APPROVED, [('pin', PIN)], [block(PIN_DIFF())], tree=owned(witnesses='[alice/1001, carol/1003]'),
    told=told_text(['@alice', '@bob'], ['@carol']), told_ids=[1001, 1002, 1003])
one('e07-three-owners', 'Three owners: commas and `and`.', [PIN2], APPROVED, [('pin', PIN)], [block(PIN_DIFF())], tree=owned(owners='[alice/1001, bob/1002, carol/1003]'),
    told=told_text(['@alice', '@bob', '@carol']), told_ids=[1001, 1002, 1003])
one('e08-the-id-orders-not-the-file', 'The settings list bob before alice: the text is in the order of the ids.', [PIN2], APPROVED, [('pin', PIN)], [block(PIN_DIFF())], tree=owned(owners='[bob/1002, alice/1001]'),
    told=ALICE_BOB, told_ids=[1001, 1002])
one('e09-a-renamed-owner', 'Alice is now alice-2 on GitHub: the mention follows the account, not the settings.', [PIN2], APPROVED, [('pin', PIN)], [block(PIN_DIFF())],
    logins={'1001': 'alice-2', '1002': 'bob'}, told=told_text(['@alice-2', '@bob']), told_ids=[1001, 1002])
one('e10-the-witness-removed-is-told', 'A witness is dropped by the change of the settings: the witness of the base is told too.', [put(SET, 'owners: [alice/1001, bob/1002]\napprovals: 1\n')],
    APPROVED, [('settings', SET)], [block(gdiff(SET, 'owners: [alice/1001, bob/1002]\napprovals: 1\nwitnesses: [carol/1003]\n', 'owners: [alice/1001, bob/1002]\napprovals: 1\n'))],
    tree=owned(witnesses='[carol/1003]'), told=told_text(['@alice', '@bob'], ['@carol']), told_ids=[1001, 1002, 1003])
one('e11-the-witness-added-is-told', 'A witness is added by the change: the witness of the commit is told too.', [put(SET, 'owners: [alice/1001, bob/1002]\napprovals: 1\nwitnesses: [carol/1003]\n')],
    APPROVED, [('settings', SET)], [block(gdiff(SET, 'owners: [alice/1001, bob/1002]\napprovals: 1\n', 'owners: [alice/1001, bob/1002]\napprovals: 1\nwitnesses: [carol/1003]\n'))],
    told=told_text(['@alice', '@bob'], ['@carol']), told_ids=[1001, 1002, 1003])
one('e12-the-login-of-the-commit-is-written', 'The login in the settings changes but not the id: the text writes the login of the commit for an account that is gone, and there is no act of the owners.',
    [put(SET, 'owners: [alice/1001, robert/1002]\napprovals: 1\n')], APPROVED, [('settings', SET)],
    [block(gdiff(SET, 'owners: [alice/1001, bob/1002]\napprovals: 1\n', 'owners: [alice/1001, robert/1002]\napprovals: 1\n'))],
    logins={'1001': 'alice', '1002': None}, told=told_text(['@alice', 'robert/1002 (no longer an account)']), told_ids=[1001])

# ---- group f: the diff ------------------------------------------------------------------------------------------------------------------------
def code_case(cid, note, text, rows_of=None, **kw):
    one(cid, note, [put('record-keeper.mjs', text)], APPROVED, [('code', 'record-keeper.mjs')], [rows_of if rows_of is not None else block(gdiff('record-keeper.mjs', None, text))], **kw)


F01 = 'a\tb\r\nc\u202ed\ufeffe\n'
code_case('f01-control-characters', 'A tab stays; a carriage return, a right-to-left override and a zero width character are shown as escapes.', F01,
          block(gdiff('record-keeper.mjs', None, F01)[:5] + ['@@ -0,0 +1,2 @@', '+a\tb\\u{d}', '+c\\u{202e}d\\u{feff}e']))
code_case('f02-fence-longer-than-the-longest-run', 'The text has a line of three backticks and one of four: the fence has five.', 'x\n```\n````\n',
          block(gdiff('record-keeper.mjs', None, 'x\n```\n````\n'), fence='`````'))
code_case('f03-fence-of-three-backticks-in-the-text', 'The text has a run of three: the fence has four.', 'x\n```\n', block(gdiff('record-keeper.mjs', None, 'x\n```\n'), fence='````'))
code_case('f04-two-backticks-in-the-text', 'Two backticks are not enough to need a longer fence.', 'x``y\n', block(gdiff('record-keeper.mjs', None, 'x``y\n')))
one('f05-a-file-is-deleted', 'The pin is deleted: an act of the pin, and the diff says the file was deleted.', [drop(PIN)], APPROVED, [('pin', PIN)], [block(gdiff(PIN, 'version: 1\n', None))])
one('f06-two-acts-two-sections', 'A change of the pin and of a workflow: two sections, in the order of the acts.', [put(WF, WF_TEXT), PIN2], APPROVED, [('pin', PIN), ('workflow', WF)],
    [block(PIN_DIFF()), block(gdiff(WF, None, WF_TEXT))])


def room_rows(lines_of_diff, room=40000):
    """The rows that fit in the room, and the number of rows left out."""
    used, taken = 0, 0
    for row in lines_of_diff:
        if used + len(row) + 1 > room: break
        used += len(row) + 1
        taken += 1
    return taken


BIG_TEXT = ''.join('line %05d %s\n' % (i, 'x' * 20) for i in range(3000))
BIG_ROWS = gdiff('record-keeper.mjs', None, BIG_TEXT)
KEPT = room_rows(BIG_ROWS)
assert 0 < KEPT < len(BIG_ROWS)
code_case('f07-the-room-is-used', 'A file of 3,000 lines: the diff is cut after the last whole line that fits in 40,000 characters, and the number of lines left out is said.', BIG_TEXT,
          block(BIG_ROWS[:KEPT]) + ['', f'... {len(BIG_ROWS) - KEPT} more lines; see the commit.'])
one('f08-a-small-act-then-a-large-one', 'A small act first and a large one after it: both have a diff block, the large one is cut.', [put(WF, WF_TEXT), put('record-keeper.mjs', BIG_TEXT)], APPROVED,
    [('workflow', WF), ('code', 'record-keeper.mjs')], [block(gdiff(WF, None, WF_TEXT)), block(BIG_ROWS[:room_rows(BIG_ROWS, 40000 - sum(len(r) + 1 for r in gdiff(WF, None, WF_TEXT)))])
                                                          + ['', f'... {len(BIG_ROWS) - room_rows(BIG_ROWS, 40000 - sum(len(r) + 1 for r in gdiff(WF, None, WF_TEXT)))} more lines; see the commit.']])
BIGPIN = gdiff(PIN, 'version: 1\n', BIG_TEXT)
KEPT_PIN = room_rows(BIGPIN)
one('f09-an-act-after-the-room-is-used', 'The pin is large and cut: the act after it gets no diff block, only the line that says the room is used.', [put(PIN, BIG_TEXT), put(WF, WF_TEXT)], APPROVED,
    [('pin', PIN), ('workflow', WF)], [block(BIGPIN[:KEPT_PIN]) + ['', f'... {len(BIGPIN) - KEPT_PIN} more lines; see the commit.'], ['The room of this issue is used; see the commit.']])


def pin_text_using(low, high):
    """A text for the pin whose diff has between low and high characters (a line feed counted for each row), and every row of it fits in the room."""
    for last in range(1, 400):
        text = ''.join('line %05d %s\n' % (i, 'x' * 20) for i in range(1200)) + 'z' * last + '\n'
        used = sum(len(r) + 1 for r in gdiff(PIN, 'version: 1\n', text))
        if low <= used <= high: return text, used
    raise AssertionError('no text')


FIT_TEXT, FIT_USED = pin_text_using(39950, 39990)
one('f10-the-next-header-does-not-fit', 'The pin diff fits and leaves a few characters; the first row of the next diff does not fit in them: the act gets the line that says the room is used.',
    [put(PIN, FIT_TEXT), put(WF, WF_TEXT)], APPROVED, [('pin', PIN), ('workflow', WF)], [block(gdiff(PIN, 'version: 1\n', FIT_TEXT)), ['The room of this issue is used; see the commit.']])
HUGE_LINE = 'y' * 45000 + '\n'
code_case('f11-a-line-that-does-not-fit', 'The one content line is longer than the room: the headers and the hunk header fit, and the line and nothing else is left out.', HUGE_LINE,
          block(gdiff('record-keeper.mjs', None, HUGE_LINE)[:6]) + ['', '... 1 more lines; see the commit.'])

# ---- group g: what the plan refuses -----------------------------------------------------------------------------------------------------
case('g01-not-adopted', 'No commit of the history holds the settings file.', [commit('c0', dump({**W, PIN: 'version: 1\n'})), commit('c1', [PIN2])], evidence={}, logins=LOGINS,
     error=('message', 'no commit of the history holds .github/record-keeper/settings.yml'))
case('g02-evidence-is-missing', 'A commit carries an act and the evidence has no entry for it.', PINC, evidence={}, logins=LOGINS, error=('message', 'no evidence for the commit @c1@'))
case('g03-evidence-is-unreadable', 'The evidence is not one JSON document.', PINC, evidence_raw='{', logins=LOGINS, error=('evidence', 'is not one JSON document'))
case('g04-issues-are-unreadable', 'The issues are not a list.', PINC, evidence={'@c1@': APPROVED}, issues_raw='{}', logins=LOGINS, error=('issues', 'is not a list'))
for cid, note, raw, reason in [
    ('g05-logins-not-json', 'Not one JSON document.', '{', 'is not one JSON document'),
    ('g06-logins-a-list', 'The document is a list.', '[]', 'is not an object'),
    ('g07-logins-null', 'The document is null.', 'null', 'is not an object'),
    ('g08-logins-key-leading-zero', 'A key with a leading zero is not an id.', '{"01": "a"}', '01: is not an id'),
    ('g09-logins-key-not-a-number', 'A key that is a word.', '{"alice": "a"}', 'alice: is not an id'),
    ('g10-logins-key-too-long', 'A key of sixteen digits.', '{"1234567890123456": "a"}', '1234567890123456: is not an id'),
    ('g11-logins-key-zero', 'Zero is not an id.', '{"0": "a"}', '0: is not an id'),
    ('g12-logins-value-a-number', 'A number is neither a login nor null.', '{"1001": 5}', '1001: is neither a login nor null'),
    ('g13-logins-value-with-space', 'A login with a space.', '{"1001": "a b"}', '1001: is neither a login nor null'),
    ('g14-logins-value-leading-hyphen', 'A login that starts with a hyphen.', '{"1001": "-a"}', '1001: is neither a login nor null'),
    ('g15-logins-value-too-long', 'A login of forty characters.', '{"1001": "%s"}' % ('a' * 40), '1001: is neither a login nor null'),
    ('g16-logins-value-empty', 'An empty login.', '{"1001": ""}', '1001: is neither a login nor null'),
    ('g17-logins-value-at-sign', 'A login that is a mention.', '{"1001": "@alice"}', '1001: is neither a login nor null'),
    ('g18-logins-the-first-key-in-byte-order', 'Two bad entries: the first key in the order of the bytes is named.', '{"9": 1, "10": 2}', '10: is neither a login nor null'),
]:
    case(cid, note, PINC, evidence={'@c1@': APPROVED}, logins_raw=raw, error=('logins', reason))
case('g19-logins-value-39-characters', 'A login of 39 characters is a login.', PINC, evidence={'@c1@': APPROVED}, logins={'1001': 'a' * 39, '1002': 'bob'},
     want=WANT((ann('c1', 7, [('pin', PIN)], told_text(['@' + 'a' * 39, '@bob']), [block(PIN_DIFF())]), logged('c1', [('pin', PIN)], [1001, 1002]))))
case('g20-logins-for-nobody-who-matters', 'Entries for ids that the settings do not name are ignored.', PINC, evidence={'@c1@': APPROVED}, logins={**LOGINS, '99': 'zed'}, want=PIN_ANN())
case('g21-logins-with-a-hyphen-inside', 'A login with single hyphens.', PINC, evidence={'@c1@': APPROVED}, logins={'1001': 'a-b-c', '1002': 'bob'},
     want=WANT((ann('c1', 7, [('pin', PIN)], told_text(['@a-b-c', '@bob']), [block(PIN_DIFF())]), logged('c1', [('pin', PIN)], [1001, 1002]))))
case('g22-logins-with-a-double-hyphen', 'Two hyphens in a row are not a login.', PINC, evidence={'@c1@': APPROVED}, logins_raw='{"1001": "a--b"}', error=('logins', '1001: is neither a login nor null'))


def labels(value, ids):
    back = {v: k for k, v in ids.items()}
    return json.loads(re.sub(r'\b[0-9a-f]{40}\b', lambda m: '@%s@' % back[m.group(0)] if m.group(0) in back else m.group(0), json.dumps(value)))


def main():
    work = tempfile.mkdtemp(prefix='announce-cases-')
    out, bad_cases = [], 0
    try:
        for c in CASES:
            spec = copy.deepcopy(c)
            repo, ids = build(spec, work)
            head = ids[c['commits'][-1]['id']]
            fl = lambda x: fill(x, ids)
            ev_bytes = fl(json.dumps(c['evidence'])).encode() if c['evidence'] is not None else fl(c['evidence_raw']).encode() if c['evidence_raw'] is not None else None
            is_bytes = fl(json.dumps(c['issues'])).encode() if c['issues'] is not None else fl(c['issues_raw']).encode() if c['issues_raw'] is not None else b'[]'
            lg_bytes = json.dumps(c['logins']).encode() if c['logins'] is not None else c['logins_raw'].encode() if c['logins_raw'] is not None else bytes.fromhex(c['logins_hex'])
            got = None
            kind, evidence = E.read_evidence(ev_bytes)
            if kind == 'error': got = ('error', ('evidence', evidence))
            if got is None:
                kind, issues = E.read_issues(is_bytes)
                if kind == 'error': got = ('error', ('issues', issues))
            if got is None:
                kind, logins = ref.read_logins(lg_bytes)
                if kind == 'error': got = ('error', ('logins', logins))
            if got is None:
                kind, result = ref.plan(repo, head, evidence, issues, logins, c['now'])
                got = ('error', ('message', result)) if kind == 'error' else ('ok', result)
            shown = ('ok', labels(got[1], ids)) if got[0] == 'ok' else ('error', (got[1][0], labels(got[1][1], ids)))
            plan_want = labels(c['want'](ids), ids) if callable(c['want']) else c['want']
            want = ('error', tuple(c['error'])) if c['error'] is not None else ('ok', plan_want)
            if shown[0] == 'error': shown = ('error', tuple(shown[1]))
            if json.dumps(shown, sort_keys=True, default=list) != json.dumps(want, sort_keys=True, default=list):
                bad_cases += 1
                print('MISMATCH', c['id'])
                a, b = json.dumps(want, sort_keys=True, default=list), json.dumps(shown, sort_keys=True, default=list)
                i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), min(len(a), len(b)))
                print('  want ...', a[max(0, i - 150):i + 250]); print('  got  ...', b[max(0, i - 150):i + 250])
            commits = [{'id': k['id'], 'parents': built['parents'], 'message': k['message'], 'changes': k['changes']} for k, built in zip(c['commits'], spec['commits'])]
            record = {'id': c['id'], 'note': c['note'], 'commits': commits}
            for key in ('evidence', 'evidence_raw', 'issues', 'issues_raw', 'logins', 'logins_raw', 'logins_hex'):
                if c[key] is not None: record[key.replace('_raw', 'Raw').replace('_hex', 'Hex')] = c[key]
            record['now'] = c['now']
            record['expect'] = ({'code': 2, **({'file': c['error'][0], 'reason': c['error'][1]} if c['error'][0] != 'message' else {'message': c['error'][1]})} if c['error'] is not None else {'code': 0, 'plan': plan_want})
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
