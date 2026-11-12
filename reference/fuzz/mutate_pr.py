"""Mutation test of every line of check-pull-request.mjs against test/github.test.mjs; MUT_FILE and MUT_TESTS name another program and its tests
(run-audit.mjs and test/audit-run.test.mjs); MUT_LINES limits the mutated lines to some ranges of line numbers.
Usage: mutate_pr.py <repo_dir> <workers>"""
import concurrent.futures, os, re, shutil, subprocess, sys, tempfile, threading
repo, workers = sys.argv[1], int(sys.argv[2])
FILE = os.environ.get('MUT_FILE', 'check-pull-request.mjs')
src = open(os.path.join(repo, FILE)).read()
lines = src.split('\n')
RANGES = [tuple(int(n) for n in part.split('-')) for part in os.environ['MUT_LINES'].split(',')] if os.environ.get('MUT_LINES') else None   # e.g. 12-40,88-97 (line numbers)
inrange = lambda i: RANGES is None or any(a <= i + 1 <= b for a, b in RANGES)
def tests_for(i):
    return os.environ.get('MUT_TESTS', 'test/github.test.mjs').split()

def skip(i, l):
    s = l.strip()
    return (not inrange(i) or s.startswith(('//', '*', '/**')) or re.match(r"^\s+'G1-\d\d':", l) or 'file}:' in l or s.startswith(('Usage', 'record-keeper.mjs', '`', '  record-keeper.mjs', 'export const RULES', 'const USAGE'))
            or 'import ' in l or s.startswith('const USAGE'))

muts = []  # (line index, new line, description)
def add(i, new, desc):
    if new != lines[i]: muts.append((i, new, desc))

REGEX = re.compile(r'(?<![\w)\]])/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n\[])+)/([gimsuy]*)')
for i, l in enumerate(lines):
    if skip(i, l): continue
    # statements
    m = re.search(r"throw new Reject\('G1-\d\d'\);", l)
    if m: add(i, l[:m.start()] + ';' + l[m.end():], 'drop ' + m.group(0))
    for m in re.finditer(r' (===|!==) ', l):
        add(i, l[:m.start()] + (' !== ' if m.group(1) == '===' else ' === ') + l[m.end():], f'flip {m.group(1)}')
    for m in re.finditer(r' (&&|\|\|) ', l):
        add(i, l[:m.start()] + (' || ' if m.group(1) == '&&' else ' && ') + l[m.end():], f'swap {m.group(1)}')
    for m in re.finditer(r' (>=|<=|>|<) ', l):
        new = {'>=': '>', '<=': '<', '>': '>=', '<': '<='}[m.group(1)]
        add(i, l[:m.start()] + f' {new} ' + l[m.end():], f'{m.group(1)} -> {new}')
    for m in re.finditer(r'\b0x([0-9a-f]+)\b', l):
        v = int(m.group(1), 16)
        for d in (-1, 1): add(i, l[:m.start()] + f'0x{v + d:0{len(m.group(1))}x}' + l[m.end():], f'{m.group(0)} {d:+d}')
    if '/^' not in l and '/[' not in l:
        for m in re.finditer(r"(?<![\w.'\"{,/$-])(\d+)(?![\w.'\"},/])", l):
            v = int(m.group(1))
            for d in (-1, 1):
                if v + d >= 0: add(i, l[:m.start()] + str(v + d) + l[m.end():], f'number {v} {d:+d}')
    for m in re.finditer(r'\b(true|false)\b', l):
        add(i, l[:m.start()] + ('false' if m.group(1) == 'true' else 'true') + l[m.end():], 'flip ' + m.group(1))
    for m in re.finditer(r'(?<![=!<>])!(?=[a-zA-Z(\[])', l):
        add(i, l[:m.start()] + l[m.end():], 'drop !')
    for m in re.finditer(r'code: ([012])', l):
        for v in '012':
            if v != m.group(1): add(i, l[:m.start()] + f'code: {v}' + l[m.end():], f'code {m.group(1)} -> {v}')
    # regex literals
    for rm in REGEX.finditer(l):
        body = rm.group(1)
        if not any(c in body for c in '^$[{+*?'): continue
        def sub(newbody, desc):
            add(i, l[:rm.start(1)] + newbody + l[rm.end(1):], desc + ' in /' + body[:30] + '/')
        for q in re.finditer(r'\{(\d+)(,(\d*))?\}', body):
            a, comma, b = int(q.group(1)), q.group(2), q.group(3)
            outs = []
            if comma is None: outs += [f'{{{a - 1}}}' if a > 0 else None, f'{{{a + 1}}}']
            elif b == '': outs += [f'{{{a - 1},}}' if a > 0 else None, f'{{{a + 1},}}']
            else: outs += [f'{{{a},{int(b) - 1}}}', f'{{{a},{int(b) + 1}}}', f'{{{a - 1},{b}}}' if a > 0 else None, f'{{{a + 1},{b}}}' if a + 1 <= int(b) else None]
            for o in outs:
                if o: sub(body[:q.start()] + o + body[q.end():], f'quantifier {q.group(0)} -> {o}')
        for a in re.finditer(r'(?<!\\)(\^|\$)', body):
            if a.start() > 0 and body[a.start() - 1] == '[': continue
            sub(body[:a.start()] + body[a.end():], 'drop anchor ' + a.group(1))
        for cm in re.finditer(r'\[((?:\\.|[^\]\\])+)\]', body):
            cls = cm.group(1)
            toks = re.findall(r'\\.|.-.|.', cls) if not cls.startswith('^') else []
            for k, tk in enumerate(toks):
                if len(toks) > 1:
                    newcls = ''.join(toks[:k] + toks[k + 1:])
                    sub(body[:cm.start(1)] + newcls + body[cm.end(1):], f'class drop {tk!r}')
        for q in re.finditer(r'(?<!\\)(\+|\*)(?!\?)', body):
            sub(body[:q.start()] + ('*' if q.group(1) == '+' else '+') + body[q.end():], f'{q.group(1)} swap')
        for q in re.finditer(r'(?<!\\)\)\?', body):
            sub(body[:q.start()] + ')' + body[q.end():], 'drop optional group')
