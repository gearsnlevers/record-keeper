"""Reference implementation of `check-pr` (docs/checking-a-change.md), in Python, written from the page.
It reads the two commits with git (ls-tree, cat-file, merge-base), judges the format with validate_ref/commit_ref (the references of the
earlier pages), the seals with g1.py, and the settings with config_ref.py. It does not share code with the library.

check_pr(repo, base, head) -> {'settings': [(line, rule, detail)], 'problems': [(file, rule, detail)], 'acts': [(kind, path)]}
with the lists in the order the page gives; line and file are None when there is none, detail is '' when there is none."""
import hashlib, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import g1, commit_ref, config_ref
from commit_ref import git, listing, RECORD_FILE

SETTINGS_PATH = config_ref.SETTINGS_PATH
PIN_PATH = '.github/record-keeper.yml'
CONTENT_RULES = {f'V-{n:02d}' for n in list(range(9, 20)) + list(range(21, 29)) + [35, 36, 37]}
ITEM = re.compile(r'^ +- +(\S.*)$')
STATUS_SUPERSEDED = re.compile(r'superseded by ([0-9]{4})')
ACT_ORDER = {'accept': 0, 'erratum': 1, 'deviation': 2, 'settings': 3, 'owners': 4, 'amendment': 5, 'pin': 6, 'workflow': 7, 'code': 8}
WORKFLOW_FILES = ['.github/workflows/records-integrity.yml', '.github/workflows/records-audit.yml']
CODE_FILES = ['record-keeper.mjs', 'check-pull-request.mjs', 'run-audit.mjs']
DEVIATION_RULES = {'V-11', 'V-12', 'V-27', 'V-28'}
FIXED_KEYS = ('applies-to', 'repos', 'window', 'supersedes')


class Rec:
    def __init__(self, data):
        self.data = data
        self.readable = True
        self.sealed = self.claims = False
        try:
            self.lines, self.end = g1.check(data)
        except g1.Reject:
            self.readable = False
            return
        entries = []
        for i in range(1, self.end):
            line = self.lines[i]
            m = g1.KEY_LINE.match(line)
            if m: entries.append({'key': m.group(1), 'text': (m.group(2) or '').lstrip(' '), 'owned': [], 'at': i})
            else: entries[-1]['owned'].append(line)
        self.by = {e['key']: e for e in entries}
        self.status = self.by['status']['text'] if 'status' in self.by else None
        self.seal_text = self.by['seal']['text'] if 'seal' in self.by else None
        items = []
        e = self.by.get('supersedes')
        if e is not None and e['text'] == '' and e['owned'] and all(ITEM.match(l) for l in e['owned']):
            items = [ITEM.match(l).group(1) for l in e['owned']]
        self.supersedes = [int(i) for i in items if re.fullmatch(r'[0-9]{4}', i)]
        em = self.by.get('emergency')
        self.has_emergency = em is not None
        self.emergency_ok = em is not None and em['text'] != '' and not em['owned'] and len(em['text']) <= 500
        self.computed = g1.seal_g1(data)
        self.claims = self.status is not None and (self.status == 'accepted' or STATUS_SUPERSEDED.fullmatch(self.status) is not None)
        self.sealed = self.claims and self.seal_text == self.computed
        self.sect = sections_of(self)
        self.chain_count, self.chain_reason = chain_of(self)


# ---- errata and deviation notes (docs/errata-and-deviations.md) ----------------------------------------------------------------
SEAL_G1 = re.compile(r'sha256-g1:[0-9a-f]{64}')
CASE = re.compile(r'(?:(issue|pull) ([1-9][0-9]{0,8})|commit ([0-9a-f]{40}|[0-9a-f]{64}))')
ITEM_LINE = re.compile(r'- ([a-z]+(?: [a-z]+)*): (\S(?:.*\S)?)')
ERRATUM_KEYS = ['date', 'previous entry', 'previous seal', 'seal', 'reason']
DEVIATION_KEYS = ['date', 'case', 'reason']


def real_date(text):
    m = re.fullmatch(r'([0-9]{4})-([0-9]{2})-([0-9]{2})', text)
    if not m: return False
    y, mo, d = map(int, m.groups())
    leap = y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)
    days = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return 1 <= mo <= 12 and 1 <= d <= days[mo - 1]


