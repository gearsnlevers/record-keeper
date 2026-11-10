"""Reference implementation of the settings file (docs/settings.md), in Python, written from the page.
parse_settings(data: bytes) -> (settings, problems); settings = {'folder', 'sharedFolder', 'extraKeys', 'owners', 'approvals'};
problems = list of (line or None, rule, detail or None), in the order of the page.
read_settings(repo, rev) -> (settings, problems) with problems = (file, line, rule, detail)."""
import os, re, subprocess

SETTINGS_PATH = '.github/record-keeper/settings.yml'
DEFAULTS = {'folder': 'docs/decisions', 'sharedFolder': 'shared', 'extraKeys': [], 'owners': [], 'approvals': 2}
KNOWN = {'folder': ('single', 'folder', 'folder'), 'shared-folder': ('single', 'part', 'sharedFolder'), 'extra-keys': ('list', 'key', 'extraKeys'),
         'owners': ('list', 'owner', 'owners'), 'approvals': ('single', 'count', 'approvals')}
KEY = r'[A-Za-z][A-Za-z0-9_-]*'
PLAIN = re.compile(r'(?:[A-Za-z_]|\.[A-Za-z])[A-Za-z0-9_./-]*', re.ASCII)
RESERVED = re.compile(r'null|true|false|yes|no|on|off|y|n|\.inf|\.nan', re.ASCII | re.IGNORECASE)
KEY_FORM = re.compile(KEY, re.ASCII)
GIT_PART = re.compile(r'\.[gG][iI][tT]')
BIDI = {0x061C, 0x200E, 0x200F, 0x2028, 0x2029, *range(0x202A, 0x202F), *range(0x2066, 0x206A)}


def cut(text):
    chars = list(text)
    return ''.join(chars[:40])


def fresh():
    return {'folder': DEFAULTS['folder'], 'sharedFolder': DEFAULTS['sharedFolder'], 'extraKeys': [], 'owners': [], 'approvals': 2}


def bad_text(data):
    """The S-02 reason and line, or None."""
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return ('not UTF-8', None)
    def line_of(i): return text.count('\n', 0, i) + 1
    for reason, test in (
        ('byte order mark', lambda c, i: ord(c) == 0xFEFF),
        ('control character', lambda c, i: (ord(c) <= 0x1F and c not in '\t\n\r') or 0x7F <= ord(c) <= 0x9F or ord(c) in (0xFFFE, 0xFFFF)),
        ('separator or direction control', lambda c, i: ord(c) in BIDI),
        ('bare carriage return', lambda c, i: c == '\r' and text[i + 1:i + 2] != '\n'),
    ):
        for i, c in enumerate(text):
            if test(c, i): return (reason, line_of(i))
    return None


def integer(s, pos):
    """An integer of the subset at pos: (int, end) or None. 0, or a digit 1-9 and up to eight more. What follows is judged by the entry."""
    end = pos
    while end < len(s) and s[end] in '0123456789': end += 1
    digits = s[pos:end]
    if digits == '' or (digits[0] == '0' and len(digits) > 1) or len(digits) > 9: return None
    return (int(digits), end)


def scalar(s, pos):
    """A scalar at pos: (value, end) or None. A value is a str, or an int for an integer."""
    if pos >= len(s): return None
    c = s[pos]
    if c in '0123456789': return integer(s, pos)
    if c == "'":
        out, i = '', pos + 1
        while True:
            if i >= len(s) or s[i] == '\t': return None
            if s[i] == "'":
                if s[i + 1:i + 2] == "'": out += "'"; i += 2; continue
                return (out, i + 1)
            out += s[i]; i += 1
    if c == '"':
        out, i = '', pos + 1
        while True:
            if i >= len(s) or s[i] == '\t': return None
            if s[i] == '"': return (out, i + 1)
            if s[i] == '\\':
                if s[i + 1:i + 2] in ('"', '\\'): out += s[i + 1]; i += 2; continue
                return None
            out += s[i]; i += 1
    m = PLAIN.match(s, pos)
    if not m or RESERVED.fullmatch(m.group()): return None
    return (m.group(), m.end())


def spaces(s, pos):
    while s[pos:pos + 1] == ' ': pos += 1
    return pos


def entry(line):
    """('entry', key, kind, value) or ('broken', key or None)."""
    km = re.match('(' + KEY + '):', line, re.ASCII)
    key = km.group(1) if km else None
    m = re.fullmatch('(' + KEY + '):(?: +(.*))?', line, re.ASCII | re.DOTALL)
    if not m: return ('broken', key)
    rest = m.group(2) or ''
    if rest == '' or rest.startswith('#'): return ('entry', key, 'none', None)
    if rest[0] == '[':
        pos = spaces(rest, 1)
        items = []
        if rest[pos:pos + 1] == ']': pos += 1
        else:
            while True:
                got = scalar(rest, pos)
                if got is None: return ('broken', key)
                items.append(got[0]); pos = spaces(rest, got[1])
                if rest[pos:pos + 1] == ',': pos = spaces(rest, pos + 1); continue
                if rest[pos:pos + 1] == ']': pos += 1; break
                return ('broken', key)
        value, kind = items, 'list'
    else:
        got = scalar(rest, 0)
        if got is None: return ('broken', key)
        value, pos, kind = got[0], got[1], 'single'
    tail = rest[pos:]
    if not (re.fullmatch(r' *', tail) or re.fullmatch(r' +#.*', tail, re.DOTALL)): return ('broken', key)
    return ('entry', key, kind, value)


