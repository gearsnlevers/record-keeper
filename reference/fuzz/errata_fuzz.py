"""Random errata and deviation notes for the differential fuzz of `check-pr` (docs/errata-and-deviations.md): builds one bare repository with a
base b<i> and a head h<i> for each scenario, and writes scenarios.json (with the cases, the clock and the time of each scenario).
Usage: errata_fuzz.py <out dir> <count> <seed>"""
import hashlib, json, os, random, re, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import g1

OUT, COUNT, SEED = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
D = 'docs/decisions'
TEMPLATE = open(os.path.join(os.path.dirname(__file__), '../../test/fixtures/validate/ok01-base/template.md')).read()
NOW = '2026-11-10T00:00:00Z'
NOW_S = 1783641600  # recomputed below; only used to write offsets
import calendar, time
NOW_S = calendar.timegm(time.strptime(NOW, '%Y-%m-%dT%H:%M:%SZ'))


def stamp(offset_s): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(NOW_S - offset_s))


def H(lines): return 'sha256:' + hashlib.sha256(('\n'.join(lines) + '\n').encode()).hexdigest()


def record_text(n, seal, status='accepted', consequences='- Effect.', keys=(), deviations=None, errata=None, body=0, mail=False, title=None):
    out = ['---', f'status: {status}', 'date: 2026-10-01', 'decision-makers:', '  - maintainers']
    out += list(keys)
    if seal: out += [f'seal: {seal}']
    out += ['---', '', f'# {title or f"The decision {n}"}', '', '## Context and problem statement', '', f'Why {n}.', '', '## Decision', '', f'- Rule {n}.', '', '## Consequences', '', consequences]
    if mail: out += ['', 'Mail a@b.com.']
    out += [f'- Filler {i}.' for i in range(body)]
    if deviations is not None: out += ['', '## Known deviations', '', deviations]
    out += ['', '## Alternatives considered', '', f'- Not {n}.']
    if errata is not None: out += ['', '## Errata', '', errata]
    return '\n'.join(out) + '\n'


def seal_of(**kw):
    try: return g1.seal_g1(record_text(seal=None, **kw).encode())
    except g1.Reject: return 'sha256-g1:' + 'e' * 64


def erratum(n, prev_hash, prev_seal, seal, reason='A fix.', date='2026-11-08'):
    return [f'### Erratum {n}', '', f'- date: {date}', f'- previous entry: {prev_hash}', f'- previous seal: {prev_seal}', f'- seal: {seal}', f'- reason: {reason}']


def deviation(n, case, reason='A one-off.', date='2026-11-08'):
    return [f'### Deviation {n}', '', f'- date: {date}', f'- case: {case}', f'- reason: {reason}']


def txt(entries, sep='\n\n'): return sep.join('\n'.join(e) for e in entries)


KEYSETS = [(), ('applies-to:', '  - src/**'), ('applies-to:', '  - src/**', 'repos: a', 'window: until-2027'), ('supersedes:', '  - 0001')]
EDITS = ['effect', 'rule', 'title', 'trailing', 'blank', 'append', 'cut', 'mail', 'long', 'comment', 'same', 'indent', 'space']


def apply_edit(rng, params, what):
    p = dict(params)
    if what == 'effect': p['consequences'] = '- Effect, corrected.'
    elif what == 'rule': p['rule'] = True
    elif what == 'title': p['title'] = 'The corrected decision'
    elif what == 'mail': p['mail'] = True
    elif what == 'long': p['body'] = 60
    elif what == 'comment': p['consequences'] = '- Effect <!-- x -->.'
    elif what == 'append': p['consequences'] = '- Effect.\n- And more.'
    elif what == 'cut': p['consequences'] = '- Effect'
    elif what == 'indent': p['consequences'] = '  - Effect.'
    elif what == 'space': p['consequences'] = '- Effect  here.'
    return p


