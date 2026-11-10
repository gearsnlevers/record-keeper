"""Random changes for the differential fuzz of `check-pr`: builds one bare repository with a base b<i> and a head h<i> for each
scenario, and writes scenarios.json. Usage: change_fuzz.py <out dir> <count> <seed>"""
import json, os, random, re, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import g1

if __name__ == '__main__': OUT, COUNT, SEED = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
HEX = 'a' * 64
SLUGS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']
TEMPLATE = open(os.path.join(os.path.dirname(__file__), '../../test/fixtures/validate/ok01-base/template.md')).read()
STATUSES = ['proposed', 'rejected', 'accepted', 'deprecated', 'superseded by 0002', 'superseded by 0004', 'superseded by 0007', 'superseded by 0009', 'accepted ', 'x', '']


def name(n, slug=None): return f'{n:04d}-{slug or SLUGS[(n - 1) % len(SLUGS)]}.md'


APPLIES = ['src/**', 'src/**/*.ts', 'README.md', 'lib/*.js', 'missing/**', 'src/x/*', 'my file.txt', 'src/a.t?', 'src/', 'src/***', 'lib/**/c.js', 'src/a.ts', 'old.txt', 'docs/*.md', 'src/**/b.ts', 'l**/c.js']


def record(rng, n, status, seal, supersedes=(), makers=True, body=0, mail=False, date='2026-10-01', extra=''):
    if not extra and rng.random() < 0.35:
        extra = 'applies-to:\n' + '\n'.join(f'  - {i}' for i in rng.sample(APPLIES, rng.choice([1, 1, 2, 3])))
    def build(seal_line):
        out = ['---', f'status: {status}', f'date: {date}']
        out += ['decision-makers:', '  - maintainers'] if makers else ['decision-makers: maintainers']
        if supersedes: out += ['supersedes:'] + [f'  - {s:04d}' for s in supersedes]
        if extra: out += [extra]
        if seal_line: out += [f'seal: {seal_line}']
        out += ['---', '', f'# The decision {n}', '', '## Context and problem statement', '', f'Why {n}.', '', '## Decision', '', f'- Rule {n}.', '', '## Consequences', '', f'- Effect {n}.']
        if mail: out += ['', 'Mail a@b.com.']
        out += [f'- Filler {i}.' for i in range(body)]
        out += ['', '## Alternatives considered', '', f'- Not {n}.']
        return '\n'.join(out) + '\n'
    if seal is None: return build(None)
    if seal is True:
        try: return build(g1.seal_g1(build(None).encode()))
        except g1.Reject: return build(None)
    if seal == 'bad': return build('sha256-g1:' + HEX)
    if seal == 'other': return build('sha256-g2:' + HEX)
    return build(seal)


def readme(rows, gens=()):
    out = ['# Decision records', '', 'Words.', '']
    if gens: out += ['## Generations', '', '| Generation | Record | Status |', '| - | - | - |'] + list(gens) + ['']
    out += ['## Index', '', '| # | Title | Status |', '| - | - | - |']
    out += [f'| {n:04d} | [The decision {n}]({name(n, slug)}) | {status} |' for n, status, slug in rows]
    return '\n'.join(out) + '\n'


def random_record(rng, n, count):
    state = rng.choice(['proposed', 'rejected', 'sealed', 'sealed', 'sealed', 'unsealed', 'badseal', 'superseded', 'superseded', 'sealed-list', 'long', 'mail', 'broken', 'single'])
    lower = [m for m in range(1, n)]
    if state == 'proposed': return 'proposed', record(rng, n, 'proposed', None, supersedes=rng.sample(lower, min(len(lower), rng.randint(0, 1))))
    if state == 'rejected': return 'rejected', record(rng, n, 'rejected', None)
    if state == 'sealed': return 'accepted', record(rng, n, 'accepted', True)
    if state == 'unsealed': return 'accepted', record(rng, n, 'accepted', None)
    if state == 'badseal': return 'accepted', record(rng, n, 'accepted', rng.choice(['bad', 'other']))
    if state == 'superseded':
        m = rng.choice([x for x in range(n + 1, count + 3)] + [n - 1 if n > 1 else 3])
        st = f'superseded by {m:04d}'
        return st, record(rng, n, st, rng.choice([True, True, None, 'bad']))
    if state == 'sealed-list':
        return 'accepted', record(rng, n, 'accepted', True, supersedes=rng.sample(lower, min(len(lower), rng.randint(0, 2))))
    if state == 'long': return 'accepted', record(rng, n, 'accepted', True, body=60)
    if state == 'mail': return 'accepted', record(rng, n, 'accepted', True, mail=True)
    if state == 'single': return 'proposed', record(rng, n, 'proposed', None, makers=False)
    return 'proposed', record(rng, n, 'proposed', None).replace('## Decision', '<!-- x -->\n## Decision')


