"""Reference implementation 1 of record-keeper generation g1 (Python), written from the draft rules.
seal_g1(bytes) -> 'sha256-g1:<hex>' or raises Reject(rule)."""
import hashlib, re

class Reject(Exception):
    def __init__(self, rule):
        super().__init__(rule)
        self.rule = rule

BIDI = {0x061C, 0x200E, 0x200F, 0x2028, 0x2029, *range(0x202A, 0x202F), *range(0x2066, 0x206A)}
EXCLUDED_KEYS = ('status', 'date', 'seal')
KEY_LINE = re.compile(r'^([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$')
CONT_LINE = re.compile(r'^ +[^ \t]')
FENCE_OPEN = re.compile(r'^(`{3,})[^`]*$')
ATX = re.compile(r'^ {0,3}#{1,6}(?:[ \t]|$)')
ATX12 = re.compile(r'^ {0,3}#{1,2}(?:[ \t]|$)')
SETEXT = re.compile(r'^ {0,3}(?:=+|-+)[ \t]*$')
HTML_START = re.compile(r'^ {0,3}<[A-Za-z/!?]')
AUTOLINK = re.compile(r'^ {0,3}<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^ \t<>]*>')
HEADINGS = {'known deviations': '## Known deviations', 'errata': '## Errata'}

def ascii_lower(s):
    return ''.join(chr(ord(c) + 32) if 'A' <= c <= 'Z' else c for c in s)

def norm_lines(text):
    text = text.replace('\r\n', '\n')
    return [l.rstrip(' \t') for l in text.split('\n')]

def fence_flags(lines):
    """For each line: True when the line is a fence line or inside a fence. Raises nothing; the rules check the fences."""
    flags, n = [], None
    for l in lines:
        if n is None:
            m = FENCE_OPEN.match(l)
            if m:
                n = len(m.group(1)); flags.append(True)
            else:
                flags.append(False)
        else:
            flags.append(True)
            if re.fullmatch('`{%d,}' % n, l):
                n = None
    return flags, n

def check(data):
    """Return (lines, fm_end) after all rules pass, or raise Reject(first violated rule)."""
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        raise Reject('G1-01')
    # G1-01 also covers surrogates: python's strict utf-8 refuses them
    if '﻿' in text: raise Reject('G1-02')
    if any((ord(c) < 32 and c not in '\t\n\r') or 0x7f <= ord(c) <= 0x9f for c in text): raise Reject('G1-03')
    if any(ord(c) in BIDI for c in text): raise Reject('G1-04')
    if re.search(r'\r(?!\n)', text): raise Reject('G1-05')
    if '<!--' in text: raise Reject('G1-06')
    lines = norm_lines(text)
    if lines[0] != '---': raise Reject('G1-07')
    try:
        end = lines.index('---', 1)
    except ValueError:
        raise Reject('G1-08')
    fm = lines[1:end]
    keys = []
    for l in fm:
        m = KEY_LINE.match(l)
        if m: keys.append(m.group(1))
        elif CONT_LINE.match(l) and keys: pass
        else: raise Reject('G1-09')
    lowered = [ascii_lower(k) for k in keys]
    if len(set(lowered)) != len(lowered): raise Reject('G1-10')
    for k in keys:
        if ascii_lower(k) in EXCLUDED_KEYS and k != ascii_lower(k): raise Reject('G1-11')
    # key line index per key
    idx = [i for i, l in enumerate(fm) if KEY_LINE.match(l)]
    for n, i in enumerate(idx):
        k = KEY_LINE.match(fm[i]).group(1)
        nxt = idx[n + 1] if n + 1 < len(idx) else len(fm)
        value = KEY_LINE.match(fm[i]).group(2) or ''
        if k in EXCLUDED_KEYS and (value == '' or nxt - i > 1): raise Reject('G1-12')
    for n, i in enumerate(idx):
        value = (KEY_LINE.match(fm[i]).group(2) or '').lstrip(' ')
        nxt = idx[n + 1] if n + 1 < len(idx) else len(fm)
        parts = [value] + [re.sub(r'^ +(?:- +)?', '', x) for x in fm[i + 1:nxt]]
        if any(p[:1] in ('&', '*', '!', '|', '>') for p in parts): raise Reject('G1-13')
    body = lines[end + 1:]
    # fences
    n = None
    for l in body:
        if n is None:
            if re.match(r'^[ \t]*~{3,}', l) or re.match(r'^[ \t]+`{3,}', l): raise Reject('G1-14')
            m = FENCE_OPEN.match(l)
            if m: n = len(m.group(1))
        elif re.fullmatch('`{%d,}' % n, l):
            n = None
    if n is not None: raise Reject('G1-15')
    flags, _ = fence_flags(body)
    for i, l in enumerate(body):
        if not flags[i] and HTML_START.match(l) and not AUTOLINK.match(l): raise Reject('G1-16')
    for i, l in enumerate(body):
        if flags[i] or i == 0: continue
        p = body[i - 1]
        if SETEXT.match(l) and p != '' and not flags[i - 1] and not ATX.match(p): raise Reject('G1-17')
    all_lines = lines
    allflags = [False] * (end + 1) + flags
    seen = {}
    for i, l in enumerate(all_lines):
        norm = ascii_lower(re.sub(r'[ \t#]+$', '', re.sub(r'^[ \t#]+', '', l)))
        if norm in HEADINGS and (l != HEADINGS[norm] or allflags[i]):
            raise Reject('G1-18')
        if norm in HEADINGS: seen.setdefault(norm, []).append(i)
    if any(len(v) > 1 for v in seen.values()): raise Reject('G1-19')
    if 'errata' in seen and 'known deviations' in seen and seen['errata'][0] < seen['known deviations'][0]: raise Reject('G1-19')
    for v in seen.values():
        for i in v:
            if all_lines[i - 1] != '': raise Reject('G1-20')
    return lines, end

def canonical(data):
    lines, end = check(data)
    head = ['---'] + [l for l in lines[1:end] if not (KEY_LINE.match(l) and KEY_LINE.match(l).group(1) in EXCLUDED_KEYS)] + ['---']
    body = lines[end + 1:]
    flags, _ = fence_flags(body)
    out, skipping = [], False
    for i, l in enumerate(body):
        if not flags[i]:
            if ATX12.match(l):
                skipping = l in HEADINGS.values()
        if skipping: continue
        out.append((l, flags[i]))
    # collapse runs of empty lines outside fences
    final, prev_blank = [], False
    for l, f in out:
        if l == '' and not f:
            if prev_blank: continue
            prev_blank = True
        else:
            prev_blank = False
        final.append(l)
    while final and final[-1] == '': final.pop()
    return '\n'.join(head + final) + '\n'

def seal_g1(data):
    return 'sha256-g1:' + hashlib.sha256(canonical(data).encode('utf-8')).hexdigest()
