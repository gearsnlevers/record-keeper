"""Random trees with modes, links, submodules, attribute files and other folders; the Python reference (checkout based) gives the answers.
usage: commit_fuzz.py <fixtures validate dir> <n> <seed> <outdir>   -> writes <outdir>/r.git and <outdir>/expected.json"""
import json, os, random, shutil, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import commit_lib, commit_ref
fixtures, n, seed, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
rng = random.Random(seed)
cases = [c for c in json.load(open(fixtures + '/cases.json'))['cases'] if c['folder'] != 'no-such-folder' and not c.get('symlinks')]
PATTERNS = ['*', '*.md', 'docs/decisions/*.md', '/docs/**', '0001*', 'README.md', '[0-9]*.md', 'docs/decisions/shared/**', 'decisions/*', '**/README.md', 'template.md', '*.lock.yml', 'docs/*/0002-second-decision.md', '!*.md', '*.MD', '.*']
ATTRS = ['text', '-text', 'text=auto', 'eol=lf', 'eol=crlf', 'diff', '-diff', 'binary', 'linguist-generated', 'linguist-generated=true', '!linguist-generated', 'ident', 'filter=x', 'working-tree-encoding=UTF-16', 'export-ignore', 'merge=ours', 'custom=1', '-merge', '!text', 'linguist-documentation']
LEVELS = ['.gitattributes', 'docs/.gitattributes', 'docs/decisions/.gitattributes', 'docs/decisions/shared/.gitattributes', 'other/.gitattributes']
OTHER = ['docs/adr/README.md', 'adr/0001-a.md', 'decisions/README.md', 'doc/adr/notes.txt', 'docs/adrs/0002-x.md', 'docs/architecture/decisions/README.md', 'docs/other/README.md', 'adrs/0001-A.md', 'doc/decisions/readme.md']
shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
trees, meta = [], {}
for i in range(n):
    c = rng.choice(cases)
    folder = rng.choice(['docs/decisions'] * 5 + ['decisions', 'adr', 'docs', 'a/b'])
    src = os.path.join(fixtures, c['folder'])
    tree = {}
    for dp, dn, fn in os.walk(src):
        for f in fn:
            full = os.path.join(dp, f)
            tree[f'{folder}/{os.path.relpath(full, src)}'.replace(os.sep, '/')] = ('100644', open(full, 'rb').read())
    names = sorted(tree)
    for _ in range(rng.randint(0, 5)):
        k = rng.randrange(7)
        if k == 0 and names: p = rng.choice(names); tree[p] = ('100755', tree[p][1])
        elif k == 1:
            lvl = rng.choice(LEVELS)
            lines = [f'{rng.choice(PATTERNS)} {" ".join(rng.sample(ATTRS, rng.randint(1, 3)))}' for _ in range(rng.randint(1, 3))]
            tree[lvl] = ('100644', ('\n'.join(lines) + '\n').encode())
        elif k == 2: tree[rng.choice(OTHER)] = ('100644', b'x\n')
        elif k == 3 and names: p = rng.choice(names); tree[p] = ('120000', b'README.md')
        elif k == 4: tree[f'{folder}/{rng.choice(["0007-sub.md", "sub", ".sub"])}'] = ('160000', '0123456789012345678901234567890123456789')
        elif k == 5: tree[f'{folder}/.hidden-{rng.randrange(3)}'] = (rng.choice(['100644', '100755']), b'x\n')
        elif k == 6: tree[rng.choice(['docs/adr', 'decisions', 'adr', 'docs'])] = ('120000', b'elsewhere')
    # a path cannot be both a file and a directory: drop entries that sit below a non-tree entry
    for p in list(tree):
        parts = p.split('/')
        if any('/'.join(parts[:j]) in tree for j in range(1, len(parts))): del tree[p]
    trees.append((f't{i}', tree)); meta[f't{i}'] = folder
commit_lib.build_repo(os.path.join(out, 'r.git'), trees)
expected = {}
for name, folder in meta.items():
    got = commit_ref.commit_validate(os.path.join(out, 'r.git'), name, folder)
    expected[name] = {'folder': folder, 'problems': sorted(f'{(f or "")}|{r}|{(d if r == "V-09" else "")}|{(d if r in ("T-02", "T-03") else "")}' for f, r, d in got)}
json.dump(expected, open(os.path.join(out, 'expected.json'), 'w'))
import collections
print(n, 'trees;', sum(1 for v in expected.values() if not v['problems']), 'valid;', dict(collections.Counter(p.split('|')[1] for v in expected.values() for p in v['problems'] if p.split('|')[1].startswith('T'))))