def sections_of(rec):
    """The line ranges [first, stop) of '## Known deviations' (dev) and '## Errata' (err) in rec.lines, or None."""
    flags, _ = g1.fence_flags(rec.lines[rec.end + 1:])
    flags = [False] * (rec.end + 1) + flags
    out = {'dev': None, 'err': None}
    for i, line in enumerate(rec.lines):
        if i <= rec.end or flags[i] or line not in (g1.HEADINGS['known deviations'], g1.HEADINGS['errata']): continue
        stop = i + 1
        while stop < len(rec.lines) and (flags[stop] or not g1.ATX12.match(rec.lines[stop])): stop += 1
        out['dev' if line == g1.HEADINGS['known deviations'] else 'err'] = (i, stop)
    return out


def blocks_of(lines, kind):
    """(entries, stray): an entry is {'n', 'lines'}; stray is True if some line is in no entry."""
    entries, stray, current = [], False, None
    for line in lines:
        if line.startswith('### '):
            m = re.fullmatch(r'### (Erratum|Deviation) ([1-9][0-9]{0,3})', line)
            if m and m.group(1) == kind:
                current = {'n': int(m.group(2)), 'lines': [line]}
                entries.append(current)
            else:
                current, stray = None, True
        elif current is not None: current['lines'].append(line)
        elif line != '': stray = True
    for e in entries:
        while e['lines'][-1] == '': e['lines'].pop()
    return entries, stray


def entry_hash(entry):
    return 'sha256:' + hashlib.sha256(('\n'.join(entry['lines']) + '\n').encode()).hexdigest()


def read_note(entry, keys, number):
    """(values, None) or (None, reason) for an entry that must be number `number` with these keys."""
    if entry['n'] != number: return None, f'number: expected {number}'
    body = entry['lines'][1:]
    items = [ITEM_LINE.fullmatch(l) for l in body[1:]]
    if len(body) != len(keys) + 1 or body[0] != '' or any(m is None or m.group(1) != k for m, k in zip(items, keys)):
        return None, 'keys: expected ' + ', '.join(keys)
    values = {m.group(1): m.group(2) for m in items}
    if not real_date(values['date']): return None, 'date: not a date'
    return values, None


def fits(text): return 1 <= len(text) <= 500


def read_erratum(entry, number, prev_hash, prev_seal):
    values, reason = read_note(entry, ERRATUM_KEYS, number)
    if reason: return None, reason
    if values['previous entry'] != prev_hash: return None, f'previous entry: expected {prev_hash}'
    if prev_seal is None:
        if not SEAL_G1.fullmatch(values['previous seal']): return None, 'previous seal: not a seal'
    elif values['previous seal'] != prev_seal: return None, f'previous seal: expected {prev_seal}'
    if not SEAL_G1.fullmatch(values['seal']): return None, 'seal: not a seal'
    if not fits(values['reason']): return None, 'reason: empty or too long'
    return values, None


def chain_of(rec):
    """(number of entries, reason the section Errata is not a chain or None)."""
    if rec.sect['err'] is None: return 0, None
    first, stop = rec.sect['err']
    entries, stray = blocks_of(rec.lines[first + 1:stop], 'Erratum')
    if stray: return len(entries), 'text outside an entry'
    prev_hash, prev_seal = 'none', None
    for i, e in enumerate(entries):
        values, reason = read_erratum(e, i + 1, prev_hash, prev_seal)
        if reason: return len(entries), f'entry {i + 1}: {reason}'
        prev_hash, prev_seal = entry_hash(e), values['seal']
    if entries and prev_seal != rec.seal_text: return len(entries), 'seal: the last entry is not the seal of the record'
    return len(entries), None


def raw_parts(rec):
    raw = rec.data.split(b'\n')
    sect = rec.sect
    def part(r): return raw[r[0]:r[1]] if r else []
    def kept(i): return not any(r and r[0] <= i < r[1] for r in sect.values())
    seal_at = rec.by['seal']['at'] if 'seal' in rec.by else -1
    return {'rest': [l for i, l in enumerate(raw) if kept(i)], 'unsealed': [l for i, l in enumerate(raw) if kept(i) and i != seal_at],
            'dev': part(sect['dev']), 'err': part(sect['err']), 'raw': raw}


