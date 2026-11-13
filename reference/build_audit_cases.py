"""Builds test/fixtures/audit/cases.json: small histories (commits with parents, a message and changes to the tree of the first parent) and what
`audit` must return for them. Each history is built here with git, the answer is computed with audit_ref.py, and the generator stops when it
differs from the answer written for the case. A commit id that a later commit needs is written @label@ in its content and message, and in the file
the id itself stands there: ids are the same in any build, because the commits are made with a fixed committer and time.
Usage: build_audit_cases.py <out cases.json>"""
import json, os, re, subprocess, sys, tempfile, shutil
sys.path.insert(0, os.path.dirname(__file__))
import audit_lib as L
import audit_ref
from audit_lib import D, name, rec, rput, put, drop, index, ROWS, with_status, g1, TREES

OUT = sys.argv[1]
env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
HISTORIES = []
W = TREES['world']
AP = lambda items: 'applies-to:\n' + ''.join(f'  - {i}\n' for i in items).rstrip('\n')
HEX0 = '1' * 40


def commit(label, changes=(), message=None, parents=None):
    return {'id': label, 'changes': list(changes), 'message': message if message is not None else f'commit {label}', 'parents': parents}


def dump(tree): return [put(p, c) if isinstance(c, str) else {'symlink': p, 'target': c[1]} for p, c in tree.items()]


def history(hid, note, commits, *, head=None, frm=None, since=None, judged, violations=(), excused=(), acts=(), cases=()):
    HISTORIES.append(dict(id=hid, note=note, commits=commits, head=head, frm=frm, since=since, want=dict(judged=judged, violations=list(violations), excused=list(excused), acts=list(acts), cases=list(cases))))


def v(c, rule, file=None, detail='', kind='commit', line=None): return (c, kind, file, rule, detail, line)
def ex(c, rule, file, detail, note_file, number, case, kind='commit'): return (c, kind, file, rule, detail, None, note_file, number, case)
def ac(c, kind, path, pull=None): return (c, kind, path, pull)
def cs(c, kind, number): return (c, kind, number)


def dev(n, case, reason='A one-off.', date='2026-11-08'): return [f'### Deviation {n}', '', f'- date: {date}', f'- case: {case}', f'- reason: {reason}']
def txt(entries): return '\n\n'.join('\n'.join(e) for e in entries)


def apply_tree(before, changes):
    t = dict(before)
    for op in changes:
        if 'write' in op: t[op['write']] = (op.get('mode', '100644'), op['content'])
        elif 'remove' in op: t.pop(op['remove'], None)
        elif 'symlink' in op: t[op['symlink']] = ('120000', op['target'])
        elif 'submodule' in op: t[op['submodule']] = ('160000', '0123456789012345678901234567890123456789')
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
        if mode == '160000': s += b'M 160000 ' + content.encode() + b' ' + pb + b'\n'
        else: s += b'M ' + mode.encode() + b' inline ' + pb + b'\n' + data(content.encode())
    return s


def build(h, work):
    repo = os.path.join(work, h['id'] + '.git')
    subprocess.run(['git', 'init', '-q', '--bare', repo], check=True)
    trees, ids = {}, {}
    for index_, c in enumerate(h['commits']):
        c['parents'] = c['parents'] if c['parents'] is not None else ([h['commits'][index_ - 1]['id']] if index_ > 0 else [])
        before = trees[c['parents'][0]] if c['parents'] else {}
        c['changes'] = [{**op, **({'content': fill(op['content'], ids)} if 'content' in op else {})} for op in c['changes']]
        c['message'] = fill(c['message'], ids)
        trees[c['id']] = apply_tree(before, c['changes'])
        subprocess.run(['git', '-C', repo, 'fast-import', '--quiet'], input=stream(c['id'], trees[c['id']], c['message'], c['parents']), check=True, env=env)
        ids[c['id']] = subprocess.run(['git', '-C', repo, 'rev-parse', c['id']], capture_output=True, text=True, check=True, env=env).stdout.strip()
    return repo, ids


def lab(ids, cid): return next(k for k, val in ids.items() if val == cid)


