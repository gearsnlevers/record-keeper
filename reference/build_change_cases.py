"""Build test/fixtures/change/cases.json: cases of `check-pr` (docs/checking-a-change.md). A case is a base tree (one of a few small
repositories), a head made from it by changes, and what the check must report. The expected answer is written here by hand for each
case (`want`), and then computed with check_ref.py; the generator stops when the two differ, so a case shows what it was written to show.
Usage: build_change_cases.py <out cases.json>"""
import calendar, hashlib, json, os, re, subprocess, sys, tempfile, shutil
sys.path.insert(0, os.path.dirname(__file__))
import g1, check_ref

OUT = sys.argv[1]
D = 'docs/decisions'
SLUG = {1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth', 11: 'eleventh', 12: 'twelfth'}
HEX = 'f' * 64


def name(n, slug=None): return f'{n:04d}-{slug or SLUG[n]}.md'
def title(n): return f'The {SLUG[n]} decision'


def rec(n, status='proposed', seal=None, supersedes=(), date='2026-10-01', makers='list', consequences=None, deviations=None, errata=None,
        keys='', body_lines=0, mail=False):
    """The text of a record. seal: None (no seal key), True (the seal that verifies), 'bad' (well formed, wrong), or a literal."""
    def build(seal_line):
        out = ['---', f'status: {status}', f'date: {date}']
        out += ['decision-makers:', '  - maintainers'] if makers == 'list' else [f'decision-makers: maintainers']
        if supersedes: out += ['supersedes:'] + [f'  - {s:04d}' for s in supersedes]
        if keys: out += [keys]
        if seal_line: out += [f'seal: {seal_line}']
        out += ['---', '', f'# {title(n)}', '', '## Context and problem statement', '', f'Why {n}.', '', '## Decision', '', f'- Rule {n}.', '',
                '## Consequences', '', consequences or f'- Effect {n}.']
        if mail: out += ['', 'Ask someone@example.com.']
        out += [f'- Filler {i}.' for i in range(body_lines)]
        if deviations: out += ['', '## Known deviations', '', deviations]
        out += ['', '## Alternatives considered', '', f'- Not {n}.']
        if errata: out += ['', '## Errata', '', errata]
        return '\n'.join(out) + '\n'
    if seal is None: return build(None)
    if seal is True: return build(g1.seal_g1(build(None).encode()))
    if seal == 'bad': return build('sha256-g1:' + HEX)
    return build(seal)


def readme(rows, prose='Some words about the records.'):
    out = ['# Decision records', '', prose, '', '## Index', '', '| # | Title | Status |', '| - | - | - |']
    out += [f'| {n:04d} | [{title(n)}]({name(n, slug)}) | {status} |' for n, status, slug in ((r[0], r[1], r[2] if len(r) > 2 else None) for r in rows)]
    return '\n'.join(out) + '\n'


TEMPLATE = open(os.path.join(os.path.dirname(__file__), '../test/fixtures/validate/ok01-base/template.md')).read()
ROWS = [(1, 'accepted'), (2, 'accepted'), (3, 'proposed'), (4, 'rejected'), (5, 'superseded by 0006'), (6, 'accepted')]


def world_records():
    return {
        1: rec(1, 'accepted', True), 2: rec(2, 'accepted', True), 3: rec(3), 4: rec(4, 'rejected'),
        5: rec(5, 'superseded by 0006', True), 6: rec(6, 'accepted', True, supersedes=[5]),
    }


def tree_of(records, rows, extra=None, template=True):
    t = {f'{D}/README.md': readme(rows)}
    if template: t[f'{D}/template.md'] = TEMPLATE
    for n, text in records.items(): t[f'{D}/{name(n)}'] = text
    t.update(extra or {})
    return t


TREES = {}
TREES['world'] = tree_of(world_records(), ROWS)
TREES['empty'] = {'README.md': '# A repository\n'}
TREES['legacy'] = tree_of(
    {1: rec(1, 'accepted', True), 2: rec(2, 'accepted'), 3: rec(3, makers='single'),
     4: rec(4, 'accepted', True, body_lines=60, mail=True)},
    [(1, 'accepted'), (2, 'accepted'), (3, 'proposed'), (4, 'accepted')], template=False)
TREES['broken-settings'] = {**TREES['world'], '.github/record-keeper/settings.yml': 'witnesses: [a]\nfolder: docs/decisions\n'}
TREES['clean-settings'] = {**TREES['world'], '.github/record-keeper/settings.yml': 'extra-keys: [repos]\n'}
TREES['linked-github'] = {**TREES['world'], '.github': ('120000', 'elsewhere')}
TREES['attributes'] = {**TREES['world'], f'{D}/.gitattributes': '*.md -diff\n'}
TREES['no-folder'] = {k: v for k, v in TREES['world'].items() if not k.startswith(D)}
TREES['legacy-pair'] = tree_of(
    {1: rec(1, 'accepted', True), 2: rec(2, 'accepted', True), 3: rec(3, 'accepted', True, supersedes=[2])},
    [(1, 'accepted'), (2, 'accepted'), (3, 'accepted')])
TREES['other-folder'] = {**TREES['world'], '.github/record-keeper/settings.yml': 'folder: records\n',
                         **{k.replace(D, 'records', 1): v for k, v in TREES['world'].items() if k.startswith(D)}}
TREES['other-folder'] = {k: v for k, v in TREES['other-folder'].items() if not k.startswith(D + '/')}

CASES = []


def put(path, text, mode=None): return {'write': path, 'content': text, **({'mode': mode} if mode else {})}
def drop(path): return {'remove': path}
def rput(n, text): return put(f'{D}/{name(n)}', text)
def index(rows): return put(f'{D}/README.md', readme(rows))
def rows_with(**changes):
    rows = dict(ROWS)
    for k, v in changes.items(): rows[int(k[1:])] = v
    return sorted(rows.items())


NOW = '2026-11-10T00:00:00Z'
def epoch(text): return calendar.timegm(__import__('time').strptime(text, '%Y-%m-%dT%H:%M:%SZ'))


def case(cid, note, changes=(), *, base='world', parent='child', problems=(), acts=(), settings=(), cases=None, since=None, now=NOW, needs=None):
    CASES.append(dict(id=cid, note=note, base=base, parent=parent, changes=list(changes), cases=cases, since=since, now=now, needs=needs,
                      want=dict(problems=list(problems), acts=list(acts), settings=list(settings))))


def p(file, rule, detail=''): return (file, rule, detail)
def a(kind, path): return (kind, path)
def acc(n): return a('accept', f'{D}/{name(n)}')
ER2 = a('erratum', f'{D}/{name(2)}')
DV2 = a('deviation', f'{D}/{name(2)}')


# ---- nothing to report ------------------------------------------------------------------------------------------------------
case('a01-same-commit', 'The head is the base: nothing changed, nothing to report.', parent='same')
case('a02-identical-tree', 'A head with the same tree as the base, one commit on: nothing.')
case('a03-proposed-edited', 'A proposed record is edited freely.', [rput(3, rec(3, consequences='- Another effect.'))])
case('a04-readme-prose', 'The prose of the records README changes; the index does not.', [put(f'{D}/README.md', readme(ROWS, 'Other words.'))])
case('a05-new-proposed', 'A proposed record with its index row enters.', [rput(7, rec(7)), index(ROWS + [(7, 'proposed')])])
case('a06-proposed-rejected', 'A proposed record becomes rejected (no seal is involved).', [rput(3, rec(3, 'rejected')), index(rows_with(r3='rejected'))])
case('a07-rejected-reopened', 'A rejected record becomes proposed again.', [rput(4, rec(4, 'proposed')), index(rows_with(r4='proposed'))])
case('a08-template-changes', 'The template of the folder changes.', [put(f'{D}/template.md', TEMPLATE + '\nMore guidance.\n')])
case('a09-outside-the-folder', 'A file outside the records folder changes.', [put('src/main.js', 'console.log(1);\n')])
case('a10-no-folder-either-side', 'The repository has no records folder before and after: nothing to judge.', base='no-folder', changes=[put('src/main.js', 'x\n')])

# ---- a new record has to be fit to enter --------------------------------------------------------------------------------------
case('b01-new-without-row', 'A new record without an index row.', [rput(7, rec(7))], problems=[p(name(7), 'V-30')])
case('b02-new-gap', 'A new record that leaves a gap in the numbers.', [rput(8, rec(8)), index(ROWS + [(8, 'proposed')])], problems=[p(None, 'V-08')])
case('b03-new-bad-front-matter', 'A new record with a decision-makers that is a single value.', [rput(7, rec(7, makers='single')), index(ROWS + [(7, 'proposed')])], problems=[p(name(7), 'V-14')])
case('b04-new-duplicate-number', 'A new record with the number of an existing one (name order puts it after).', [rput(3, rec(3)), put(f'{D}/0003-zeta.md', rec(3)), index(ROWS + [(3, 'proposed', 'zeta')])],
     problems=[p('0003-zeta.md', 'V-07')])
case('b05-new-too-long', 'A new record over sixty lines.', [rput(7, rec(7, body_lines=60)), index(ROWS + [(7, 'proposed')])], problems=[p(name(7), 'V-10')])
case('b06-new-email', 'A new record with an e-mail address.', [rput(7, rec(7, mail=True)), index(ROWS + [(7, 'proposed')])], problems=[p(name(7), 'V-12')])
case('b07-new-unknown-key', 'A new record with a key that is not a standard key.', [rput(7, rec(7, keys='repos: a')), index(ROWS + [(7, 'proposed')])], problems=[p(name(7), 'V-13')])
case('b08-new-extra-key-allowed', 'The same key is fine when the settings of the base name it.', base='clean-settings', changes=[rput(7, rec(7, keys='repos: a')), index(ROWS + [(7, 'proposed')])])
case('b09-extra-key-in-the-head-only', 'A change that adds an extra key to the settings does not make the key valid for itself: the base decides.',
     [put('.github/record-keeper/settings.yml', 'extra-keys: [repos]\n'), rput(7, rec(7, keys='repos: a')), index(ROWS + [(7, 'proposed')])],
     problems=[p(name(7), 'V-13')], acts=[a('settings', '.github/record-keeper/settings.yml')])
case('b10-new-bad-index-status', 'A new record whose index row shows another status.', [rput(7, rec(7)), index(ROWS + [(7, 'accepted')])], problems=[p(name(7), 'V-33')])
case('b11-new-file-not-a-record', 'A stray file in the folder.', [put(f'{D}/notes.txt', 'x\n')], problems=[p('notes.txt', 'V-05')])
case('b12-new-executable', 'A new record with the executable mode.', [rput(7, rec(7)), put(f'{D}/{name(7)}', rec(7), '100755'), index(ROWS + [(7, 'proposed')])], problems=[p(name(7), 'T-01')])
case('b13-other-folder-with-records', 'A second folder of records appears.', [put('docs/adr/README.md', '# adr\n')], problems=[p(None, 'T-03', 'docs/adr')])
case('b14-attributes-for-the-folder', 'A .gitattributes for the folder appears.', [put(f'{D}/.gitattributes', '*.md -diff\n')],
     problems=[p(n, 'T-02', 'diff: unset') for n in sorted(['README.md', 'template.md'] + [name(i) for i in range(1, 7)])])
case('b15-symlink-record', 'A symbolic link in the folder.', [{'symlink': f'{D}/0007-link.md', 'target': '0003-third.md'}], problems=[p('0007-link.md', 'V-04')])

# ---- accepting ----------------------------------------------------------------------------------------------------------------
case('c01-new-accepted-record', 'A new record arrives accepted with a seal that verifies: an acceptance.', [rput(7, rec(7, 'accepted', True)), index(ROWS + [(7, 'accepted')])], acts=[acc(7)])
case('c02-proposed-becomes-accepted', 'A proposed record is accepted: it gets a seal and the status.', [rput(3, rec(3, 'accepted', True)), index(rows_with(r3='accepted'))], acts=[acc(3)])
case('c03-accepted-without-seal', 'A proposed record is set to accepted without a seal.', [rput(3, rec(3, 'accepted')), index(rows_with(r3='accepted'))], problems=[p(name(3), 'P-06', 'no seal')])
case('c04-accepted-wrong-seal', 'A proposed record is set to accepted with a seal that does not match.', [rput(3, rec(3, 'accepted', 'bad')), index(rows_with(r3='accepted'))], problems=[p(name(3), 'P-06', 'seal does not match')])
case('c05-accepted-other-generation', 'A seal of another generation fails closed.', [rput(3, rec(3, 'accepted', 'sha256-g2:' + HEX)), index(rows_with(r3='accepted'))], problems=[p(name(3), 'P-06', 'unknown generation g2')])
case('c06-accepted-malformed-seal', 'A seal that is not well formed is a format problem and not P-06.', [rput(3, rec(3, 'accepted', 'sha256-g1:xyz')), index(rows_with(r3='accepted'))], problems=[p(name(3), 'V-22')])
case('c07-seal-then-edit', 'A seal made for the record before a last edit of the text.', [rput(3, rec(3, 'accepted', g1.seal_g1(rec(3).encode()), consequences='- Edited after sealing.')), index(rows_with(r3='accepted'))],
     problems=[p(name(3), 'P-06', 'seal does not match')])
case('c08-seal-on-proposed', 'A seal on a record that is still proposed.', [rput(3, rec(3, 'proposed', True))], problems=[p(name(3), 'P-07')])
case('c09-seal-on-rejected', 'A seal on a rejected record.', [rput(4, rec(4, 'rejected', True))], problems=[p(name(4), 'P-07')])
case('c10-accepted-with-format-problem', 'An acceptance of a record that has a format problem: both are reported.', [rput(3, rec(3, 'accepted', True, makers='single')), index(rows_with(r3='accepted'))],
     problems=[p(name(3), 'V-14')], acts=[acc(3)])
case('c11-new-superseded-record', 'A record can arrive already superseded when its successor is sealed and lists it.',
     [rput(7, rec(7, 'superseded by 0008', True)), rput(8, rec(8, 'accepted', True, supersedes=[7])), index(ROWS + [(7, 'superseded by 0008'), (8, 'accepted')])], acts=[acc(7), acc(8)])
case('c12-accept-index-forgotten', 'An acceptance that does not change the index row.', [rput(3, rec(3, 'accepted', True))], problems=[p(name(3), 'V-33')], acts=[acc(3)])

# ---- sealed records do not change ---------------------------------------------------------------------------------------------
case('d01-delete-sealed', 'A sealed record is deleted.', [drop(f'{D}/{name(2)}'), index([r for r in ROWS if r[0] != 2])], problems=[p(name(2), 'P-01'), p(None, 'V-08')])
case('d02-delete-proposed', 'A proposed record is deleted too: a record is never deleted.', [drop(f'{D}/{name(3)}'), index([r for r in ROWS if r[0] != 3])], problems=[p(name(3), 'P-01'), p(None, 'V-08')])
case('d03-rename-sealed', 'A sealed record is renamed: the old name is gone (P-01) and the new file is a record that arrives sealed, an acceptance.', [drop(f'{D}/{name(2)}'), put(f'{D}/{name(2, "other")}', rec(2, 'accepted', True)), index([(r[0], r[1], 'other') if r[0] == 2 else r for r in ROWS])],
     problems=[p(name(2), 'P-01')], acts=[a('accept', f'{D}/{name(2, "other")}')])
case('d04-renumber-sealed', 'A sealed record gets another number.', [drop(f'{D}/{name(2)}'), put(f'{D}/{name(7, "second")}', rec(2, 'accepted', True)), index([r for r in ROWS if r[0] != 2] + [(7, 'accepted', 'second')])],
     problems=[p(name(2), 'P-01'), p(None, 'V-08'), p(name(7, 'second'), 'V-34')], acts=[a('accept', f'{D}/{name(7, "second")}')])
case('d05-sealed-becomes-link', 'A sealed record is replaced by a symbolic link.', [drop(f'{D}/{name(2)}'), {'symlink': f'{D}/{name(2)}', 'target': name(1)}],
     problems=[p(name(2), 'P-01'), p(name(2), 'V-04'), p(None, 'V-08'), p('README.md', 'V-32')])
case('d06-folder-removed', 'The records folder is removed altogether.', [drop(f'{D}/{name(i)}') for i in range(1, 7)] + [drop(f'{D}/README.md'), drop(f'{D}/template.md')],
     problems=[p(name(i), 'P-01') for i in range(1, 7)] + [p(None, 'V-01')])
case('d07-edit-sealed', 'The text of a sealed record is edited.', [rput(2, rec(2, 'accepted', consequences='- A different effect.').replace('---\n\n#', f'seal: {g1.seal_g1(rec(2).encode())}\n---\n\n#', 1))],
     problems=[p(name(2), 'P-02', 'line 21'), p(name(2), 'P-06', 'seal does not match')])
case('d08-edit-sealed-and-reseal', 'The text of a sealed record is edited and the seal is made again.', [rput(2, rec(2, 'accepted', True, consequences='- A different effect.'))],
     problems=[p(name(2), 'P-02', 'line 6')])
case('d09-trailing-space', 'A trailing space in a sealed record: the seal does not see it, the check does.', [rput(2, rec(2, 'accepted', True).replace('- Rule 2.', '- Rule 2. '))], problems=[p(name(2), 'P-02', 'line 17')])
case('d10-crlf', 'Line endings of a sealed record converted to CRLF.', [rput(2, rec(2, 'accepted', True).replace('\n', '\r\n'))], problems=[p(name(2), 'P-02', 'line 1')])
case('d11-date-changes', 'The date of a sealed record changes; the seal does not cover it, the check does.', [rput(2, rec(2, 'accepted', True, date='2026-10-02'))], problems=[p(name(2), 'P-02', 'line 3')])
case('d12-seal-removed', 'The seal of a sealed record is removed.', [rput(2, rec(2, 'accepted'))], problems=[p(name(2), 'P-02', 'line 6'), p(name(2), 'P-06', 'no seal')])
case('d13-seal-replaced', 'The seal of a sealed record is replaced by another well formed one.', [rput(2, rec(2, 'accepted', 'bad'))], problems=[p(name(2), 'P-02', 'line 6'), p(name(2), 'P-06', 'seal does not match')])
case('d14-erratum-added', 'Free text is added to Errata: it is not an entry (P-10), the section does not gain one entry (P-11), and the change is an erratum, an act.', [rput(2, rec(2, 'accepted', True, errata='- Typo fixed.'))],
     problems=[p(name(2), 'P-10', 'text outside an entry'), p(name(2), 'P-11', 'not one new entry')], acts=[ER2])
case('d15-deviation-added', 'Free text is added to Known deviations: not an entry (P-14); the change is a deviation note, an act.', [rput(2, rec(2, 'accepted', True, deviations='- Case owner/repo#1.'))],
     problems=[p(name(2), 'P-14', 'text outside an entry')], acts=[DV2])
case('d16-line-appended', 'A line appended at the end of a sealed record: the text is sealed, so the seal does not match any more either.', [rput(2, rec(2, 'accepted', True) + '\nMore.\n')], problems=[p(name(2), 'P-02', 'line 27'), p(name(2), 'P-06', 'seal does not match')])
case('d17-last-line-cut', 'The last line of a sealed record is cut.', [rput(2, rec(2, 'accepted', True).replace('\n- Not 2.\n', '\n'))], problems=[p(name(2), 'P-02', 'line 25'), p(name(2), 'P-06', 'seal does not match')])
case('d18-mode-changes', 'A sealed record gets the executable mode: its bytes are the same.', [put(f'{D}/{name(2)}', rec(2, 'accepted', True), '100755')], problems=[p(name(2), 'T-01')])
case('d19-edit-and-supersede', 'The text and the status of a sealed record change in one commit: it is a text change.',
     [rput(2, rec(2, 'superseded by 0007', consequences='- A different effect.').replace('---\n\n#', f'seal: {g1.seal_g1(rec(2).encode())}\n---\n\n#', 1)),
      rput(7, rec(7, 'accepted', True, supersedes=[2])), index(rows_with(r2='superseded by 0007') + [(7, 'accepted')])],
     problems=[p(name(2), 'P-02', 'line 2'), p(name(2), 'P-06', 'seal does not match')], acts=[acc(7)])
case('d20-status-spaces-only', 'The status line of a sealed record changes only in white space.', [rput(2, rec(2, 'accepted', True).replace('status: accepted', 'status: accepted '))], problems=[p(name(2), 'P-02', 'line 2')])
case('d21-status-key-case', 'The status key is written with a capital: no longer the status line.', [rput(2, rec(2, 'accepted', True).replace('status: accepted', 'Status: accepted'))], problems=[p(name(2), 'P-02', 'line 2')])
case('d22-sealed-text-with-unrelated-edit-elsewhere', 'Another sealed record is untouched while a proposed one changes.', [rput(3, rec(3, consequences='- New.'))])

# ---- the status of a sealed record --------------------------------------------------------------------------------------------
def with_status(n, status, **kw): return rec(n, 'accepted', True, **kw).replace('status: accepted', f'status: {status}', 1)
case('e01-accepted-to-proposed', 'A sealed record goes back to proposed.', [rput(2, with_status(2, 'proposed')), index(rows_with(r2='proposed'))], problems=[p(name(2), 'P-03', 'accepted -> proposed'), p(name(2), 'P-07')])
case('e02-accepted-to-rejected', 'A sealed record becomes rejected.', [rput(2, with_status(2, 'rejected')), index(rows_with(r2='rejected'))], problems=[p(name(2), 'P-03', 'accepted -> rejected'), p(name(2), 'P-07')])
case('e03-accepted-to-deprecated', 'A sealed record becomes deprecated.', [rput(2, with_status(2, 'deprecated')), index(rows_with(r2='deprecated'))], problems=[p(name(2), 'P-03', 'accepted -> deprecated')])
case('e04-superseded-to-accepted', 'A superseded record is reinstated.', [rput(5, with_status(5, 'accepted')), index(rows_with(r5='accepted'))], problems=[p(name(5), 'P-03', 'superseded by 0006 -> accepted'), p(name(6), 'P-05', '0005')])
case('e05-superseded-to-another', 'A superseded record is given another successor.', [rput(5, with_status(5, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[5])), index(rows_with(r5='superseded by 0007') + [(7, 'accepted')])],
     problems=[p(name(5), 'P-03', 'superseded by 0006 -> superseded by 0007'), p(name(6), 'P-05', '0005')], acts=[acc(7)])
case('e06-status-emptied', 'The status value is removed.', [rput(2, with_status(2, '').replace('status: ', 'status:', 1)), index(rows_with(r2=''))], problems=[p(name(2), 'P-03', 'accepted -> (empty)')])
case('e07-status-with-control', 'A status value that is not plain text is not shown.', [rput(2, with_status(2, 'x\x01y')), index(rows_with(r2='x'))], problems=[p(name(2), 'P-03', 'accepted -> (other)')])
case('e08-status-long', 'A status value longer than forty characters is not shown.', [rput(2, with_status(2, 'z' * 41)), index(rows_with(r2='z'))], problems=[p(name(2), 'P-03', 'accepted -> (other)')])
case('e09-supersede-properly', 'A sealed record is superseded by a new accepted record that lists it, and the index follows.',
     [rput(2, with_status(2, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[2])), index(rows_with(r2='superseded by 0007') + [(7, 'accepted')])], acts=[acc(7)])
case('e10-supersede-index-forgotten', 'The same, without the index row of the superseded record.',
     [rput(2, with_status(2, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[2])), index(ROWS + [(7, 'accepted')])], problems=[p(name(2), 'V-33')], acts=[acc(7)])
case('e11-successor-proposed', 'A sealed record is superseded by a record that is only proposed.',
     [rput(2, with_status(2, 'superseded by 0007')), rput(7, rec(7, 'proposed', supersedes=[2])), index(rows_with(r2='superseded by 0007') + [(7, 'proposed')])], problems=[p(name(2), 'P-04', '0007: not sealed')])
case('e12-successor-does-not-list', 'The successor is accepted and sealed but does not list the record.',
     [rput(2, with_status(2, 'superseded by 0007')), rput(7, rec(7, 'accepted', True)), index(rows_with(r2='superseded by 0007') + [(7, 'accepted')])], problems=[p(name(2), 'P-04', '0007: does not list this record')], acts=[acc(7)])
case('e13-successor-missing', 'The successor does not exist: V-20 only.', [rput(2, with_status(2, 'superseded by 0009')), index(rows_with(r2='superseded by 0009'))], problems=[p(name(2), 'V-20')])
case('e14-successor-lower', 'The successor has a lower number: V-20 only.', [rput(2, with_status(2, 'superseded by 0001')), index(rows_with(r2='superseded by 0001'))], problems=[p(name(2), 'V-20')])
case('e15-successor-itself-superseded', 'The successor of a record is later superseded itself: the first still stands.',
     [rput(6, with_status(6, 'superseded by 0007', supersedes=[5])), rput(7, rec(7, 'accepted', True, supersedes=[6])), index(rows_with(r6='superseded by 0007') + [(7, 'accepted')])], acts=[acc(7)])
case('e16-successor-unsealed-legacy', 'The successor says accepted but has no seal.',
     [rput(2, with_status(2, 'superseded by 0007')), rput(7, rec(7, 'accepted', supersedes=[2])), index(rows_with(r2='superseded by 0007') + [(7, 'accepted')])],
     problems=[p(name(2), 'P-04', '0007: not sealed'), p(name(7), 'P-06', 'no seal')])
case('e17-successor-has-bad-seal', 'The successor carries a seal that does not match.',
     [rput(2, with_status(2, 'superseded by 0007')), rput(7, rec(7, 'accepted', 'bad', supersedes=[2])), index(rows_with(r2='superseded by 0007') + [(7, 'accepted')])],
     problems=[p(name(2), 'P-04', '0007: not sealed'), p(name(7), 'P-06', 'seal does not match')])
case('e18-two-records-one-number', 'Two files with the successor number: the first in name order is the successor.',
     [rput(2, with_status(2, 'superseded by 0007')), put(f'{D}/0007-aaa.md', rec(7, 'proposed')), rput(7, rec(7, 'accepted', True, supersedes=[2])), index(rows_with(r2='superseded by 0007') + [(7, 'accepted'), (7, 'proposed', 'aaa')])],
     problems=[p(name(2), 'P-04', '0007: not sealed'), p(name(7), 'V-07')], acts=[acc(7)])
case('e19-delete-the-successor', 'The successor of a superseded record is deleted: the record is not vouched for any more.',
     [drop(f'{D}/{name(6)}'), index([r for r in ROWS if r[0] != 6])], problems=[p(name(5), 'V-20'), p(name(6), 'P-01')])

# ---- supersedes lists ------------------------------------------------------------------------------------------------------------
case('f01-lists-without-flipping', 'A record accepted with a supersedes list, and the listed record not set to superseded.',
     [rput(7, rec(7, 'accepted', True, supersedes=[2])), index(ROWS + [(7, 'accepted')])], problems=[p(name(7), 'P-05', '0002')], acts=[acc(7)])
case('f02-lists-a-proposed-record', 'A listed record that is only proposed.', [rput(7, rec(7, 'accepted', True, supersedes=[3])), index(ROWS + [(7, 'accepted')])], problems=[p(name(7), 'P-05', '0003')], acts=[acc(7)])
case('f03-lists-a-missing-record', 'A listed record that does not exist: V-36 only.', [rput(7, rec(7, 'accepted', True, supersedes=[9])), index(ROWS + [(7, 'accepted')])], problems=[p(name(7), 'V-36')], acts=[acc(7)])
case('f04-lists-a-higher-record', 'A listed record with a higher number: V-36 only.', [rput(7, rec(7, 'accepted', True, supersedes=[8])), rput(8, rec(8)), index(ROWS + [(7, 'accepted'), (8, 'proposed')])], problems=[p(name(7), 'V-36')], acts=[acc(7)])
case('f05-proposed-lists-without-flipping', 'A proposed record may list records that are still accepted.', [rput(7, rec(7, 'proposed', supersedes=[2])), index(ROWS + [(7, 'proposed')])])
case('f06-lists-two', 'A consolidation: one record replaces two, and both are set.',
     [rput(1, with_status(1, 'superseded by 0007')), rput(2, with_status(2, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[1, 2])), index(rows_with(r1='superseded by 0007', r2='superseded by 0007') + [(7, 'accepted')])], acts=[acc(7)])
case('f07-lists-two-flips-one', 'The same, with one of the two forgotten.',
     [rput(1, with_status(1, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[1, 2])), index(rows_with(r1='superseded by 0007') + [(7, 'accepted')])], problems=[p(name(7), 'P-05', '0002')], acts=[acc(7)])
case('f08-lists-a-record-with-another-successor', 'A listed record that has another successor already.',
     [rput(7, rec(7, 'accepted', True, supersedes=[5])), index(ROWS + [(7, 'accepted')])], problems=[p(name(7), 'P-05', '0005')], acts=[acc(7)])
case('f09-list-in-a-record-that-goes-back', 'The proposed successor is edited and its list is not checked until it is accepted.',
     [rput(7, rec(7, 'proposed', supersedes=[2, 3])), index(ROWS + [(7, 'proposed')])])
case('f10-legacy-pair-repaired', 'The base has a sealed record that lists a record still accepted; the change sets the status and repairs the pair.',
     base='legacy-pair', changes=[rput(2, with_status(2, 'superseded by 0003')), index([(1, 'accepted'), (2, 'superseded by 0003'), (3, 'accepted')])])
case('f11-legacy-pair-untouched', 'The pair is broken at the base and the change does not touch it: not reported again.', base='legacy-pair', changes=[rput(4, rec(4)), index([(1, 'accepted'), (2, 'accepted'), (3, 'accepted'), (4, 'proposed')])])

# ---- concurrent supersession (the named test of the design) -------------------------------------------------------------------------
CONC_BASE = {'world': 'world'}
case('g01-first-supersession-alone', 'Two pull requests replace record 0002, each with its own number. The first, alone against the base: fine.',
     [rput(2, with_status(2, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[2])), index(rows_with(r2='superseded by 0007') + [(7, 'accepted')])], acts=[acc(7)])
TREES['after-first'] = {**TREES['world'], f'{D}/{name(2)}': with_status(2, 'superseded by 0007'), f'{D}/{name(7)}': rec(7, 'accepted', True, supersedes=[2]),
                        f'{D}/README.md': readme(rows_with(r2='superseded by 0007') + [(7, 'accepted')])}
ROWS_AFTER = rows_with(r2='superseded by 0007') + [(7, 'accepted')]
case('g02-second-supersession-updated', 'The second, after the first was merged and the branch updated: it sets the status again.',
     base='after-first', changes=[rput(2, with_status(2, 'superseded by 0008')), rput(8, rec(8, 'accepted', True, supersedes=[2])), index(rows_with(r2='superseded by 0008') + [(7, 'accepted'), (8, 'accepted')])],
     problems=[p(name(2), 'P-03', 'superseded by 0007 -> superseded by 0008'), p(name(7), 'P-05', '0002')], acts=[acc(8)])
case('g03-second-supersession-without-flip', 'The second, updated, and it leaves the status alone: its list names a record that has another successor.',
     base='after-first', changes=[rput(8, rec(8, 'accepted', True, supersedes=[2])), index(ROWS_AFTER + [(8, 'accepted')])], problems=[p(name(8), 'P-05', '0002')], acts=[acc(8)])
case('g04-second-supersession-stale', 'The second, not updated: its branch was cut before the first was merged, so it does not contain the base.',
     base='after-first', parent='none', changes=[drop(f'{D}/{name(7)}'), rput(2, world_records()[2]), rput(8, rec(8, 'accepted', True, supersedes=[2])), index(ROWS + [(8, 'accepted')])],
     problems=[p(None, 'P-09')])
case('g05-same-number-in-two-requests', 'Two pull requests that add a record with the same number: the second, updated, has both files.',
     base='after-first', changes=[put(f'{D}/0008-aaa.md', rec(8)), put(f'{D}/0008-bbb.md', rec(8)), index(ROWS_AFTER + [(8, 'proposed', 'aaa'), (8, 'proposed', 'bbb')])], problems=[p('0008-bbb.md', 'V-07')])

# ---- the base must be an ancestor of the head ---------------------------------------------------------------------------------------
case('h01-unrelated-commits', 'The head does not contain the base.', [rput(3, rec(3, consequences='- X.'))], parent='none', problems=[p(None, 'P-09')])
case('h02-head-behind-base', 'The head is an ancestor of the base.', [rput(3, rec(3, consequences='- X.'))], parent='ahead', problems=[p(None, 'P-09')])

# ---- the shared folder ---------------------------------------------------------------------------------------------------------------
case('i01-shared-record-added', 'A record in the shared folder: not checked yet, so it fails.', [put(f'{D}/shared/0001-shared.md', rec(1, 'accepted', True))], problems=[p('shared/0001-shared.md', 'P-08')])
TREES['with-shared'] = {**TREES['world'], f'{D}/shared/0001-shared.md': rec(1, 'accepted', True), f'{D}/shared/README.md': '# shared\n'}
case('i02-shared-record-edited', 'A record in the shared folder is edited.', base='with-shared', changes=[put(f'{D}/shared/0001-shared.md', rec(1, 'accepted', True, consequences='- Other.'))], problems=[p('shared/0001-shared.md', 'P-08')])
case('i03-shared-record-deleted', 'A record in the shared folder is deleted.', base='with-shared', changes=[drop(f'{D}/shared/0001-shared.md')], problems=[p('shared/0001-shared.md', 'P-08')])
case('i04-shared-untouched', 'The shared folder is not touched.', base='with-shared', changes=[rput(3, rec(3, consequences='- Y.'))])
case('i05-shared-name-in-the-settings', 'The shared folder is the one the base names, not the one the change names: a folder called common is a subfolder that is not the shared folder.', base='clean-settings',
     changes=[put('.github/record-keeper/settings.yml', 'extra-keys: [repos]\nshared-folder: common\n'), put(f'{D}/common/0001-x.md', 'x\n')], problems=[p('common', 'V-06')], acts=[a('settings', '.github/record-keeper/settings.yml')])

# ---- a change that is old problems only: the ratchet ----------------------------------------------------------------------------------
LEGACY_ROWS = [(1, 'accepted'), (2, 'accepted'), (3, 'proposed'), (4, 'accepted')]
case('j01-legacy-untouched', 'The base has problems; a change that adds a clean proposed record reports none of them.', base='legacy', changes=[rput(5, rec(5)), index(LEGACY_ROWS + [(5, 'proposed')])])
case('j02-legacy-record-edited', 'The same change also edits the proposed record that has a format problem: its problems are reported now.', base='legacy',
     changes=[rput(3, rec(3, makers='single', consequences='- Edited.'))], problems=[p(name(3), 'V-14')])
case('j03-legacy-unsealed-edited', 'A record that says accepted but has no seal is edited: it has to be sealed.', base='legacy', changes=[rput(2, rec(2, 'accepted', consequences='- Edited.'))],
     problems=[p(name(2), 'P-06', 'no seal')])
case('j04-legacy-unsealed-sealed', 'A record that said accepted without a seal gets its seal and nothing else: an acceptance.', base='legacy', changes=[rput(2, rec(2, 'accepted', True))], acts=[acc(2)])
case('j05-legacy-sealed-long-superseded', 'A sealed record that is too long and has an e-mail address can still be superseded: the content rules do not apply to it.',
     base='legacy', changes=[rput(4, rec(4, 'accepted', True, body_lines=60, mail=True).replace('status: accepted', 'status: superseded by 0005')), rput(5, rec(5, 'accepted', True, supersedes=[4])),
                             index([(1, 'accepted'), (2, 'accepted'), (3, 'proposed'), (4, 'superseded by 0005'), (5, 'accepted')])], acts=[acc(5)])
case('j06-legacy-index-row-lost', 'A row of the index is lost for a record the change does not touch.', base='legacy', changes=[index([r for r in LEGACY_ROWS if r[0] != 1])], problems=[p(name(1), 'V-30')])
case('j07-legacy-template-added', 'The missing template is added: the problem goes.', base='legacy', changes=[put(f'{D}/template.md', TEMPLATE)])
case('j08-attributes-already-there', 'The folder has a .gitattributes at the base; a change to another record does not report it again.', base='attributes', changes=[rput(3, rec(3, consequences='- Z.'))],
     problems=[p(name(3), 'T-02', 'diff: unset')])
case('j09-attributes-unchanged-record', 'A record whose bytes did not change keeps the same attribute problem and is not reported.', base='attributes', changes=[put('src/a.js', 'x\n')])
case('j10-sealed-attribute-added', 'An attribute is added for a sealed record by a file in the folder: reported even if the record is unchanged.',
     changes=[put(f'{D}/.gitattributes', '0002-second.md -diff\n')], problems=[p(name(2), 'T-02', 'diff: unset')])

# ---- settings -----------------------------------------------------------------------------------------------------------------------
SET = '.github/record-keeper/settings.yml'
case('k01-broken-settings-block-everything', 'The settings of the base have a problem: every change reports it.', base='broken-settings', changes=[rput(3, rec(3, consequences='- Q.'))], settings=[(1, 'S-05', 'witnesses')])
case('k02-repair', 'A change that touches only the settings file and leaves it clean is let through.', base='broken-settings', changes=[put(SET, 'folder: docs/decisions\n')], acts=[a('settings', SET)])
case('k03-repair-with-another-file', 'The same, with another change in the commit: not a repair.', base='broken-settings', changes=[put(SET, 'folder: docs/decisions\n'), put('src/a.js', 'x\n')], settings=[(1, 'S-05', 'witnesses')], acts=[a('settings', SET)])
case('k04-repair-incomplete', 'A change to the settings that leaves a problem.', base='broken-settings', changes=[put(SET, 'witnesses: [a]\nowner: [b]\n')],
     settings=[(1, 'S-05', 'witnesses'), (2, 'S-05', 'owner')], acts=[a('settings', SET)])
case('k05-repair-by-deleting', 'The broken file is deleted: the defaults apply.', base='broken-settings', changes=[drop(SET)], acts=[a('settings', SET)])
case('k06-settings-broken-by-the-change', 'A change that breaks the settings reports the problem it leaves.', changes=[put(SET, 'folder: "docs/../x"\n')], settings=[(1, 'S-07', 'docs/../x')], acts=[a('settings', SET)])
case('k07-settings-added-clean', 'A clean settings file is added: an act.', changes=[put(SET, 'extra-keys: [repos]\n')], acts=[a('settings', SET)])
case('k08-link-repaired', 'The base has a link in front of the settings; replacing it with a real folder is a repair. The folder in front of the pin changed too, so the pin is an act as well, and so are the two workflow files of the kit.', base='linked-github', changes=[drop('.github'), put(SET, 'folder: docs/decisions\n')],
     acts=[a('settings', SET), a('pin', '.github/record-keeper.yml'), a('workflow', '.github/workflows/records-integrity.yml'), a('workflow', '.github/workflows/records-audit.yml')])
case('k09-link-introduced', 'A change that puts a link in front of the settings file: the settings of the head cannot be read.', changes=[{'symlink': '.github/record-keeper', 'target': 'elsewhere'}],
     settings=[(None, 'S-01', '.github/record-keeper')], acts=[a('settings', SET)])
case('k10-pin-changes', 'The pin changes: an act.', changes=[put('.github/record-keeper.yml', 'source: x/y\nversion: v1.0.0\n')], acts=[a('pin', '.github/record-keeper.yml')])
case('k11-other-workflow-file', 'A file in .github that is neither the settings nor the pin.', changes=[put('.github/workflows/x.yml', 'name: x\n')])
case('k12-folder-in-the-settings-of-the-base', 'The records are in the folder the settings of the base name.', base='other-folder', changes=[put('records/0007-seventh.md', rec(7)), put('records/README.md', readme(ROWS + [(7, 'proposed')]))])
case('k13-folder-moved-by-the-change', 'The change moves the records and the folder in the settings: judged by the base, the folder it names does not exist for the check.',
     changes=[put(SET, 'folder: moved\n')] + [put(f'moved/{k.split("/", 2)[2]}', v) for k, v in TREES['world'].items() if k.startswith(D + '/')],
     acts=[a('settings', SET)])
case('k14-settings-mode-only', 'The settings file changes its mode only: still the settings, still an act.', base='clean-settings', changes=[put(SET, 'extra-keys: [repos]\n', '100755')], acts=[a('settings', SET)])


# ---- the cases that mutation testing of the check asked for ------------------------------------------------------------------------
TREES['unreadable'] = {**TREES['world'], f'{D}/{name(7)}': rec(7).replace('## Decision', '<!-- x -->\n## Decision'), f'{D}/README.md': readme(ROWS + [(7, 'proposed')])}
TREES['settings-folder'] = {**TREES['world'], SET + '/x': 'x\n'}
STAT = lambda n, status: rec(n, 'accepted', True).replace('status: accepted', f'status: {status}', 1)
case('n01-status-with-trailing-digit', 'A new record whose status is superseded by a number of five digits: not a status, V-18 only.', [rput(7, rec(7, 'superseded by 00022')), index(ROWS + [(7, 'proposed')])], problems=[p(name(7), 'V-18')])
case('n02-status-with-leading-text', 'A new record whose status has text before superseded: V-18 only.', [rput(7, rec(7, 'xsuperseded by 0002')), index(ROWS + [(7, 'proposed')])], problems=[p(name(7), 'V-18')])
case('o01-null-file-sorts-before-a-name', 'A problem without a file comes before one with a file, also when the file name starts with a late letter.',
     [put(f'{D}/shared/0003-x.md', 'x\n'), rput(9, rec(9)), index(ROWS + [(9, 'proposed')])], problems=[p(None, 'V-08'), p('shared/0003-x.md', 'P-08')])
case('o02-settings-problems-on-one-line', 'The base and the head both have a problem on line 1 of the settings: ordered by rule, not by detail.', base='broken-settings', changes=[put(SET, 'zzz: [\n')],
     settings=[(1, 'S-03', 'zzz: ['), (1, 'S-05', 'witnesses')], acts=[a('settings', SET)])
case('o03-settings-problem-without-a-line-first', 'A problem without a line comes before a problem with one.', base='broken-settings', changes=[drop(SET), put(SET + '/x', 'x\n')],
     settings=[(None, 'S-01', SET), (1, 'S-05', 'witnesses')], acts=[a('settings', SET)])
case('p01-unreadable-record-edited', 'A record that g1 rejects is not sealed: an edit is judged by the format, not as a change of a sealed record.', base='unreadable',
     changes=[rput(7, rec(7).replace('## Decision', '<!-- x -->\n## Decision').replace('Why 7.', 'Why seven.'))], problems=[p(name(7), 'V-09')])
case('p02-unreadable-record-fixed', 'The same record is fixed.', base='unreadable', changes=[rput(7, rec(7))])
case('p03-superseded-by-an-unreadable-record', 'A sealed record superseded by a record that g1 rejects: the successor is not sealed.', base='unreadable',
     changes=[rput(2, STAT(2, 'superseded by 0007')), index(rows_with(r2='superseded by 0007') + [(7, 'proposed')])], problems=[p(name(2), 'P-04', '0007: not sealed')])
case('q01-superseded-by-itself', 'A sealed record set to superseded by its own number: V-20 only.', [rput(2, STAT(2, 'superseded by 0002')), index(rows_with(r2='superseded by 0002'))], problems=[p(name(2), 'V-20')])
case('q02-lists-itself', 'A record that lists its own number in supersedes: V-36 only.', [rput(7, rec(7, 'accepted', True, supersedes=[7])), index(ROWS + [(7, 'accepted')])], problems=[p(name(7), 'V-36')], acts=[acc(7)])
case('r01-first-byte-changes', 'The first byte of a sealed record changes.', [rput(2, rec(2, 'accepted', True).replace('---', 'x--', 1))], problems=[p(name(2), 'P-02', 'line 1')])
case('r02-blank-line-in-front', 'A blank line in front of a sealed record.', [rput(2, '\n' + rec(2, 'accepted', True))], problems=[p(name(2), 'P-02', 'line 1')])
case('s01-status-of-forty-characters', 'A status of forty plain characters is shown.', [rput(2, STAT(2, 'z' * 40)), index(rows_with(r2='z'))], problems=[p(name(2), 'P-03', 'accepted -> ' + 'z' * 40)])
case('s02-status-of-one-character', 'A status of one character is shown.', [rput(2, STAT(2, 'x')), index(rows_with(r2='x'))], problems=[p(name(2), 'P-03', 'accepted -> x')])
FLIP_ROWS = rows_with(r2='superseded by 0007') + [(7, 'accepted')]
case('t01-status-flip-with-trailing-tab', 'The status line of the flip ends in a tab: outside the seal and cut off, so it is the allowed change.',
     [rput(2, STAT(2, 'superseded by 0007\t')), rput(7, rec(7, 'accepted', True, supersedes=[2])), index(FLIP_ROWS)], acts=[acc(7)])
case('t02-status-flip-with-carriage-return', 'The status line of the flip ends in a carriage return, the rest of the file in line feeds.',
     [rput(2, STAT(2, 'superseded by 0007\r')), rput(7, rec(7, 'accepted', True, supersedes=[2])), index(FLIP_ROWS)], acts=[acc(7)])
case('t03-status-key-with-a-prefix', 'A line that ends in status: and a value but is another key: not a status change.', [rput(2, rec(2, 'accepted', True).replace('status: accepted', 'xstatus: superseded by 0007'))],
     problems=[p(name(2), 'P-02', 'line 2')])
case('t04-status-without-a-space', 'status: with the value right after the colon is not a key line.', [rput(2, rec(2, 'accepted', True).replace('status: accepted', 'status:superseded by 0007'))],
     problems=[p(name(2), 'P-02', 'line 2')])
case('t05-superseded-by-five-digits', 'A flip to a number of five digits is not the allowed change.', [rput(2, STAT(2, 'superseded by 00071')), index(rows_with(r2='x'))], problems=[p(name(2), 'P-03', 'accepted -> superseded by 00071')])
case('t06-superseded-with-a-prefix', 'A flip to text that only ends like the allowed status.', [rput(2, STAT(2, 'xsuperseded by 0007')), index(rows_with(r2='x'))], problems=[p(name(2), 'P-03', 'accepted -> xsuperseded by 0007')])
case('u01-settings-folder-emptied', 'The base has a folder where the settings file should be; removing what is in it is a repair, and a change to the settings.', base='settings-folder',
     changes=[drop(SET + '/x')], acts=[a('settings', SET)])
case('u02-broken-settings-no-change', 'The settings of the base are broken and nothing changes: the problem is reported, nothing is repaired.', base='broken-settings', parent='same', settings=[(1, 'S-05', 'witnesses')])

TREES['broken-settings-2'] = {**TREES['world'], SET: 'folder: docs/decisions\nwitnesses: [a]\n'}
case('o04-problem-without-a-file-before-a-later-one-with', 'A gap (no file) and a record that claims acceptance without a seal: the gap first, though it is found before.',
     [rput(9, rec(9, 'accepted')), index(ROWS + [(9, 'accepted')])], problems=[p(None, 'V-08'), p(name(9), 'P-06', 'no seal')])
case('o05-settings-problems-on-two-lines', 'A problem of the base on line 2 and one of the head on line 1: ordered by line.', base='broken-settings-2', changes=[put(SET, 'folder: [\n')],
     settings=[(1, 'S-03', 'folder: ['), (2, 'S-05', 'witnesses')], acts=[a('settings', SET)])
case('c13-claims-acceptance-with-a-format-problem', 'One file with a rule of each kind: P before V in the order.', [rput(3, rec(3, 'accepted', makers='single')), index(rows_with(r3='accepted'))],
     problems=[p(name(3), 'P-06', 'no seal'), p(name(3), 'V-14')])

def materialise(tree):
    out = {}
    for path, v in tree.items():
        out[path] = ('120000', v[1]) if isinstance(v, tuple) else ('100644', v)
    return out


def apply(tree, changes):
    t = dict(materialise(tree))
    for op in changes:
        if 'write' in op: t[op['write']] = (op.get('mode', '100644'), op['content'])
        elif 'remove' in op:
            t.pop(op['remove'], None)
        elif 'symlink' in op: t[op['symlink']] = ('120000', op['target'])
        elif 'submodule' in op: t[op['submodule']] = ('160000', '0123456789012345678901234567890123456789')
        elif 'mode' in op: t[op['mode']] = (op['to'], t[op['mode']][1])
    # a path that is a file cannot also have files below it, and the reverse
    for path in list(t):
        parts = path.split('/')
        for i in range(1, len(parts)):
            t.pop('/'.join(parts[:i]), None)
    return t


def data(b): return b'data %d\n' % len(b) + b + b'\n'


def stream_commit(ref, tree, parent=None):
    s = b'commit refs/heads/' + ref.encode() + b'\ncommitter T <t@example.com> 0 +0000\n' + data(b'case')
    if parent: s += b'from refs/heads/' + parent.encode() + b'\n'
    s += b'deleteall\n'
    for path, (mode, content) in sorted(tree.items()):
        pb = path.encode()
        if mode == '160000': s += b'M 160000 ' + content.encode() + b' ' + pb + b'\n'
        else: s += b'M ' + mode.encode() + b' inline ' + pb + b'\n' + data(content.encode() if isinstance(content, str) else content)
    return s


# ---- the act `owners` (M2.4): another list of owners, or fewer approvals ------------------------------------------------------------
OWN = 'owners: [alice/1001, bob/1002]\napprovals: 2\n'
TREES['owned'] = {**TREES['world'], SET: OWN}
TREES['owned-one'] = {**TREES['world'], SET: 'owners: [alice/1001]\napprovals: 1\n'}
TREES['owned-three'] = {**TREES['world'], SET: 'owners: [alice/1001, bob/1002, carol/1003]\napprovals: 3\n'}
TREES['broken-owners'] = {**TREES['world'], SET: 'owners: [bad]\n'}
SO = [a('settings', SET), a('owners', SET)]
case('w01-owner-added', 'A third owner is named: the list of owners changes.', base='owned', changes=[put(SET, 'owners: [alice/1001, bob/1002, carol/1003]\napprovals: 2\n')], acts=SO)
case('w02-owner-removed', 'An owner is taken out.', base='owned', changes=[put(SET, 'owners: [alice/1001]\napprovals: 2\n')], acts=SO)
case('w03-login-changed', 'Only a login changes: the IDs are the same, so only the settings act.', base='owned', changes=[put(SET, 'owners: [alicia/1001, bob/1002]\napprovals: 2\n')], acts=[a('settings', SET)])
case('w04-order-changed', 'The owners are listed in another order.', base='owned', changes=[put(SET, 'owners: [bob/1002, alice/1001]\napprovals: 2\n')], acts=[a('settings', SET)])
case('w05-approvals-lowered', 'The number of approvals is lowered.', base='owned', changes=[put(SET, 'owners: [alice/1001, bob/1002]\napprovals: 1\n')], acts=SO)
case('w06-approvals-raised', 'The number of approvals is raised: one owner is enough for that, so only the settings act.', base='owned', changes=[put(SET, 'owners: [alice/1001, bob/1002]\napprovals: 3\n')], acts=[a('settings', SET)])
case('w07-approvals-line-removed', 'The line with the default value is taken away: the same number.', base='owned', changes=[put(SET, 'owners: [alice/1001, bob/1002]\n')], acts=[a('settings', SET)])
case('w08-approvals-back-to-default', 'From 1 to the default 2: raised.', base='owned-one', changes=[put(SET, 'owners: [alice/1001]\n')], acts=[a('settings', SET)])
case('w09-approvals-to-default-lower', 'From 3 to the default 2: lowered.', base='owned-three', changes=[put(SET, 'owners: [alice/1001, bob/1002, carol/1003]\n')], acts=SO)
case('w10-settings-deleted', 'The settings file is deleted: nobody is an owner any more.', base='owned', changes=[drop(SET)], acts=SO)
case('w11-owners-line-broken', 'The head breaks the line: no owners, a problem of the settings, and the act.', base='owned', changes=[put(SET, 'owners: [alice/1001, bad]\napprovals: 2\n')], settings=[(1, 'S-07', 'bad')], acts=SO)
case('w12-other-setting-changes', 'Another setting changes, the owners stay.', base='owned', changes=[put(SET, 'folder: docs/decisions\nowners: [alice/1001, bob/1002]\napprovals: 2\n')], acts=[a('settings', SET)])
case('w13-owners-named-first-time', 'A repository without settings names its owners.', changes=[put(SET, 'owners: [alice/1001]\n')], acts=SO)
case('w14-id-changed', 'The login stays and the ID changes: another account.', base='owned', changes=[put(SET, 'owners: [alice/1005, bob/1002]\napprovals: 2\n')], acts=SO)
case('w15-link-in-front', 'A link in front of the file: the settings of the head cannot be read, so there are no owners.', base='owned', changes=[drop(SET), {'symlink': '.github/record-keeper', 'target': 'elsewhere'}],
     settings=[(None, 'S-01', '.github/record-keeper')], acts=SO)
case('w16-repair-of-owners', 'The base has a broken owners line (so no owners) and the change names owners: a repair, and the act.', base='broken-owners', changes=[put(SET, 'owners: [alice/1001]\n')], acts=SO)
case('w17-head-has-a-bom', 'The head file starts with a byte order mark, so it is not read: the default, so no owners.', base='owned', changes=[put(SET, '\ufeffowners: [alice/1001, bob/1002]\n')], settings=[(1, 'S-02', 'byte order mark')], acts=SO)
case('w18-both-lists-empty', 'Owners are empty before and after: nothing for the bar.', base='broken-owners', changes=[put(SET, 'extra-keys: [repos]\n')], acts=[a('settings', SET)])
case('w19-owners-and-pin', 'The owners change together with the pin: the acts are listed in their order.', base='owned', changes=[put(SET, 'owners: [alice/1001]\n'), put('.github/record-keeper.yml', 'x\n')], acts=[a('settings', SET), a('owners', SET), a('pin', '.github/record-keeper.yml')])
case('w20-shorter-and-lower', 'Both: fewer owners and fewer approvals: one act.', base='owned', changes=[put(SET, 'owners: [alice/1001]\napprovals: 1\n')], acts=SO)
case('w22-accept-with-owners', 'A record is accepted in a repository that has owners: the act accept alone.', base='owned', changes=[rput(7, rec(7, 'accepted', True)), index(ROWS + [(7, 'accepted')])], acts=[acc(7)])
case('w23-accept-and-a-problem', 'An acceptance together with an edit of a sealed record: the act and the problem.', base='owned',
     changes=[rput(7, rec(7, 'accepted', True)), index(ROWS + [(7, 'accepted')]), rput(2, rec(2, 'accepted', True).replace('- Rule 2.', '- Rule 2. '))], problems=[p(name(2), 'P-02', 'line 17')], acts=[acc(7)])
case('w24-every-act', 'An acceptance, a change of the owners and a change of the pin together: the four acts, in their order.', base='owned',
     changes=[put('.github/record-keeper.yml', 'x\n'), put(SET, 'owners: [alice/1001]\n'), rput(7, rec(7, 'accepted', True)), index(ROWS + [(7, 'accepted')])],
     acts=[acc(7), a('settings', SET), a('owners', SET), a('pin', '.github/record-keeper.yml')])
case('w21-same-owners-new-spelling', 'The same IDs and logins, written with quotes and a comment.', base='owned', changes=[put(SET, 'owners: ["alice/1001", \'bob/1002\']  # both\napprovals: 2\n')], acts=[a('settings', SET)])


# ---- errata and deviation notes (M2.6): docs/errata-and-deviations.md -----------------------------------------------------------------
def H(lines): return 'sha256:' + hashlib.sha256(('\n'.join(lines) + '\n').encode()).hexdigest()
def sl(n, status='accepted', **kw): return g1.seal_g1(rec(n, status, **kw).encode())
def ent(n, prev_hash, prev_seal, seal, reason='Fixed a typo.', date='2026-11-08'):
    return [f'### Erratum {n}', '', f'- date: {date}', f'- previous entry: {prev_hash}', f'- previous seal: {prev_seal}', f'- seal: {seal}', f'- reason: {reason}']
def dev(n, cite, reason='A one-off.', date='2026-11-08'): return [f'### Deviation {n}', '', f'- date: {date}', f'- case: {cite}', f'- reason: {reason}']
def txt(entries): return '\n\n'.join('\n'.join(e) for e in entries)

S0 = sl(2)                                         # the seal of record 2 in 'world'
C1, C2 = '- Effect 2, corrected.', '- Effect 2, corrected twice.'
S1, S2 = sl(2, consequences=C1), sl(2, consequences=C2)
E1 = ent(1, 'none', S0, S1)
E2 = ent(2, H(E1), S1, S2)
TREES['errata-one'] = {**TREES['world'], f'{D}/{name(2)}': rec(2, 'accepted', S1, consequences=C1, errata=txt([E1]))}
TREES['errata-two'] = {**TREES['world'], f'{D}/{name(2)}': rec(2, 'accepted', S2, consequences=C2, errata=txt([E1, E2]))}
KEYED = dict(keys='applies-to:\n  - src/**\nrepos: a\nwindow: until-2027')
TREES['keyed'] = {**TREES['world'], '.github/record-keeper/settings.yml': 'extra-keys: [repos, window]\n', f'{D}/{name(2)}': rec(2, 'accepted', True, **KEYED)}
SK = sl(2, **KEYED)
TREES['devs-one'] = {**TREES['world'], f'{D}/{name(2)}': rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5')]))}
TREES['prose-devs'] = {**TREES['world'], f'{D}/{name(2)}': rec(2, 'accepted', True, deviations='Written before acceptance.')}
TREES['legacy-mail'] = {**TREES['world'], f'{D}/{name(2)}': rec(2, 'accepted', True, mail=True)}
TREES['unsealed-errata'] = {**TREES['world'], f'{D}/{name(2)}': rec(2, 'accepted', True, errata='Free text.')}

def fix(n=2, consequences=C1, errata=None, deviations=None, status='accepted', seal=None, **kw):
    """Record n with a corrected Consequences, sealed (or with the given seal) and with the given sections."""
    return rec(n, status, sl(n, consequences=consequences, **kw) if seal is None else seal, consequences=consequences, errata=errata, deviations=deviations, **kw)

ER = lambda n=2: a('erratum', f'{D}/{name(n)}')
DV = lambda n=2: a('deviation', f'{D}/{name(n)}')
SINCE_OK = '2026-11-07T00:00:00Z'         # 72 hours before NOW
SINCE_EXACT = '2026-11-08T00:00:00Z'      # exactly 48 hours
SINCE_SHORT = '2026-11-08T00:00:01Z'      # 47 h 59 m 59 s
SINCE_NEW = '2026-11-09T23:30:00Z'        # half an hour
WAIT = lambda h: p(name(2), 'P-13', f'{h}h of 48h')

case('r01-erratum', 'An erratum: the text is corrected, the seal is made again, one entry is added; it has been open for 72 hours.',
     [rput(2, fix(errata=txt([E1])))], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('r02-erratum-exactly-48h', 'Exactly 48 hours is enough.', [rput(2, fix(errata=txt([E1])))], acts=[ER()], since=SINCE_EXACT, needs=dict(cases=[], clock=True))
case('r03-erratum-one-second-short', 'One second short of 48 hours: 47 whole hours.', [rput(2, fix(errata=txt([E1])))], problems=[WAIT(47)], acts=[ER()], since=SINCE_SHORT, needs=dict(cases=[], clock=True))
case('r04-erratum-just-opened', 'Half an hour: 0 whole hours.', [rput(2, fix(errata=txt([E1])))], problems=[WAIT(0)], acts=[ER()], since=SINCE_NEW, needs=dict(cases=[], clock=True))
case('r05-erratum-no-clock', 'No time is given: the wait cannot be checked, so it fails.', [rput(2, fix(errata=txt([E1])))], problems=[p(name(2), 'P-13', 'no clock')], acts=[ER()], needs=dict(cases=[], clock=True))
case('r06-erratum-since-in-the-future', 'A time after now counts as no time at all.', [rput(2, fix(errata=txt([E1])))], problems=[WAIT(0)], acts=[ER()], since='2026-11-12T00:00:00Z', needs=dict(cases=[], clock=True))
TRAIL = rec(2, 'accepted', True).replace('- Rule 2.', '- Rule 2. ')
E_SAME = ent(1, 'none', S0, S0, 'A trailing space.')
case('r07-whitespace-erratum-no-wait', 'An erratum that leaves the seal as it is needs no wait, and no clock.', [rput(2, rec(2, 'accepted', S0, errata=txt([E_SAME])).replace('- Rule 2.', '- Rule 2. '))], acts=[ER()])
case('r08-erratum-second', 'A second erratum on a record that has one: the chain goes on.', base='errata-one', changes=[rput(2, fix(consequences=C2, errata=txt([E1, E2])))], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('r09-erratum-second-wrong-hash', 'The second entry names another hash of the first.', base='errata-one',
     changes=[rput(2, fix(consequences=C2, errata=txt([E1, ent(2, 'sha256:' + 'a' * 64, S1, S2)])))], problems=[p(name(2), 'P-10', 'entry 2: previous entry: expected ' + H(E1))], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('r10-erratum-second-wrong-previous-seal', 'The second entry names a previous seal that is not the one of the first.', base='errata-one',
     changes=[rput(2, fix(consequences=C2, errata=txt([E1, ent(2, H(E1), S0, S2)])))], problems=[p(name(2), 'P-10', 'entry 2: previous seal: expected ' + S1), p(name(2), 'P-11', 'previous seal: expected ' + S1)], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('r11-erratum-no-entry', 'The text and the seal change and no entry is added: not an erratum.', [rput(2, fix())], problems=[p(name(2), 'P-02', 'line 6')])
case('r12-erratum-two-entries', 'Two entries are added in one change.', [rput(2, fix(consequences=C2, errata=txt([E1, ent(2, H(E1), S1, S2)])))], problems=[p(name(2), 'P-11', 'not one new entry')], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('r13-erratum-earlier-entry-changed', 'The first entry is rewritten when the second is added.', base='errata-one',
     changes=[rput(2, fix(consequences=C2, errata=txt([ent(1, 'none', S0, S1, 'Another reason.'), ent(2, H(ent(1, 'none', S0, S1, 'Another reason.')), S1, S2)])))],
     problems=[p(name(2), 'P-11', 'earlier entry changed')], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('r14-erratum-entry-removed', 'The entry is taken away again and the old text comes back: still an erratum, and the earlier entry is gone.', base='errata-one', changes=[rput(2, rec(2, 'accepted', True))],
     problems=[p(name(2), 'P-11', 'earlier entry changed')], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('r15-erratum-wrong-previous-seal', 'The entry does not name the seal of the base as its previous seal.', [rput(2, fix(errata=txt([ent(1, 'none', 'sha256-g1:' + 'b' * 64, S1)])))],
     problems=[p(name(2), 'P-11', 'previous seal: expected ' + S0)], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('r16-erratum-wrong-new-seal', 'The last entry does not name the seal of the record.', [rput(2, fix(errata=txt([ent(1, 'none', S0, 'sha256-g1:' + 'c' * 64)])))],
     problems=[p(name(2), 'P-10', 'seal: the last entry is not the seal of the record')], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('r17-erratum-seal-not-made-again', 'The text changes and the old seal stays: the record does not verify.', [rput(2, fix(errata=txt([E_SAME]), seal=S0))],
     problems=[p(name(2), 'P-06', 'seal does not match')], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('r18-erratum-without-a-text-change', 'An entry is added and the text is the same.', [rput(2, rec(2, 'accepted', S0, errata=txt([E_SAME])))], problems=[p(name(2), 'P-11', 'no change of the text')], acts=[ER()])
case('r19-erratum-and-status', 'The text, an entry and the status change together.', [rput(2, fix(errata=txt([E1])).replace('status: accepted', 'status: superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[2])), index(rows_with(r2='superseded by 0007') + [(7, 'accepted')])],
     problems=[p(name(2), 'P-02', 'line 2')], acts=[acc(7)])
case('r20-erratum-and-date', 'The date of the record changes with the erratum.', [rput(2, fix(errata=txt([E1])).replace('date: 2026-10-01', 'date: 2026-11-08'))], problems=[p(name(2), 'P-02', 'line 3')])
case('r21-erratum-and-deviation', 'An erratum and a deviation entry in one change: not either of them.', [rput(2, fix(errata=txt([E1]), deviations=txt([dev(1, 'pull 5')])))], problems=[p(name(2), 'P-02', 'line 6')], cases={'issue': [], 'pull': [5]})
case('r22-erratum-unreadable-head', 'The corrected text breaks a rule of g1: the head cannot be read, so it is not an erratum, and V-09 is not asked of a sealed record.', [rput(2, fix(errata=txt([E1]), consequences='- Effect <!-- hidden -->.', seal=S1))], problems=[p(name(2), 'P-02', 'line 6')])
M23 = g1.seal_g1(rec(2, 'accepted', consequences=C1, mail=True).encode())
case('r23-erratum-mail', 'The corrected text brings an e-mail address.', [rput(2, rec(2, 'accepted', M23, consequences=C1, mail=True, errata=txt([ent(1, 'none', S0, M23)])))], problems=[p(name(2), 'V-12')], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('r24-erratum-removes-mail', 'The old text had an e-mail address and the erratum removes it.', base='legacy-mail',
     changes=[rput(2, rec(2, 'accepted', sl(2), errata=txt([ent(1, 'none', sl(2, mail=True), sl(2))])))], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('r25-erratum-keeps-mail', 'The old text had an e-mail address and the erratum leaves it: not a new problem of the head, because the base has it.', base='legacy-mail',
     changes=[rput(2, rec(2, 'accepted', sl(2, mail=True, consequences=C1), consequences=C1, mail=True, errata=txt([ent(1, 'none', sl(2, mail=True), sl(2, mail=True, consequences=C1))])))], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
M26 = g1.seal_g1(rec(2, 'accepted', consequences=C1, body_lines=60).encode())
case('r26-erratum-longer-than-sixty-lines', 'An erratum may make a record longer than sixty lines: the length is judged at acceptance.', [rput(2, rec(2, 'accepted', M26, consequences=C1, body_lines=60, errata=txt([ent(1, 'none', S0, M26)])))],
     acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))

T28 = rec(2, 'accepted', consequences=C1).replace('# The second decision', '# The 2nd decision')
M28 = g1.seal_g1(T28.encode())
case('r28-erratum-title-without-index', 'The title of the record is corrected and the index shows the old one.',
     [rput(2, rec(2, 'accepted', M28, consequences=C1, errata=txt([ent(1, 'none', S0, M28)])).replace('# The second decision', '# The 2nd decision'))],
     problems=[p(name(2), 'V-34')], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))

# the keys an erratum may not change
def keyed_head(keys, entries=None):
    kw = dict(keys=keys)
    return rec(2, 'accepted', sl(2, consequences=C1, **kw), consequences=C1, errata=txt([ent(1, 'none', SK, sl(2, consequences=C1, **kw))]), **kw)
case('k01-erratum-keeps-the-keys', 'An erratum on a record that has the four kinds of key leaves them: fine.', base='keyed', changes=[rput(2, keyed_head(KEYED['keys']))], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('k02-erratum-changes-applies-to', 'The applies-to list changes.', base='keyed', changes=[rput(2, keyed_head('applies-to:\n  - lib/**\nrepos: a\nwindow: until-2027'))],
     problems=[p(name(2), 'P-12', 'applies-to')], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('k03-erratum-changes-repos', 'The repos key changes.', base='keyed', changes=[rput(2, keyed_head('applies-to:\n  - src/**\nrepos: b\nwindow: until-2027'))], problems=[p(name(2), 'P-12', 'repos')], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('k04-erratum-changes-window', 'The window changes.', base='keyed', changes=[rput(2, keyed_head('applies-to:\n  - src/**\nrepos: a\nwindow: until-2028'))], problems=[p(name(2), 'P-12', 'window')], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('k05-erratum-drops-a-key', 'The window key is taken away.', base='keyed', changes=[rput(2, keyed_head('applies-to:\n  - src/**\nrepos: a'))], problems=[p(name(2), 'P-12', 'window')], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('k06-erratum-adds-applies-to', 'A record that had no applies-to gets one.', [rput(2, rec(2, 'accepted', sl(2, consequences=C1, keys='applies-to:\n  - src/**'), consequences=C1, keys='applies-to:\n  - src/**', errata=txt([ent(1, 'none', S0, sl(2, consequences=C1, keys='applies-to:\n  - src/**'))])))],
     problems=[p(name(2), 'P-12', 'applies-to')], acts=[ER()], since=SINCE_OK, needs=dict(cases=[], clock=True))
case('k07-erratum-changes-supersedes', 'Record 6 stops listing record 5: the successor no longer vouches for it.',
     [rput(6, rec(6, 'accepted', sl(6, consequences=C1), consequences=C1, errata=txt([ent(1, 'none', sl(6, supersedes=[5]), sl(6, consequences=C1))])))],
     problems=[p(name(5), 'P-04', '0006: does not list this record'), p(name(6), 'P-12', 'supersedes')], acts=[ER(6)], since=SINCE_OK, needs=dict(cases=[], clock=True))

# the chain as a state rule
BADE = lambda **kw: ent(1, 'none', S0, S1, **kw)


# the chain of Errata as a state rule: the entry added is judged at the head like every entry
def one(entry, **kw): return rput(2, fix(errata=txt([entry]), **kw))
def at_(entry, i, line): return entry[:i] + [line] + entry[i + 1:]
OK1 = dict(since=SINCE_OK, needs=dict(cases=[], clock=True))
case('s01-entry-bad-number', 'The only entry is numbered 2.', [one(at_(E1, 0, '### Erratum 2'))], problems=[p(name(2), 'P-10', 'entry 1: number: expected 1')], acts=[ER()], **OK1)
case('s02-entry-keys-swapped', 'The keys previous seal and seal are in the other order.', [one(E1[:4] + [E1[5], E1[4]] + E1[6:])], problems=[p(name(2), 'P-10', 'entry 1: keys: expected date, previous entry, previous seal, seal, reason')], acts=[ER()], **OK1)
case('s03-entry-without-reason', 'The entry has no reason.', [one(E1[:6])], problems=[p(name(2), 'P-10', 'entry 1: keys: expected date, previous entry, previous seal, seal, reason')], acts=[ER()], **OK1)
case('s04-entry-extra-key', 'The entry has a sixth key.', [one(E1 + ['- note: more'])], problems=[p(name(2), 'P-10', 'entry 1: keys: expected date, previous entry, previous seal, seal, reason')], acts=[ER()], **OK1)
case('s05-entry-bad-date', 'The date of the entry is not a day.', [one(at_(E1, 2, '- date: 2026-02-30'))], problems=[p(name(2), 'P-10', 'entry 1: date: not a date')], acts=[ER()], **OK1)
case('s06-first-entry-names-a-hash', 'The first entry names a hash as the entry before it.', [one(at_(E1, 3, '- previous entry: sha256:' + 'd' * 64))], problems=[p(name(2), 'P-10', 'entry 1: previous entry: expected none')], acts=[ER()], **OK1)
case('s07-previous-seal-not-a-seal', 'The previous seal is not a seal; it is not the seal of the base either.', [one(at_(E1, 4, '- previous seal: abc'))],
     problems=[p(name(2), 'P-10', 'entry 1: previous seal: not a seal'), p(name(2), 'P-11', 'previous seal: expected ' + S0)], acts=[ER()], **OK1)
case('s08-seal-not-a-seal', 'The seal of the entry is not a seal.', [one(at_(E1, 5, '- seal: sha256-g2:' + 'e' * 64))], problems=[p(name(2), 'P-10', 'entry 1: seal: not a seal')], acts=[ER()], **OK1)
case('s09-reason-too-long', 'The reason has 501 characters.', [one(at_(E1, 6, '- reason: ' + 'x' * 501))], problems=[p(name(2), 'P-10', 'entry 1: reason: empty or too long')], acts=[ER()], **OK1)
case('s10-reason-500-characters', 'A reason of 500 characters is fine.', [one(at_(E1, 6, '- reason: ' + 'x' * 500))], acts=[ER()], **OK1)
case('s11-text-after-the-entry', 'A line after the entry that is in no entry... it belongs to the entry, whose keys then do not fit.', [rput(2, fix(errata=txt([E1]) + '\n\nAnd more.'))], problems=[p(name(2), 'P-10', 'entry 1: keys: expected date, previous entry, previous seal, seal, reason')], acts=[ER()], **OK1)
case('s12-text-before-the-entry', 'Text in Errata in front of the entry.', [rput(2, fix(errata='Corrected once.\n\n' + txt([E1])))], problems=[p(name(2), 'P-10', 'text outside an entry')], acts=[ER()], **OK1)
case('s13-other-heading', 'The heading of the entry has words after the number: not an entry.', [one(at_(E1, 0, '### Erratum 1 (typo)'))], problems=[p(name(2), 'P-10', 'text outside an entry'), p(name(2), 'P-11', 'not one new entry')], acts=[ER()], **OK1)
case('s14-deviation-heading-in-errata', 'An entry of the other kind in Errata.', [one(at_(E1, 0, '### Deviation 1'))], problems=[p(name(2), 'P-10', 'text outside an entry'), p(name(2), 'P-11', 'not one new entry')], acts=[ER()], **OK1)
case('s15-no-blank-after-heading', 'No empty line after the heading.', [one(E1[:1] + E1[2:])], problems=[p(name(2), 'P-10', 'entry 1: keys: expected date, previous entry, previous seal, seal, reason')], acts=[ER()], **OK1)
case('s16-blank-between-keys', 'An empty line between two keys.', [one(E1[:3] + [''] + E1[3:])], problems=[p(name(2), 'P-10', 'entry 1: keys: expected date, previous entry, previous seal, seal, reason')], acts=[ER()], **OK1)
case('s17-crlf-in-the-entry', 'The lines of the entry end in CRLF: read as LF.', [rput(2, fix(errata='\r\n'.join(E1)))], acts=[ER()], **OK1)
case('s18-trailing-spaces-in-the-entry', 'The lines of the entry end in spaces: cut off.', [rput(2, fix(errata='  \n'.join(E1)))], acts=[ER()], **OK1)
case('s19-leading-space-in-a-value', 'A value that starts with two spaces is not a value of the form.', [one(at_(E1, 2, '- date:  2026-11-08'))], problems=[p(name(2), 'P-10', 'entry 1: keys: expected date, previous entry, previous seal, seal, reason')], acts=[ER()], **OK1)
case('s20-number-with-leading-zero', 'The number has a leading zero: not an entry heading.', [one(at_(E1, 0, '### Erratum 01'))], problems=[p(name(2), 'P-10', 'text outside an entry'), p(name(2), 'P-11', 'not one new entry')], acts=[ER()], **OK1)
case('s21-old-chain-bad-and-untouched', 'The chain of a record was bad at the base; a change elsewhere does not report it again.', base='unsealed-errata', changes=[rput(3, rec(3, consequences='- Other.'))])
case('s22-acceptance-with-a-bad-chain', 'A record is accepted with free text in Errata: an acceptance whose chain is not one.', [rput(3, rec(3, 'accepted', True, errata='Free text.')), index(rows_with(r3='accepted'))],
     problems=[p(name(3), 'P-10', 'text outside an entry')], acts=[acc(3)])
E_ODD = ent(2, H(E1), S1, S2)
case('s23-second-entry-bad-number', 'The second entry is numbered 3.', base='errata-one', changes=[rput(2, fix(consequences=C2, errata=txt([E1, at_(E_ODD, 0, '### Erratum 3')])))],
     problems=[p(name(2), 'P-10', 'entry 2: number: expected 2')], acts=[ER()], **OK1)
case('s24-second-entry-says-none', 'The second entry says it has no entry before it.', base='errata-one', changes=[rput(2, fix(consequences=C2, errata=txt([E1, at_(E_ODD, 3, '- previous entry: none')])))],
     problems=[p(name(2), 'P-10', 'entry 2: previous entry: expected ' + H(E1))], acts=[ER()], **OK1)

# deviation notes
CASES5 = {'issue': [], 'pull': [5]}
NEED_P5 = dict(cases=[('pull', 5)], clock=False)
case('x01-deviation-note', 'A first deviation note, citing a pull request that exists.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5')])))], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('x02-deviation-issue', 'A note citing an issue that exists.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'issue 12')])))], acts=[DV()], cases={'issue': [12], 'pull': []}, needs=dict(cases=[('issue', 12)], clock=False))
case('x03-deviation-commit-in-the-base', 'A note citing the base commit itself: a commit of the history.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'commit @BASE@')])))], acts=[DV()])
case('x04-deviation-commit-elsewhere', 'A note citing a commit that exists but is not in the history of the base.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'commit @BASE:r08-erratum-second@')])))],
     problems=[p(name(2), 'P-14', 'entry 1: case does not resolve')], acts=[DV()])
case('x05-deviation-commit-missing', 'A note citing a commit that does not exist.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'commit ' + 'a' * 40)])))], problems=[p(name(2), 'P-14', 'entry 1: case does not resolve')], acts=[DV()])
case('x06-deviation-long-commit-missing', 'A commit of the longer form that does not exist.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'commit ' + 'a' * 64)])))], problems=[p(name(2), 'P-14', 'entry 1: case does not resolve')], acts=[DV()])
case('x07-deviation-no-cases-given', 'An issue is cited and no list of what exists is given.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'issue 12')])))],
     problems=[p(name(2), 'P-14', 'entry 1: case does not resolve')], acts=[DV()], needs=dict(cases=[('issue', 12)], clock=False))
case('x08-deviation-issue-is-a-pull', 'The number is a pull request, and the note says issue.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'issue 5')])))],
     problems=[p(name(2), 'P-14', 'entry 1: case does not resolve')], acts=[DV()], cases=CASES5, needs=dict(cases=[('issue', 5)], clock=False))
case('x09-deviation-second-note', 'A second note after the first.', base='devs-one', changes=[rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5'), dev(2, 'pull 5')])))], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('x10-deviation-two-notes-at-once', 'Two notes in one change, citing three things.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5'), dev(2, 'issue 3'), dev(3, 'pull 5')])))], acts=[DV()],
     cases={'issue': [3], 'pull': [5]}, needs=dict(cases=[('issue', 3), ('pull', 5)], clock=False))
case('x11-deviation-wrong-number', 'The new note is numbered 1 again.', base='devs-one', changes=[rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5'), dev(1, 'pull 5')])))],
     problems=[p(name(2), 'P-14', 'entry 1: number: expected 2')], acts=[DV()], cases=CASES5)
case('x12-deviation-earlier-entry-changed', 'The first note is rewritten when the second is added.', base='devs-one', changes=[rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5', 'Another reason.'), dev(2, 'pull 5')])))],
     problems=[p(name(2), 'P-14', 'earlier entry changed')], acts=[DV()], cases=CASES5)
case('x13-deviation-after-prose', 'Text written before acceptance stays; the note is numbered 1.', base='prose-devs', changes=[rput(2, rec(2, 'accepted', True, deviations='Written before acceptance.\n\n' + txt([dev(1, 'pull 5')])))], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('x14-deviation-text-after-the-note', 'A line after the note joins the note, and the keys no longer fit.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5')]) + '\n\nMore.'))],
     problems=[p(name(2), 'P-14', 'entry 1: keys: expected date, case, reason')], acts=[DV()], cases=CASES5)
case('x15-deviation-no-entry', 'The section gains an empty line and nothing else.', base='prose-devs', changes=[rput(2, rec(2, 'accepted', True, deviations='Written before acceptance.\n'))],
     problems=[p(name(2), 'P-14', 'no new entry')], acts=[DV()])
case('x16-deviation-bad-date', 'The date of the note is not a day.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5', date='2026-13-01')])))], problems=[p(name(2), 'P-14', 'entry 1: date: not a date')], acts=[DV()], cases=CASES5)
case('x17-deviation-keys-swapped', 'The keys case and reason in the other order.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5')[:3] + [dev(1, 'pull 5')[4], dev(1, 'pull 5')[3]]])))],
     problems=[p(name(2), 'P-14', 'entry 1: keys: expected date, case, reason')], acts=[DV()], cases=CASES5)
for k, bad in enumerate(['pull 0', 'pull 05', 'issue 1234567890', 'commit abc', 'Pull 5', 'pull #5', 'owner/repo#5', 'pull 5 and 6', 'commit ' + 'A' * 40], 18):
    case(f'x{k}-deviation-bad-case-{k - 17}', f'The case is written `{bad}`.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, bad)])))], problems=[p(name(2), 'P-14', 'entry 1: case: expected issue N, pull N or commit HEX')], acts=[DV()], cases=CASES5)
case('x27-deviation-reason-too-long', 'The reason of the note has 501 characters.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5', 'x' * 501)])))], problems=[p(name(2), 'P-14', 'entry 1: reason: empty or too long')], acts=[DV()], cases=CASES5)
case('x28-deviation-only-the-bad-entry', 'Two notes, the second with a bad date: only it is reported.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5'), dev(2, 'pull 5', date='2026-00-01')])))],
     problems=[p(name(2), 'P-14', 'entry 2: date: not a date')], acts=[DV()], cases=CASES5, needs=NEED_P5)
