"""Records around the cap of V-10 (docs/record-format.md: the length of a record without its Known deviations and Errata sections), with reference 1.
usage: length_fuzz.py <n> <seed> <outdir>

Writes folders of one record each (with an index and a template) and ref1.json in the format of validate_fuzz.py, so that validate_compare_ref2.mjs and
validate_compare.mjs compare reference 2 and the library with it. Three kinds of record:
  pair      a record without the two sections (name ...a) and the same record with sections appended as a record gets them after acceptance (name ...b).
            The length outside the sections is drawn around the cap (50 to 70, most of them 58 to 62), and the text around is rough: fenced blocks that hold
            headings, headings of other levels, indented headings, empty lines, CRLF, no line feed at the end or empty lines there, white space at line ends.
  inside    a record whose excluded sections hold lines that end a section (a heading of level 1 or 2, up to three spaces in front) or only look like one.
  damaged   a record that g1 refuses (G1-18, G1-19, G1-20), to which V-10 must not be applied.
A pair is the invariant of the page: appending a well-formed section, or an entry to one, never changes the length that V-10 counts, so it never changes
whether V-10 is reported. The generator checks it with reference 1 (the number of pairs that broke it is printed and must be 0), and the comparison of the
folders checks that the other two implementations answer the same for both halves of every pair."""
import json, os, random, shutil, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import g1
import validate_ref as ref

n, seed, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
rng = random.Random(seed)

README = '# Decision records\n\n## Index\n\n| # | Title | Status |\n| - | - | - |\n| 0001 | [Title](0001-title.md) | proposed |\n'
TEMPLATE = '---\nstatus: proposed\ndate: YYYY-MM-DD\ndecision-makers:\n  - maintainers\n---\n\n# Short title\n\n## Context and problem statement\n\nWhy.\n\n## Decision\n\nWhat.\n\n## Consequences\n\nSo.\n'
HEAD = ['---', 'status: proposed', 'date: 2026-11-01', 'decision-makers:', '  - maintainers', '---', '', '# Title', '', '## Context and problem statement', '', 'Why.', '',
        '## Decision', '', '- Do.', '', '## Consequences', '', '- Done.']
ALTERNATIVES = ['', '## Alternatives considered', '', '- Nothing else.']

# Lines of a section that are not a heading of level 1 or 2, so that they end nothing. (A fence is never one line here: a fence is drawn as a block.)
QUIET = ['text.', '- an item', '', '', '### Deviation 1', '### Sub', '###', '    ## indented four spaces', '##Notes', '#hashtag', '>', '| a | b |', '- date: 2026-11-07', '- case: pull 28']
# Lines that end a section for g1: a heading of level 1 or 2 outside a fence, with up to three spaces in front.
ENDERS = ['# Appendix', '#', '#\tAppendix', '   ## Notes', '##\tNotes', '##', '## Notes', ' # Notes', '  ##']


def fenced_block():
    """A closed fence that holds lines that look like headings, never the heading of an excluded section (g1 refuses that)."""
    inner = [rng.choice(['## Alternatives considered', '# Appendix', '   ## Notes', '### Sub', '##', 'text', '', '## Decision']) for _ in range(rng.randint(0, 3))]
    return ['```' + rng.choice(['', 'md', 'sh'])] + inner + ['```']


def units(pool, count, room=None):
    """`count` units, each a line of the pool or a closed fence, in all at most `room` lines (a unit is never cut: a fence that is open would be G1-15)."""
    out = []
    for _ in range(count):
        unit = fenced_block() if rng.random() < 0.15 else [rng.choice(pool)]
        if room is None or len(out) + len(unit) <= room: out += unit
    return out


def block(name, kind):
    """The lines of an excluded section: the heading, an empty line, entries and free lines. Kind 'inside' may hold lines that end a section."""
    lines = ['## ' + name, '']
    for k in range(rng.randint(0, 3)):
        if name == 'Known deviations': lines += [f'### Deviation {k + 1}', '', '- date: 2026-11-07', '- case: pull 28', '- reason: A reason.', '']
        else: lines += [f'### Erratum {k + 1}', '', '- date: 2026-11-08', '- previous entry: none', '- previous seal: sha256-g1:' + 'a' * 64, '- seal: sha256-g1:' + 'b' * 64, '- reason: A reason.', '']
    lines += units(QUIET + (ENDERS if kind == 'inside' else []), rng.randint(0, 6))
    return lines


def make_base(outside):
    """The lines of a record that has `outside` lines (with no empty line counted for a final line feed), and an Alternatives section half of the time."""
    tail = list(ALTERNATIVES) if rng.random() < 0.5 else []
    room = max(0, outside - len(HEAD) - len(tail))
    noise = units(QUIET + ENDERS, rng.choice([0, 0, 2, 5]), room)
    return HEAD + ['- filler line %d.' % i for i in range(room - len(noise))] + noise + tail, bool(tail)


