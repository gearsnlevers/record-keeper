"""Mutate fixture folders, run reference 1 on them, write the folders and results. usage: fuzz_validate.py <fixtures> <n> <seed> <outdir>"""
import json, os, random, re, shutil, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import validate_ref as ref
fixtures, n, seed, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
rng = random.Random(seed)
POOL = ['0001', '0002', '0003', '0004', '0005', '0009', '0000', '0010', '1', '0001 0002', '00001', 'abcd', '\uff10\uff10\uff10\uff11', '0001x', '-0001', '0001 # x', '٠٠٠١']
def supersedes_block():
    kind = rng.random()
    items = [rng.choice(POOL) for _ in range(rng.randint(1, 3))]
    if kind < 0.65: return ['supersedes:'] + ['  - ' + i for i in items]
    if kind < 0.8: return ['supersedes: ' + items[0]]
    if kind < 0.9: return ['supersedes:']
    return ['supersedes: ' + items[0]] + ['  - ' + i for i in items[1:]]
def put_supersedes(t):
    lines = t.split('\n')
    if lines and lines[0] == '---' and '---' in lines[1:]:
        end = lines.index('---', 1)
        cut = [i for i in range(1, end) if lines[i] == 'supersedes:' or lines[i].startswith('supersedes:')]
        if cut and rng.random() < 0.5:
            i = cut[0]; j = i + 1
            while j < end and lines[j].startswith(' '): j += 1
            del lines[i:j]; end -= j - i
        at = rng.choice([1, end])
        lines[at:at] = supersedes_block()
    return '\n'.join(lines)
cases = json.load(open(fixtures + '/cases.json'))['cases']
bases = [c for c in cases if c['folder'] != 'no-such-folder' and not c.get('symlinks')]
LINES = ['', '', '---', '```', '## Index', '## Decision', '## Errata', '## Known deviations', '## Notes', '# Title', '### Sub', 'status: accepted', 'status: deprecated', 'status: superseded by 0002', 'status: superseded by 0001',
         'date: 2026-02-30', 'date: 2026-11-01', 'seal: sha256-g1:' + 'c' * 64, 'seal: x', 'tags: x', 'repos:', 'applies-to:', '  - src/**', '  -x', '  - ', 'decision-makers: me', 'issues:', '  - a/b#1', '  - a/b',
         '| 0001 | [First decision](0001-first-decision.md) | accepted |', '| 0009 | [Ghost](0009-ghost.md) | proposed |', '| x | y |', 'mail me@example.org', 'token ghp_' + 'Z' * 24, '<!-- c -->', '<div>']
def mutate_text(t):
    lines = t.split('\n')
    for _ in range(rng.randint(1, 3)):
        k = rng.randrange(7); i = rng.randrange(len(lines))
        if k == 0 and len(lines) > 2: del lines[i]
        elif k == 1: lines.insert(i, lines[i])
        elif k == 2: lines.insert(i, rng.choice(LINES))
        elif k == 3: lines[i] = rng.choice(LINES)
        elif k == 4 and lines[i]:
            j = rng.randrange(len(lines[i])); lines[i] = lines[i][:j] + lines[i][j + 1:]
        elif k == 5: lines[i] = lines[i] + rng.choice([' ', '\t', ' x'])
        elif k == 6 and i + 1 < len(lines): lines[i], lines[i + 1] = lines[i + 1], lines[i]
    return '\n'.join(lines)
shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
results = {}
for i in range(n):
    c = rng.choice(bases)
    src = os.path.join(fixtures, c['folder'])
    d = os.path.join(out, f'f{i:05d}')
    shutil.copytree(src, d)
    files = sorted(f for f in os.listdir(d) if os.path.isfile(os.path.join(d, f)))
    for _ in range(rng.randint(1, 3)):
        files = sorted(f for f in os.listdir(d) if os.path.isfile(os.path.join(d, f)))
        k = rng.choice([0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 8, 8, 8])
        f = rng.choice(files) if files else None
        if f is None: break
        p = os.path.join(d, f)
        if k == 8: open(p, 'w', newline='').write(put_supersedes(open(p, newline='').read()))
        elif k <= 4: open(p, 'w', newline='').write(mutate_text(open(p, newline='').read()))
        elif k == 5: os.remove(p)
        elif k == 6:
            new = rng.choice(['0004-new-one.md', '0002-dup.md', 'notes.txt', '0004-Bad.md', 'readme.txt', '0010-gap.md', '.hidden', 'x.md'])
            if new.lower() != f.lower(): shutil.copyfile(p, os.path.join(d, new))
        else:
            target = rng.choice(['0001-first-decision.md', '0002-second-decision.md', '0003-third-decision.md', '0005-skip.md'])
            if target.lower() != f.lower(): os.replace(p, os.path.join(d, target))
    extra = rng.choice([(), ('repos',), ('window', 'repos')])
    res = ref.validate(d, extra)
    results[os.path.basename(d)] = {'extra': list(extra), 'problems': sorted(f'{(f or "")}|{r}|{(det if r == "V-09" else "")}' for f, r, det in res)}
json.dump(results, open(os.path.join(out, 'ref1.json'), 'w'))
import collections
print(n, 'folders;', sum(1 for v in results.values() if not v['problems']), 'valid;', 'rules hit:', len(collections.Counter(p.split('|')[1] for v in results.values() for p in v['problems'])))