def shown(result, ids):
    to = lambda c: lab(ids, c)
    swap = lambda text: re.sub(r'\b[0-9a-f]{40}\b', lambda m: '@%s@' % lab(ids, m.group(0)) if m.group(0) in ids.values() else m.group(0), text)
    return dict(judged=result['judged'],
                violations=[(to(q['commit']), q['kind'], q['file'], q['rule'], '' if q['rule'].startswith('V-') else swap(q['detail']), q.get('line')) for q in result['violations']],
                excused=[(to(q['commit']), q['kind'], q['file'], q['rule'], '' if q['rule'].startswith('V-') else swap(q['detail']), q.get('line'), q['note']['file'], q['note']['number'], swap(q['note']['case'])) for q in result['excused']],
                acts=[(to(a['commit']), a['kind'], a['path'], a['pull']) for a in result['acts']],
                cases=[(to(c['commit']), c['kind'], c['number']) for c in result['cases']])


def wanted(want): return {k: (sorted(val, key=repr) if isinstance(val, list) else val) for k, val in want.items()}


ROOT = lambda tree=W: commit('c0', dump(tree))
WORLD_ACTS = [ac('c0', 'accept', f'{D}/{name(n)}') for n in (1, 2, 5, 6)]
EDIT3 = rput(3, rec(3, consequences='- Edited.'))
PLAIN = [rput(7, rec(7)), index(ROWS + [(7, 'proposed')])]
TAMPER = rput(2, rec(2, 'accepted', True).replace('- Rule 2.', '- Rule 2, changed.'))
APP_FILES = {'src/a.ts': 'a\n', 'src/x/b.ts': 'b\n', 'README.md': 'r\n', 'lib/c.js': 'c\n'}
APP = {**W, **APP_FILES, f'{D}/{name(1)}': rec(1, 'accepted', True, keys=AP(['src/**'])), f'{D}/{name(2)}': rec(2, 'accepted', True, keys=AP(['README.md', 'lib/*.js']))}
R2 = lambda deviations, items=('README.md', 'lib/*.js'): rput(2, rec(2, 'accepted', True, keys=AP(items), deviations=deviations))
P18 = lambda c, item: v(c, 'P-18', name(2), item)
LOST = ('README.md',)

history('h01-clean-history-judged-from-the-root', 'A tree is created, a proposed record is edited, another added. The first commit is judged against an empty tree: four acceptances, nothing wrong.',
        [ROOT(), commit('c1', [EDIT3]), commit('c2', PLAIN)], judged=3, acts=WORLD_ACTS)
history('h02-from-the-first-commit', 'The same history from the first commit on: it is the base of the next one.', [ROOT(), commit('c1', [EDIT3]), commit('c2', PLAIN)], frm='c0', judged=2)
history('h03-direct-edit-of-a-sealed-record', 'A sealed record is edited in a direct push: P-02 and, as the seal no longer matches, P-06, at that commit; the tip does not repeat them.',
        [ROOT(), commit('c1', [TAMPER])], frm='c0', judged=1, violations=[v('c1', 'P-02', name(2), 'line 17'), v('c1', 'P-06', name(2), 'seal does not match')])
history('h04-the-edit-is-reverted', 'The edit is reverted: the record is sealed again, which counts as an acceptance (an act for M2.9), and the violation of the first commit stays.',
        [ROOT(), commit('c1', [TAMPER]), commit('c2', [rput(2, rec(2, 'accepted', True))])], frm='c0', judged=2,
        violations=[v('c1', 'P-02', name(2), 'line 17'), v('c1', 'P-06', name(2), 'seal does not match')], acts=[ac('c2', 'accept', f'{D}/{name(2)}')])
history('h05-a-sealed-record-is-deleted', 'A sealed record is deleted and the index follows: P-01 and the gap in the numbers.',
        [ROOT(), commit('c1', [drop(f'{D}/{name(2)}'), index([r for r in ROWS if r[0] != 2])])], frm='c0', judged=1, violations=[v('c1', 'P-01', name(2)), v('c1', 'V-08')])
OTHER3 = f'{D}/{name(3, "other")}'
RENAMED_ROWS = [(n, s, 'other') if n == 3 else (n, s) for n, s in ROWS]
history('h06-a-number-comes-back-under-another-name', 'Record 3 is deleted, and later a record 3 with another name is added.',
        [ROOT(), commit('c1', [drop(f'{D}/{name(3)}'), index([r for r in ROWS if r[0] != 3])]), commit('c2', [put(OTHER3, rec(3)), index(RENAMED_ROWS)])],
        frm='c0', judged=2, violations=[v('c1', 'P-01', name(3)), v('c1', 'V-08'), v('c2', 'A-02', name(3, 'other'), f'0003: {name(3)} -> {name(3, "other")}', kind='register')])
history('h07-the-same-file-comes-back', 'Record 3 is deleted and the very same file is restored: the number has its name again.',
        [ROOT(), commit('c1', [drop(f'{D}/{name(3)}'), index([r for r in ROWS if r[0] != 3])]), commit('c2', [rput(3, rec(3)), index(ROWS)])],
        frm='c0', judged=2, violations=[v('c1', 'P-01', name(3)), v('c1', 'V-08')])