LATE = rec(2, 'accepted', True) + '\n## Known deviations\n\n' + txt([dev(1, 'pull 5')]) + '\n'
case('x29-deviation-section-after-alternatives', 'The section is added after Alternatives considered: the order of the sections is wrong.', [rput(2, LATE)], problems=[p(name(2), 'V-27')], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('x30-deviation-mail', 'The reason of the note contains an e-mail address.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5', 'Ask someone@example.com.')])))], problems=[p(name(2), 'V-12')], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('x31-deviation-credential', 'The reason of the note contains a key.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5', 'Used AKIA' + 'A' * 16 + ' once.')])))], problems=[p(name(2), 'V-11')], acts=[DV()], cases=CASES5, needs=NEED_P5)
TREES['long'] = {**TREES['world'], f'{D}/{name(2)}': rec(2, 'accepted', True, body_lines=60)}
case('x32-deviation-past-sixty-lines', 'A note may take a record past sixty lines.', base='long', changes=[rput(2, rec(2, 'accepted', True, body_lines=60, deviations=txt([dev(1, 'pull 5')])))], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('x33-deviation-on-a-record-with-a-mail', 'The record had an e-mail address at the base: the note does not bring it.', base='legacy-mail', changes=[rput(2, rec(2, 'accepted', True, mail=True, deviations=txt([dev(1, 'pull 5')])))], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('x34-deviation-heading-only', 'The section is added with a heading and no entry.', [rput(2, rec(2, 'accepted', True, deviations=' '))], problems=[p(name(2), 'P-14', 'no new entry'), p(name(2), 'V-28')], acts=[DV()])
case('x35-deviation-on-a-proposed-record', 'A proposed record gets a Known deviations section: free editing, no act.', [rput(3, rec(3, deviations='Nothing yet.'))])
case('x36-deviation-on-a-superseded-record', 'A superseded record gets a note.', [rput(5, rec(5, 'superseded by 0006', True, deviations=txt([dev(1, 'pull 5')])))], acts=[DV(5)], cases=CASES5, needs=NEED_P5)
case('x37-deviation-and-a-status-change', 'A note and a status change together.', [rput(2, rec(2, 'superseded by 0007', True, deviations=txt([dev(1, 'pull 5')]))), rput(7, rec(7, 'accepted', True, supersedes=[2])), index(rows_with(r2='superseded by 0007') + [(7, 'accepted')])],
     problems=[p(name(2), 'P-02', 'line 2')], acts=[acc(7)], cases=CASES5)
case('x38-deviation-and-a-text-change', 'A note and an edit of the sealed text.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 5')]), consequences='- Different.'))], problems=[p(name(2), 'P-02', 'line 6')], cases=CASES5)
case('x39-deviation-removed', 'A note is taken away.', base='devs-one', changes=[rput(2, rec(2, 'accepted', True))], problems=[p(name(2), 'P-14', 'earlier entry changed')], acts=[DV()])
case('x40-deviation-and-erratum-on-two-records', 'Two records, an erratum on one and a note on the other: two acts.', [rput(2, fix(errata=txt([E1]))), rput(1, rec(1, 'accepted', True, deviations=txt([dev(1, 'pull 5')])))],
     acts=[ER(), DV(1)], since=SINCE_OK, cases=CASES5, needs=dict(cases=[('pull', 5)], clock=True))
