"""Helpers shared with build_change_cases.py (copied from it): the records, the trees of the small repositories, and the application of changes."""
import calendar, hashlib, json, os, re, subprocess, sys, tempfile, shutil
sys.path.insert(0, os.path.dirname(__file__))
import g1, check_ref

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
TREES['broken-settings'] = {**TREES['world'], '.github/record-keeper/settings.yml': 'branches: [a]\nfolder: docs/decisions\n'}
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


def put(path, text, mode=None): return {'write': path, 'content': text, **({'mode': mode} if mode else {})}
def drop(path): return {'remove': path}
def rput(n, text): return put(f'{D}/{name(n)}', text)
def index(rows): return put(f'{D}/README.md', readme(rows))
def rows_with(**changes):
    rows = dict(ROWS)
    for k, v in changes.items(): rows[int(k[1:])] = v
    return sorted(rows.items())


def with_status(n, status, **kw): return rec(n, 'accepted', True, **kw).replace('status: accepted', f'status: {status}', 1)


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