OWNER_LINES = ['owners: [alice/1001]', 'owners: [alice/1001, bob/1002]', 'owners: [bob/1002, alice/1001]', 'owners: []', 'owners: [alice/1001, bob/1002, carol/1003]']
APPROVAL_LINES = ['approvals: 1', 'approvals: 2', 'approvals: 3']


def world(rng):
    folder = 'docs/decisions' if rng.random() < 0.85 else 'records'
    files, rows = {}, []
    settings = []
    if folder != 'docs/decisions': settings.append(f'folder: {folder}')
    if rng.random() < 0.15: settings.append('extra-keys: [repos]')
    if rng.random() < 0.05: settings.append(rng.choice(['witnesses: [a]', 'folder: 2024', 'shared-folder: x/y', 'extra-keys: nope', 'owners: [bad]', 'approvals: 0']))
    if rng.random() < 0.3: settings.append(rng.choice(OWNER_LINES))
    if rng.random() < 0.15: settings.append(rng.choice(APPROVAL_LINES))
    if settings: files['.github/record-keeper/settings.yml'] = '\n'.join(settings) + '\n'
    count = rng.randint(0, 7)
    numbers = list(range(1, count + 1))
    if numbers and rng.random() < 0.08: numbers.remove(rng.choice(numbers))
    for n in numbers:
        status, text = random_record(rng, n, count)
        files[f'{folder}/{name(n)}'] = text
        if rng.random() < 0.93: rows.append((n, status if rng.random() < 0.93 else 'proposed', None))
    gens = []
    if rng.random() < 0.35 and rows:
        for g in range(1, rng.choice([2, 2, 3])):
            number = rng.choice(rows)[0]
            gens.append(rng.choice([f'| g{g} | [{number:04d}]({name(number)}) | accepted |', f'|  g{g}\t| \t[{number:04d}](x.md)|', f'| g{g} | [{number:04d}]({name(number)}) | proposed |', f'| G{g} | [{number:04d}](x.md) | a |', f'| g{g} | [{number}](x.md) | a |']))
    if rng.random() < 0.95: files[f'{folder}/README.md'] = readme(rows, gens)
    if rng.random() < 0.9: files[f'{folder}/template.md'] = TEMPLATE
    if rng.random() < 0.06: files[f'{folder}/.gitattributes'] = rng.choice(['*.md -diff\n', '* text=auto\n', '0002-second.md filter=x\n'])
    if rng.random() < 0.1: files[f'{folder}/shared/0001-shared.md'] = record(rng, 1, 'accepted', True)
    if rng.random() < 0.05: files['docs/adr/README.md'] = '# adr\n'
    if rng.random() < 0.1: files['.github/record-keeper.yml'] = 'source: a/b\nversion: v1\n'
    if rng.random() < 0.5: files['src/a.js'] = 'x\n'
    for tree_file in ['src/a.ts', 'src/x/b.ts', 'lib/c.js', 'README.md', 'my file.txt', 'docs/guide.md']:
        if rng.random() < 0.7: files[tree_file] = 'x\n'
    if rng.random() < 0.5:
        for kit in ['.github/workflows/records-integrity.yml', '.github/workflows/test.yml', 'record-keeper.mjs', 'check-pull-request.mjs']:
            if rng.random() < 0.8: files[kit] = '// ' + kit + '\n'
        if rng.random() < 0.2: files['.github/workflows/other.yml'] = 'name: Records integrity\n'
    return folder, files