def world(rng, i):
    n = rng.choice([1, 2])
    keys = rng.choice(KEYSETS)
    params = dict(n=n, keys=keys, consequences='- Effect.', body=rng.choice([0, 0, 0, 55]), mail=rng.random() < 0.1)
    first = seal_of(**params)
    chain, seal, prev_hash, prev_seal = [], first, 'none', None
    count = rng.choice([0, 0, 0, 1, 2])
    current = dict(params)
    for k in range(count):
        current = dict(current, consequences=f'- Effect {k}.')
        new = seal_of(**current)
        chain.append(erratum(k + 1, prev_hash if k else 'none', seal, new))
        prev_hash, seal = H(chain[-1]), new
    notes = []
    prose = rng.random() < 0.15
    for k in range(rng.choice([0, 0, 1, 2])): notes.append(deviation(k + 1, rng.choice(['pull 2', 'issue 3', 'commit ' + 'b' * 40])))
    dev_text = None if not notes and not prose else (('Prose before acceptance.\n\n' if prose else '') + txt(notes) if notes else 'Prose before acceptance.')
    base_params = dict(current, deviations=dev_text, errata=txt(chain) if chain else None)
    files = {f'{D}/README.md': readme(n), f'{D}/template.md': TEMPLATE}
    files[f'{D}/{name(n)}'] = record_text(seal=seal, **{k: v for k, v in base_params.items() if k not in ('rule',)})
    other = 3 - n
    files[f'{D}/{name(other)}'] = record_text(other, None, status='proposed')
    return files, dict(base_params, seal=seal, chain=chain, notes=notes, prose=prose, prev_hash=prev_hash)


def name(n): return f'{n:04d}-d.md'


def readme(n):
    rows = {n: 'accepted', 3 - n: 'proposed'}
    out = ['# Decision records', '', 'Words.', '', '## Index', '', '| # | Title | Status |', '| - | - | - |']
    out += [f'| {m:04d} | [The decision {m}]({name(m)}) | {rows[m]} |' for m in sorted(rows)]
    return '\n'.join(out) + '\n'


def damage_entry(rng, entry):
    e = list(entry)
    for _ in range(rng.choice([0, 0, 0, 1, 1, 2])):
        op = rng.choice(['number', 'drop', 'swap', 'blank', 'extra', 'date', 'prev', 'seal', 'reason', 'space', 'heading', 'lead', 'crlf', 'unicode-space'])
        i = rng.randrange(len(e))
        if op == 'number': e[0] = re.sub(r'\d+$', str(rng.choice([0, 2, 3, 9, 10, 99])), e[0])
        elif op == 'drop' and len(e) > 3: del e[rng.randrange(2, len(e))]
        elif op == 'swap' and len(e) > 4:
            a, b = rng.sample(range(2, len(e)), 2); e[a], e[b] = e[b], e[a]
        elif op == 'blank': e.insert(rng.randrange(1, len(e) + 1), '')
        elif op == 'extra': e.append(rng.choice(['- note: more', 'Text.', '- reason: again']))
        elif op == 'date' and i >= 2: e[2] = '- date: ' + rng.choice(['2026-02-30', '2026-11-8', 'soon', '2026-13-01', '2024-02-29'])
        elif op == 'prev' and len(e) > 3: e[3] = e[3].split(':')[0] + ': ' + rng.choice(['none', 'sha256:' + 'c' * 64, 'sha256:' + 'C' * 64, 'x'])
        elif op == 'seal' and len(e) > 5: e[rng.choice([4, 5])] = e[rng.choice([4, 5])].split(':')[0] + ': ' + rng.choice(['sha256-g1:' + 'd' * 64, 'sha256-g2:' + 'd' * 64, 'abc', 'sha256-g1:' + 'D' * 64])
        elif op == 'reason': e[-1] = '- reason: ' + rng.choice(['', 'x' * 500, 'x' * 501, 'é' * 500, 'é' * 501]).rstrip()
        elif op == 'space': e[i] = e[i] + rng.choice([' ', '  ', '\t'])
        elif op == 'heading': e[0] = rng.choice(['### Erratum 1 (x)', '### erratum 1', '## Erratum 1', '### Deviation 1', '###Erratum 1', '### Erratum 01'])
        elif op == 'lead' and i >= 2: e[i] = ' ' + e[i]
        elif op == 'crlf': e = [l + '\r' for l in e[:-1]] + e[-1:]
        elif op == 'unicode-space' and i >= 2: e[i] = rng.choice([e[i] + '\u00a0', e[i].replace(': ', ': \u00a0', 1), e[i] + '\u3000', e[i].replace(': ', ':\u2003', 1), e[i] + '\u200b', e[i].replace('- ', '-\u00a0', 1)])
    return e


