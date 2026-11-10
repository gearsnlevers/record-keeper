"""Random trees around the settings path. Usage: config_tree_fuzz.py <count> <seed> <repo.git> <expected.json>
Builds a bare repository with one branch t<N> for each tree and writes what the Python reference reads from each."""
import json, os, random, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import config_ref as ref
from commit_lib import build_repo

sys.argv_save = sys.argv
count, seed, repo, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4]
sys.argv = [sys.argv[0], '0', '0', '/dev/null']
import importlib.util
spec = importlib.util.spec_from_file_location('config_fuzz', os.path.join(os.path.dirname(__file__), 'config_fuzz.py'))
fz = importlib.util.module_from_spec(spec)
src = open(os.path.join(os.path.dirname(__file__), 'config_fuzz.py')).read().replace('\nmain()\n', '\n')
exec(compile(src, 'config_fuzz.py', 'exec'), fz.__dict__)
r = random.Random(seed)
GL = '0123456789012345678901234567890123456789'


def node(path, kind, content=b'x\n'):
    return {'link': (path, ('120000', b'target')), 'sub': (path, ('160000', GL)), 'file': (path, ('100644', content)), 'exec': (path, ('100755', content))}[kind]


trees, expected = [], []
for n in range(count):
    entries = {}
    content = fz.make(r)
    github = r.choice(['dir', 'dir', 'dir', 'none', 'file', 'link', 'sub'])
    rk = r.choice(['dir', 'dir', 'dir', 'none', 'file', 'link', 'sub'])
    settings = r.choice(['file', 'file', 'file', 'exec', 'none', 'link', 'sub', 'dir'])
    if github in ('file', 'link', 'sub'):
        p, v = node('.github', github); entries[p] = v
    else:
        if github == 'dir':
            entries['.github/workflows/ci.yml'] = ('100644', b'x\n')
            if rk in ('file', 'link', 'sub'):
                p, v = node('.github/record-keeper', rk); entries[p] = v
            elif rk == 'dir':
                entries['.github/record-keeper/other.yml'] = ('100644', b'x\n')
                if settings == 'dir': entries[ref.SETTINGS_PATH + '/inner.yml'] = ('100644', b'x\n')
                elif settings != 'none':
                    p, v = node(ref.SETTINGS_PATH, settings, content); entries[p] = v
    for decoy in r.sample(['settings.yml', '.github/settings.yml', '.github/record-keeper.yml', 'docs/settings.yml'], r.randint(0, 2)):
        if decoy not in entries and not any(k.startswith(decoy + '/') or decoy.startswith(k + '/') for k in entries): entries[decoy] = ('100644', content)
    trees.append((f't{n}', entries))
build_repo(repo, trees)
for name, _ in trees:
    settings, problems = ref.read_settings(repo, name)
    expected.append({'name': name, 'settings': settings, 'problems': [[l, rule, d] for _, l, rule, d in problems]})
json.dump(expected, open(out, 'w'))
print(count, 'trees;', sum(1 for e in expected if e['problems'] and e['problems'][0][1] == 'S-01'), 'with S-01;', sum(1 for e in expected if not e['problems']), 'without a problem')