def clean(files):
    out = dict(files)
    for p in list(out):
        parts = p.split('/')
        for i in range(1, len(parts)): out.pop('/'.join(parts[:i]), None)
    return out


def text_mutation(rng, text):
    kind = rng.choice(['append', 'space', 'crlf', 'date', 'drop-seal', 'bad-seal', 'edit', 'flip', 'delete-line', 'byte', 'errata', 'reseal'])
    lines = text.split('\n')
    if kind == 'append': return text + rng.choice(['More.\n', '\n', '## Errata\n\n- x\n'])
    if kind == 'space': i = rng.randrange(len(lines)); lines[i] += ' '; return '\n'.join(lines)
    if kind == 'crlf': return text.replace('\n', '\r\n')
    if kind == 'date': return text.replace('date: 2026-10-01', 'date: 2026-10-02')
    if kind == 'drop-seal': return '\n'.join(l for l in lines if not l.startswith('seal:'))
    if kind == 'bad-seal': return '\n'.join(('seal: sha256-g1:' + HEX) if l.startswith('seal:') else l for l in lines)
    if kind == 'edit': return text.replace('- Effect', '- Changed effect')
    if kind == 'flip':
        new = rng.choice(STATUSES)
        return '\n'.join(('status: ' + new) if l.startswith('status:') else l for l in lines)
    if kind == 'delete-line': del lines[rng.randrange(len(lines))]; return '\n'.join(lines)
    if kind == 'errata': return text + '\n## Errata\n\n- fixed\n'
    if kind == 'reseal':
        body = '\n'.join(l for l in lines if not l.startswith('seal:'))
        try:
            s = g1.seal_g1(body.encode())
        except g1.Reject:
            return text
        return body.replace('\n---\n\n#', f'\nseal: {s}\n---\n\n#', 1)
    b = bytearray(text.encode())
    if b: b[rng.randrange(len(b))] = rng.choice([0x0d, 0x00, 0x20, 0x09, 0x23, 0x2d, 0x3a, 0x0a, 0xc3])
    return b.decode('latin-1').encode('latin-1').decode('utf-8', 'replace')


NOTE_CASES = ['pull 5', 'pull 5', 'issue 12', 'issue 12', 'pull 6', 'issue 5', 'commit ' + 'a' * 40, 'pull 05', 'x']
NOTE_REASONS = ['A one-off.', 'A one-off.', 'A one-off.', 'Mail a@b.com.', 'x' * 501]


def with_note(rng, text):
    """The record with one or two deviation notes added: well formed most of the time, in the usual place or at the end."""
    entries = []
    for _ in range(rng.choice([1, 1, 1, 2])):
        date = rng.choice(['2026-11-08'] * 6 + ['2026-13-01'])
        entries.append(f'- date: {date}\n- case: {rng.choice(NOTE_CASES)}\n- reason: {rng.choice(NOTE_REASONS)}')
    if '\n## Known deviations\n' in text:
        have = len(re.findall(r'^### Deviation ', text, re.M))
        number = lambda k: rng.choice([have + k + 1] * 5 + [have + k, 1])
        blocks = ''.join(f'\n\n### Deviation {number(k)}\n\n{e}' for k, e in enumerate(entries))
        return text.replace('\n\n## Alternatives considered', blocks + '\n\n## Alternatives considered', 1) if rng.random() < 0.8 else text
    section = '\n\n'.join(f'### Deviation {k + 1}\n\n{e}' for k, e in enumerate(entries))
    if '\n## Alternatives considered' in text and rng.random() < 0.85:
        return text.replace('\n## Alternatives considered', f'\n## Known deviations\n\n{section}\n\n## Alternatives considered', 1)
    return text.rstrip('\n') + f'\n\n## Known deviations\n\n{section}\n'