history('h08-a-record-is-renamed', 'Record 3 is renamed: the old name is gone and the new name has the old number.',
        [ROOT(), commit('c1', [drop(f'{D}/{name(3)}'), put(OTHER3, rec(3)), index(RENAMED_ROWS)])],
        frm='c0', judged=1, violations=[v('c1', 'P-01', name(3)), v('c1', 'A-02', name(3, 'other'), f'0003: {name(3)} -> {name(3, "other")}', kind='register')])
history('h09-the-last-audited-commit-is-not-in-the-history', 'The commit that was audited last was on a branch that is no longer part of the history: A-01. The history is judged from the other bound.',
        [ROOT(), commit('c1', [EDIT3], parents=['c0']), commit('x1', [rput(3, rec(3, consequences='- Side.'))], parents=['c0']), commit('c2', PLAIN, parents=['c1'])],
        head='c2', frm='c0', since='@x1@', judged=2, violations=[v('c2', 'A-01', None, 'since @x1@', kind='history')])
history('h10-the-start-is-unknown', 'The commit the audit started from is not in the repository at all.',
        [ROOT(), commit('c1', [EDIT3])], frm=HEX0, judged=2, acts=WORLD_ACTS, violations=[v('c1', 'A-01', None, f'from {HEX0}', kind='history')][:0] + [v('c1', 'A-01', None, f'from {HEX0}', kind='history')])
history('h11-the-start-is-not-an-ancestor', 'The start is a commit of another branch.',
        [ROOT(), commit('x1', [EDIT3], parents=['c0']), commit('c1', PLAIN, parents=['c0'])], head='c1', frm='@x1@', judged=2, acts=WORLD_ACTS, violations=[v('c1', 'A-01', None, 'from @x1@', kind='history')])
history('h12-the-last-file-of-an-item-goes', 'README.md is deleted: the only file the item of record 2 matches.', [ROOT(APP), commit('c1', [drop('README.md')])], frm='c0', judged=1, violations=[P18('c1', 'README.md')])
NOTE_C1 = lambda cite, **kw: commit('c2', [R2(txt([dev(1, cite)]))], **kw)
history('h13-excused-by-the-commit', 'A note on the record cites the commit that took the file away: the violation is excused, the note is an act.',
        [ROOT(APP), commit('c1', [drop('README.md')]), NOTE_C1('commit @c1@')], frm='c0', judged=2,
        excused=[ex('c1', 'P-18', name(2), 'README.md', name(2), 1, 'commit @c1@')], acts=[ac('c2', 'deviation', f'{D}/{name(2)}')])
history('h14-excused-by-the-merge-of-a-pull-request', 'The commit is the merge of pull request 7, and the note cites pull 7.',
        [ROOT(APP), commit('c1', [drop('README.md')], message='Merge pull request #7 from a/b'), NOTE_C1('pull 7')], frm='c0', judged=2,
        excused=[ex('c1', 'P-18', name(2), 'README.md', name(2), 1, 'pull 7')], acts=[ac('c1', 'workflow', 'x') for _ in ()] + [ac('c2', 'deviation', f'{D}/{name(2)}')], cases=[cs('c2', 'pull', 7)])
history('h15-excused-by-a-squash', 'The commit is a squash merge whose subject ends in (#9).',
        [ROOT(APP), commit('c1', [drop('README.md')], message='Delete the readme (#9)'), NOTE_C1('pull 9')], frm='c0', judged=2,
        excused=[ex('c1', 'P-18', name(2), 'README.md', name(2), 1, 'pull 9')], acts=[ac('c1', 'x', 'x') for _ in ()] + [ac('c2', 'deviation', f'{D}/{name(2)}')], cases=[cs('c2', 'pull', 9)])
history('h16-excused-by-an-issue-in-the-message', 'The message of the commit mentions #12 and the note cites issue 12.',
        [ROOT(APP), commit('c1', [drop('README.md')], message='Remove the readme\n\nFixes #12'), NOTE_C1('issue 12')], frm='c0', judged=2,
        excused=[ex('c1', 'P-18', name(2), 'README.md', name(2), 1, 'issue 12')], acts=[ac('c2', 'deviation', f'{D}/{name(2)}')], cases=[cs('c2', 'issue', 12)])
