"""Builds test/fixtures/applies/vectors.json: items of applies-to, paths, and whether the item matches the path, computed with the Python
reference (check_ref.glob_regex). Hand-written vectors come first, then every item with every path from a small alphabet.
Usage: build_applies_vectors.py <out.json>"""
import itertools, json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
import check_ref

HAND = [
    ('src/**', 'src/a.ts'), ('src/**', 'src/x/a.ts'), ('src/**', 'src'), ('src/**', 'src/'), ('src/**', 'srcx/a'), ('src/**', 'a/src/b'),
    ('src/**/*.ts', 'src/a.ts'), ('src/**/*.ts', 'src/x/y/a.ts'), ('src/**/*.ts', 'src/a.js'), ('src/**/*.ts', 'src/x/a.tsx'), ('src/**/*.ts', 'src/.ts'),
    ('**/README.md', 'README.md'), ('**/README.md', 'docs/README.md'), ('**/README.md', 'docs/x/README.md'), ('**/README.md', 'xREADME.md'),
    ('*.mjs', 'record-keeper.mjs'), ('*.mjs', 'src/a.mjs'), ('*.mjs', '.mjs'), ('lib/*.mjs', 'lib/a.mjs'), ('lib/*.mjs', 'lib/x/a.mjs'),
    ('a**b', 'ab'), ('a**b', 'a/x/b'), ('a**b', 'axb'), ('a**b', 'ba'), ('a*b', 'a/b'), ('a*b', 'ab'), ('a*b', 'axxb'),
    ('a/**/b', 'a/b'), ('a/**/b', 'a/x/b'), ('a/**/b', 'a/x/y/b'), ('a/**/b', 'a/xb'), ('a/**/b', 'a//b'), ('a/**', 'a/'), ('a/**', 'a'),
    ('src/***', 'src/a'), ('src/***', 'src/x/a'), ('src/***', 'src/'), ('**/**', 'a/b'), ('**/', 'a/'), ('**/', 'a'), ('**', ''), ('**', 'a/b/c'), ('*', 'a'), ('*', 'a/b'), ('*', ''),
    ('README.md', 'README.md'), ('README.md', 'readme.md'), ('README.md', 'README.mdx'), ('README.md', 'x/README.md'), ('README.md', 'READMEXmd'),
    ('a?b', 'a?b'), ('a?b', 'axb'), ('a[b]c', 'a[b]c'), ('a[b]c', 'abc'), ('a{b,c}', 'a{b,c}'), ('a{b,c}', 'ab'), ('a(b)', 'a(b)'), ('a+b', 'a+b'), ('a+b', 'aab'), ('a.b', 'a.b'), ('a.b', 'axb'),
    ('a\\b', 'a\\b'), ('a^b', 'a^b'), ('a$b', 'a$b'), ('a|b', 'a|b'), ('a|b', 'a'), ('my file.txt', 'my file.txt'), ('my file.txt', 'my_file.txt'),
    ('docs/é.md', 'docs/é.md'), ('docs/*.md', 'docs/é.md'), ('docs/*.md', 'docs/é.md'), ('döcs/**', 'döcs/a'), ('a\U0001f600*', 'a\U0001f600b'), ('a*', 'a\U0001f600'),
    ('a/\n', 'a/\n'), ('a*', 'a\nb'), ('a**', 'a\nb/c'), ('a/*', 'a/\n'),
    ('', ''), ('', 'a'), ('/', '/'), ('/a', '/a'), ('./a', 'a'), ('./a', './a'), ('a/', 'a/'), ('a//b', 'a//b'), ('a//b', 'a/b'),
    ('-', '-'), ('--', '--'), ('a-b', 'a-b'),
    ('a{2}', 'a{2}'), ('a{2}', 'aa'), ('a{1,}', 'a{1,}'), ('a{1,}', 'a'), ('a{,2}', 'a{,2}'), ('a{2}b', 'a{2}b'), ('a{2}b', 'aab'), ('a{', 'a{'), ('a}', 'a}'), ('a]', 'a]'), ('a{2,3}', 'aaa'),
]
rng = random.Random(7)
ALPHA = ['a', 'b', '/', '*', '.']
items = sorted({''.join(c) for n in range(1, 6) for c in itertools.product(ALPHA, repeat=n) if rng.random() < 0.35 or n <= 3})
PATH = ['a', 'b', '/', '.']
random_paths = sorted({''.join(c) for n in range(0, 6) for c in itertools.product(PATH, repeat=n) if rng.random() < 0.25 or n <= 3})


def instance(item):
    """A path that the item matches by construction: each star replaced by a random run."""
    out, i = [], 0
    while i < len(item):
        if item.startswith('**/', i): out.append(rng.choice(['', 'a/', 'a/b/', 'b.a/'])); i += 3
        elif item.startswith('**', i): out.append(rng.choice(['', 'a', 'a/b', '/', 'b/a/.']) ); i += 2
        elif item[i] == '*': out.append(rng.choice(['', 'a', 'ab.', '.'])); i += 1
        else: out.append(item[i]); i += 1
    return ''.join(out)


def damage(path):
    if not path: return 'a'
    k = rng.randrange(len(path))
    return rng.choice([path[:k] + path[k + 1:], path[:k] + 'x' + path[k:], path + 'a', 'a' + path, path.upper(), path[:k] + '/' + path[k:]])


vectors = [{'item': i, 'path': p} for i, p in HAND]
for it in rng.sample(items, min(len(items), 160)):
    for _ in range(4): vectors.append({'item': it, 'path': instance(it)})
    for _ in range(4): vectors.append({'item': it, 'path': damage(instance(it))})
    for p in rng.sample(random_paths, 4): vectors.append({'item': it, 'path': p})
for v in vectors: v['match'] = check_ref.glob_regex(v['item']).fullmatch(v['path']) is not None
seen, out = set(), []
for v in vectors:
    k = (v['item'], v['path'])
    if k not in seen: seen.add(k); out.append(v)
json.dump({'vectors': out}, open(sys.argv[1], 'w'), ensure_ascii=True, indent=0)
open(sys.argv[1], 'a').write('\n')
print(len(out), 'vectors,', sum(v['match'] for v in out), 'match')