case('x41-every-act', 'An acceptance, an erratum, a deviation note, the settings, the owners and the pin together: the acts in their order.', base='owned',
     changes=[put('.github/record-keeper.yml', 'x\n'), put(SET, 'owners: [alice/1001]\n'), rput(7, rec(7, 'accepted', True)), index(ROWS + [(7, 'accepted')]), rput(2, fix(errata=txt([E1]))), rput(1, rec(1, 'accepted', True, deviations=txt([dev(1, 'pull 5')])))],
     acts=[acc(7), ER(), DV(1), a('settings', SET), a('owners', SET), a('pin', '.github/record-keeper.yml')], since=SINCE_OK, cases=CASES5, needs=dict(cases=[('pull', 5)], clock=True))

# cases that mutation testing of the errata rules asked for
def seal_in(text):
    """The text of an accepted record, sealed: `text` has no seal line."""
    return text.replace('  - maintainers\n---', f'  - maintainers\nseal: {g1.seal_g1(text.encode())}\n---', 1)
X9 = 'sha256-g1:' + '9' * 64
case('r29-erratum-text-same-seal-changed', 'An entry is added, the text is the same and the seal line is another one: no change of the text, and the seal does not match.',
     [rput(2, rec(2, 'accepted', X9, errata=txt([ent(1, 'none', S0, X9)])))], problems=[p(name(2), 'P-06', 'seal does not match'), p(name(2), 'P-11', 'no change of the text')], acts=[ER()])