def mutate(rng, files, info):
    f = dict(files)
    n = info['n']
    path = f'{D}/{name(n)}'
    params = {k: info[k] for k in ('consequences', 'keys', 'body', 'mail')}
    params['n'] = n
    kind = rng.choices(['erratum', 'note', 'other'], [48, 34, 18])[0]
    if kind == 'erratum':
        what = rng.choice(EDITS)
        edited = apply_edit(rng, params, what)
        title = edited.get('title')
        text_kw = dict(edited)
        rule = text_kw.pop('rule', False)
        if what == 'same': new_seal = info['seal']
        else: new_seal = seal_of(**text_kw)
        if what == 'trailing': new_seal = info['seal']
        k = len(info['chain'])
        entry = erratum(k + 1, info['prev_hash'] if k else 'none', info['seal'], new_seal)
        entries = list(info['chain']) + [damage_entry(rng, entry)]
        if rng.random() < 0.08: entries.append(erratum(k + 2, H(entry), new_seal, new_seal))
        if rng.random() < 0.08 and info['chain']: entries[0] = damage_entry(rng, entries[0])
        if rng.random() < 0.05: entries = entries[:-1]
        seal_line = new_seal if rng.random() < 0.9 else rng.choice([info['seal'], 'sha256-g1:' + 'e' * 64, None])
        sep = rng.choice(['\n\n', '\n\n', '\n\n', '\n'])
        dev = info['deviations'] if rng.random() < 0.95 else 'Changed.'
        errata = txt(entries, sep) if entries else None
        text = record_text(seal=seal_line, deviations=dev, errata=errata, **{**text_kw, 'title': title})
        if what == 'trailing': text = text.replace('- Rule', '- Rule ', 1)
        if what == 'blank': text = text.replace('\n## Decision', '\n\n## Decision', 1)
        if rule: text = text.replace('- Rule', '- Rule, corrected', 1)
        if rng.random() < 0.06: text = text.replace('status: accepted', 'status: superseded by 0009', 1)
        if rng.random() < 0.05: text = text.replace('date: 2026-10-01', 'date: 2026-11-08', 1)
        if rng.random() < 0.08 and info['keys']: text = text.replace(info['keys'][-1], info['keys'][-1].replace('a', 'b').replace('src', 'lib').replace('2027', '2028').replace('0001', '0002'), 1)
        if rng.random() < 0.05: text = text.replace('\n', '\r\n')
        f[path] = text
    elif kind == 'note':
        count = rng.choice([1, 1, 1, 2, 3])
        base_k = max([int(m.group(1)) for l in (info['notes'] and sum(info['notes'], [])) or [] for m in [re.fullmatch(r'### Deviation (\d+)', l)] if m] or [0])
        cases = ['pull 2', 'issue 3', 'pull 5', 'issue 7', 'commit @BASE@', 'commit @OTHER@', 'commit ' + 'a' * 40, 'commit ' + 'f' * 64, 'pull 0', 'issue x', 'commit abc', 'pull 12', 'Issue 3', 'pull  2']
        new = [damage_entry(rng, deviation(base_k + j + 1, rng.choice(cases))) for j in range(count)]
        old = list(info['notes'])
        if rng.random() < 0.1 and old: old[0] = damage_entry(rng, old[0])
        prose = 'Prose before acceptance.\n\n' if info['prose'] else ''
        if rng.random() < 0.05: new[-1] = new[-1] + ['', 'Stray text.']
        body = prose + txt(old + new, rng.choice(['\n\n', '\n\n', '\n\n', '\n']))
        if rng.random() < 0.04: body = ' '
        params2 = {k: v for k, v in params.items()}
        text = record_text(seal=info['seal'], deviations=body, errata=info['errata'], **params2)
        if rng.random() < 0.06: text = text.replace('Mail a@b.com.', 'x') if info['mail'] else text.replace('- Not', 'Mail c@d.org. - Not', 1)
        if rng.random() < 0.05:  # the section after Alternatives
            text = record_text(seal=info['seal'], deviations=None, errata=info['errata'], **params2).rstrip('\n') + '\n\n## Known deviations\n\n' + body + '\n'
        f[path] = text
    else:
        base = f[path]
        op = rng.choice(['status', 'date', 'seal', 'text', 'both', 'delete-errata', 'crlf', 'index', 'readme'])
        if op == 'status': f[path] = base.replace('status: accepted', rng.choice(['status: superseded by 0003', 'status: proposed', 'status: accepted ', 'status: x']), 1)
        elif op == 'date': f[path] = base.replace('date: 2026-10-01', 'date: 2026-10-02', 1)
        elif op == 'seal': f[path] = re.sub(r'seal: sha256-g1:[0-9a-f]{64}', 'seal: sha256-g1:' + 'e' * 64, base, count=1)
        elif op == 'text': f[path] = base.replace('- Rule', '- Rule!', 1)
        elif op == 'both': f[path] = base.replace('\n## Alternatives considered', '\n## Known deviations\n\nx\n\n## Alternatives considered', 1) if '## Known deviations' not in base else base + '\n'
        elif op == 'delete-errata': f[path] = base.split('\n## Errata')[0] + ('\n' if '## Errata' in base else '')
        elif op == 'crlf': f[path] = base.replace('\n', '\r\n')
        elif op == 'index': f[f'{D}/README.md'] = f[f'{D}/README.md'].replace('accepted', 'proposed', 1)
        else: f[f'{D}/README.md'] = f[f'{D}/README.md'].replace('Words.', 'Other.')
    return f, kind