def addition_of(old, new):
    if not new.readable: return None
    a, b = raw_parts(old), raw_parts(new)
    if a['err'] == b['err'] and a['dev'] != b['dev'] and a['rest'] == b['rest']: return 'deviation'
    if a['err'] != b['err'] and a['dev'] == b['dev']:
        def line(parts, rec, key): return parts['raw'][rec.by[key]['at']] if key in rec.by else None
        if all(line(a, old, k) is not None and line(a, old, k) == line(b, new, k) for k in ('status', 'date')): return 'erratum'
    return None


def commit_in(repo, commit_id, base):
    if base is None: return False
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    if subprocess.run(['git', '-C', repo, 'rev-parse', '--verify', '--quiet', commit_id + '^{commit}'], env=env, capture_output=True).returncode != 0: return False
    return subprocess.run(['git', '-C', repo, 'merge-base', '--is-ancestor', commit_id, base], env=env, capture_output=True).returncode == 0


def key_text(rec, key):
    for e in rec.by.values():
        if e['key'].lower() == key: return '\n'.join([rec.lines[e['at']]] + e['owned'])
    return None


def judge_erratum(old, new, since, now, needs, assume=False):
    out = []
    a, b = raw_parts(old), raw_parts(new)
    reason = None
    if len(b['err']) < len(a['err']) or b['err'][:len(a['err'])] != a['err']: reason = 'earlier entry changed'
    elif new.chain_count != old.chain_count + 1: reason = 'not one new entry'
    else:
        first, stop = new.sect['err']
        entries, _ = blocks_of(new.lines[first + 1:stop], 'Erratum')
        values, why = read_note(entries[-1], ERRATUM_KEYS, len(entries))
        if values is not None and values['previous seal'] != old.seal_text: reason = f'previous seal: expected {old.seal_text}'
        elif a['unsealed'] == b['unsealed']: reason = 'no change of the text'
    if reason: out.append(('P-11', reason))
    for k in FIXED_KEYS:
        if key_text(old, k) != key_text(new, k): out.append(('P-12', k))
    if g1.seal_g1(new.data) != old.seal_text:
        needs['clock'] = True
        if assume is True: pass   # the audit without evidence cannot read when the head was first seen
        elif since is None: out.append(('P-13', 'no clock'))
        else:
            elapsed = max(0, now - since)
            if elapsed < 48 * 3600: out.append(('P-13', f'{elapsed // 3600}h of 48h'))
    return out


def judge_deviation(repo, base, old, new, cases, needs, assume=False):
    a, b = raw_parts(old), raw_parts(new)
    if len(b['dev']) < len(a['dev']) or b['dev'][:len(a['dev'])] != a['dev']: return [('P-14', 'earlier entry changed')]
    first, stop = new.sect['dev']
    skip = 1 if old.sect['dev'] is None else len(a['dev'])
    entries, stray = blocks_of(new.lines[first + skip:stop], 'Deviation')
    if stray: return [('P-14', 'text outside an entry')]
    if not entries: return [('P-14', 'no new entry')]
    greatest = 0
    if old.sect['dev']:
        for l in old.lines[old.sect['dev'][0]:old.sect['dev'][1]]:
            m = re.fullmatch(r'### Deviation ([1-9][0-9]{0,3})', l)
            if m: greatest = max(greatest, int(m.group(1)))
    out = []
    for k, e in enumerate(entries, 1):
        values, why = read_note(e, DEVIATION_KEYS, greatest + k)
        if why: out.append(('P-14', f'entry {k}: {why}')); continue
        m = CASE.fullmatch(values['case'])
        if not m: out.append(('P-14', f'entry {k}: case: expected issue N, pull N or commit HEX')); continue
        if not fits(values['reason']): out.append(('P-14', f'entry {k}: reason: empty or too long')); continue
        if m.group(1):
            n = int(m.group(2))
            needs['cases'].add((m.group(1), n))
            if not assume and n not in (cases or {}).get(m.group(1), []): out.append(('P-14', f'entry {k}: case does not resolve'))
        elif not commit_in(repo, m.group(3), base): out.append(('P-14', f'entry {k}: case does not resolve'))
    return out



def protocol_records(repo, entries, folder):
    ent = entries.get(folder + '/README.md')
    if not ent or ent[1] != 'blob' or ent[0] not in ('100644', '100755'): return set()
    found = set()
    for line in git(repo, 'cat-file', 'blob', ent[2]).decode('utf-8', errors='replace').split('\n'):
        if not line.startswith('|'): continue
        cells = [c.strip(' \t\r') for c in line[1:].split('|')]
        link = re.search(r'\[([0-9]{4})\]\(', cells[1]) if len(cells) > 1 else None
        if re.fullmatch(r'g[0-9]+', cells[0]) and link: found.add(int(link.group(1)))
    return found