case('r30-erratum-no-blank-after-the-heading', 'The first entry follows the heading of Errata directly.', [rput(2, fix(errata=txt([E1])).replace('## Errata\n\n### Erratum 1', '## Errata\n### Erratum 1'))], acts=[ER()], **OK1)
case('s25-heading-number-1000', 'An entry numbered 1000 is an entry with the wrong number.', [one(at_(E1, 0, '### Erratum 1000'))], problems=[p(name(2), 'P-10', 'entry 1: number: expected 1')], acts=[ER()], **OK1)
case('s26-heading-number-10000', 'Five digits are not a number of an entry heading.', [one(at_(E1, 0, '### Erratum 10000'))], problems=[p(name(2), 'P-10', 'text outside an entry'), p(name(2), 'P-11', 'not one new entry')], acts=[ER()], **OK1)
case('s27-reason-of-one-character', 'A reason of one character is fine.', [one(at_(E1, 6, '- reason: x'))], acts=[ER()], **OK1)
case('s28-reason-of-two-characters', 'A reason of two characters is fine.', [one(at_(E1, 6, '- reason: ab'))], acts=[ER()], **OK1)
case('s29-key-line-with-text-in-front', 'Text in front of the dash makes a line that is no key.', [one(at_(E1, 2, 'x- date: 2026-11-08'))], problems=[p(name(2), 'P-10', 'entry 1: keys: expected date, previous entry, previous seal, seal, reason')], acts=[ER()], **OK1)
case('s30-previous-seal-too-long', 'The previous seal has 65 digits.', [one(at_(E1, 4, '- previous seal: ' + S0 + '0'))], problems=[p(name(2), 'P-10', 'entry 1: previous seal: not a seal'), p(name(2), 'P-11', 'previous seal: expected ' + S0)], acts=[ER()], **OK1)
case('s31-previous-seal-with-text-in-front', 'The previous seal has a letter in front.', [one(at_(E1, 4, '- previous seal: x' + S0))], problems=[p(name(2), 'P-10', 'entry 1: previous seal: not a seal'), p(name(2), 'P-11', 'previous seal: expected ' + S0)], acts=[ER()], **OK1)
case('s32-seal-too-long', 'The seal of the entry has 65 digits.', [one(at_(E1, 5, '- seal: ' + S1 + '0'))], problems=[p(name(2), 'P-10', 'entry 1: seal: not a seal')], acts=[ER()], **OK1)
case('s33-seal-with-text-in-front', 'The seal of the entry has a letter in front.', [one(at_(E1, 5, '- seal: x' + S1))], problems=[p(name(2), 'P-10', 'entry 1: seal: not a seal')], acts=[ER()], **OK1)
case('s34-other-heading-alone', 'Errata holds a heading of level 3 that is no entry, and nothing else.', [rput(3, rec(3, 'accepted', True, errata='### Notes')), index(rows_with(r3='accepted'))], problems=[p(name(3), 'P-10', 'text outside an entry')], acts=[acc(3)])
case('s35-empty-errata-section', 'A record is accepted with an Errata section that has no entry: a chain of no entries, and a section with no content.', [rput(3, rec(3, 'accepted', True, errata=' ')), index(rows_with(r3='accepted'))],
     problems=[p(name(3), 'V-28')], acts=[acc(3)])

