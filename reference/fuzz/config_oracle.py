"""For every input that the reference accepts without a problem, three real YAML readers must read the same settings.
Usage: config_oracle.py <in.jsonl> [more.jsonl ...]   (PyYAML in process, Psych through ruby, `yaml` 1.2 through node when YAML_DIR names a folder that holds node_modules/yaml)"""
import json, os, subprocess, sys, yaml

HERE = os.path.dirname(os.path.abspath(__file__))
NAMES = {'folder': 'folder', 'shared-folder': 'sharedFolder', 'extra-keys': 'extraKeys', 'owners': 'owners', 'approvals': 'approvals', 'witnesses': 'witnesses'}
DEFAULT = {'folder': 'docs/decisions', 'sharedFolder': 'shared', 'extraKeys': [], 'owners': [], 'approvals': 2, 'witnesses': []}


def accepted(paths):
    for p in paths:
        for line in open(p):
            h = json.loads(line)
            if not h['problems']: yield h


def check(loaded, h):
    """None if the YAML reading equals the kit's reading; else a reason."""
    if loaded is None: loaded = {}
    if not isinstance(loaded, dict): return 'not a mapping: %r' % (loaded,)
    for key, value in loaded.items():
        if key not in NAMES: return 'extra key %r' % (key,)
        want = h['settings'][NAMES[key]]
        if key in ('owners', 'witnesses'): want = ['%s/%d' % (o['login'], o['id']) for o in want]
        if value != want or type(value) is not type(want): return '%s: yaml %r, kit %r' % (key, value, want)
        if isinstance(want, list) and not all(type(v) is str for v in value): return '%s: non-string item in %r' % (key, value)
    for key, field in NAMES.items():
        if key not in loaded and h['settings'][field] != DEFAULT[field]:
            return 'kit sets %s but yaml does not' % key
    return None


def main():
    inputs = list(accepted(sys.argv[1:]))
    print(len(inputs), 'accepted inputs')
    bad = {'pyyaml': [], 'psych': [], 'yaml-1.2': []}
    for h in inputs:
        text = bytes.fromhex(h['hex']).decode('utf-8')
        try: reason = check(yaml.safe_load(text), h)
        except Exception as e: reason = 'error %s' % type(e).__name__
        if reason: bad['pyyaml'].append((reason, text))
    ruby = subprocess.run(['ruby', os.path.join(HERE, 'config_oracle.rb')], input='\n'.join(json.dumps({'hex': h['hex']}) for h in inputs) + '\n', capture_output=True, text=True)
    for h, out in zip(inputs, ruby.stdout.splitlines()):
        r = json.loads(out)
        reason = ('error ' + r['err']) if 'err' in r else check(r['ok'], h)
        if reason: bad['psych'].append((reason, bytes.fromhex(h['hex']).decode('utf-8')))
    YAML_DIR = os.environ.get('YAML_DIR')   # a folder with node_modules/yaml in it (npm install yaml)
    if YAML_DIR and os.path.isdir(os.path.join(YAML_DIR, 'node_modules', 'yaml')):
        node = subprocess.run(['node', os.path.join(HERE, 'config_oracle.mjs')], input='\n'.join(json.dumps({'hex': h['hex']}) for h in inputs) + '\n', capture_output=True, text=True)
        for h, out in zip(inputs, node.stdout.splitlines()):
            r = json.loads(out)
            reason = ('error ' + r['err']) if 'err' in r else check(r['ok'], h)
            if reason: bad['yaml-1.2'].append((reason, bytes.fromhex(h['hex']).decode('utf-8')))
    else:
        bad.pop('yaml-1.2')
        print('(the YAML 1.2 reader is not installed)')
    for name, found in bad.items():
        print(name, ':', len(found), 'disagreements')
        seen = set()
        for reason, text in found:
            if reason in seen: continue
            seen.add(reason)
            if len(seen) <= 12: print('   ', reason, '\n      text:', repr(text))


main()
