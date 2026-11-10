"""Reference implementation 1 of `validate` (the format rules of docs/record-format.md), in Python, on top of g1.py.
validate(dir, extra_keys=(), shared_folder='shared') -> list of (file or None, rule, detail), in report order."""
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
import g1

STANDARD_KEYS = ['status', 'date', 'decision-makers', 'applies-to', 'issues', 'supersedes', 'seal', 'emergency']
LIST_KEYS = ['decision-makers', 'applies-to', 'issues', 'supersedes']
SCALAR_KEYS = ['status', 'date', 'seal', 'emergency']
REQUIRED_KEYS = ['status', 'date', 'decision-makers']
SECTIONS = ['Context and problem statement', 'Decision', 'Consequences', 'Known deviations', 'Alternatives considered', 'Errata']
REQUIRED_SECTIONS = SECTIONS[:3]
MAX_LINES = 60
RECORD_FILE = re.compile(r'^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$')
SECRET = re.compile(r'(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})')
EMAIL = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}')
STATUS_OK = re.compile(r'^(proposed|accepted|rejected|superseded by (\d{4}))$')
SEAL_FORM = re.compile(r'^sha256-g[0-9]+:[0-9a-f]{64}$')
ISSUE = re.compile(r'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[0-9]+$')
ITEM = re.compile(r'^ +- +(\S.*)$')
INDEX_LINK = re.compile(r'\]\((\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md)\)')
LINK_TEXT = re.compile(r'\[([^\]]*)\]\(')


def real_date(v):
    import datetime
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', v): return False
    try: datetime.date(int(v[:4]), int(v[5:7]), int(v[8:]))
    except ValueError: return False
    return True


def fenced_flags(lines):
    flags, need = [], 0
    for l in lines:
        if need == 0:
            m = re.match(r'^(`{3,})[^`]*$', l)
            if m: need = len(m.group(1)); flags.append(True)
            else: flags.append(False)
        else:
            flags.append(True)
            m = re.match(r'^(`+)$', l)
            if m and len(m.group(1)) >= need: need = 0
    return flags