history('h17-an-issue-number-inside-a-longer-number', 'The message mentions #123 and the note cites issue 12: not the same issue.',
        [ROOT(APP), commit('c1', [drop('README.md')], message='Remove the readme (see #123)'), NOTE_C1('issue 12')], frm='c0', judged=2,
        violations=[P18('c1', 'README.md')], acts=[ac('c2', 'deviation', f'{D}/{name(2)}')], cases=[cs('c2', 'issue', 12)])
history('h18-an-issue-number-in-a-word', 'The message has a#12, which is no mention of #12.',
        [ROOT(APP), commit('c1', [drop('README.md')], message='Remove the readme, ticket a#12'), NOTE_C1('issue 12')], frm='c0', judged=2,
        violations=[P18('c1', 'README.md')], acts=[ac('c2', 'deviation', f'{D}/{name(2)}')], cases=[cs('c2', 'issue', 12)])
history('h19-a-pull-cite-needs-the-subject', 'The message mentions #7 in the body, and the note cites pull 7: only the subject names a pull request.',
        [ROOT(APP), commit('c1', [drop('README.md')], message='Remove the readme\n\nMerge pull request #7 from a/b'), NOTE_C1('pull 7')], frm='c0', judged=2,
        violations=[P18('c1', 'README.md')], acts=[ac('c2', 'deviation', f'{D}/{name(2)}')], cases=[cs('c2', 'pull', 7)])
history('h20-a-note-of-another-record-excuses-nothing', 'The violation is on record 1 and the note is on record 2.',
        [ROOT(APP), commit('c1', [drop('src/a.ts'), drop('src/x/b.ts')]), commit('c2', [R2(txt([dev(1, 'commit @c1@')]))])], frm='c0', judged=2,
        violations=[v('c1', 'P-18', name(1), 'src/**')], acts=[ac('c2', 'deviation', f'{D}/{name(2)}')])
history('h21-a-note-citing-another-commit', 'The note cites the first commit, not the one that took the file away.',
        [ROOT(APP), commit('c1', [drop('README.md')]), commit('c2', [R2(txt([dev(1, 'commit @c0@')]))])], frm='c0', judged=2,
        violations=[P18('c1', 'README.md')], acts=[ac('c2', 'deviation', f'{D}/{name(2)}')])
history('h22-one-note-excuses-the-whole-commit-of-a-record', 'Two items of one record lose their files in one commit; one note excuses both.',
        [ROOT(APP), commit('c1', [drop('README.md'), drop('lib/c.js')]), NOTE_C1('commit @c1@')], frm='c0', judged=2,
        excused=[ex('c1', 'P-18', name(2), 'README.md', name(2), 1, 'commit @c1@'), ex('c1', 'P-18', name(2), 'lib/*.js', name(2), 1, 'commit @c1@')], acts=[ac('c2', 'deviation', f'{D}/{name(2)}')])
history('h23-a-later-violation-is-not-excused', 'The note excuses the first loss; a second item is lost later and is reported.',
        [ROOT(APP), commit('c1', [drop('README.md')]), NOTE_C1('commit @c1@'), commit('c3', [drop('lib/c.js')])], frm='c0', judged=3,
        excused=[ex('c1', 'P-18', name(2), 'README.md', name(2), 1, 'commit @c1@')], violations=[P18('c3', 'lib/*.js')], acts=[ac('c2', 'deviation', f'{D}/{name(2)}')])
history('h24-acts-and-their-pull-requests', 'Acts are listed with the number of the pull request that the subject names.',
        [ROOT(), commit('c1', [rput(7, rec(7, 'accepted', True)), index(ROWS + [(7, 'accepted')])], message='Merge pull request #5 from a/b'),
         commit('c2', [put('.github/record-keeper/settings.yml', 'extra-keys: [repos]\n')], message='Settings (#6)'), commit('c3', [put('record-keeper.mjs', '// x\n')], message='Code')], frm='c0', judged=3,
        acts=[ac('c1', 'accept', f'{D}/{name(7)}', 5), ac('c2', 'settings', '.github/record-keeper/settings.yml', 6), ac('c3', 'code', 'record-keeper.mjs', None)])
history('h25-since-skips-the-commits-up-to-it', 'The commit after --since is clean; the loss in the commit before it was reported earlier, so the tip reports it as a state.',
        [ROOT(APP), commit('c1', [drop('README.md')]), commit('c2', [EDIT3])], frm='c0', since='@c1@', judged=1, violations=[v('c2', 'P-19', name(2), 'README.md', kind='state')])