def mutate(rng, folder, files):
    f = dict(files)
    menu = ['edit', 'edit', 'edit', 'status', 'status', 'delete', 'rename', 'add', 'add', 'supersede', 'supersede', 'index', 'index', 'mode', 'link', 'shared', 'settings', 'pin',
            'attributes', 'other-folder', 'unrelated', 'seal', 'readme-prose', 'template', 'accept', 'kit-file', 'kit-file', 'workflow', 'workflow', 'gens', 'gens', 'amend', 'amend', 'amend', 'tree-file', 'tree-file', 'tree-file',
            'note', 'note', 'note', 'note', 'note', 'note']
    for _ in range(rng.choice([1, 1, 2, 2, 3, 4])):
        what = rng.choice(menu)
        recs = sorted(p for p in f if isinstance(f[p], str) and p.startswith(folder + '/') and '/' not in p[len(folder) + 1:] and p[len(folder) + 1:][:4].isdigit() and p.endswith('.md'))
        if what == 'edit' and recs:
            p = rng.choice(recs); f[p] = text_mutation(rng, f[p])
        elif what == 'note' and recs:
            q = rng.choice(recs)
            if isinstance(f[q], str): f[q] = with_note(rng, f[q])
        elif what == 'status' and recs:
            p = rng.choice(recs)
            f[p] = '\n'.join(('status: ' + rng.choice(STATUSES)) if l.startswith('status:') else l for l in f[p].split('\n'))
        elif what == 'delete' and recs: del f[rng.choice(recs)]
        elif what == 'rename' and recs:
            p = rng.choice(recs); text = f.pop(p); n = int(p[len(folder) + 1:][:4])
            f[f'{folder}/{name(rng.choice([n, n + 1, n + 5]), rng.choice(["renamed", "other"]))}'] = text
        elif what == 'add':
            n = rng.choice([len(recs) + 1, len(recs) + 2, len(recs) + 3, 1, 2, max(1, len(recs))])
            status, text = random_record(rng, n, len(recs) + 3)
            f[f'{folder}/{name(n, rng.choice([None, "zeta", "aaa"]))}'] = text
        elif what == 'supersede' and recs:
            p = rng.choice(recs); n = int(p[len(folder) + 1:][:4]); m = len(recs) + rng.choice([1, 1, 2])
            f[p] = '\n'.join(('status: superseded by %04d' % m) if l.startswith('status:') else l for l in f[p].split('\n'))
            f[f'{folder}/{name(m)}'] = record(rng, m, 'accepted', rng.choice([True, True, None, 'bad']), supersedes=rng.choice([[n], [n], [n, 1], []]))
        elif what == 'index' and f'{folder}/README.md' in f:
            lines = f[f'{folder}/README.md'].split('\n')
            rows = [i for i, l in enumerate(lines) if l.startswith('| 0')]
            if rows:
                i = rng.choice(rows)
                act = rng.choice(['drop', 'status', 'dangle', 'dup'])
                if act == 'drop': del lines[i]
                elif act == 'status': lines[i] = lines[i].rsplit('|', 2)[0] + '| ' + rng.choice(STATUSES) + ' |'
                elif act == 'dangle': lines.insert(i, '| 0099 | [Gone](0099-gone.md) | accepted |')
                else: lines.insert(i, lines[i])
                f[f'{folder}/README.md'] = '\n'.join(lines)
        elif what == 'mode' and recs:
            q = rng.choice(recs); f[q] = ('100755', f[q])
        elif what == 'link': f[f'{folder}/{name(rng.randint(1, 9), "link")}'] = ('120000', 'x')
        elif what == 'shared':
            q = f'{folder}/shared/{name(rng.randint(1, 3), "s")}'
            if rng.random() < 0.7: f[q] = record(rng, 1, 'accepted', True)
            else: f.pop(q, None)
        elif what == 'settings':
            choice = rng.choice(['folder: records\n', 'extra-keys: [repos]\n', 'witnesses: [a]\n', 'folder: docs/decisions\n', None, '', 'shared-folder: common\n', 'folder: [a]\n', 'owners: [alice/1001]\n', 'owners: [alice/1001, bob/1002]\napprovals: 1\n', 'owners: [bob/1002, alice/1001]\n', 'owners: [alicia/1001, bob/1002]\n', 'approvals: 3\n', 'approvals: 1\n', 'owners: [alice/1001, bob/1002, carol/1003]\napprovals: 2\n', 'owners: [bad]\n', '\ufeffowners: [alice/1001]\n'])
            if choice is None: f.pop('.github/record-keeper/settings.yml', None)
            else: f['.github/record-keeper/settings.yml'] = choice
        elif what == 'pin': f['.github/record-keeper.yml'] = rng.choice(['source: a/b\n', 'x: y\n'])
        elif what == 'kit-file':
            path = rng.choice(['.github/workflows/records-integrity.yml', '.github/workflows/records-audit.yml', 'record-keeper.mjs', 'check-pull-request.mjs', '.github/workflows', 'record-keeper.mjs/x', '.github'])
            act = rng.choice(['write', 'write', 'delete', 'mode', 'link', 'file'])
            if act == 'delete': f.pop(path, None)
            elif act == 'mode': f[path] = ('100755', 'x')
            elif act == 'link': f[path] = ('120000', 'elsewhere')
            else: f[path] = rng.choice(['x\n', 'name: Records integrity\n', '// code\n'])
        elif what == 'workflow':
            wfname = rng.choice(['a.yml', 'b.yaml', 'c.YML', 'records-integrity.yaml', 'Records_Integrity.yml', 'records integrity.yml', 'sub/d.yml', 'e.txt', 'test.yml', 'recordſ-integrity.yml'])
            body = rng.choice(['name: Test\n', 'name: Records integrity\n', '# records-integrity\n', 'x: RECORDS_INTEGRITY\n', 'Records  integrity\n', 'records\nintegrity\n', 'recordsintegrity\n', 'RECORDſ INTEGRITY\n', 'name: \u00e9 Records integrity\n', ''])
            mode = rng.choice(['100644', '100644', '100755'])
            if rng.random() < 0.15: f.pop(f'.github/workflows/{wfname}', None)
            else: f[f'.github/workflows/{wfname}'] = (mode, body)
        elif what == 'attributes': f[f'{folder}/.gitattributes'] = rng.choice(['*.md -diff\n', '* text=auto\n', '0001-first.md filter=lfs\n'])
        elif what == 'other-folder': f['docs/adr/README.md'] = '# adr\n'
        elif what == 'unrelated': f['src/b.js'] = str(rng.random())
        elif what == 'seal' and recs:
            p = rng.choice(recs); f[p] = text_mutation(rng, f[p]) if rng.random() < 0.3 else f[p].replace('status: proposed', 'status: accepted')
        elif what == 'readme-prose' and f'{folder}/README.md' in f: f[f'{folder}/README.md'] = f[f'{folder}/README.md'].replace('Words.', 'Other words.')
        elif what == 'template': f[f'{folder}/template.md'] = TEMPLATE + 'x\n'
        elif what == 'accept' and recs:
            n = len(recs) + 1
            f[f'{folder}/{name(n)}'] = record(rng, n, 'accepted', True)
        elif what == 'amend' and recs:
            n = len(recs) + 1
            target = rng.randint(1, len(recs))
            extra = rng.choice(['', '', 'emergency: A broken hash.', 'emergency: ' + 'x' * rng.choice([500, 501]), 'emergency:', 'emergency:\n  - a', 'emergency: a\n  b'])
            f[f'{folder}/{name(n)}'] = record(rng, n, 'accepted', rng.choice([True, True, True, None]), supersedes=rng.choice([[target], [target], [target, 1], []]), extra=extra)
            if isinstance(f.get(f'{folder}/{name(target)}'), str) and rng.random() < 0.7:
                f[f'{folder}/{name(target)}'] = f[f'{folder}/{name(target)}'].replace('status: accepted', f'status: superseded by {n:04d}', 1)
        elif what == 'tree-file':
            tree_files = [q for q in f if q in ('src/a.ts', 'src/x/b.ts', 'lib/c.js', 'README.md', 'my file.txt', 'docs/guide.md', 'src/a.js', 'lib/d.js', 'src/new.ts')]
            target = rng.choice(tree_files) if tree_files and rng.random() < 0.8 else rng.choice(['src/new.ts', 'lib/d.js'])
            act = rng.choice(['delete', 'delete', 'link', 'folder', 'rename', 'add', 'mode'])
            if act == 'delete': f.pop(target, None)
            elif act == 'link': f[target] = ('120000', 'elsewhere')
            elif act == 'folder': f.pop(target, None); f[target + '/x'] = 'x\n'
            elif act == 'rename': f.pop(target, None); f[rng.choice(['lib/moved.ts', 'src/moved.ts', 'moved/x.ts'])] = 'x\n'
            elif act == 'mode': f[target] = ('100755', 'x\n')
            else: f[target] = 'y\n'
        elif what == 'gens' and f'{folder}/README.md' in f:
            lines = f[f'{folder}/README.md'].split('\n')
            rows = [i for i, l in enumerate(lines) if l.lower().lstrip(' |').startswith('g')]
            act = rng.choice(['drop', 'status', 'repoint', 'add', 'prose', 'crlf'])
            if act == 'drop' and rows: del lines[rng.choice(rows)]
            elif act == 'status' and rows: i = rng.choice(rows); lines[i] = lines[i].replace('accepted', 'proposed').replace('proposed', 'accepted', 1) if 'proposed' in lines[i] else lines[i].replace('accepted', 'proposed')
            elif act == 'repoint' and rows: i = rng.choice(rows); lines[i] = lines[i].replace('[0001]', '[0002]').replace('[0002]', '[0003]', 1) if '[0001]' in lines[i] else lines[i].replace('[0002]', '[0001]')
            elif act == 'add':
                at = next((i for i, l in enumerate(lines) if l == '## Index'), len(lines))
                lines[at:at] = ['| g9 | [0002](x.md) | accepted |'] if rows else ['## Generations', '', '| Generation | Record | Status |', '| - | - | - |', '| g9 | [0002](x.md) | accepted |', '']
            elif act == 'prose': lines = [l.replace('Words.', 'Other words.') for l in lines]
            else: lines = [l + '\r' for l in lines]
            f[f'{folder}/README.md'] = '\n'.join(lines)
    return clean(f)