def validate(d, extra_keys=(), shared_folder='shared'):
    out = []
    add = lambda f, r, detail='': out.append((f, r, detail))
    if not os.path.isdir(d):
        add(None, 'V-01'); return out
    names = sorted(os.listdir(d))
    records, has_readme, has_template = [], False, False
    for n in names:
        if n.startswith('.'): continue
        p = os.path.join(d, n)
        if os.path.islink(p) or not (os.path.isfile(p) or os.path.isdir(p)):
            add(n, 'V-04'); continue
        if os.path.isdir(p):
            if n != shared_folder: add(n, 'V-06')
            continue
        if n == 'README.md': has_readme = True
        elif n == 'template.md': has_template = True
        elif RECORD_FILE.match(n): records.append(n)
        else: add(n, 'V-05')
    if not has_readme: add('README.md', 'V-02')
    if not has_template: add('template.md', 'V-03')
    numbers = {}
    for n in records:
        num = int(n[:4])
        if num in numbers: add(n, 'V-07')
        numbers.setdefault(num, n)
    for i, num in enumerate(sorted(numbers), 1):
        if num != i:
            add(None, 'V-08', f'expected {i:04d}, found {num:04d}'); break
    allowed = STANDARD_KEYS + list(extra_keys)
    info = {}   # file -> (status or None, title or None)
    for n in records:
        data = open(os.path.join(d, n), 'rb').read()
        try:
            lines, end = g1.check(data)
        except g1.Reject as e:
            add(n, 'V-09', e.rule); info[n] = (None, None); continue
        text = '\n'.join(lines)
        if len(lines) - (1 if lines[-1] == '' else 0) > MAX_LINES: add(n, 'V-10')
        if SECRET.search(text): add(n, 'V-11')
        if EMAIL.search(text): add(n, 'V-12')
        # front matter
        entries = []
        for l in lines[1:end]:
            m = g1.KEY_LINE.match(l)
            if m: entries.append({'key': m.group(1), 'text': (m.group(2) or '').lstrip(' '), 'owned': []})
            else: entries[-1]['owned'].append(l)
        for e in entries:
            if e['key'] not in allowed: add(n, 'V-13', e['key'])
        for e in entries:
            e['shape'] = None
            if e['text'] == '' and not e['owned']: e['shape'] = 'empty'
            elif e['text'] != '' and e['owned']: e['shape'] = 'mixed'
            elif e['text'] != '': e['shape'] = 'scalar'
            elif all(ITEM.match(l) for l in e['owned']): e['shape'] = 'list'; e['items'] = [ITEM.match(l).group(1) for l in e['owned']]
            else: e['shape'] = 'mixed'
        for e in entries:
            if e['key'] in LIST_KEYS and e['shape'] == 'scalar': add(n, 'V-14', e['key'])
            elif e['key'] in SCALAR_KEYS and e['shape'] == 'list': add(n, 'V-14', e['key'])
        for e in entries:
            if e['shape'] == 'empty': add(n, 'V-15', e['key'])
        for e in entries:
            if e['shape'] == 'mixed': add(n, 'V-16', e['key'])
        keys = {e['key']: e for e in entries}
        for k in REQUIRED_KEYS:
            if k not in keys: add(n, 'V-17', k)
        status = keys['status']['text'] if 'status' in keys and keys['status']['shape'] == 'scalar' else None
        if status is not None:
            if status == 'deprecated': add(n, 'V-19')
            elif not STATUS_OK.match(status): add(n, 'V-18', status)
            else:
                sup = re.match(r'^superseded by (\d{4})$', status)
                if sup and (int(sup.group(1)) not in numbers or int(sup.group(1)) <= int(n[:4])): add(n, 'V-20', sup.group(1))
        date = keys['date']['text'] if 'date' in keys and keys['date']['shape'] == 'scalar' else None
        if date is not None and not real_date(date): add(n, 'V-21')
        seal = keys['seal']['text'] if 'seal' in keys and keys['seal']['shape'] == 'scalar' else None
        if seal is not None and not SEAL_FORM.match(seal): add(n, 'V-22')
        emergency = keys['emergency']['text'] if 'emergency' in keys and keys['emergency']['shape'] == 'scalar' else None
        if emergency is not None and len(emergency) > 500: add(n, 'V-37')
        if 'issues' in keys and keys['issues']['shape'] == 'list':
            for it in keys['issues']['items']:
                if not ISSUE.match(it): add(n, 'V-23', it)
        if 'supersedes' in keys and keys['supersedes']['shape'] == 'list':
            for it in keys['supersedes']['items']:
                if not re.fullmatch(r'[0-9]{4}', it): add(n, 'V-35', it)
                elif int(it) not in numbers or int(it) >= int(n[:4]): add(n, 'V-36', it)
        # body
        body = lines[end + 1:]
        fl = fenced_flags(body)
        first = next((l for l in body if l != ''), None)
        title = None
        if first is None or not re.match(r'^# \S', first): add(n, 'V-24')
        else: title = first[2:].strip()
        heads = [(i, l[3:]) for i, l in enumerate(body) if not fl[i] and l.startswith('## ')]
        for _, name in heads:
            if name not in SECTIONS: add(n, 'V-25', name)
        names_in = [name for _, name in heads]
        for s in REQUIRED_SECTIONS:
            if s not in names_in: add(n, 'V-26', s)
        order = [SECTIONS.index(x) for x in names_in if x in SECTIONS]
        if any(order[i] <= order[i - 1] for i in range(1, len(order))): add(n, 'V-27')
        for k, (i, name) in enumerate(heads):
            stop = heads[k + 1][0] if k + 1 < len(heads) else len(body)
            if not any(l != '' for l in body[i + 1:stop]): add(n, 'V-28', name)
        usable = status if status is not None and status != 'deprecated' and STATUS_OK.match(status) else None
        info[n] = (usable, title)
    # index
    if has_readme:
        text = open(os.path.join(d, 'README.md'), 'rb').read().decode('utf-8', 'replace').replace('\r\n', '\n')
        L = [l.rstrip(' \t') for l in text.split('\n')]; fl = fenced_flags(L)
        at = next((i for i, l in enumerate(L) if not fl[i] and l == '## Index'), None)
        if at is None:
            add('README.md', 'V-29')
        else:
            stop = next((i for i in range(at + 1, len(L)) if not fl[i] and re.match(r'^#{1,2} ', L[i])), len(L))
            rows = [l for l in L[at + 1:stop] if l.startswith('|')]
            linked = {}
            for r in rows:
                m = INDEX_LINK.search(r)
                if m: linked.setdefault(m.group(1), []).append(r)
            for target, rs in linked.items():
                if target not in records:
                    for _ in rs: add('README.md', 'V-32', target)
            for n in records:
                rs = linked.get(n, [])
                if not rs: add(n, 'V-30'); continue
                if len(rs) > 1: add(n, 'V-31')
                status, title = info.get(n, (None, None))
                pieces = rs[0].split('|')[1:]
                if pieces and pieces[-1].strip() == '': pieces.pop()
                cells = [c.strip() for c in pieces]
                if status is not None and status not in cells: add(n, 'V-33')
                if title is not None and title not in cells and title not in LINK_TEXT.findall(rs[0]): add(n, 'V-34')
    return out


if __name__ == '__main__':
    import collections
    d = sys.argv[1]
    extra = tuple(a for a in sys.argv[2:])
    res = validate(d, extra)
    c = collections.Counter(r for _, r, _ in res)
    for f, r, detail in res[:int(os.environ.get('SHOW', '8'))]: print(f, r, detail)
    print(len(res), 'problems', dict(sorted(c.items())))