history('h26-since-is-the-head', 'Nothing is left to judge; the tip is still read.', [ROOT(APP), commit('c1', [drop('README.md')])], frm='c0', since='@c1@', judged=0, violations=[v('c1', 'P-19', name(2), 'README.md', kind='state')])
BROKEN = rput(3, rec(3, 'accepted'))
history('h27-a-problem-that-predates-the-start', 'An accepted record without a seal is in the tree at the start: the tip reports it, since no judged commit did.',
        [commit('c0', dump({**W, f'{D}/{name(3)}': rec(3, 'accepted')})), commit('c1', [rput(7, rec(7)), index(ROWS + [(7, 'proposed')])])], frm='c0', judged=1,
        violations=[v('c1', 'P-06', name(3), 'no seal', kind='state')])
history('h28-a-vouching-that-predates-the-start', 'Record 5 is superseded by 6, which does not list it: P-04 at the tip.',
        [commit('c0', dump({**W, f'{D}/{name(6)}': rec(6, 'accepted', True)})), commit('c1', [EDIT3])], frm='c0', judged=1,
        violations=[v('c1', 'P-04', name(5), '0006: does not list this record', kind='state'), v('c1', 'P-05', name(6), '0005', kind='state')][:1])
history('h29-a-problem-of-the-settings', 'A settings file with an unknown setting is committed.',
        [ROOT(), commit('c1', [put('.github/record-keeper/settings.yml', 'branches: [a]\n')])], frm='c0', judged=1,
        violations=[v('c1', 'S-05', None, 'branches', line=1)], acts=[ac('c1', 'settings', '.github/record-keeper/settings.yml')])
history('h30-a-workflow-that-names-the-check', 'A workflow of someone else names the check.',
        [ROOT(), commit('c1', [put('.github/workflows/fake.yml', 'name: Records integrity\n')])], frm='c0', judged=1, violations=[v('c1', 'P-15', None, '.github/workflows/fake.yml')])
history('h31-a-deviation-citing-a-commit-that-is-not-in-the-history', 'The note cites a commit of another branch.',
        [ROOT(APP), commit('x1', [EDIT3], parents=['c0']), commit('c1', [R2(txt([dev(1, 'commit @x1@')]))], parents=['c0'])], head='c1', frm='c0', judged=1,
        violations=[v('c1', 'P-14', name(2), 'entry 1: case does not resolve')], acts=[ac('c1', 'deviation', f'{D}/{name(2)}')])
history('h32-the-first-parent-line', 'A pull request branch has a bad commit inside; the merge is judged by its net change, which is clean, and the commit inside is not judged.',
        [ROOT(), commit('c1', [EDIT3], parents=['c0']), commit('x1', [TAMPER], parents=['c0']), commit('x2', [rput(2, rec(2, 'accepted', True))], parents=['x1']),
         commit('m', [rput(3, rec(3, consequences='- Edited.'))], parents=['c1', 'x2'], message='Merge pull request #3 from a/b')], head='m', frm='c0', judged=2)
history('h33-a-merge-with-the-net-change-of-a-bad-branch', 'The merge keeps the edit of the sealed record: the net change of the merge is the violation.',
        [ROOT(), commit('c1', [EDIT3], parents=['c0']), commit('x1', [TAMPER], parents=['c0']), commit('m', [TAMPER], parents=['c1', 'x1'], message='Merge pull request #4 from a/b')], head='m', frm='c0', judged=2,
        violations=[v('m', 'P-02', name(2), 'line 17'), v('m', 'P-06', name(2), 'seal does not match')])
history('h34-no-records-folder', 'A repository that has no records folder.', [commit('c0', [put('src/a.js', 'x\n')]), commit('c1', [put('src/b.js', 'y\n')])], judged=2)
history('h35-erratum-and-note-with-assumed-facts', 'An erratum is not asked for 48 hours, and a note that cites an issue is not asked whether the issue exists.',
        [ROOT(), commit('c1', [rput(2, rec(2, 'accepted', g1.seal_g1(rec(2, "accepted", consequences="- Fixed.").encode()), consequences='- Fixed.', errata='### Erratum 1\n\n- date: 2026-11-08\n- previous entry: none\n- previous seal: ' + g1.seal_g1(rec(2).encode()) + '\n- seal: ' + g1.seal_g1(rec(2, "accepted", consequences="- Fixed.").encode()) + '\n- reason: Fixed.'))], message='Fix (#2)')],
        frm='c0', judged=1, acts=[ac('c1', 'erratum', f'{D}/{name(2)}', 2)])