def data(b): return b'data %d\n' % len(b) + b + b'\n'


def commit(ref, files, parent=None):
    s = b'commit refs/heads/' + ref.encode() + b'\ncommitter T <t@example.com> 0 +0000\n' + data(b'c')
    if parent: s += b'from refs/heads/' + parent.encode() + b'\n'
    s += b'deleteall\n'
    for p, v in sorted(files.items()):
        pb = p.encode()
        if isinstance(v, tuple):
            mode, content = v
            s += b'M ' + mode.encode() + b' inline ' + pb + b'\n' + data(content.encode('utf-8', 'surrogateescape'))
        else:
            s += b'M 100644 inline ' + pb + b'\n' + data(v.encode('utf-8', 'surrogateescape'))
    return s


def main():
    rng = random.Random(SEED)
    os.makedirs(OUT, exist_ok=True)
    repo = os.path.join(OUT, 'repo.git')
    subprocess.run(['git', 'init', '-q', '--bare', repo], check=True)
    stream, scenarios = b'', []
    for i in range(COUNT):
        folder, base = world(rng)
        head = mutate(rng, folder, base)
        kind = rng.choices(['child', 'none', 'ahead', 'same'], [90, 4, 3, 3])[0]
        if kind == 'ahead': stream += commit(f'h{i}', head) + commit(f'b{i}', base, f'h{i}')
        elif kind == 'none': stream += commit(f'b{i}', base) + commit(f'h{i}', head)
        elif kind == 'same': stream += commit(f'b{i}', base) + commit(f'h{i}', base, f'b{i}')
        else: stream += commit(f'b{i}', base) + commit(f'h{i}', head, f'b{i}')
        scenarios.append({'id': i, 'base': f'b{i}', 'head': f'h{i}', 'kind': kind})
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    subprocess.run(['git', '-C', repo, 'fast-import', '--quiet'], input=stream, check=True, env=env)
    json.dump(scenarios, open(os.path.join(OUT, 'scenarios.json'), 'w'))
    print(COUNT, 'scenarios in', repo)


if __name__ == '__main__': main()