def glob_regex(item):
    out, i = [], 0
    while i < len(item):
        if item.startswith('**/', i): out.append('(?:.*/)?'); i += 3
        elif item.startswith('**', i): out.append('.*'); i += 2
        elif item[i] == '*': out.append('[^/]*'); i += 1
        else: out.append(re.escape(item[i])); i += 1
    return re.compile(''.join(out), re.S)


def applies_items(rec):
    e = rec.by.get('applies-to')
    if e is None or e['text'] != '' or not e['owned'] or not all(ITEM.match(l) for l in e['owned']): return []
    seen = []
    for l in e['owned']:
        it = ITEM.match(l).group(1)
        if it not in seen: seen.append(it)
    return seen


def read_commit(repo, rev):
    commit = git(repo, 'rev-parse', '--verify', rev + '^{commit}').decode().strip()
    return commit, listing(repo, commit)


def record_files(entries, folder, cache, repo):
    out = {}
    prefix = folder + '/'
    for p, (mode, typ, sha) in entries.items():
        if p.startswith(prefix) and '/' not in p[len(prefix):] and mode in ('100644', '100755') and RECORD_FILE.match(p[len(prefix):]):
            name = p[len(prefix):]
            if sha not in cache: cache[sha] = Rec(git(repo, 'cat-file', 'blob', sha))
            out[name] = cache[sha]
    return out


def state_problems(recs):
    first = {}
    for name in sorted(recs): first.setdefault(int(name[:4]), name)
    out = []
    for name in sorted(recs):
        r = recs[name]
        if not r.readable: continue
        num = int(name[:4])
        m = STATUS_SUPERSEDED.fullmatch(r.status) if r.status is not None else None
        if m:
            n = int(m.group(1))
            if n in first and n > num:
                s = recs[first[n]]
                reason = None
                if not s.readable or not s.sealed: reason = 'not sealed'
                elif num not in s.supersedes: reason = 'does not list this record'
                if reason: out.append((name, 'P-04', f'{m.group(1)}: {reason}'))
        if r.sealed:
            for k in sorted(set(r.supersedes)):
                if k in first and k < num:
                    t = recs[first[k]]
                    if not t.readable or t.status != f'superseded by {num:04d}': out.append((name, 'P-05', f'{k:04d}'))
        if r.claims and not r.sealed:
            if r.seal_text is None: out.append((name, 'P-06', 'no seal'))
            elif re.fullmatch(r'sha256-g[0-9]+:[0-9a-f]{64}', r.seal_text):
                if not r.seal_text.startswith('sha256-g1:'): out.append((name, 'P-06', 'unknown generation ' + r.seal_text[7:r.seal_text.index(':')]))
                else: out.append((name, 'P-06', 'seal does not match'))
        if r.seal_text is not None and r.status in ('proposed', 'rejected'): out.append((name, 'P-07', ''))
        if r.sealed and r.chain_reason: out.append((name, 'P-10', r.chain_reason))
    return out


def shown(value):
    if value == '': return '(empty)'
    return value if re.fullmatch(r'[\x20-\x7e]{1,40}', value) else '(other)'


def compare(rec, head_data):
    """None when the head's bytes are an allowed version of the sealed record, else (rule, detail)."""
    bl, hl = rec.data.split(b'\n'), head_data.split(b'\n')
    if bl == hl: return None
    n = min(len(bl), len(hl))
    diff = [i for i in range(n) if bl[i] != hl[i]]
    if len(bl) == len(hl) and len(diff) == 1 and diff[0] == rec.by['status']['at']:
        line = hl[diff[0]].decode('latin-1')
        if line.endswith('\r'): line = line[:-1]
        line = line.rstrip(' \t')
        m = re.fullmatch(r'status:(?: (.*))?', line, re.S)
        if m:
            new = (m.group(1) or '').lstrip(' ')
            old = rec.status
            if new != old:
                if old == 'accepted' and re.fullmatch(r'superseded by [0-9]{4}', new): return None
                return ('P-03', f'{old} -> {shown(new)}')
    return ('P-02', f'line {(diff[0] if diff else n) + 1}')