def data(b): return b'data %d\n' % len(b) + b + b'\n'


def commit(ref, files, parent=None):
    s = b'commit refs/heads/' + ref.encode() + b'\ncommitter T <t@example.com> 0 +0000\n' + data(b'c')
    if parent: s += b'from refs/heads/' + parent.encode() + b'\n'
    s += b'deleteall\n'
    for p, v in sorted(files.items()):
        s += b'M 100644 inline ' + p.encode() + b'\n' + data(v.encode('utf-8', 'surrogateescape'))
    return s


def main():
    rng = random.Random(SEED)
    os.makedirs(OUT, exist_ok=True)
    repo = os.path.join(OUT, 'repo.git')
    subprocess.run(['git', 'init', '-q', '--bare', repo], check=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    worlds = [world(rng, i) for i in range(COUNT)]
    subprocess.run(['git', '-C', repo, 'fast-import', '--quiet'], input=b''.join(commit(f'b{i}', w[0]) for i, w in enumerate(worlds)), check=True, env=env)
    ids = [subprocess.run(['git', '-C', repo, 'rev-parse', f'b{i}'], capture_output=True, text=True, check=True, env=env).stdout.strip() for i in range(COUNT)]
    stream, scenarios = b'', []
    for i, (files, info) in enumerate(worlds):
        head, kind = mutate(rng, files, info)
        other = ids[rng.randrange(COUNT)]
        head = {p: v.replace('@BASE@', ids[i]).replace('@OTHER@', other) for p, v in head.items()}
        stream += commit(f'h{i}', head, f'b{i}')
        since = rng.choice([None, None, stamp(0), stamp(3600), stamp(47 * 3600), stamp(48 * 3600 - 1), stamp(48 * 3600), stamp(100 * 3600), stamp(-3600)])
        cases = None if rng.random() < 0.15 else {'issue': rng.sample(range(1, 9), rng.randint(0, 4)), 'pull': rng.sample(range(1, 13), rng.randint(0, 4))}
        scenarios.append({'id': i, 'base': f'b{i}', 'head': f'h{i}', 'kind': kind, 'since': since, 'now': NOW, 'cases': cases})
    subprocess.run(['git', '-C', repo, 'fast-import', '--quiet'], input=stream, check=True, env=env)
    json.dump(scenarios, open(os.path.join(OUT, 'scenarios.json'), 'w'))
    print(COUNT, 'scenarios in', repo)


main()
