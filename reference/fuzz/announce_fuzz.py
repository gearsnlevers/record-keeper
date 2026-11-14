"""Random histories for the differential fuzz of `announce-plan`: like audit_fuzz.py, but every repository has owners (so that acts can be
approved), many have witnesses, and the commits also change the kit files, the workflow and the pin with texts that make hard diffs (control and
format characters, runs of backticks, CRLF, no final line feed, bytes that are not UTF-8, long lines, very many lines).
Usage: announce_fuzz.py <out dir> <count> <seed>"""
import json, os, random, re, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))
import change_fuzz as cf

OUT, COUNT, SEED = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
SETTINGS = '.github/record-keeper/settings.yml'
OWNERS = ['owners: [alice/1001]', 'owners: [alice/1001, bob/1002]', 'owners: [bob/1002, alice/1001]', 'owners: [alice/1001, bob/1002, carol/1003]', 'owners: [alice/1001, carol/1003]']
WITNESSES = ['witnesses: [dave/1004]', 'witnesses: [dave/1004, erin/1005]', 'witnesses: [erin/1005, dave/1004, frank/1006]', 'witnesses: [alice/1001]', 'witnesses: [alice/1001, dave/1004]',
             'witnesses: [bob/1002, erin/1005]', 'witnesses: []', 'witnesses: [dave/1004, dave/1004]', 'witnesses: [oldname/1004]']
APPROVALS = ['approvals: 1', 'approvals: 1', 'approvals: 2', 'approvals: 3']
PIECES = ['plain line\n', 'a ``` fence\n', 'five ````` ticks\n', 'tab\there\n', 'ctl \x01 and \x1b[31m red\n', 'bidi ‮ reversed ⁦ isolate\n', 'zero​width ﻿ bom\n', 'crlf\r\nline\r\n',
          'no final line feed', '\n\n\n', 'long ' + 'z' * 3000 + '\n', 'café € \U0001F600\n', 'invalid \udcff byte\n', 'cut \udce2\udc82 sequence\n', 'overlong \udcc0\udc80\n', 'nul \x00 byte\n',
          '\\u{41} literal\n', 'line sep   and   and nel \x85\n', '@@ looks like a hunk\n', 'def f():\n', 'function g() {\n', '    indented\n']


def odd_text(rng):
    r = rng.random()
    if r < 0.12: return ''.join('line %d with some text\n' % n for n in range(rng.choice([300, 1500, 3000, 6000])))
    if r < 0.18: return ''.join(rng.choice(['x' * rng.randint(100, 900), 'y']) + '\n' for _ in range(rng.randint(100, 400)))
    return ''.join(rng.choice(PIECES) for _ in range(rng.randint(1, 8)))