def related(path):
    return path == SETTINGS_PATH or SETTINGS_PATH.startswith(path + '/') or path.startswith(SETTINGS_PATH + '/')


def file_related(file, path):
    return path == file or file.startswith(path + '/') or path.startswith(file + '/')


def pin_related(path):
    return path == PIN_PATH or PIN_PATH.startswith(path + '/') or path.startswith(PIN_PATH + '/')


def check_pr(repo, base_rev, head_rev, cases=None, since=None, now=0, assume=False, root=False):
    base, be = read_commit(repo, base_rev)
    head, he = read_commit(repo, head_rev)
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    if not root and subprocess.run(['git', '-C', repo, 'merge-base', '--is-ancestor', base, head], env=env, capture_output=True).returncode != 0:
        return {'settings': [], 'problems': [(None, 'P-09', '')], 'acts': [], 'needs': {'cases': [], 'clock': False}}
    settings, base_settings = config_ref.read_settings(repo, base)
    folder, shared, extra = settings['folder'], settings['sharedFolder'], settings['extraKeys']
    prefix = folder + '/'
    leaves = lambda entries: {p: (m, s) for p, (m, t, s) in entries.items() if t != 'tree'}
    lb, lh = leaves(be), leaves(he)
    changed = sorted(p for p in set(lb) | set(lh) if lb.get(p) != lh.get(p))
    touched = any(related(p) for p in changed)
    pin = any(pin_related(p) for p in changed)
    head_settings = config_ref.read_settings(repo, head)[1] if touched else []
    repair = bool(base_settings) and bool(changed) and all(related(p) for p in changed) and not config_ref.read_settings(repo, head)[1]
    settings_out = set()
    if not repair:
        settings_out |= {(line, rule, detail) for _, line, rule, detail in base_settings}
        settings_out |= {(line, rule, detail) for _, line, rule, detail in head_settings}
    cache = {}
    brec, hrec = record_files(be, folder, cache, repo), record_files(he, folder, cache, repo)
    problems = []
    for name in sorted(brec):
        if name not in hrec: problems.append((name, 'P-01', ''))
    sealed_kept = {n for n in brec if brec[n].readable and brec[n].sealed and n in hrec}
    needs = {'cases': set(), 'clock': False}
    additions = {}
    for n in sorted(sealed_kept):
        got = compare(brec[n], hrec[n].data)
        if not got: continue
        kind = addition_of(brec[n], hrec[n]) if got[0] == 'P-02' else None
        if kind is None:
            problems.append((n, got[0], got[1]))
            continue
        additions[n] = kind
        found = judge_erratum(brec[n], hrec[n], since, now, needs, assume) if kind == 'erratum' else judge_deviation(repo, None if root else base, brec[n], hrec[n], cases, needs, assume)
        problems += [(n, r, d) for r, d in found]
    # a record that says it is accepted and has no seal or a seal of g1 that does not match can still gain a deviation note
    def unsealed_g1(r):
        if r.seal_text is None: return True
        return bool(re.fullmatch(r'sha256-g1:[0-9a-f]{64}', r.seal_text))
    noted = {n for n in brec if n in hrec and brec[n].readable and brec[n].claims and not brec[n].sealed and unsealed_g1(brec[n]) and addition_of(brec[n], hrec[n]) == 'deviation'}
    for n in sorted(noted):
        additions[n] = 'deviation'
        problems += [(n, r, d) for r, d in judge_deviation(repo, None if root else base, brec[n], hrec[n], cases, needs, assume)]
    # a record that says it is accepted and does not verify, whose only change is its status line to `superseded by NNNN`
    superseding = {n for n in brec if n in hrec and brec[n].readable and brec[n].claims and not brec[n].sealed and unsealed_g1(brec[n]) and brec[n].status == 'accepted'
                   and hrec[n].readable and brec[n].data != hrec[n].data and compare(brec[n], hrec[n].data) is None}
    same = lambda name: be.get(prefix + name) == he.get(prefix + name)
    sh = prefix + shared
    for p in changed:
        if p == sh or p.startswith(sh + '/'): problems.append((p[len(prefix):], 'P-08', ''))
    for p in changed:
        name = p[len('.github/workflows/'):] if p.startswith('.github/workflows/') else None
        if name is None or '/' in name or not re.search(r'\.ya?ml$', name, re.I) or p in WORKFLOW_FILES: continue
        if p not in lh or lh[p][0] not in ('100644', '100755'): continue
        body = git(repo, 'cat-file', 'blob', lh[p][1]).decode('latin-1')
        if re.search(r'records[ _-]?integrity', name, re.I | re.A) or re.search(r'records[ _-]?integrity', body, re.I | re.A): problems.append((None, 'P-15', p))
    files_b = [p for p, (m, s) in lb.items() if m in ('100644', '100755')]
    files_h = [p for p, (m, s) in lh.items() if m in ('100644', '100755')]
    for n, r in hrec.items():
        if r.readable and r.sealed and not (n in brec and brec[n].readable and brec[n].sealed):
            for it in applies_items(r):
                rx = glob_regex(it)
                if not any(rx.fullmatch(f) for f in files_h): problems.append((n, 'P-17', it))
    for n, r in brec.items():
        h = hrec.get(n)
        if not (r.readable and r.sealed and r.status == 'accepted') or h is None or not h.readable or h.status != 'accepted': continue
        for it in applies_items(r):
            rx = glob_regex(it)
            if any(rx.fullmatch(f) for f in files_b) and not any(rx.fullmatch(f) for f in files_h): problems.append((n, 'P-18', it))
    plain = lambda t: (t[0], t[1], t[2] if t[1] in ('T-02', 'T-03') else '')
    vb = {plain(t) for t in commit_ref.commit_validate(repo, base, folder, extra, shared)}
    for f, r, d in map(plain, commit_ref.commit_validate(repo, head, folder, extra, shared)):
        if f in superseding and r in CONTENT_RULES: continue
        if (f in sealed_kept or f in noted) and r in CONTENT_RULES:
            kind = additions.get(f)
            applies = (r != 'V-10') if kind == 'erratum' else (r in DEVIATION_RULES) if kind == 'deviation' else False
            if applies and (f, r, d) not in vb: problems.append((f, r, d))
            continue
        if (f, r, d) in vb and (f is None or same(f)): continue
        problems.append((f, r, d))
    sb = set(state_problems(brec))
    for f, r, d in state_problems(hrec):
        if (f, r, d) in sb and (same(f) or additions.get(f) == 'deviation' or f in superseding): continue
        problems.append((f, r, d))
    acts = set()
    proto_before, proto_after = protocol_records(repo, be, folder), protocol_records(repo, he, folder)
    waived = set()
    for n, r in hrec.items():
        if r.readable and r.sealed and not (n in brec and brec[n].readable and brec[n].sealed):
            if any(s in proto_before for s in r.supersedes):
                acts.add(('amendment', prefix + n))
                if r.emergency_ok: waived.add(prefix + n)
            else:
                acts.add(('accept', prefix + n))
                if r.has_emergency: problems.append((n, 'P-16', ''))
    if proto_before != proto_after: acts.add(('amendment', prefix + 'README.md'))
    for n, kind in additions.items(): acts.add((kind, prefix + n))
    if touched:
        acts.add(('settings', SETTINGS_PATH))
        after = config_ref.read_settings(repo, head)[0]
        if sorted(o['id'] for o in after['owners']) != sorted(o['id'] for o in settings['owners']) or after['approvals'] < settings['approvals']:
            acts.add(('owners', SETTINGS_PATH))
    if pin: acts.add(('pin', PIN_PATH))
    for kind, files in (('workflow', WORKFLOW_FILES), ('code', CODE_FILES)):
        for f in files:
            if any(file_related(f, p) for p in changed): acts.add((kind, f))
    return {
        'settings': sorted(settings_out, key=lambda t: (t[0] is not None, t[0] or 0, t[1], t[2])),
        'problems': sorted(problems, key=lambda t: (t[0] is not None, t[0] or '', t[1], t[2])),
        'acts': sorted(acts, key=lambda t: (ACT_ORDER[t[0]], t[1])),
        'waived': sorted(waived),
        'needs': {'cases': sorted(needs['cases'], key=lambda t: (t[0] != 'issue', t[1])), 'clock': needs['clock'] or any(k == 'owners' or (k == 'amendment' and pth not in waived) for k, pth in acts)},
    }


if __name__ == '__main__':
    got = check_pr(sys.argv[1], sys.argv[2], sys.argv[3])
    for key in ('settings', 'problems', 'acts'):
        for item in got[key]: print(key, item)