history('h36-the-first-commit-with-a-bad-record', 'The first commit holds a record that breaks the format; with no start it is judged against nothing.',
        [commit('c0', dump({**W, f'{D}/{name(3)}': rec(3, makers='single')}))], judged=1, acts=WORLD_ACTS, violations=[v('c0', 'V-14', name(3))])
history('h37-a-violation-without-a-record-is-not-excused', 'A violation without a record cannot be excused: a note citing the commit does not help.',
        [ROOT(APP), commit('c1', [put('.github/workflows/fake.yml', 'name: Records integrity\n')]), commit('c2', [R2(txt([dev(1, 'commit @c1@')]))])], frm='c0', judged=2,
        violations=[v('c1', 'P-15', None, '.github/workflows/fake.yml')], acts=[ac('c2', 'deviation', f'{D}/{name(2)}')])
SEALED_OTHER = rec(3, 'accepted', True)
RENAMED_ACC = [(n, 'accepted', 'other') if n == 3 else ((n, s, 'other') if False else (n, s)) for n, s in ROWS]
history('h38-a-number-reused-and-excused', 'A sealed record is added under a used number; a note on it cites that commit, and the violation of the register is excused.',
        [ROOT(), commit('c1', [drop(f'{D}/{name(3)}'), index([r for r in ROWS if r[0] != 3])]), commit('c2', [put(OTHER3, SEALED_OTHER), index(RENAMED_ACC)]),
         commit('c3', [put(OTHER3, rec(3, 'accepted', True, deviations=txt([dev(1, 'commit @c2@')])))])],
        frm='c0', judged=3, violations=[v('c1', 'P-01', name(3)), v('c1', 'V-08')], excused=[ex('c2', 'A-02', name(3, 'other'), f'0003: {name(3)} -> {name(3, "other")}', name(3, 'other'), 1, 'commit @c2@', kind='register')],
        acts=[ac('c2', 'accept', OTHER3), ac('c3', 'deviation', OTHER3)])


LINK3 = f'{D}/{name(3, "link")}'
history('h39-a-link-named-like-a-record-is-no-record-file', 'A symbolic link with the name of a record file under a used number is not a record file: V-04 and nothing in the register.',
        [ROOT(), commit('c1', [{'symlink': LINK3, 'target': name(3)}])], frm='c0', judged=1, violations=[v('c1', 'V-04', name(3, 'link'))])
history('h40-the-link-becomes-a-file', 'The link is replaced by a regular file of the same name: now it is a record file under a used number.',
        [ROOT(), commit('c1', [{'symlink': LINK3, 'target': name(3)}]), commit('c2', [put(LINK3, rec(3)), index(ROWS)])], frm='c0', judged=2,
        violations=[v('c1', 'V-04', name(3, 'link')), v('c2', 'V-30', name(3, 'link')), v('c2', 'V-07', name(3)), v('c2', 'A-02', name(3, 'link'), f'0003: {name(3)} -> {name(3, "link")}', kind='register')])


TAMPERED_NOTE = rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'commit @c1@')])).replace('- Rule 2.', '- Rule 2, changed.'))
history('h41-a-note-excuses-a-broken-seal', 'A note on a record whose seal is already broken: it excuses the violations of the commit it cites, and the commit that adds it is judged as a note, which does not repeat the old problems of the record.',
        [ROOT(), commit('c1', [TAMPER]), commit('c2', [TAMPERED_NOTE])], frm='c0', judged=2,
        excused=[ex('c1', 'P-02', name(2), 'line 17', name(2), 1, 'commit @c1@'), ex('c1', 'P-06', name(2), 'seal does not match', name(2), 1, 'commit @c1@')],
        acts=[ac('c2', 'deviation', f'{D}/{name(2)}')])
ACCEPTED_BARE = rput(3, rec(3, 'accepted'))
ROWS_3 = index([(r[0], 'accepted') if r[0] == 3 else r for r in ROWS])
history('h47-a-note-excuses-an-acceptance-without-a-seal', 'A record is set to accepted by a push, without a seal. A note that cites that commit excuses its P-06, and the commit that adds the note is a note.',
        [ROOT(), commit('c1', [ACCEPTED_BARE, ROWS_3]), commit('c2', [rput(3, rec(3, 'accepted', deviations=txt([dev(1, 'commit @c1@')])))])], frm='c0', judged=2,
        excused=[ex('c1', 'P-06', name(3), 'no seal', name(3), 1, 'commit @c1@')],
        acts=[ac('c2', 'deviation', f'{D}/{name(3)}')])