# string constants: every short single-quoted literal
for i, l in enumerate(lines):
    if skip(i, l): continue
    for m in re.finditer(r"'([^'\\\n]{2,})'", l):
        t = m.group(1)
        add(i, l[:m.start(1)] + t[:-1] + l[m.end(1):], f'shorten {t[:30]!r}')
        add(i, l[:m.start(1)] + t + 'x' + l[m.end(1):], f'lengthen {t[:30]!r}')
# dedupe
seen, uniq = set(), []
for i, new, d in muts:
    if (i, new) not in seen: seen.add((i, new)); uniq.append((i, new, d))
print(len(uniq), 'mutants', flush=True)

def run(idx_mut):
    n, (i, new, d) = idx_mut
    w = os.path.join(tmp, f'w{n % workers}')
    # one directory per worker slot, guarded by a lock per slot
    with locks[n % workers]:
        mutated = '\n'.join(lines[:i] + [new] + lines[i + 1:])
        open(os.path.join(w, FILE), 'w').write(mutated)
        # a new session, so that a timeout stops the test runner and everything it started (a mutant can loop for ever); a mutant is killed
        # at the first test that fails, which is when the runner has printed `not ok`
        proc = subprocess.Popen(['node', '--test', '--test-reporter=tap', *tests_for(i)], cwd=w, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True, text=True)
        timer = threading.Timer(240, lambda: os.killpg(proc.pid, 9))
        timer.start()
        failed = False
        for line in proc.stdout:
            if re.match(r'\s*not ok ', line):
                failed = True
                os.killpg(proc.pid, 9)
                break
        proc.wait()
        timer.cancel()
        killed = failed or proc.returncode != 0
        return n, i, d, killed

locks = [threading.Lock() for _ in range(workers)]
tmp = tempfile.mkdtemp(prefix='mut-')
for k in range(workers):
    shutil.copytree(repo, os.path.join(tmp, f'w{k}'), ignore=shutil.ignore_patterns('.git'))
survivors = []
done = 0
with concurrent.futures.ThreadPoolExecutor(workers) as ex:
    for n, i, d, killed in ex.map(run, list(enumerate(uniq))):
        done += 1
        if not killed: survivors.append((i, d, uniq[n][1]))
        if done % 100 == 0: print(done, 'done,', len(survivors), 'survivors', flush=True)
print(f'{len(uniq)} mutants, {len(uniq) - len(survivors)} killed, {len(survivors)} survived')
for i, d, new in sorted(survivors):
    print(f'L{i + 1}: {d}\n     was: {lines[i].strip()[:150]}\n     now: {new.strip()[:150]}')
shutil.rmtree(tmp)
