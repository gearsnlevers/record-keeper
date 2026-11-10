"""Generate mutated records from the g1 vectors and, if given, the records in some folders. Usage: g1_mutants.py <vectors_dir> <n> <seed> <out.json> [<folder of records> ...]"""
import base64, glob, json, random, sys
vec_dir, n, seed, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
corpus = sys.argv[5:]
bases = []
for p in glob.glob(vec_dir + '/seal/*.record') + glob.glob(vec_dir + '/reject/*.record'):
    bases.append(open(p, 'rb').read())
for d in corpus:
    for p in sorted(glob.glob(d + '/[0-9][0-9][0-9][0-9]-*.md')):
        bases.append(open(p, 'rb').read())
rng = random.Random(seed)
POOL_LINES = ['', '', '---', '```', '````', '``` js', '~~~', '   ```', '\t```', '===', '---', '- - -', '***', '# Errata', '## Errata', '## errata', '##  Errata', '## Errata ##', ' ## Errata', '    ## Errata',
              '## Known deviations', '## Known Deviations', '### Known deviations', '# Known deviations', '## Known deviations:', 'Errata', 'Known deviations', '## Alternatives', '# Title', '## Other', '### Sub', '#', '##',
              '<div>', '<!-- x -->', '<https://a.b/c>', '<a:b>', '</div>', '<?x', '<!x', '<br/>', '   <p>', 'status: accepted', 'Status: accepted', 'seal: sha256-g1:' + '0'*64, 'date: 2026-01-01', 'Seal: x', 'DATE: x',
              'key:value', 'key: value', 'key:', 'a-b_c: 1', '1bad: x', '  continued', '  - item', ' - &anchor', '  *alias', 'k: &a b', 'k: |', 'k: >', 'k: !tag', '\tindented', 'text', 'Title', '-', '--', '=', 'x\r', '\r']
POOL_CHARS = ['\r', '\x00', '\x01', '\x08', '\x0b', '\x0c', '\x0e', '\x1b', '\x7f', '\x85', '\x9f', '\ufeff', '\u2028', '\u2029', '\u200b', '\u200d', '\u00a0', '\u061c', '\u200e', '\u200f', '\u202a', '\u202e', '\u2066', '\u2069',
              '\t', ' ', '`', '~', '#', '<', '!', '-', '=', ':', '&', '*', '|', '>', 'é', 'e\u0301', '\ud83d\ude00'.encode('utf-16','surrogatepass').decode('utf-16'), '<!--', '\ufffd']
def dec(b): return b.decode('utf-8', errors='surrogateescape')
def enc(s): return s.encode('utf-8', errors='surrogateescape')
def mutate(text):
    ops = rng.randint(1, 3)
    for _ in range(ops):
        lines = text.split('\n')
        k = rng.randrange(17)
        i = rng.randrange(len(lines))
        if k == 0 and len(lines) > 1: del lines[i]
        elif k == 1: lines.insert(i, lines[i])
        elif k == 2 and i + 1 < len(lines): lines[i], lines[i+1] = lines[i+1], lines[i]
        elif k == 3: lines.insert(i, rng.choice(POOL_LINES))
        elif k == 4: lines[i] = rng.choice(POOL_LINES)
        elif k in (5, 6):
            c = rng.choice(POOL_CHARS); j = rng.randint(0, len(lines[i])); lines[i] = lines[i][:j] + c + lines[i][j:]
        elif k == 7 and lines[i]:
            j = rng.randrange(len(lines[i])); lines[i] = lines[i][:j] + lines[i][j+1:]
        elif k == 8 and lines[i]:
            j = rng.randrange(len(lines[i])); lines[i] = lines[i][:j] + rng.choice(POOL_CHARS) + lines[i][j+1:]
        elif k == 9: lines = [l + '\r' if j < len(lines) - 1 else l for j, l in enumerate(lines)]
        elif k == 10: lines[i] = lines[i] + rng.choice([' ', '  ', '\t', ' \t', '\u00a0'])
        elif k == 11:
            if lines and lines[-1] == '': lines.pop()
            else: lines.append('')
        elif k == 12: lines[i] = rng.choice([' ', '  ', '   ', '    ', '\t']) + lines[i]
        elif k == 13:
            for _ in range(rng.randint(1, 3)): lines.insert(i, '')
        elif k == 14:
            t = '\n'.join(lines); text = t[:rng.randrange(len(t) + 1)]; continue
        elif k == 15: lines[i] = lines[i] + rng.choice(['\udcff', '\udc80', '\udcc3'])
        elif k == 16 and lines[i]:
            j = rng.randint(0, len(lines[i])); lines[i] = lines[i][:j] + ' ' + lines[i][j:]
        text = '\n'.join(lines)
    return text
mut = []
for _ in range(n):
    b = rng.choice(bases)
    mut.append(base64.b64encode(enc(mutate(dec(b)))).decode())
# the unmutated bases come first, so the comparison also covers them
allv = [base64.b64encode(b).decode() for b in bases] + mut
json.dump(allv, open(out, 'w'))
print(len(bases), 'bases +', n, 'mutants =', len(allv))
