"""Fuzz inputs for the settings reader. Usage: config_fuzz.py <count> <seed> <out.jsonl>
Each output line: {"hex": ..., "settings": ..., "problems": [[line, rule, detail], ...]} computed by the Python reference."""
import json, os, random, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import config_ref as ref

KEYS = ['folder', 'shared-folder', 'extra-keys', 'owners', 'Folder', 'approvals', 'x', 'constructor', 'toString', 'a-b_c', 'k' * 45, 'folder ', '_x', '1', '"folder"', 'extra_keys', 'witnesses']
PLAIN = ['docs/adr', 'a', 'repos', '.github/x', '_x', 'docs/decisions', 'a.b', 'a-b_c', 'x/y/z', '.git', '.GIT/a', 'a/../b', 'a//b', 'docs/', '/docs', '.', '..', '...', '.a', '._1', '_1', 'n1', 'abc123', 'a/.git/b', 'core', 'shared']
RESERVED = ['null', 'Null', 'true', 'False', 'yes', 'NO', 'on', 'Off', 'y', 'N', '.inf', '.NaN', '~', '1', '0', '12', '1.5', '0x1f', '0o7', '1e3', '2001-01-01', '1:30', '-1', '+1', '=', '<<', '.5', '-.inf', 'nulll', 'yess']
QUOTED = ["'x'", '"x"', "''", '""', "'it''s'", '"a\\"b"', '"a\\\\b"', '"a\\nb"', "'a\tb'", '"docs/ü"', "'a #b'", '"a: b"', "'unterminated", '"unterminated', "'a'''", "'a''", '"a\\"', "'folder'", '"no"', "'yes'", '"null"', "'1'", '"/"', '" "', "'.git'", '"a/b"', "'a b'"]
ODD = ['{a: b}', '[[a]]', '&a x', '*a', '!!str x', '|', '>', '- a', '? a', ': a', '%x', '@a', '`a`', '[a,]', '[,]', '[a b]', '[a: b]', '[ ]', '[]', '[ a , b ]', '[a,b,c]', "[a, 'b', \"c\"]", '[null]', '[yes, no]', '[1]', '["a#b"]', '[a #x]', '[a] b', '[a', 'a]', '[a,,b]', '[ , ]', "['', '']"]
TAILS = ['', '', '', '', ' # c', '  # c', '# c', ' #', ' x', ' #c # d', '   ', ' \t', '\t# c', ',', ':', ' : x']
SEPS = [': ', ': ', ': ', ':', ':  ', ' : ', ':\t', ':']
SPECIAL = ['\x00', '\x01', '\x0b', '\x0c', '\x7f', '\x85', ' ', ' ', '؜', '‎', '‮', '⁦', '﻿', '￾', '￿', '\r', ' ', '​', '\U0001f600', 'é', '\t', '\U0001fffe', '☃']


CLEAN = len(sys.argv) > 4 and sys.argv[4] == 'clean'
VALID_QUOTED = [q for q in QUOTED if q in ("'x'", '"x"', "''", '""', "'it''s'", '"a\\"b"', '"a\\\\b"', '"docs/ü"', "'a #b'", '"a: b"', "'a'''", "'folder'", '"no"', "'yes'", '"null"', "'1'", '"/"', '" "', "'.git'", '"a/b"', "'a b'")]
OWNER_ITEMS = ['alice/1001', 'bob/1002', 'a/1', 'a-b/22', 'A1/333', '"1a/4"', "'0/5'", 'x/999999999999999', 'a/1000000000000000', 'a/0', 'a/01', 'a--b/1', '-a/1', 'a-/1', 'a_b/1', 'alice', 'alice/', '/1', 'a/b/1', 'a/1x', 'alice/1001', '"a b/1"', '"copilot[bot]/6"', '"a:1"', '"\u00e9/1"', 'a' * 39 + '/7', 'a' * 40 + '/7', '7', '12']
INTS = ['0', '1', '2', '3', '9', '10', '99', '100', '123456789', '1234567890', '00', '01', '007', '1_0', '1.5', '1e3', '0x1f', '+1', '-1', '1:30', '2x', '2.', '2/3', '2-3', '"2"', "'2'", 'two', '[2]', '', '0.0', '.5']
VALID_OWNER_LISTS = ['[]', '[alice/1001]', '[alice/1001, bob/1002]', '[ a/1 , b/2 ]', '["1a/4", x/5]', "['alice/1001']", '[a/1, A/2, a-b/3]']
VALID_LISTS = ['[]', '[ ]', '[a]', '[ a , b ]', "[a, 'b', \"c\"]", '[repos, window]', "['1x']", "['a b']", '[a.b]', "['']", '[a, a]', "[status]", '[_x]']