G2 = 'sha256-g2:' + 'f' * 64
history('h48-a-note-on-a-seal-of-another-generation-is-refused', 'A push replaces the seal of a record with one of generation g2. The audit does not know where the sections of g2 are: the note that cites the push excuses its violations, and the commit that adds the note is not a note, so the record is reported again.',
        [ROOT(), commit('c1', [rput(2, rec(2, 'accepted', G2))]), commit('c2', [rput(2, rec(2, 'accepted', G2, deviations=txt([dev(1, 'commit @c1@')])))])], frm='c0', judged=2,
        violations=[v('c2', 'P-06', name(2), 'unknown generation g2')],
        excused=[ex('c1', 'P-02', name(2), 'line 6', name(2), 1, 'commit @c1@'), ex('c1', 'P-06', name(2), 'unknown generation g2', name(2), 1, 'commit @c1@')])


history('h49-a-note-on-a-broken-record-cites-a-pull-request', 'The note cites the pull request of the push that edited a sealed record. The audit takes the pull request to exist, matches it to the commit by its subject, and lists it for M2.9 to look up.',
        [ROOT(), commit('c1', [TAMPER], message='Edit rule 2 (#7)'), commit('c2', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 7')])).replace('- Rule 2.', '- Rule 2, changed.'))])], frm='c0', judged=2,
        excused=[ex('c1', 'P-02', name(2), 'line 17', name(2), 1, 'pull 7'), ex('c1', 'P-06', name(2), 'seal does not match', name(2), 1, 'pull 7')],
        acts=[ac('c2', 'deviation', f'{D}/{name(2)}')], cases=[cs('c2', 'pull', 7)])


DEL = lambda n: drop(f'{D}/{name(n)}')
history('h42-the-order-of-violations', 'Many violations in two commits: oldest commit first, then no file before a file, then the rule, then the detail, as bytes; a violation of the register among those of the commit.',
        [ROOT(), commit('c1', [DEL(4), DEL(2), put('.github/workflows/zzz.yml', 'Records integrity\n'), put('.github/workflows/aaa.yml', 'records-integrity\n'), index([r for r in ROWS if r[0] not in (2, 4)])]),
         commit('c2', [DEL(6), put(OTHER3, rec(3)), DEL(3), index([(1, 'accepted'), (3, 'proposed', 'other'), (5, 'superseded by 0006')])])], frm='c0', judged=2,
        violations=[v('c1', 'P-15', None, '.github/workflows/aaa.yml'), v('c1', 'P-15', None, '.github/workflows/zzz.yml'), v('c1', 'V-08'), v('c1', 'P-01', name(2)), v('c1', 'P-01', name(4)),
                    v('c2', 'A-02', name(3, 'other'), f'0003: {name(3)} -> {name(3, "other")}', kind='register'), v('c2', 'P-01', name(3)), v('c2', 'V-20', name(5)), v('c2', 'P-01', name(6))])
history('h43-the-pull-request-of-a-commit', 'Subjects that do and do not name a pull request: nine digits do, ten do not, the number must be at the end, the merge text at the start.',
        [ROOT(), commit('c1', [rput(7, rec(7, 'accepted', True)), index(ROWS + [(7, 'accepted')])], message='Merge pull request #123456789 from a/b'),
         commit('c2', [put('record-keeper.mjs', '// 1\n')], message='Merge pull request #1234567890 from a/b'), commit('c3', [put('record-keeper.mjs', '// 2\n')], message='Fix it (#12) now'),
         commit('c4', [put('record-keeper.mjs', '// 3\n')], message='See Merge pull request #5 from a/b'), commit('c5', [put('record-keeper.mjs', '// 4\n')], message='Fix it (#123456789)'),
         commit('c6', [put('record-keeper.mjs', '// 5\n')], message='Fix it (#1234567890)'), commit('c7', [put('record-keeper.mjs', '// 6\n')], message='Fix it (#12) '), commit('c8', [put('record-keeper.mjs', '// 7\n')], message='Merge pull request #0 from a/b')],
        frm='c0', judged=8, acts=[ac('c1', 'accept', f'{D}/{name(7)}', 123456789), ac('c2', 'code', 'record-keeper.mjs'), ac('c3', 'code', 'record-keeper.mjs'), ac('c4', 'code', 'record-keeper.mjs'), ac('c5', 'code', 'record-keeper.mjs', 123456789),
                                      ac('c6', 'code', 'record-keeper.mjs'), ac('c7', 'code', 'record-keeper.mjs'), ac('c8', 'code', 'record-keeper.mjs')])
history('h44-an-issue-number-next-to-a-zero', 'The message mentions #120 and 0#12, and the note cites issue 12: neither is #12.',
        [ROOT(APP), commit('c1', [drop('README.md')], message='Remove the readme, refs #120 and 0#12'), NOTE_C1('issue 12')], frm='c0', judged=2,
        violations=[P18('c1', 'README.md')], acts=[ac('c2', 'deviation', f'{D}/{name(2)}')], cases=[cs('c2', 'issue', 12)])
APP_OLD = {**APP, f'{D}/{name(5)}': rec(5, 'superseded by 0006', True, keys=AP(['old/**'])), f'{D}/{name(3)}': rec(3, 'accepted', keys=AP(['gone.txt']))}
history('h45-dead-items-of-records-that-do-not-bind', 'A superseded record and an unsealed one have items that no file matches: only the unsealed one is reported, as a seal that is missing.',
        [commit('c0', dump(APP_OLD)), commit('c1', [EDIT3.__class__(EDIT3) if False else put('src/c.ts', 'c\n')])], frm='c0', judged=1, violations=[v('c1', 'P-06', name(3), 'no seal', kind='state')])
history('h46-a-note-cannot-excuse-the-state-of-the-tip', 'The tip reports an item without a file; the commit of the tip is the merge of pull request 7 and a note on the record cites pull 7: still reported.',
        [ROOT(APP), commit('c1', [drop('README.md')]), commit('c2', [R2(txt([dev(1, 'pull 7')]))], message='Merge pull request #7 from a/b')], frm='c0', since='@c1@', judged=1,
        violations=[v('c2', 'P-19', name(2), 'README.md', kind='state')], acts=[ac('c2', 'deviation', f'{D}/{name(2)}', 7)], cases=[cs('c2', 'pull', 7)])


def run():
    work = tempfile.mkdtemp(prefix='audit-cases-')
    out, failed = [], 0
    for h in HISTORIES:
        repo, ids = build(h, work)
        resolve = lambda s: None if s is None else (ids[s[1:-1]] if s.startswith('@') and s.endswith('@') else (ids[s[1:]] if s.startswith('@') else s))
        head = ids[h['head'] or h['commits'][-1]['id']]
        got = audit_ref.audit(repo, head, from_=resolve(h['frm'].replace('@', '') if False else (f"@{h['frm']}@" if h['frm'] in ids else h['frm'])) if h['frm'] else None,
                              since=resolve(f"@{h['since'].strip('@')}@" if h['since'] and h['since'].strip('@') in ids else h['since']) if h['since'] else None)
        mine = shown(got, ids)
        want = h['want']
        # expectations written with @label@ in details are compared as written
        expect = dict(judged=want['judged'], violations=sorted(want['violations'], key=repr), excused=sorted(want['excused'], key=repr), acts=sorted(want['acts'], key=repr), cases=sorted(want['cases'], key=repr))
        ordered = {k: (sorted(val, key=repr) if isinstance(val, list) else val) for k, val in mine.items()}
        if ordered != expect:
            failed += 1
            print('DIFFERENT', h['id'])
            for k in expect:
                if ordered[k] != expect[k]: print('  ', k, '\n     want', expect[k], '\n     got ', ordered[k])
        out.append((h, mine))
    shutil.rmtree(work, ignore_errors=True)
    if failed:
        print(failed, 'histories differ from what they were written to show'); sys.exit(1)
    doc = {'histories': []}
    for h, mine in out:
        doc['histories'].append({'id': h['id'], 'note': h['note'], 'head': h['head'], 'from': h['frm'], 'since': h['since'],
                                 'commits': [{'id': c['id'], 'parents': c['parents'], 'message': c['message'], 'changes': c['changes']} for c in h['commits']],
                                 'expect': {'judged': mine['judged'],
                                            'violations': [dict(commit=q[0], kind=q[1], file=q[2], rule=q[3], detail=q[4], **({'line': q[5]} if q[5] else {})) for q in mine['violations']],
                                            'excused': [dict(commit=q[0], kind=q[1], file=q[2], rule=q[3], detail=q[4], **({'line': q[5]} if q[5] else {}), note={'file': q[6], 'number': q[7], 'case': q[8]}) for q in mine['excused']],
                                            'acts': [dict(commit=q[0], kind=q[1], path=q[2], pull=q[3]) for q in mine['acts']],
                                            'cases': [dict(commit=q[0], kind=q[1], number=q[2]) for q in mine['cases']]}})
    json.dump(doc, open(OUT, 'w'), indent=1, ensure_ascii=True)
    open(OUT, 'a').write('\n')
    print(len(HISTORIES), 'histories written to', OUT)


run()
