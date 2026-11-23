"""Builds test/fixtures/adopt/cases.json. Every case is a records folder and says what the first sealing of it (`seal --adopt`, docs/install.md) must do to each file; the
generator runs the Python reference (adopt_ref.py) on it and stops if the two differ. Usage: build_adopt_cases.py <out.json>

A file is bytes, written as a text when it is UTF-8 and as {"hex": ...} when it is not. `intend` says, for each file that is looked at, the answer that the case was written to
show: `seal`, `has-seal`, `skip: <why>` or `cannot: <rule>`; the lines that the command prints and the bytes that a file becomes are made from it and from the reference."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import adopt_ref as ref

# What the command says after "cannot seal (" for each rule that a case uses: the rules of g1 as the library words them, and the one rule of the format that can stop a record.
WORDS = {
    'G1-01': 'the bytes are not valid UTF-8',
    'G1-02': 'the text contains U+FEFF (a byte order mark)',
    'G1-03': 'the text contains a control character other than tab, line feed and carriage return',
    'G1-05': 'a carriage return is not directly followed by a line feed',
    'G1-06': 'the text contains <!--',
    'G1-07': 'line 1 is not ---',
    'G1-08': 'the front matter is never closed by a line that is ---',
    'G1-10': 'two front matter keys are the same apart from case',
    'G1-11': 'status, date or seal is written with a capital letter',
    'G1-12': 'status, date or seal has no value, or has continuation lines',
    'G1-15': 'a code fence is never closed',
    'G1-16': 'a line starts a raw HTML block',
    'V-10': 'the seal line would make the record longer than 60 lines',
}

TEMPLATE_FRONT = ['status: accepted', 'date: 2026-11-01', 'decision-makers:', '  - maintainers', 'applies-to:', '  - src/**', 'issues:', '  - owner/repo#1']
BODY = ['', '# A rule', '', '## Context and problem statement', '', 'Why.', '', '## Decision', '', '- Do it.', '', '## Consequences', '', '- Done.']
SHORT_FRONT = ['status: accepted', 'date: 2026-11-01', 'decision-makers:', '  - a']
cases = []


def rec(front=TEMPLATE_FRONT, body=BODY, eol='\n', end=None):
    """A record as bytes: the front matter between two delimiters, then the body, every line ended by `eol`, and the last one by `end` (`eol` when it is not given)."""
    return ((eol.join(['---', *front, '---', *body])) + (eol if end is None else end)).encode('utf-8')


def shown(data):
    try:
        return {'text': data.decode('utf-8')}
    except UnicodeDecodeError:
        return {'hex': data.hex()}


def case(case_id, note, files, intend):
    cases.append({'id': case_id, 'note': note, 'files': files, 'intend': intend})


def one(case_id, note, data, intend, name='0001-a-rule.md'):
    case(case_id, note, {name: data}, {name: intend})


def padded(front, total):
    """A record whose lines, as V-10 counts them, are `total` in number."""
    extra = total - (len(front) + 2) - len(BODY)
    assert extra >= 0
    return rec(front, BODY + [f'- More {i}.' for i in range(extra)])


# ------------------------------------------------------------------------------------------------------------------------ records that are sealed
one('s01-template-order', 'The keys in the order of the template: the line is the last of the front matter, after the last item of the last list.', rec(), 'seal')
one('s02-superseded', 'A record that is superseded by a later one is sealed like an accepted one.', rec(['status: superseded by 0007', *TEMPLATE_FRONT[1:]]), 'seal')
one('s03-crlf', 'CRLF line endings: the line ends in CRLF as the line before it, and no other byte changes.', rec(eol='\r\n'), 'seal')
one('s04-crlf-no-final-newline', 'CRLF and no line ending at the end of the file.', rec(eol='\r\n', end=''), 'seal')
one('s05-no-final-newline', 'No line feed at the end of the file.', rec(end=''), 'seal')
one('s06-blank-lines-at-the-end', 'Empty lines and lines of white space at the end are kept.', rec(end='\n\n  \n\t\n\n'), 'seal')
one('s07-trailing-white-space', 'Trailing spaces and tabs after the delimiters, the keys and the values are kept, and the line is added after them.',
    b'--- \nstatus: accepted \ndate: 2026-11-01\t\ndecision-makers:  \n  - a  \n--- \n\n# T\n\n## Context and problem statement\n\nWhy.\n\n## Decision\n\n- Do it.\n\n## Consequences\n\n- Done.\n', 'seal')
one('s08-front-matter-only', 'A record with only a front matter, closed by the last line of the file.', b'---\nstatus: accepted\n---', 'seal')
one('s09-front-matter-and-one-newline', 'The same with a line feed after the closing delimiter.', b'---\nstatus: accepted\n---\n', 'seal')
one('s10-another-order-of-keys', 'The record has other keys in another order, an extra key and a list in the middle: the line goes last.',
    rec(['repos:', '  - a', 'status: accepted', 'emergency: no', 'date: 2026-11-01', 'decision-makers:', '  - a', '  - b']), 'seal')
one('s11-known-deviations-and-errata', 'The sections that the seal does not cover are in the record: they stay, and the seal is the one of the record without them.',
    rec(TEMPLATE_FRONT, BODY + ['', '## Known deviations', '', '- A note.', '', '## Errata', '', 'None yet.']), 'seal')
one('s12-non-ascii', 'Non-ASCII text, a no-break space and an emoji are kept byte for byte.', rec(['status: accepted', 'decision-makers:', '  - Zoë'], BODY + ['', 'Ünïcödé ☃ \U0001F600 and a no-break space.']), 'seal')
one('s13-mixed-line-endings-crlf-before', 'Mixed line endings: the new line ends like the line before it, which ends in CRLF.',
    b'---\nstatus: accepted\ndate: 2026-11-01\ndecision-makers:\n  - a\r\n---\n\n# T\n\n## Context and problem statement\n\nWhy.\n\n## Decision\n\n- Do it.\n\n## Consequences\n\n- Done.\n', 'seal')
one('s14-mixed-line-endings-lf-before', 'Mixed line endings: the line before ends in a line feed and the rest of the record in CRLF.',
    b'---\r\nstatus: accepted\r\ndate: 2026-11-01\r\ndecision-makers:\r\n  - a\n---\r\n\r\n# T\r\n\r\n## Context and problem statement\r\n\r\nWhy.\r\n\r\n## Decision\r\n\r\n- Do it.\r\n\r\n## Consequences\r\n\r\n- Done.\r\n', 'seal')
one('s15-status-with-trailing-white-space', 'A status followed by spaces or a tab is the status.', rec(['status: accepted \t', 'date: 2026-11-01', 'decision-makers:', '  - a']), 'seal')
one('s16-status-after-spaces', 'Spaces after the colon are not part of the value.', rec(['status:    accepted', 'date: 2026-11-01', 'decision-makers:', '  - a']), 'seal')
one('s17-a-fence-in-the-body', 'A fenced block with lines that look like headings and keys is body text.', rec(SHORT_FRONT, BODY + ['', '```md', '## Another heading', 'seal: not-a-seal', '```']), 'seal')
one('s18-one-line-short-of-the-length', 'A record of 59 lines becomes one of 60, which V-10 allows.', padded(SHORT_FRONT, 59), 'seal')
one('s19-too-long-already', 'A record of 61 lines has the problem V-10 already, and the line adds none: it is sealed.', padded(SHORT_FRONT, 61), 'seal')
one('s20-long-sections-do-not-count', 'A record of 60 lines and a long Errata section after it: the section is not counted, so the record is at the length and the line would pass it.',
    padded(SHORT_FRONT, 60) + b'\n## Errata\n\n' + b'\n'.join(b'- entry %d' % i for i in range(30)) + b'\n', 'cannot: V-10')
one('s21-number-of-the-file-is-not-read', 'The number and the name of the file do not matter to the line: 0099 is a record file like another.', rec(), 'seal', name='0099-some-late-rule.md')

# ------------------------------------------------------------------------------------------------------------------------ the length
one('l01-at-the-length', 'A record of exactly 60 lines would be 61 with the seal line, and V-10 would report it: it is left as it is and listed under V-10.', padded(SHORT_FRONT, 60), 'cannot: V-10')
one('l02-at-the-length-superseded', 'The same for a superseded record.', padded(['status: superseded by 0003', *SHORT_FRONT[1:]], 60), 'cannot: V-10')
one('l03-an-empty-line-at-the-end-counts', 'An empty line at the end of the file is a line: 59 lines and one empty line are 60.', padded(SHORT_FRONT, 59) + b'\n', 'cannot: V-10')
one('l05-the-line-feed-at-the-end-does-not-count', 'The line feed that ends the last line is not a line: 59 lines and a line feed are 59.', padded(SHORT_FRONT, 59), 'seal')
one('l04-at-the-length-crlf', 'CRLF does not change the count.', padded(SHORT_FRONT, 60).replace(b'\n', b'\r\n'), 'cannot: V-10')

# ------------------------------------------------------------------------------------------------------------------------ records that are skipped
for number, (status, why) in enumerate([('proposed', 'status proposed'), ('rejected', 'status rejected'), ('deprecated', 'status deprecated'), ('Accepted', 'status Accepted'),
                                        ('accepted # note', 'status accepted # note'), ('superseded by 12', 'status superseded by 12'), ('superseded', 'status superseded'),
                                        ('superseded by 0012 now', 'status superseded by 0012 now'), ('wip', 'status wip')], 1):
    one(f'k{number:02d}-status-' + ''.join(ch if ch.isalnum() else '-' for ch in status.lower()).strip('-') + '', f'The status `{status}` is not accepted and not superseded by NNNN: the record is skipped and the status is said.', rec([f'status: {status}', *TEMPLATE_FRONT[1:]]), f'skip: {why}')
one('k10-no-status', 'A record with no status key is skipped.', rec(['date: 2026-11-01', 'decision-makers:', '  - a']), 'skip: no status')
one('k11-proposed-with-a-seal', 'A proposed record that has a seal line is skipped for its status: the command does not say that it has a seal.', rec(['status: proposed', 'seal: sha256-g1:' + '0' * 64]), 'skip: status proposed')
one('k12-no-front-matter-key-but-status-in-body', 'A line `status: accepted` in the body is not a key.', rec(['date: 2026-11-01', 'decision-makers:', '  - a'], BODY + ['', 'status: accepted']), 'skip: no status')

# ------------------------------------------------------------------------------------------------------------------------ records that have a seal line
good = ref.g1.seal_g1(rec())
one('h01-valid-seal', 'A record with a seal that verifies is left alone.', rec([*TEMPLATE_FRONT, 'seal: ' + good]), 'has-seal')
one('h02-wrong-seal', 'A seal that does not match the text is left alone, and not rewritten: the command cannot be used to hide a change.', rec([*TEMPLATE_FRONT, 'seal: sha256-g1:' + '0' * 64]), 'has-seal')
one('h03-malformed-seal', 'A seal that is not a seal at all is left alone.', rec([*TEMPLATE_FRONT, 'seal: trust me']), 'has-seal')
one('h04-other-generation', 'A seal of a generation that this version does not know is left alone.', rec([*TEMPLATE_FRONT, 'seal: sha256-g2:' + 'a' * 64]), 'has-seal')
one('h05-seal-first', 'The seal line stands first in the front matter.', rec(['seal: ' + good, *TEMPLATE_FRONT]), 'has-seal')
one('h06-seal-uppercase-digits', 'A seal in capitals is not valid and is left alone.', rec([*TEMPLATE_FRONT, 'seal: ' + good.upper()]), 'has-seal')
one('h07-superseded-with-a-seal', 'A superseded record that has a seal line is left alone.', rec(['status: superseded by 0004', *TEMPLATE_FRONT[1:], 'seal: ' + good]), 'has-seal')

# ------------------------------------------------------------------------------------------------------------------------ records that g1 rejects
one('r01-comment', 'An HTML comment: G1-06. The record is left as it is.', rec(TEMPLATE_FRONT, BODY + ['<!-- note -->']), 'cannot: G1-06')
one('r02-byte-order-mark', 'A byte order mark in front of the record: G1-02.', b'\xef\xbb\xbf' + rec(), 'cannot: G1-02')
one('r03-no-front-matter', 'No front matter: G1-07.', b'# A rule\n\nText.\n', 'cannot: G1-07')
one('r04-front-matter-not-closed', 'A front matter that is never closed: G1-08.', b'---\nstatus: accepted\n\n# A rule\n', 'cannot: G1-08')
one('r05-invalid-utf8', 'A byte that is not UTF-8: G1-01.', b'---\nstatus: accepted\n---\n\xff\n', 'cannot: G1-01')
one('r06-nul', 'A control character: G1-03.', rec(TEMPLATE_FRONT, BODY + ['a\x00b']), 'cannot: G1-03')
one('r07-lone-carriage-return', 'A carriage return that is not part of a CRLF: G1-05.', rec(TEMPLATE_FRONT, BODY + ['a\rb']), 'cannot: G1-05')
one('r08-key-twice', 'A key twice: G1-10.', rec([*TEMPLATE_FRONT, 'date: 2026-11-02']), 'cannot: G1-10')
one('r09-seal-with-a-capital', 'The key written Seal: G1-11. It is not a seal line, and it is not rewritten.', rec([*TEMPLATE_FRONT, 'Seal: x']), 'cannot: G1-11')
one('r10-seal-without-a-value', 'A seal key with no value: G1-12.', rec([*TEMPLATE_FRONT, 'seal:']), 'cannot: G1-12')
one('r11-unclosed-fence', 'A code fence that is never closed: G1-15.', rec(TEMPLATE_FRONT, BODY + ['```', 'code']), 'cannot: G1-15')
one('r12-html-block', 'A line that starts a raw HTML block: G1-16.', rec(TEMPLATE_FRONT, BODY + ['<div>x</div>']), 'cannot: G1-16')
one('r13-proposed-and-rejected', 'A proposed record that g1 rejects is listed too: the rule is read before the status, because a record that g1 rejects has no status that can be read.', rec(['status: proposed', *TEMPLATE_FRONT[1:]], BODY + ['<!-- note -->']), 'cannot: G1-06')
one('r14-empty-file', 'An empty file: G1-07.', b'', 'cannot: G1-07')

# ------------------------------------------------------------------------------------------------------------------------ what is not a record
case('f01-not-record-files', 'Files that are not record files are skipped and said; README.md, template.md and a name that starts with a dot are not looked at.',
     {'0001-a-rule.md': shown(rec()), 'notes.txt': shown(b'x'), '0002-Capital.md': shown(rec()), '2-short.md': shown(rec()), '0003-two_words.md': shown(rec()), '.hidden.md': shown(rec()), 'README.md': shown(rec()), 'template.md': shown(rec())},
     {'0001-a-rule.md': 'seal', 'notes.txt': 'skip: not a record file', '0002-Capital.md': 'skip: not a record file', '2-short.md': 'skip: not a record file', '0003-two_words.md': 'skip: not a record file'})

# ------------------------------------------------------------------------------------------------------------------------ folders
case('m01-a-folder-of-everything', 'A folder with a record of each kind, in the order of their names.',
     {'0001-sealed-now.md': shown(rec()), '0002-superseded-now.md': shown(rec(['status: superseded by 0006', *TEMPLATE_FRONT[1:]])), '0003-sealed-already.md': shown(rec([*TEMPLATE_FRONT, 'seal: ' + good])),
      '0004-proposed.md': shown(rec(['status: proposed', *TEMPLATE_FRONT[1:]])), '0005-rejected-by-g1.md': shown(rec(TEMPLATE_FRONT, BODY + ['<!-- x -->'])), '0006-rejected.md': shown(rec(['status: rejected', *TEMPLATE_FRONT[1:]])),
      '0007-crlf.md': shown(rec(eol='\r\n')), '0008-no-final-newline.md': shown(rec(end='')), '0009-at-the-length.md': shown(padded(SHORT_FRONT, 60))},
     {'0001-sealed-now.md': 'seal', '0002-superseded-now.md': 'seal', '0003-sealed-already.md': 'has-seal', '0004-proposed.md': 'skip: status proposed', '0005-rejected-by-g1.md': 'cannot: G1-06',
      '0006-rejected.md': 'skip: status rejected', '0007-crlf.md': 'seal', '0008-no-final-newline.md': 'seal', '0009-at-the-length.md': 'cannot: V-10'})
case('m02-nothing-to-do', 'A folder in which every accepted record has a seal and the others are proposed: nothing is written and the exit status is 0.',
     {'0001-a.md': shown(rec([*TEMPLATE_FRONT, 'seal: ' + good])), '0002-b.md': shown(rec(['status: proposed', *TEMPLATE_FRONT[1:]]))}, {'0001-a.md': 'has-seal', '0002-b.md': 'skip: status proposed'})
case('m03-empty-folder', 'A folder with README.md and template.md only: no line and a count of zero.', {}, {})


def clause(answer, writing):
    kind = answer[0]
    if kind == 'seal':
        return 'sealed' if writing else 'would seal'
    if kind == 'has-seal':
        return 'already has a seal'
    if kind == 'skip':
        return f'skipped ({answer[1]})'
    return f'cannot seal ({answer[1]}: {WORDS[answer[1]]})'


def intended(text):
    if text.startswith('skip: '):
        return ('skip', text[6:])
    if text.startswith('cannot: '):
        return ('cannot', text[8:])
    return (text,)


failed = 0
ids = set()
for c in cases:
    assert c['id'] not in ids, c['id']
    ids.add(c['id'])
    files = {name: (bytes.fromhex(f['hex']) if 'hex' in f else f['text'].encode('utf-8')) if isinstance(f, dict) else f for name, f in c['files'].items()}
    c['files'] = {name: shown(data) for name, data in files.items()}
    folder = {name: data for name, data in files.items() if name not in ('README.md', 'template.md') and not name.startswith('.')}
    got = ref.adopt_folder({**files})
    want = {name: intended(text) for name, text in c.pop('intend').items()}
    if [name for name, _ in got] != sorted(want):
        failed += 1
        print('DIFFERENT', c['id'], 'files looked at', [name for name, _ in got], 'intended', sorted(want))
        continue
    after, dry, write, counts = {}, [], [], {'seal': 0, 'has-seal': 0, 'skip': 0, 'cannot': 0}
    for name, answer in got:
        if (answer[:2] if answer[0] in ('skip', 'cannot') else answer[:1]) != want[name]:
            failed += 1
            print('DIFFERENT', c['id'], name, '\n  intended', want[name], '\n  reference', answer[:2])
            continue
        counts[answer[0]] += 1
        if answer[0] == 'seal':
            after[name] = answer[1]
        # the line for a rule of g1 or of the format is made from the rule that the reference gave
        said = ('cannot', answer[1]) if answer[0] == 'cannot' else answer
        dry.append(f'{name}: {clause(said, False)}')
        write.append(f'{name}: {clause(said, True)}')
    c['dry'], c['write'], c['after'] = dry, write, {name: shown(new) for name, new in after.items()}
    c['counts'] = [counts['seal'], counts['has-seal'], counts['skip'], counts['cannot']]
    c['code'] = 1 if counts['cannot'] else 0
    # the bytes of a sealed record are the old bytes and one line: that is the whole of what a case may say a file becomes
    for name, new in after.items():
        old = files[name]
        at = new.index(b'seal: sha256-g1:')
        end = new.index(b'\n', at) + 1
        if new[:at] + new[end:] != old:
            failed += 1
            print('DIFFERENT', c['id'], name, 'more than the seal line changed')
        if ref.g1.seal_g1(old) != new[at + 6:end].rstrip(b'\r\n').decode():
            failed += 1
            print('DIFFERENT', c['id'], name, 'the seal is not the seal of the record')
        if ref.adopt_record(new)[0] != 'has-seal':
            failed += 1
            print('NOT STABLE', c['id'], name)
if failed:
    print(failed, 'differences')
    sys.exit(1)
with open(sys.argv[1], 'w', encoding='utf-8') as handle:
    json.dump({'cases': cases}, handle, ensure_ascii=True, indent=1)
    handle.write('\n')
print(len(cases), 'cases; the reference agrees with all of them')