# deviation notes: the numbering reads only the headings of the form, and a section ends where the next one starts
DEV1 = txt([dev(1, 'pull 5')])
case('x42-deviation-no-blank-after-the-heading', 'The first note follows the heading of Known deviations directly.', [rput(2, rec(2, 'accepted', True, deviations=DEV1).replace('## Known deviations\n\n### Deviation 1', '## Known deviations\n### Deviation 1'))], acts=[DV()], cases=CASES5, needs=NEED_P5)
DECOYS = '### Deviation 7 (old)\nx### Deviation 8\n### Deviation 10000\n### Erratum 3'
TREES['decoys'] = {**TREES['world'], f'{D}/{name(2)}': rec(2, 'accepted', True, deviations=DECOYS)}
case('x43-deviation-after-lines-that-look-like-notes', 'Headings of the base that are not of the form are not counted: the new note is numbered 1.', base='decoys', changes=[rput(2, rec(2, 'accepted', True, deviations=DECOYS + '\n\n' + DEV1))], acts=[DV()], cases=CASES5, needs=NEED_P5)
TREES['dev1000'] = {**TREES['world'], f'{D}/{name(2)}': rec(2, 'accepted', True, deviations=txt([dev(1000, 'pull 5')]))}
case('x44-deviation-after-note-1000', 'A base with a note numbered 1000: the next one is 1001.', base='dev1000', changes=[rput(2, rec(2, 'accepted', True, deviations=txt([dev(1000, 'pull 5'), dev(1001, 'pull 5')])))], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('x45-deviation-issue-and-pull-of-one-number', 'An issue 5 and a pull request 5 are two cases.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'issue 5'), dev(2, 'pull 5')])))], acts=[DV()],
     cases={'issue': [5], 'pull': [5]}, needs=dict(cases=[('issue', 5), ('pull', 5)], clock=False))
case('x46-deviation-needs-in-order', 'The cases are listed issues first, each kind by number, whatever the order of the notes.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'pull 1'), dev(2, 'issue 9'), dev(3, 'issue 2'), dev(4, 'pull 8')])))], acts=[DV()],
     cases={'issue': [2, 9], 'pull': [1, 8]}, needs=dict(cases=[('issue', 2), ('issue', 9), ('pull', 1), ('pull', 8)], clock=False))
case('x47-deviation-case-with-text-in-front', 'A letter in front of the case.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'xpull 5')])))], problems=[p(name(2), 'P-14', 'entry 1: case: expected issue N, pull N or commit HEX')], acts=[DV()], cases=CASES5)
case('x48-deviation-issue-of-nine-digits', 'An issue number of nine digits is a number.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'issue 123456789')])))], acts=[DV()], cases={'issue': [123456789], 'pull': []}, needs=dict(cases=[('issue', 123456789)], clock=False))
case('x49-deviation-long-commit-with-digits', 'A commit of the long form that has digits and letters: well formed, and absent.', [rput(2, rec(2, 'accepted', True, deviations=txt([dev(1, 'commit ' + '0123456789abcdef' * 4)])))],
     problems=[p(name(2), 'P-14', 'entry 1: case does not resolve')], acts=[DV()])
FENCE_PROSE = 'Before acceptance:\n\n```\n## Not a heading\n```'
TREES['devs-fence'] = {**TREES['world'], f'{D}/{name(2)}': rec(2, 'accepted', True, deviations=FENCE_PROSE)}
case('x50-deviation-after-a-fence-with-a-heading', 'A line that looks like a heading inside a fence does not end the section.', base='devs-fence', changes=[rput(2, rec(2, 'accepted', True, deviations=FENCE_PROSE + '\n\n' + DEV1))], acts=[DV()], cases=CASES5, needs=NEED_P5)
DIRECT = lambda body: seal_in(rec(2, 'accepted').replace('\n## Alternatives considered', body + '\n## Alternatives considered', 1))
TREES['devs-empty-direct'] = {**TREES['world'], f'{D}/{name(2)}': DIRECT('\n## Known deviations')}
case('x51-deviation-into-a-section-that-ends-at-once', 'Known deviations is a heading and the next section starts on the following line.', base='devs-empty-direct', changes=[rput(2, DIRECT('\n## Known deviations\n\n' + DEV1 + '\n'))], acts=[DV()], cases=CASES5, needs=NEED_P5)
TREES['devs-fence-direct'] = {**TREES['world'], f'{D}/{name(2)}': DIRECT('\n## Known deviations\n\n' + FENCE_PROSE)}
case('x52-deviation-after-a-fence-and-a-heading', 'The section ends with a fence and the next heading follows the closing line.', base='devs-fence-direct', changes=[rput(2, DIRECT('\n## Known deviations\n\n' + FENCE_PROSE + '\n\n' + DEV1 + '\n'))], acts=[DV()], cases=CASES5, needs=NEED_P5)

# the sections next to fences, and a record whose Errata is not the last section
ALT = '\n## Alternatives considered'
TREES['devs-fence-first'] = {**TREES['world'], f'{D}/{name(2)}': seal_in(rec(2, 'accepted').replace(ALT, '\n## Known deviations\n```\n## Not a heading\n```\n' + ALT, 1))}
case('x53-deviation-after-a-fence-at-the-heading', 'The fence starts on the line after the heading of the section.', base='devs-fence-first',
     changes=[rput(2, seal_in(rec(2, 'accepted').replace(ALT, '\n## Known deviations\n```\n## Not a heading\n```\n\n' + DEV1 + '\n' + ALT, 1)))], acts=[DV()], cases=CASES5, needs=NEED_P5)
ALT_FENCE = '\n## Alternatives considered\n```\ncode\n```\n'
TREES['alt-fence'] = {**TREES['world'], f'{D}/{name(2)}': seal_in(rec(2, 'accepted').replace(ALT + '\n\n- Not 2.', ALT_FENCE + '- Not 2.', 1))}
case('x54-deviation-before-a-section-that-opens-with-a-fence', 'The section after Known deviations starts with a fence on the line after its heading.', base='alt-fence',
     changes=[rput(2, seal_in(rec(2, 'accepted').replace(ALT + '\n\n- Not 2.', '\n## Known deviations\n\n' + DEV1 + '\n' + ALT_FENCE + '- Not 2.', 1)))], acts=[DV()], cases=CASES5, needs=NEED_P5)
MID0 = rec(2, 'accepted').replace(ALT, '\n## Errata\n\n@ENTRY@\n' + ALT, 1)
SMID = g1.seal_g1(MID0.encode())
MIDE = ent(1, 'none', SMID, SMID, 'A trailing space.')
MID = MID0.replace('@ENTRY@', txt([MIDE])).replace('  - maintainers\n---', f'  - maintainers\nseal: {SMID}\n---', 1)
TREES['errata-middle'] = {**TREES['world'], f'{D}/{name(2)}': MID}
case('s36-errata-before-another-section', 'Errata is followed by another section (g1 allows it, the format does not for a new record): its chain ends at the next heading, and a note can be added.', base='errata-middle',
     changes=[rput(2, MID.replace('\n## Errata', '\n## Known deviations\n\n' + DEV1 + '\n\n## Errata', 1))], acts=[DV()], cases=CASES5, needs=NEED_P5)

# ---- the files of the check (M2.7a): docs/protected-files.md ---------------------------------------------------------------------
WF, AU, TY = '.github/workflows/records-integrity.yml', '.github/workflows/records-audit.yml', '.github/workflows/test.yml'
RK, CP = 'record-keeper.mjs', 'check-pull-request.mjs'
TREES['kit'] = {**TREES['world'], WF: 'name: Records integrity\n', TY: 'name: Test\n', RK: '// the rules\n', CP: '// the program\n'}
TREES['kit-both'] = {**TREES['kit'], AU: 'name: Records audit\n'}
TREES['kit-collides'] = {**TREES['kit'], '.github/workflows/other.yml': 'name: Records integrity\n', '.github/workflows/clean.yml': 'name: Clean\n'}
WFA, WFB, CPA, RKA = a('workflow', WF), a('workflow', AU), a('code', CP), a('code', RK)
P15 = lambda path: p(None, 'P-15', path)
case('y01-workflow-edited', 'The workflow of the check is edited.', base='kit', changes=[put(WF, 'name: Records integrity\non: x\n')], acts=[WFA])
case('y02-audit-workflow-added', 'The workflow of the audit is added.', base='kit', changes=[put(AU, 'name: Records audit\n')], acts=[WFB])
case('y03-workflow-deleted', 'The workflow of the check is deleted.', base='kit', changes=[drop(WF)], acts=[WFA])
case('y04-both-workflows', 'Both workflows change: two acts, by path.', base='kit-both', changes=[put(WF, 'name: Records integrity\n# x\n'), put(AU, 'name: Records audit\n# x\n')], acts=[WFA, WFB])
case('y05-rules-edited', 'The file with the rules is edited.', base='kit', changes=[put(RK, '// the rules, changed\n')], acts=[RKA])
case('y06-program-edited', 'The program that reads GitHub is edited.', base='kit', changes=[put(CP, '// the program, changed\n')], acts=[CPA])
case('y07-both-code-files', 'Both code files change: two acts, by path.', base='kit', changes=[put(RK, '// 1\n'), put(CP, '// 2\n')], acts=[CPA, RKA])
case('y08-mode-changes', 'The rules file gets the executable mode and nothing else.', base='kit', changes=[put(RK, '// the rules\n', '100755')], acts=[RKA])
case('y09-file-becomes-a-folder', 'A folder stands where the rules file was.', base='kit', changes=[drop(RK), put(RK + '/x', 'x\n')], acts=[RKA])
case('y10-file-becomes-a-link', 'The program becomes a symbolic link.', base='kit', changes=[{'symlink': CP, 'target': RK}], acts=[CPA])
case('y11-folder-in-front', 'The workflows folder is replaced by a file.', base='kit', changes=[drop(WF), drop(TY), put('.github/workflows', 'x\n')], acts=[WFA, WFB])
case('y12-other-workflow-edited', 'A workflow that is not the kit\'s is edited.', base='kit', changes=[put(TY, 'name: Test\non: x\n')])
case('y13-unrelated-file', 'A file that only looks like a code file.', base='kit', changes=[put('record-keeper.mjs.bak', 'x\n'), put('src/record-keeper.mjs', 'x\n')])
case('y14-all-acts', 'Every kind of act together: the acts come in their order.', base='kit',
     changes=[put(RK, '// 1\n'), put(WF, 'name: Records integrity\n# 1\n'), put('.github/record-keeper.yml', 'x\n'), put(SET, 'extra-keys: [repos]\n')],
     acts=[a('settings', SET), a('pin', '.github/record-keeper.yml'), WFA, RKA])
case('y15-name-in-a-new-workflow', 'A new workflow has a job with the name of the check.', base='kit', changes=[put('.github/workflows/fake.yml', 'name: Fake\njobs:\n  x:\n    name: Records integrity\n')], problems=[P15('.github/workflows/fake.yml')])
case('y16-name-in-lower-case-with-a-hyphen', 'The name in other spellings.', base='kit',
     changes=[put('.github/workflows/a.yml', '# records-integrity\n'), put('.github/workflows/b.yml', 'x: RECORDS_INTEGRITY\n'), put('.github/workflows/c.yml', 'x: recordsintegrity\n')],
     problems=[P15('.github/workflows/a.yml'), P15('.github/workflows/b.yml'), P15('.github/workflows/c.yml')])
case('y17-two-spaces-is-another-name', 'Two spaces, a dot and a newline between the words are other names.', base='kit',
     changes=[put('.github/workflows/a.yml', 'x: Records  integrity\n'), put('.github/workflows/b.yml', 'x: records.integrity\n'), put('.github/workflows/c.yml', 'x: records\nintegrity\n')])
case('y18-yaml-extension', 'A .yaml workflow, and capitals in the extension.', base='kit',
     changes=[put('.github/workflows/a.yaml', 'x: Records integrity\n'), put('.github/workflows/b.YML', 'x: Records integrity\n')],
     problems=[P15('.github/workflows/a.yaml'), P15('.github/workflows/b.YML')])
case('y19-not-a-workflow-file', 'Files that GitHub does not run as workflows.', base='kit',
     changes=[put('.github/workflows/a.txt', 'Records integrity\n'), put('.github/workflows/sub/b.yml', 'Records integrity\n'), put('.github/other/c.yml', 'Records integrity\n'), put('workflows/d.yml', 'Records integrity\n')])
case('y20-name-in-the-file-name-only', 'The file name is the name of the check and the file is empty.', base='kit', changes=[put('.github/workflows/records-integrity.yaml', ''), put('.github/workflows/Records_Integrity.yml', '')],
     problems=[P15('.github/workflows/Records_Integrity.yml'), P15('.github/workflows/records-integrity.yaml')])
case('y21-name-added-to-a-workflow', 'An existing workflow gains the name.', base='kit', changes=[put(TY, 'name: Test\njobs:\n  j:\n    name: Records integrity\n')], problems=[P15(TY)])
case('y22-old-mention-untouched', 'A workflow that already named the check at the base, and a change elsewhere.', base='kit-collides', changes=[put('src/a.js', 'x\n')])
case('y23-old-mention-edited', 'The same workflow is edited: judged again.', base='kit-collides', changes=[put('.github/workflows/other.yml', 'name: Records integrity\n# more\n')], problems=[P15('.github/workflows/other.yml')])
case('y24-old-mention-removed', 'The workflow that named the check is deleted.', base='kit-collides', changes=[drop('.github/workflows/other.yml')])
case('y25-name-removed', 'The mention is taken out of the workflow.', base='kit-collides', changes=[put('.github/workflows/other.yml', 'name: Other\n')])
case('y26-executable-workflow', 'A workflow with the executable mode names the check.', base='kit', changes=[put('.github/workflows/x.yml', 'Records integrity\n', '100755')], problems=[P15('.github/workflows/x.yml')])
case('y27-link-as-a-workflow', 'A symbolic link in the workflows folder is not a file with content.', base='kit', changes=[{'symlink': '.github/workflows/x.yml', 'target': 'records-integrity.yml'}])
case('y28-kit-workflow-names-itself', 'The kit\'s own workflows name the check and are not judged by P-15: one act each.', base='kit-both', changes=[put(WF, 'name: Records integrity\n# 2\n'), put(AU, 'name: Records integrity audit\n')], acts=[WFA, WFB])
case('y29-name-among-other-text', 'The name stands among letters outside ASCII.', base='kit', changes=[put('.github/workflows/x.yml', 'name: \u00e9 Records integrity \u017f\n')], problems=[P15('.github/workflows/x.yml')])
case('y31-letters-that-only-look-like-the-name', 'A long s in the name, in the content and in the file name: not the name.', base='kit', changes=[put('.github/workflows/x.yml', 'RECORD\u017f INTEGRITY\n'), put('.github/workflows/record\u017f-integrity.yml', '')])
case('y30-collision-and-act', 'A change of the check that also adds a colliding workflow.', base='kit', changes=[put(WF, 'name: Records integrity\n# 3\n'), put('.github/workflows/z.yml', 'Records integrity\n')], problems=[P15('.github/workflows/z.yml')], acts=[WFA])

case('y32-extension-must-end-the-name', 'A name that only contains .yml is not a workflow file.', base='kit',
     changes=[put('.github/workflows/a.yml.bak', 'Records integrity\n'), put('.github/workflows/b.ymlx', 'Records integrity\n'), put('.github/workflows/c.yaml.orig', 'Records integrity\n')])

# ---- the bar for an amendment (M2.7b): docs/amendments.md -----------------------------------------------------------------------------
def readme_gens(rows, gens, prose='Some words about the records.', eol='\n', extra=()):
    out = ['# Decision records', '', prose, '', '## Generations', '', '| Generation | Record | Status |', '| - | - | - |']
    out += [f'| {g} | [{n:04d}]({name(n)}) | {status} |' for g, n, status in gens] + list(extra)
    out += ['', '## Index', '', '| # | Title | Status |', '| - | - | - |']
    out += [f'| {n:04d} | [{title(n)}]({name(n, r[2] if len(r) > 2 else None)}) | {status} |' for n, status, *r in ((x[0], x[1], *x[2:]) for x in rows)]
    return eol.join(out) + eol
GENS = [('g1', 1, 'accepted')]
def rd(rows, gens=GENS, mode=None, **kw): return put(f'{D}/README.md', readme_gens(rows, gens, **kw), mode)
AM = lambda n: a('amendment', f'{D}/{name(n)}')
AMR = a('amendment', f'{D}/README.md')
TREES['proto'] = {**TREES['world'], f'{D}/README.md': readme_gens(ROWS, GENS)}
AROWS = rows_with(r1='superseded by 0007') + [(7, 'accepted')]
def amend(**kw): return [rput(1, with_status(1, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[1], **kw)), rd(AROWS)]
CLOCK = dict(cases=[], clock=True)
NOCLOCK = dict(cases=[], clock=False)
case('z01-amendment', 'A record that replaces the protocol record is an amendment, not an acceptance.', base='proto', changes=amend(), acts=[AM(7)], needs=CLOCK)
case('z02-amendment-with-emergency', 'The same, with the reason in emergency: the seven days are waived, so no clock is needed.', base='proto', changes=amend(keys='emergency: The hash function is broken.'), acts=[AM(7)], needs=NOCLOCK)
case('z03-acceptance-of-another-replacement', 'A record that replaces an ordinary record is an acceptance.', base='proto', changes=[rput(2, with_status(2, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[2])), rd(rows_with(r2='superseded by 0007') + [(7, 'accepted')])], acts=[acc(7)])
case('z04-emergency-on-an-acceptance', 'emergency: on a record that replaces no protocol record.', base='proto', changes=[rput(7, rec(7, 'accepted', True, keys='emergency: Why not.')), rd(ROWS + [(7, 'accepted')])], problems=[p(name(7), 'P-16')], acts=[acc(7)])
case('z05-amendment-and-another-replacement', 'A record that replaces the protocol record and another record.', base='proto',
     changes=[rput(1, with_status(1, 'superseded by 0007')), rput(2, with_status(2, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[1, 2])), rd(rows_with(r1='superseded by 0007', r2='superseded by 0007') + [(7, 'accepted')])], acts=[AM(7)], needs=CLOCK)
case('z06-table-row-removed', 'The row of the table is taken away and nothing else changes.', base='proto', changes=[rd(ROWS, [])], acts=[AMR], needs=CLOCK)
case('z07-table-row-added', 'A second generation is added to the table.', base='proto', changes=[rd(ROWS, GENS + [('g2', 2, 'proposed')])], acts=[AMR], needs=CLOCK)
case('z08-table-row-repointed', 'The row of g1 points at another record.', base='proto', changes=[rd(ROWS, [('g1', 2, 'accepted')])], acts=[AMR], needs=CLOCK)
case('z09-table-status-changed', 'Only the status column of the table changes: not an amendment.', base='proto', changes=[rd(ROWS, [('g1', 1, 'proposed')])])
case('z10-words-around-the-table', 'The words around the table change.', base='proto', changes=[rd(ROWS, GENS, prose='Other words.')])
case('z11-amendment-and-table', 'The amendment and a change of the table together: two acts, by path.', base='proto', changes=amend()[:2] + [rd(AROWS, GENS + [('g2', 7, 'accepted')])], acts=[AM(7), AMR], needs=CLOCK)
case('z12-no-table-no-amendment', 'A repository without a table has no protocol record: a record that replaces record 1 is an acceptance.', base='world',
     changes=[rput(1, with_status(1, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[1])), index(AROWS)], acts=[acc(7)])
case('z13-table-added-with-the-acceptance', 'The table is read from the base: a table that arrives with the record does not make it an amendment, but the table is one.', base='world',
     changes=[rput(1, with_status(1, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[1])), rd(AROWS)], acts=[acc(7), AMR], needs=CLOCK)
JUNK = ['| G1 | [0001](x.md) | a |', '| g | [0001](x.md) | a |', '| g1 | [001](x.md) | a |', '| g1 | [00001](x.md) | a |', '| g1 | 0001 | a |', '| g1x | [0001](x.md) | a |', '|g1|', 'g1 | [0001](x.md) | a |', '| g1 | a | [0001](x.md) |', '| 1 | [0001](x.md) | a |', '| g 1 | [0001](x.md) | a |', '| xg1 | [0001](x.md) | a |']
TREES['proto-junk'] = {**TREES['world'], f'{D}/README.md': readme_gens(ROWS, [], extra=JUNK)}
case('z14-rows-that-are-not-generations', 'Rows that only look like a generation are none: taking them away is no amendment, and a record replacing record 1 is an acceptance.', base='proto-junk', changes=[rd(ROWS, [])])
case('z14b-junk-rows-no-protocol', 'With such rows only, a record that replaces record 1 is an acceptance.', base='proto-junk',
     changes=[rput(1, with_status(1, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[1])), rd(AROWS, [], extra=JUNK)], acts=[acc(7)])
TREES['proto-crlf'] = {**TREES['world'], f'{D}/README.md': readme_gens(ROWS, GENS, eol='\r\n')}
case('z15-table-with-crlf', 'The README has CRLF line endings; the row is still read.', base='proto-crlf', changes=[rd(ROWS, [], eol='\r\n')], acts=[AMR], needs=CLOCK)
TREES['proto-spaces'] = {**TREES['world'], f'{D}/README.md': readme_gens(ROWS, [], extra=['|  g1\t| \t[0001](x.md)|', '|\tg2 \t|\t[0002](x.md)\t|'])}
case('z16-cells-with-white-space', 'Spaces and tabs around the cells do not matter.', base='proto-spaces', changes=[rd(ROWS, [])], acts=[AMR], needs=CLOCK)
case('z16b-one-of-two-rows-with-white-space', 'Two rows with tabs and spaces around their cells; the second is taken away: the set changes.', base='proto-spaces', changes=[rd(ROWS, [], extra=['|  g1\t| \t[0001](x.md)|'])], acts=[AMR], needs=CLOCK)
case('z16c-row-kept-with-white-space', 'The same rows, with the order of the two swapped: the same set.', base='proto-spaces', changes=[rd(ROWS, [], extra=['|\tg2 \t|\t[0002](x.md)\t|', '|  g1\t| \t[0001](x.md)|'])])
TREES['proto-two'] = {**TREES['world'], f'{D}/README.md': readme_gens(ROWS, GENS + [('g2', 2, 'accepted')])}
case('z17-one-of-two-rows-removed', 'Two generations; one row is taken away.', base='proto-two', changes=[rd(ROWS, GENS)], acts=[AMR], needs=CLOCK)
case('z17b-two-rows-swapped', 'The same two rows in the other order: the same set.', base='proto-two', changes=[rd(ROWS, [('g2', 2, 'accepted'), ('g1', 1, 'accepted')])])
case('z18-emergency-too-long', 'emergency: of 501 characters on an amendment: V-37, and not a waiver.', base='proto', changes=amend(keys='emergency: ' + 'x' * 501), problems=[p(name(7), 'V-37')], acts=[AM(7)], needs=CLOCK)
case('z19-emergency-as-a-list', 'emergency: as a list on an amendment: V-14, and not a waiver.', base='proto', changes=amend(keys='emergency:\n  - a reason'), problems=[p(name(7), 'V-14')], acts=[AM(7)], needs=CLOCK)
case('z20-emergency-empty', 'emergency: without a value on an amendment: V-15, and not a waiver.', base='proto', changes=amend(keys='emergency:'), problems=[p(name(7), 'V-15')], acts=[AM(7)], needs=CLOCK)
case('z21-emergency-500-characters', 'A reason of 500 characters waives.', base='proto', changes=amend(keys='emergency: ' + 'x' * 500), acts=[AM(7)], needs=NOCLOCK)
case('z22-readme-with-the-executable-mode', 'The head README has the executable mode: it is read, and T-01 is reported for it.', base='proto', changes=[rd(ROWS, [], mode='100755')], problems=[p('README.md', 'T-01')], acts=[AMR], needs=CLOCK)
case('z23-owners-needs-the-clock', 'A change of the owners meets the bar, so a clock is needed.', base='owned', changes=[put(SET, 'owners: [alice/1001]\napprovals: 1\n')], acts=[a('settings', SET), a('owners', SET)], needs=CLOCK)
case('z24-readme-is-a-link', 'The README is a symbolic link: nothing is read from it.', base='proto', changes=[{'symlink': f'{D}/README.md', 'target': 'x'}], problems=[p('README.md', 'V-02'), p('README.md', 'V-04')], acts=[AMR], needs=CLOCK)

TREES['proto-owned'] = {**TREES['proto'], SET: 'owners: [alice/1001, bob/1002]\napprovals: 1\n'}
case('z25-amendment-with-owners', 'An amendment in a repository that has owners.', base='proto-owned', changes=amend(), acts=[AM(7)], needs=CLOCK)
case('z26-amendment-with-emergency-and-owners', 'An amendment with the reason in emergency: in a repository that has owners.', base='proto-owned', changes=amend(keys='emergency: The hash function is broken.'), acts=[AM(7)], needs=NOCLOCK)
case('z27-table-change-with-owners', 'A change of the table in a repository that has owners.', base='proto-owned', changes=[rd(ROWS, [])], acts=[AMR], needs=CLOCK)

case('z28-sealed-record-with-a-long-emergency', 'A sealed record gets a long emergency and a new seal: P-02 only, the content rules are not asked of a sealed record.', base='proto', changes=[rput(2, rec(2, 'accepted', True, keys='emergency: ' + 'x' * 501))], problems=[p(name(2), 'P-02', 'line 6')])


# ---- where a record applies (M2.7c): docs/applies-to.md --------------------------------------------------------------------------
AP = lambda items: 'applies-to:\n' + ''.join(f'  - {i}\n' for i in items).rstrip('\n')
APP_FILES = {'src/a.ts': 'a\n', 'src/x/b.ts': 'b\n', 'README.md': 'r\n', 'lib/c.js': 'c\n', 'old/x.js': 'o\n', 'my file.txt': 'm\n', 'docs/é.md': 'e\n'}
TREES['app'] = {**TREES['world'], **APP_FILES,
                f'{D}/{name(1)}': rec(1, 'accepted', True, keys=AP(['src/**'])),
                f'{D}/{name(2)}': rec(2, 'accepted', True, keys=AP(['README.md', 'lib/*.js'])),
                f'{D}/{name(5)}': rec(5, 'superseded by 0006', True, keys=AP(['old/**']))}
def gone(*paths): return [drop(x) for x in paths]
case('q01-last-file-of-an-item-deleted', 'The only file that README.md matches is deleted.', base='app', changes=gone('README.md'), problems=[p(name(2), 'P-18', 'README.md')])
case('q02-one-of-two-files-deleted', 'One of the two files src/** matches is deleted: it still matches the other.', base='app', changes=gone('src/a.ts'))
case('q03-all-files-of-a-folder-deleted', 'Both files src/** matches are deleted.', base='app', changes=gone('src/a.ts', 'src/x/b.ts'), problems=[p(name(1), 'P-18', 'src/**')])
case('q04-code-moved', 'The code moves to another folder: nothing in src/ remains.', base='app', changes=[drop('src/a.ts'), drop('src/x/b.ts'), put('lib/a.ts', 'a\n'), put('lib/b.ts', 'b\n')], problems=[p(name(1), 'P-18', 'src/**')])
case('q05-file-becomes-a-link', 'README.md becomes a symbolic link: not a regular file.', base='app', changes=[{'symlink': 'README.md', 'target': 'lib/c.js'}], problems=[p(name(2), 'P-18', 'README.md')])
case('q06-file-becomes-a-folder', 'A folder stands where README.md was.', base='app', changes=[drop('README.md'), put('README.md/x', 'x\n')], problems=[p(name(2), 'P-18', 'README.md')])
case('q07-record-superseded-in-the-same-change', 'The record is replaced in the same change and the code moves: the new record has the new list, the old one binds no longer.', base='app',
     changes=[rput(1, rec(1, 'accepted', True, keys=AP(['src/**'])).replace('status: accepted', 'status: superseded by 0007', 1)), rput(7, rec(7, 'accepted', True, supersedes=[1], keys=AP(['lib/**']))), index(rows_with(r1='superseded by 0007') + [(7, 'accepted')]), drop('src/a.ts'), drop('src/x/b.ts')],
     acts=[acc(7)])
case('q08-star-item-loses-its-file', 'The only file lib/*.js matches is deleted.', base='app', changes=gone('lib/c.js'), problems=[p(name(2), 'P-18', 'lib/*.js')])
case('q09-two-items-lose-files', 'Both items of one record lose their files: two problems, in the order of the items as bytes.', base='app', changes=gone('README.md', 'lib/c.js'), problems=[p(name(2), 'P-18', 'README.md'), p(name(2), 'P-18', 'lib/*.js')])
case('q10-superseded-record-is-not-judged', 'A record that is already superseded binds no longer: its files can go.', base='app', changes=gone('old/x.js'))
case('q11-dead-item-at-the-base', 'An item that matched nothing at the base is not reported again; and the same item when a file arrives.', base='app', changes=[put('nothing/x', 'x\n'), drop('docs/é.md')])

def acceptance(items, files=(), n=7, **kw):
    return [rput(n, rec(n, 'accepted', True, keys=AP(items), **kw)), index(ROWS + [(n, 'accepted')])] + list(files)
case('q12-acceptance-with-a-dead-item', 'A record is accepted with an item that matches no file, and one that does.', base='app', changes=acceptance(['missing/**', 'src/**']), problems=[p(name(7), 'P-17', 'missing/**')], acts=[acc(7)])
case('q13-acceptance-with-live-items', 'Every item matches.', base='app', changes=acceptance(['src/**', 'README.md', 'lib/*.js']), acts=[acc(7)])
case('q14-duplicate-item-reported-once', 'The same dead item twice.', base='app', changes=acceptance(['gone.txt', 'gone.txt', 'README.md']), problems=[p(name(7), 'P-17', 'gone.txt')], acts=[acc(7)])
case('q15-the-dialect', 'Every kind of live item: folders in the middle, zero folders, stars next to text, a space, a letter outside ASCII.', base='app',
     changes=acceptance(['src/**/*.ts', 'src/**/a.ts', 'src/**/x/b.ts', 'src/***', 'src/**/*', 'my file.txt', 'docs/*.md', 'docs/é.md', 'l**/c.js', 'lib/c.j*', 'src/x/*', 'src/**', 'lib/**/c.js', 'README.m*']), acts=[acc(7)])
case('q16-items-that-match-nothing', 'Items that look like folders, are absolute or case wrong, or use characters that are not patterns: all dead.', base='app',
     changes=acceptance(['src/', 'src', '/src/a.ts', './src/a.ts', 'readme.md', 'README.md/', 'src/a.t?', 'src/[a].ts', 'src/{a,b}.ts', 'src/x*', 'src//a.ts', 'lib/*/c.js']),
     problems=[p(name(7), 'P-17', i) for i in sorted(['src/', 'src', '/src/a.ts', './src/a.ts', 'readme.md', 'README.md/', 'src/a.t?', 'src/[a].ts', 'src/{a,b}.ts', 'src/x*', 'src//a.ts', 'lib/*/c.js'], key=lambda s: s.encode())], acts=[acc(7)])
case('q17-single-value-has-no-items', 'applies-to as a single value is a format problem, and has no items to match.', base='app', changes=[rput(7, rec(7, 'accepted', True, keys='applies-to: src/**')), index(ROWS + [(7, 'accepted')])], problems=[p(name(7), 'V-14')], acts=[acc(7)])
case('q18-no-applies-to', 'A record without the key binds everything and is not looked at.', base='app', changes=[rput(7, rec(7, 'accepted', True)), index(ROWS + [(7, 'accepted')])], acts=[acc(7)])
case('q19-executable-file-counts', 'A file with the executable mode added in the same change.', base='app', changes=acceptance(['bin/tool'], [put('bin/tool', '#!/bin/sh\n', '100755')]), acts=[acc(7)])
case('q20-link-and-submodule-do-not-count', 'A symbolic link and a submodule are not files.', base='app', changes=acceptance(['bin/link', 'vendor/lib'], [{'symlink': 'bin/link', 'target': 'x'}, {'submodule': 'vendor/lib'}]), problems=[p(name(7), 'P-17', 'bin/link'), p(name(7), 'P-17', 'vendor/lib')], acts=[acc(7)])
case('q21-accepting-a-proposed-record', 'A proposed record with a dead item is accepted.', base='app', changes=[rput(3, rec(3, 'accepted', True, keys=AP(['missing.txt']))), index(rows_with(r3='accepted'))], problems=[p(name(3), 'P-17', 'missing.txt')], acts=[acc(3)])
case('q22-proposed-record-with-dead-item', 'A record that is only proposed may name what it likes.', base='app', changes=[rput(3, rec(3, keys=AP(['missing.txt'])))])
case('q23-amendment-with-a-dead-item', 'A record that replaces the protocol is judged too.', base='proto', changes=[rput(1, with_status(1, 'superseded by 0007')), rput(7, rec(7, 'accepted', True, supersedes=[1], keys=AP(['nothing.txt']))), rd(AROWS)], problems=[p(name(7), 'P-17', 'nothing.txt')], acts=[AM(7)], needs=CLOCK)
TREES['app-unsealed'] = {**TREES['app'], f'{D}/{name(3)}': rec(3, 'accepted', keys=AP(['lib/*.js'])), f'{D}/README.md': readme([(1, 'accepted'), (2, 'accepted'), (3, 'accepted'), (4, 'rejected'), (5, 'superseded by 0006'), (6, 'accepted')])}
case('q25-unsealed-record-is-not-judged', 'A record that says accepted and has no seal binds nothing the check can hold it to: the files it names can go (its own problem, P-06, is old).', base='app-unsealed', changes=gone('lib/c.js'),
     problems=[p(name(2), 'P-18', 'lib/*.js')])
case('q24-erratum-does-not-start-p17', 'An erratum on a record with a dead item does not report it: only an acceptance does.', base='app', changes=[rput(2, rec(2, 'accepted', True, keys=AP(['README.md', 'lib/*.js'])).replace('- Rule 2.', '- Rule 2. '))], problems=[p(name(2), 'P-02', 'line 20')])


# ---- a deviation note on a record that does not verify (M2.8): docs/errata-and-deviations.md, "A record that does not verify" -------------------
EDIT = '- Effect 2, edited.'
BROKEN = dict(consequences=EDIT)                      # the text of record 2 edited, the seal of the unedited one kept: P-06 `seal does not match`
NOTE1 = txt([dev(1, 'pull 5')])
def rec2(**kw): return {**TREES['world'], f'{D}/{name(2)}': rec(2, 'accepted', **kw)}
TREES['broken-text'] = rec2(seal=S0, **BROKEN)
TREES['no-seal'] = rec2()
TREES['broken-with-note'] = rec2(seal=S0, deviations=NOTE1, **BROKEN)
TREES['other-generation'] = rec2(seal='sha256-g2:' + HEX)
TREES['malformed-seal'] = rec2(seal='nope')
TREES['broken-superseded'] = {**TREES['world'], f'{D}/{name(5)}': rec(5, 'superseded by 0006', 'bad')}
TREES['broken-long'] = rec2(seal=S0, body_lines=60)
NOTED = lambda seal=S0, **kw: rput(2, rec(2, 'accepted', seal, **kw))
P06 = lambda n=2, d='seal does not match': p(name(n), 'P-06', d)
case('v01-note-on-a-record-that-does-not-match', 'The text of an accepted record was edited and the seal kept (P-06 at the base). A change that only adds a note is a note: the old P-06 is not repeated.',
     base='broken-text', changes=[NOTED(deviations=NOTE1, **BROKEN)], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('v02-note-on-a-record-without-a-seal', 'An accepted record that never had a seal (P-06 `no seal` at the base) takes a note the same way.',
     base='no-seal', changes=[NOTED(None, deviations=NOTE1)], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('v03-note-on-a-broken-record-is-judged', 'The note cites a pull request that does not exist: P-14, and the old P-06 is not repeated.',
     base='broken-text', changes=[NOTED(deviations=NOTE1, **BROKEN)], problems=[p(name(2), 'P-14', 'entry 1: case does not resolve')], acts=[DV()], needs=NEED_P5)
case('v04-note-and-an-edit-of-the-text', 'A note together with another edit of the text is not a note: the record still does not verify, and P-06 is reported.',
     base='broken-text', changes=[NOTED(deviations=NOTE1, consequences='- Effect 2, edited again.')], problems=[P06()], cases=CASES5)
case('v05-note-and-another-seal', 'A note together with another seal line is not a note.',
     base='broken-text', changes=[NOTED(X9, deviations=NOTE1, **BROKEN)], problems=[P06()], cases=CASES5)
case('v06-erratum-on-a-record-that-does-not-match', 'An Errata entry on a record that does not verify has no seal to chain from: not judged as an erratum, P-06 is reported and there is no act.',
     base='broken-text', changes=[NOTED(errata=txt([E1]), **BROKEN)], problems=[P06()])
case('v07-note-on-an-unknown-generation', 'A seal of generation g2: this version does not know where the sections of g2 are, so the change fails as a change to an unsealed record.',
     base='other-generation', changes=[NOTED('sha256-g2:' + HEX, deviations=NOTE1)], problems=[P06(2, 'unknown generation g2')], cases=CASES5)
case('v08-note-on-a-seal-that-is-not-a-seal', 'A seal that is not written as a seal is V-22, not P-06, and takes no note: the change is judged whole.',
     base='malformed-seal', changes=[NOTED('nope', deviations=NOTE1)], problems=[p(name(2), 'V-22')], cases=CASES5)
case('v09-superseding-a-record-that-does-not-match', 'Not changed here: the status of a record that does not verify changes to `superseded by`, and the record still does not verify, so P-06 is reported.',
     base='broken-text', changes=[rput(2, rec(2, 'superseded by 0007', S0, **BROKEN)), rput(7, rec(7, 'accepted', True, supersedes=[2])), index(rows_with(r2='superseded by 0007') + [(7, 'accepted')])],
     problems=[P06()], acts=[acc(7)])
case('v10-second-note-on-a-broken-record', 'A second note after the first, on a record that does not verify.',
     base='broken-with-note', changes=[NOTED(deviations=txt([dev(1, 'pull 5'), dev(2, 'pull 5')]), **BROKEN)], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('v11-earlier-note-changed-on-a-broken-record', 'The first note is rewritten when the second is added.',
     base='broken-with-note', changes=[NOTED(deviations=txt([dev(1, 'pull 5', 'Another reason.'), dev(2, 'pull 5')]), **BROKEN)], problems=[p(name(2), 'P-14', 'earlier entry changed')], acts=[DV()], cases=CASES5)
case('v12-note-on-a-superseded-record-that-does-not-match', 'A record that is superseded and whose seal does not match takes a note.',
     base='broken-superseded', changes=[rput(5, rec(5, 'superseded by 0006', 'bad', deviations=NOTE1))], acts=[DV(5)], cases=CASES5, needs=NEED_P5)
case('v13-note-on-a-broken-record-with-an-old-format-problem', 'The record is past sixty lines (V-10 at the base) and does not verify: the note does not bring the old V-10 back.',
     base='broken-long', changes=[NOTED(deviations=NOTE1, body_lines=60)], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('v14-note-on-a-broken-record-with-a-mail-address', 'The note brings an e-mail address into a record that does not verify: V-12, as for a sealed record.',
     base='broken-text', changes=[NOTED(deviations=txt([dev(1, 'pull 5', 'Ask someone@example.com.')]), **BROKEN)], problems=[p(name(2), 'V-12')], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('v15-note-after-alternatives-on-a-broken-record', 'The section is added after Alternatives considered: V-27, as for a sealed record.',
     base='broken-text', changes=[rput(2, rec(2, 'accepted', S0, **BROKEN) + '\n## Known deviations\n\n' + NOTE1 + '\n')], problems=[p(name(2), 'V-27')], acts=[DV()], cases=CASES5, needs=NEED_P5)
TREES['errata-broken-chain'] = {**TREES['world'], f'{D}/{name(2)}': rec(2, 'accepted', True, errata='Free text.')}
case('v16-note-on-a-sealed-record-with-a-broken-chain', 'A sealed record whose Errata is not a chain (P-10 at the base) takes a note: the old P-10 is not repeated.',
     base='errata-broken-chain', changes=[rput(2, rec(2, 'accepted', True, errata='Free text.', deviations=NOTE1))], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('v17-edit-of-a-sealed-record-with-a-broken-chain', 'The same record with the text edited and sealed again: not a note, P-02, and the old P-10 is reported again because the file changed.',
     base='errata-broken-chain', changes=[rput(2, rec(2, 'accepted', True, errata='Free text.', deviations=NOTE1, consequences=EDIT))], problems=[p(name(2), 'P-02', 'line 6'), p(name(2), 'P-10', 'text outside an entry')], cases=CASES5)
case('v18-two-records-a-note-and-an-edit', 'A note on a record that does not verify, and an edit of the text of a sealed one: the edit is P-02 and P-06, the note is not reported.',
     base='broken-text', changes=[NOTED(deviations=NOTE1, **BROKEN), rput(1, rec(1, 'accepted', sl(1), consequences=EDIT))], problems=[p(name(1), 'P-02', 'line 21'), p(name(1), 'P-06', 'seal does not match')], acts=[DV()], cases=CASES5, needs=NEED_P5)
case('v19-erratum-on-a-sealed-record-with-a-broken-chain', 'An erratum on the record whose Errata is already not a chain: only a note leaves the old state problems alone, so the old P-10 is reported again.',
     base='errata-broken-chain', changes=[rput(2, fix(errata='Free text.\n\n' + txt([E1])))], problems=[p(name(2), 'P-10', 'text outside an entry')], acts=[ER()], **OK1)
case('v20-delete-a-record-that-does-not-verify', 'A record that does not verify is deleted: P-01 as for any record, and nothing is asked of a note.',
     base='broken-text', changes=[drop(f'{D}/{name(2)}'), index([r for r in ROWS if r[0] != 2])], problems=[p(name(2), 'P-01'), p(None, 'V-08')])

def main():
    work = tempfile.mkdtemp(prefix='change-cases-')
    repo = os.path.join(work, 'r.git')
    subprocess.run(['git', 'init', '-q', '--bare', repo], check=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    # first the bases (and the heads of the cases whose head is the parent), so that a change can name the id of a base commit
    stream = b''
    for i, c in enumerate(CASES):
        base_tree = materialise(TREES[c['base']])
        if c['parent'] == 'ahead': stream += stream_commit(f'h{i}', apply(TREES[c['base']], c['changes'])) + stream_commit(f'b{i}', base_tree, f'h{i}')
        else: stream += stream_commit(f'b{i}', base_tree)
    subprocess.run(['git', '-C', repo, 'fast-import', '--quiet'], input=stream, check=True, env=env)
    ids = {c['id']: subprocess.run(['git', '-C', repo, 'rev-parse', f'b{i}'], check=True, capture_output=True, env=env, text=True).stdout.strip() for i, c in enumerate(CASES)}
    def fill(text, i):
        text = text.replace('@BASE@', ids[CASES[i]['id']])
        return re.sub(r'@BASE:([a-z0-9-]+)@', lambda m: ids[m.group(1)], text)
    stream = b''
    for i, c in enumerate(CASES):
        for ch in c['changes']:
            if 'content' in ch: ch['content'] = fill(ch['content'], i)
        base_tree = materialise(TREES[c['base']])
        head_tree = apply(TREES[c['base']], c['changes'])
        if c['parent'] == 'none': stream += stream_commit(f'h{i}', head_tree)
        elif c['parent'] == 'same': stream += stream_commit(f'h{i}', base_tree, f'b{i}')
        elif c['parent'] != 'ahead': stream += stream_commit(f'h{i}', head_tree, f'b{i}')
    subprocess.run(['git', '-C', repo, 'fast-import', '--quiet'], input=stream, check=True, env=env)
    bad = 0
    out_cases = []
    for i, c in enumerate(CASES):
        since = None if c['since'] is None else epoch(c['since'])
        got = check_ref.check_pr(repo, f'b{i}', f'h{i}', cases=c['cases'], since=since, now=epoch(c['now']))
        if c['needs'] is not None and (sorted(got['needs']['cases']) != sorted(tuple(x) for x in c['needs']['cases']) or got['needs']['clock'] != c['needs']['clock']):
            bad += 1
            print('DIFFERENT needs', c['id'], 'want', c['needs'], 'got', got['needs'])
        want = c['want']
        w_problems = None if want['problems'] is None else sorted(want['problems'], key=lambda t: (t[0] is not None, t[0] or '', t[1], t[2]))
        w_settings = sorted(want['settings'] , key=lambda t: (t[0] is not None, t[0] or 0, t[1], t[2] if len(t) > 2 else '')) if want['settings'] else []
        w_settings = [(s[0], s[1], s[2] if len(s) > 2 else '') for s in w_settings]
        w_acts = sorted(want['acts'], key=lambda t: (check_ref.ACT_ORDER[t[0]], t[1]))
        ok = (w_problems is None or w_problems == got['problems']) and w_settings == got['settings'] and w_acts == got['acts']
        if not ok:
            bad += 1
            print('DIFFERENT', c['id'])
            print('  want', w_problems, w_settings, w_acts)
            print('  got ', got['problems'], got['settings'], got['acts'])
        out_cases.append((c, got))
    shutil.rmtree(work, ignore_errors=True)
    if bad:
        print(bad, 'cases differ from what they were written to show')
        sys.exit(1)

    def jtree(tree):
        files = []
        for path, v in sorted(tree.items()):
            if isinstance(v, tuple): files.append({'path': path, 'link': v[1]})
            else: files.append({'path': path, 'content': v})
        return files
    def jproblem(t):
        r = {'file': t[0], 'rule': t[1]}
        if t[2]: r['detail'] = t[2]
        return r
    doc = {'trees': {k: jtree(v) for k, v in TREES.items() if any(c['base'] == k for c in CASES)}, 'cases': []}
    for c, got in out_cases:
        doc['cases'].append({'id': c['id'], 'base': c['base'], **({'parent': c['parent']} if c['parent'] != 'child' else {}), 'changes': c['changes'],
                             **({'cases': c['cases']} if c['cases'] is not None else {}), **({'since': c['since']} if c['since'] is not None else {}),
                             **({'now': c['now']} if (c['cases'] is not None or c['since'] is not None or c['needs'] is not None) else {}),
                             **({'needs': {'cases': [{'kind': k, 'number': n} for k, n in got['needs']['cases']], 'clock': got['needs']['clock']}} if (got['needs']['cases'] or got['needs']['clock']) else {}),
                             'expect': {'settings': [{'line': s[0], 'rule': s[1], **({'detail': s[2]} if s[2] else {})} for s in got['settings']],
                                        'problems': [jproblem(t) for t in got['problems']], 'acts': [{'kind': k, 'path': pth} for k, pth in got['acts']]},
                             'note': c['note']})
    json.dump(doc, open(OUT, 'w'), indent=1, ensure_ascii=True)
    open(OUT, 'a').write('\n')
    print(len(CASES), 'cases written to', OUT)


main()
