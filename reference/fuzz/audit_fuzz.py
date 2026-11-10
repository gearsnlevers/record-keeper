"""Random histories for the differential fuzz of `audit`: builds one bare repository for each scenario (a chain of commits made with the
mutations of change_fuzz.py, some merges, notes that cite earlier commits, messages that name pull requests and issues) and writes
scenarios.json. Usage: audit_fuzz.py <out dir> <count> <seed>"""
import json, os, random, re, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))
import change_fuzz as cf

OUT, COUNT, SEED = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
MESSAGES = ['work', 'Merge pull request #{n} from a/b', 'Fix things (#{n})', 'Fixes #{n}', 'see #{n}0', 'a#{n}', 'Merge pull request #{n} from a/b\n\nFixes #{m}', 'x\n\nrefs #{n}']


def stream(label, files, message, parents):
    s = b'commit refs/heads/' + label.encode() + b'\ncommitter T <t@example.com> 0 +0000\n' + cf.data(message.encode())
    if parents: s += b'from refs/heads/' + parents[0].encode() + b'\n' + b''.join(b'merge refs/heads/' + q.encode() + b'\n' for q in parents[1:])
    s += b'deleteall\n'
    for p, val in sorted(files.items()):
        pb = p.encode()
        if isinstance(val, tuple):
            mode, content = val
            s += b'M ' + mode.encode() + b' inline ' + pb + b'\n' + cf.data(content.encode('utf-8', 'surrogateescape'))
        else:
            s += b'M 100644 inline ' + pb + b'\n' + cf.data(val.encode('utf-8', 'surrogateescape'))
    return s


def add_note(rng, folder, files, ids):
    """A Known deviations note on a record that looks sealed, citing an earlier commit, a pull request or an issue."""
    names = [p for p, val in files.items() if isinstance(val, str) and p.startswith(folder + '/') and re.search(r'^seal: sha256-g1:', val, re.M) and '## Known deviations' not in val and '## Errata' not in val]
    if not names: return files
    p = rng.choice(names)
    cite = rng.choice(['commit ' + rng.choice(list(ids.values())), 'commit ' + rng.choice(list(ids.values())), 'pull %d' % rng.randint(1, 6), 'issue %d' % rng.randint(1, 6), 'commit ' + 'a' * 40])
    note = '## Known deviations\n\n### Deviation 1\n\n- date: 2026-11-08\n- case: %s\n- reason: A one-off.\n\n' % cite
    out = dict(files)
    out[p] = files[p].replace('## Alternatives considered', note + '## Alternatives considered', 1)
    return out


def main():
    rng = random.Random(SEED)
    os.makedirs(OUT, exist_ok=True)
    scenarios = []
    for i in range(COUNT):
        repo = os.path.join(OUT, f'r{i}.git')
        subprocess.run(['git', 'init', '-q', '--bare', repo], check=True)
        folder, files = cf.world(rng)
        trees, ids, labels = {}, {}, []
        steps = rng.choice([2, 3, 4, 5, 6, 8])
        for k in range(steps + 1):
            label = f'c{k}'
            parents = [labels[-1]] if labels else []
            if k == 0: tree = files
            else:
                tree = cf.mutate(rng, folder, trees[labels[-1]])
                if rng.random() < 0.25: tree = add_note(rng, folder, tree, ids)
                if len(labels) >= 2 and rng.random() < 0.15:
                    side = f's{k}'
                    side_tree = cf.mutate(rng, folder, trees[labels[rng.randrange(len(labels))]])
                    base_label = rng.choice(labels)
                    subprocess.run(['git', '-C', repo, 'fast-import', '--quiet'], input=stream(side, side_tree, 'side', [base_label]), check=True, env=env)
                    ids[side] = subprocess.run(['git', '-C', repo, 'rev-parse', side], capture_output=True, text=True, check=True, env=env).stdout.strip()
                    if rng.random() < 0.6: parents = [labels[-1], side]
            message = rng.choice(MESSAGES).format(n=rng.randint(1, 6), m=rng.randint(1, 6))
            subprocess.run(['git', '-C', repo, 'fast-import', '--quiet'], input=stream(label, tree, message, parents), check=True, env=env)
            ids[label] = subprocess.run(['git', '-C', repo, 'rev-parse', label], capture_output=True, text=True, check=True, env=env).stdout.strip()
            trees[label] = tree
            labels.append(label)
        frm = since = None
        pool = [ids[l] for l in labels]
        if rng.random() < 0.5: frm = rng.choice(pool + [ids.get('s2', pool[0]), '1' * 40])
        if rng.random() < 0.35: since = rng.choice(pool + [ids.get('s3', pool[-1]), '2' * 40])
        scenarios.append({'id': i, 'repo': repo, 'head': ids[labels[-1]], 'from': frm, 'since': since})
    json.dump(scenarios, open(os.path.join(OUT, 'scenarios.json'), 'w'))
    print(COUNT, 'scenarios in', OUT)


main()