def value(r):
    k = r.random()
    if CLEAN:
        if k < 0.35: return r.choice(PLAIN)
        if k < 0.55: return r.choice(VALID_QUOTED)
        if k < 0.85: return r.choice(VALID_LISTS)
        if k < 0.92: return r.choice(RESERVED)
        return r.choice(ODD)
    if k < 0.30: return r.choice(PLAIN)
    if k < 0.40: return r.choice(RESERVED)
    if k < 0.58: return r.choice(QUOTED)
    if k < 0.85: return r.choice(ODD)
    if k < 0.93: return '[' + ', '.join(r.choice(PLAIN + QUOTED[:6]) for _ in range(r.randint(0, 4))) + ']'
    return ''


def line(r):
    k = r.random()
    if CLEAN:
        if k < 0.1: return r.choice(['', '# c'])
        key = r.choice(['folder', 'shared-folder', 'extra-keys', 'folder', 'shared-folder', 'extra-keys', 'owners', 'approvals', 'owners', 'approvals', 'Folder'])
        if key == 'owners': val = r.choice(VALID_OWNER_LISTS)
        elif key == 'approvals': val = r.choice(['1', '2', '3', '10', '99', '1', '2'])
        else: val = value(r)
        return key + (': ' if r.random() < 0.95 else r.choice(SEPS)) + val + (r.choice(TAILS) if r.random() < 0.1 else '')
    if k < 0.05: return ''
    if k < 0.10: return '# ' + r.choice(['comment', 'folder: x', 'é'])
    if k < 0.22:
        if r.random() < 0.5: return 'approvals' + r.choice(SEPS) + r.choice(INTS) + r.choice(TAILS)
        items = ', '.join(r.choice(OWNER_ITEMS) for _ in range(r.randint(0, 4)))
        return 'owners' + r.choice(SEPS) + r.choice(['[' + items + ']', '[' + items + ']', r.choice(OWNER_ITEMS), '', r.choice(INTS)]) + r.choice(TAILS)
    if k < 0.14: return ' ' * r.randint(1, 3) + r.choice(['folder: x', '# c', '- a', ''])
    return r.choice(KEYS) + r.choice(SEPS) + value(r) + r.choice(TAILS)


def make(r):
    n = r.choice([0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 8])
    lines = [line(r) for _ in range(n)]
    nl = r.choice(['\n', '\n', '\n', '\r\n'])
    text = nl.join(lines) + (nl if r.random() < 0.8 else '')
    for _ in range(r.choice([0, 0, 0, 1, 1, 2])):
        k = r.random()
        if text and k < 0.35: i = r.randrange(len(text)); text = text[:i] + r.choice(SPECIAL) + text[i:]
        elif text and k < 0.55: i = r.randrange(len(text)); text = text[:i] + text[i + 1:]
        elif text and k < 0.7: i = r.randrange(len(text)); text = text[:i] + r.choice(' \t:#[]\'",') + text[i:]
        elif k < 0.85: text = text + r.choice(lines or ['x'])
        else: text = text.replace('\n', '\r\n')
    data = text.encode('utf-8')
    if r.random() < 0.03 and data:
        i = r.randrange(len(data)); data = data[:i] + bytes([r.choice([0xff, 0xc0, 0x80, 0xed, 0xe2])]) + data[i + 1:]
    return data


def main():
    count, seed, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    r = random.Random(seed)
    seen = set()
    hits = {}
    with open(out, 'w') as f:
        for _ in range(count):
            data = make(r)
            settings, problems = ref.parse_settings(data)
            for p in problems: hits[p[1]] = hits.get(p[1], 0) + 1
            if not problems: hits['none'] = hits.get('none', 0) + 1
            f.write(json.dumps({'hex': data.hex(), 'settings': settings, 'problems': [list(p) for p in problems]}) + '\n')
    print(count, 'inputs;', dict(sorted(hits.items())))


main()