def odd_change(rng, files):
    f = dict(files)
    what = rng.choice(['code', 'code', 'code', 'workflow', 'workflow', 'pin', 'settings', 'settings'])
    if what == 'code':
        path = rng.choice(['record-keeper.mjs', 'check-pull-request.mjs', 'run-audit.mjs'])
        old = f.get(path)
        old = old if isinstance(old, str) else '// code\n'
        mode = rng.choice(['replace', 'append', 'prepend', 'middle'])
        new = odd_text(rng)
        f[path] = new if mode == 'replace' else old + new if mode == 'append' else new + old if mode == 'prepend' else old[:len(old) // 2] + new + old[len(old) // 2:]
    elif what == 'workflow':
        path = rng.choice(['.github/workflows/records-integrity.yml', '.github/workflows/records-audit.yml', '.github/workflows/test.yml'])
        f[path] = rng.choice(['name: Records integrity\n', 'name: Records integrity\n', 'name: Other\n']) + odd_text(rng)
    elif what == 'pin': f['.github/record-keeper.yml'] = 'source: a/b\nversion: v%d\n' % rng.randint(1, 3) + odd_text(rng)
    else:
        old = f.get(SETTINGS)
        old = old[0] if isinstance(old, tuple) else old
        lines = [l for l in (old or '').split('\n') if l and not l.startswith(('owners:', 'witnesses:', 'approvals:'))]
        if rng.random() < 0.9: lines.append(rng.choice(OWNERS))
        if rng.random() < 0.7: lines.append(rng.choice(WITNESSES))
        if rng.random() < 0.4: lines.append(rng.choice(APPROVALS))
        rng.shuffle(lines)
        f[SETTINGS] = '\n'.join(lines) + '\n'
    return f


def world(rng):
    folder, files = cf.world(rng)
    old = files.get(SETTINGS) or ''
    old = old[1] if isinstance(old, tuple) else old
    lines = [l for l in old.split('\n') if l and not l.startswith(('owners:', 'witnesses:', 'approvals:'))]
    lines.append(rng.choice(OWNERS))
    if rng.random() < 0.6: lines.append(rng.choice(WITNESSES))
    if rng.random() < 0.3: lines.append(rng.choice(APPROVALS))
    files[SETTINGS] = '\n'.join(lines) + '\n'
    for kit in ['record-keeper.mjs', 'check-pull-request.mjs', 'run-audit.mjs', '.github/workflows/records-integrity.yml']:
        files.setdefault(kit, '// ' + kit + '\n')
    return folder, files


def mutate(rng, folder, files):
    tree = cf.mutate(rng, folder, files) if rng.random() < 0.5 else dict(files)
    for _ in range(rng.choice([0, 1, 1, 2, 3])): tree = odd_change(rng, tree)
    return tree


env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
MESSAGES = ['work', 'Merge pull request #{n} from a/b', 'Fix things (#{n})', 'Fixes #{n}', 'x\n\nrefs #{n}']


def stream(label, files, message, parents):
    s = b'commit refs/heads/' + label.encode() + b'\ncommitter T <t@example.com> 0 +0000\n' + cf.data(message.encode())
    if parents: s += b'from refs/heads/' + parents[0].encode() + b'\n' + b''.join(b'merge refs/heads/' + q.encode() + b'\n' for q in parents[1:])
    s += b'deleteall\n'
    for p, val in sorted(files.items()):
        mode, content = val if isinstance(val, tuple) else ('100644', val)
        s += b'M ' + mode.encode() + b' inline ' + p.encode() + b'\n' + cf.data(content.encode('utf-8', 'surrogateescape'))
    return s


def main():
    rng = random.Random(SEED)
    os.makedirs(OUT, exist_ok=True)
    scenarios = []
    for i in range(COUNT):
        repo = os.path.join(OUT, f'r{i}.git')
        subprocess.run(['git', 'init', '-q', '--bare', repo], check=True)
        folder, files = world(rng)
        trees, labels = {}, []
        for k in range(rng.choice([2, 3, 4, 5, 6, 8]) + 1):
            label = f'c{k}'
            parents = [labels[-1]] if labels else []
            tree = files if k == 0 else mutate(rng, folder, trees[labels[-1]])
            if k > 0 and len(labels) >= 2 and rng.random() < 0.15:
                side = f's{k}'
                side_tree = mutate(rng, folder, trees[labels[rng.randrange(len(labels))]])
                subprocess.run(['git', '-C', repo, 'fast-import', '--quiet'], input=stream(side, side_tree, 'side', [rng.choice(labels)]), check=True, env=env)
                if rng.random() < 0.6: parents = [labels[-1], side]
            message = rng.choice(MESSAGES).format(n=rng.randint(1, 6))
            subprocess.run(['git', '-C', repo, 'fast-import', '--quiet'], input=stream(label, tree, message, parents), check=True, env=env)
            trees[label] = tree
            labels.append(label)
        head = subprocess.run(['git', '-C', repo, 'rev-parse', labels[-1]], capture_output=True, text=True, check=True, env=env).stdout.strip()
        scenarios.append({'id': i, 'repo': repo, 'head': head, 'from': None, 'since': None})
    json.dump(scenarios, open(os.path.join(OUT, 'scenarios.json'), 'w'))
    print(COUNT, 'scenarios in', OUT)


main()