def text_of(lines, final, white):
    shown = [line + (rng.choice([' ', '\t', '  ']) if white and rng.random() < 0.1 else '') for line in lines]
    return '\n'.join(shown) + {'none': '', 'lf': '\n', 'lf+blank': '\n\n'}[final]


def put(folder, text, eol):
    os.makedirs(folder)
    open(os.path.join(folder, 'README.md'), 'w').write(README)
    open(os.path.join(folder, 'template.md'), 'w').write(TEMPLATE)
    with open(os.path.join(folder, '0001-title.md'), 'w', newline='') as fh: fh.write(text.replace('\n', eol))


def counted(text, eol):
    lines, end = g1.check(text.replace('\n', eol).encode('utf-8'))
    return ref.length_as_accepted(lines, end)


def before_alternatives(lines, extra):
    """The lines of a section put right before `## Alternatives considered` (the last lines of a base that has the section: a fence in the text may hold
    a line that looks like the heading), after the empty line that stands there, and an empty line behind them."""
    k = len(lines) - len(ALTERNATIVES) + 1
    assert lines[k] == '## Alternatives considered'
    return lines[:k] + extra + [''] + lines[k:]


shutil.rmtree(out, ignore_errors=True)
os.makedirs(out)
results = {}
stats = dict(pairs=0, over=0, broken=0, unread=0, inside=0, damaged=0)
unread_by = {}
for i in range(n):
    kind = rng.choice(['pair', 'pair', 'pair', 'inside', 'damaged'])
    outside = rng.choice([58, 59, 60, 60, 60, 61, 61, 62, 50, 70, rng.randint(40, 80)])
    final = rng.choice(['lf', 'lf', 'lf', 'none', 'lf+blank'])
    eol = rng.choice(['\n', '\n', '\n', '\r\n'])
    lines, has_alternatives = make_base(outside)
    folders = {}
    if kind == 'pair':
        stats['pairs'] += 1
        kd, er = rng.choice([(True, False), (False, True), (True, True), (True, True)])
        middle = kd and has_alternatives and rng.random() < 0.5
        at_end = [block(name, 'quiet') for name, wanted in (('Known deviations', kd and not middle), ('Errata', er)) if wanted]
        base = text_of(lines, final, white=False)
        with_text = text_of(before_alternatives(lines, block('Known deviations', 'quiet')) if middle else lines, final, white=False)
        if at_end:
            # one line feed if the text has none, then the empty line that g1 asks for, then the sections, whatever the end of the last one is
            with_text += ('' if with_text.endswith('\n') else '\n') + '\n' + '\n\n'.join('\n'.join(b) for b in at_end) + rng.choice(['', '\n', '\n', '\n\n'])
        folders = {f'f{i:05d}a': base, f'f{i:05d}b': with_text}
        try:
            ca, cb = counted(base, eol), counted(with_text, eol)
            if ca != cb or (ca > 60) != (cb > 60):
                stats['broken'] += 1
                print('INVARIANT BROKEN', f'f{i:05d}b', ca, cb)
            stats['over'] += cb > 60
        except g1.Reject as e:
            stats['unread'] += 1
            unread_by[e.rule] = unread_by.get(e.rule, 0) + 1
    else:
        wild = list(lines)
        if kind == 'inside':
            stats['inside'] += 1
            for name in rng.choice([['Known deviations'], ['Errata'], ['Known deviations', 'Errata']]):
                if has_alternatives and name == 'Known deviations' and rng.random() < 0.4: wild = before_alternatives(wild, block(name, 'inside'))
                else: wild += [''] + block(name, 'inside')
        else:
            stats['damaged'] += 1
            breaks = rng.choice([
                ['```md', '## Known deviations', '```'], ['```', '## Errata', '```'], ['### Errata'], ['## errata'], ['## Known deviations ##'], ['##  Errata'],
                ['## Errata', '', '- x', '', '## Errata'], ['## Errata', '', '- x', '', '## Known deviations', '', '- y'], ['## Known deviations', '', '- x', '## Known deviations'],
            ])
            wild += ([''] if rng.random() < 0.8 else []) + breaks      # without the empty line in front: G1-20
        folders = {f'f{i:05d}': text_of(wild, final, white=rng.random() < 0.3)}
    for name, text in folders.items():
        put(os.path.join(out, name), text, eol)
        res = ref.validate(os.path.join(out, name), ())
        results[name] = {'extra': [], 'problems': sorted(f'{(f or "")}|{r}|{(det if r == "V-09" else "")}' for f, r, det in res)}
json.dump(results, open(os.path.join(out, 'ref1.json'), 'w'))
hit = {}
for v in results.values():
    for p in v['problems']: hit[p.split('|')[1]] = hit.get(p.split('|')[1], 0) + 1
print(f"{len(results)} folders; {stats['pairs']} pairs ({stats['over']} over the cap, {stats['unread']} that g1 refuses), {stats['inside']} with lines that end a section, "
      f"{stats['damaged']} damaged; the invariant broke {stats['broken']} times; V-10 in {hit.get('V-10', 0)} folders, V-09 in {hit.get('V-09', 0)}; pairs g1 refused: {unread_by}")