def part_ok(part):
    return part not in ('', '.', '..') and not GIT_PART.fullmatch(part) and '\\' not in part


def owner_parts(value):
    """(login, id) of an item that is login/id, or None."""
    if not isinstance(value, str) or value.count('/') != 1: return None
    login, ident = value.split('/')
    if not 1 <= len(login) <= 39: return None
    if not all(c.isascii() and (c.isalnum() or c == '-') for c in login): return None
    if login[0] == '-' or login[-1] == '-' or '--' in login: return None
    if not 1 <= len(ident) <= 15 or ident[0] == '0' or not all(c in '0123456789' for c in ident): return None
    return (login, int(ident))


def form_ok(form, value, before=()):
    if form == 'count': return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 99
    if not isinstance(value, str) and form != 'owner': return False
    if form == 'folder': return all(part_ok(p) for p in value.split('/'))
    if form == 'part': return '/' not in value and part_ok(value)
    if form == 'owner':
        mine = owner_parts(value)
        return mine is not None and all((owner_parts(o) or (None, None))[1] != mine[1] for o in before)
    return KEY_FORM.fullmatch(value) is not None


def parse_settings(data):
    settings = fresh()
    why = bad_text(data)
    if why: return settings, [(why[1], 'S-02', why[0])]
    text = data.decode('utf-8')
    lines = text.split('\n')
    if lines and lines[-1] == '': lines.pop()
    lines = [l[:-1] if l.endswith('\r') else l for l in lines]
    problems, entries = [], []   # entries: (n, key, status, kind, value) status 'ok' or 'broken'
    for n, line in enumerate(lines, 1):
        if re.fullmatch(r' *', line) or re.fullmatch(r' *#.*', line, re.DOTALL): continue
        got = entry(line)
        if got[0] == 'broken':
            problems.append((n, 'S-03', cut(line.rstrip(' '))))
            if got[1] is not None: entries.append((n, got[1], 'broken', None, None))
        else:
            entries.append((n, got[1], 'ok', got[2], got[3]))
    by_key = {}
    for e in entries: by_key.setdefault(e[1], []).append(e)
    for key, occurrences in by_key.items():
        if key not in KNOWN:
            for n, _, status, _, _ in occurrences:
                if status == 'ok': problems.append((n, 'S-05', cut(key)))
            continue
        kind_wanted, form, field = KNOWN[key]
        if len(occurrences) > 1:
            for n, _, status, _, _ in occurrences:
                if status == 'ok': problems.append((n, 'S-04', cut(key)))
            continue
        n, _, status, kind, value = occurrences[0]
        if status == 'broken': continue
        if kind != kind_wanted:
            problems.append((n, 'S-06', cut(key))); continue
        items = value if kind == 'list' else [value]
        bad = next((k for k, i in enumerate(items) if not form_ok(form, i, items[:k])), None)
        if bad is not None:
            problems.append((n, 'S-07', cut(str(items[bad])))); continue
        if form == 'owner': settings[field] = [{'login': owner_parts(o)[0], 'id': owner_parts(o)[1]} for o in value]
        else: settings[field] = list(value) if kind == 'list' else value
    problems.sort(key=lambda p: p[0])
    return settings, problems


def git(repo, *args, input=None):
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    r = subprocess.run(['git', '-C', repo, *args], input=input, capture_output=True, env=env)
    if r.returncode != 0: raise RuntimeError(r.stderr.decode(errors='replace'))
    return r.stdout


KINDS = {'100644': 'file', '100755': 'executable', '040000': 'directory', '120000': 'symlink', '160000': 'submodule'}


def read_settings(repo, rev):
    commit = git(repo, 'rev-parse', '--verify', rev + '^{commit}').decode().strip()
    entries = {}
    for rec in git(repo, 'ls-tree', '-r', '-t', '-z', '--full-tree', commit).split(b'\0'):
        if not rec: continue
        meta, _, p = rec.partition(b'\t')
        mode, _, sha = meta.decode().split(' ')
        entries[p.decode('utf-8', 'surrogateescape')] = (KINDS.get(mode, 'other'), sha)
    parts = SETTINGS_PATH.split('/')
    for i in range(1, len(parts) + 1):
        p = '/'.join(parts[:i])
        if p not in entries: return fresh(), []
        kind = entries[p][0]
        ok = kind in ('file', 'executable') if i == len(parts) else kind == 'directory'
        if not ok: return fresh(), [(SETTINGS_PATH, None, 'S-01', p)]
    settings, problems = parse_settings(git(repo, 'cat-file', 'blob', entries[SETTINGS_PATH][1]))
    return settings, [(SETTINGS_PATH, n, r, d) for n, r, d in problems]
