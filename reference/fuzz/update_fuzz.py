"""Differential fuzz of the core of the updater (docs/updater.md). Usage: update_fuzz.py <count> <seed> <out.jsonl>
Each output line is an input of `plan` and the answer of the Python reference (update_ref.py). The generator does not draw its inputs blindly: it asks the
reference which release the options choose, builds the manifest of that release (right, or damaged in one of 60 ways), a pinned release with a manifest of its
own (right, missing, damaged), the digests of what was downloaded (right, or not) and a working tree (every state), so that the plan reaches the branches that
a blind input would stop in front of. It prints how many inputs ended in each answer and how many reached each part of a plan."""
import copy
import hashlib
import json
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import update_ref as ref

COMMITS = ['a1' * 20, 'b2' * 20, 'c3' * 32, 'd4' * 20]
TAGS = ['v1.0.0-1', 'v1.0.0-2', 'v1.0.0', 'v1.0.1', 'v1.1.0-rc.1', 'v1.1.0-rc.2', 'v1.1.0', 'v1.2.0', 'v2.0.0-1', 'v2.0.0', 'v10.0.0', 'v1.0.0-alpha', 'v1.0.0-alpha.1', 'v1.0.0-beta']
ODD_TAGS = ['nightly', 'v1.0', '1.0.0', 'v01.0.0', 'v1.0.0+build', 'v1.0.0-', 'latest', 'V1.0.0', 'v1.0.0-01', '', 'v' + '1' * 100 + '.0.0', 'v1.0.0 ', 'v1.0.0\n']
PROGRAMS = ['.github/record-keeper/record-keeper.mjs', '.github/record-keeper/check-pull-request.mjs', '.github/record-keeper/run-audit.mjs', '.github/record-keeper/updater.mjs',
            '.github/record-keeper/setup-check.mjs', '.github/record-keeper/x-1.mjs']
WORKFLOWS = ['.github/workflows/records-integrity.yml', '.github/workflows/records-audit.yml', '.github/workflows/records-updater.yml', '.github/workflows/records-setup-check.yml']
MANAGED = PROGRAMS + WORKFLOWS
TEMPLATES = ref.TEMPLATES
HOSTILE_PATHS = ['../x', '/etc/passwd', '.github/record-keeper/../../x.mjs', '.github/record-keeper/Record-Keeper.mjs', '.github/record-keeper/a.mjs/b', '.github/record-keeper/settings.yml',
                 '.github/workflows/other.yml', '.github/workflows/records-.yml', 'docs/decisions/0001-x.md', 'docs/decisions/README.md', '.github/record-keeper/x y.mjs', '',
                 '.github/record-keeper/a--b.mjs', '.github/record-keeper/1a.mjs', '.github\\record-keeper\\a.mjs', '.git/config', '.github/workflows/records-a.yaml', None, 7, ['a']]
HOSTILE_SOURCES = ['../x', '/abs', 'a//b', 'a/./b', 'a/ b', 'a/b.', 'a/.GIT/x', 'a\\b', 'a:b', '', 'café.mjs', 'a\tb', None, 9]
NODES = ['>=22', '>=22.0.0', '>=22 <27', '>=20 <23', '>=22.6', '>=22.6.1', '>=99', '<1', '<22.6.0', '<=22', '^22', '22.x', '>= 22', '>=22  <27', '', '>=22 <', '>=', 'v22', '>=22.6.0.1', '>=022', '>=22 || >=18', None, 22]
RUNNING = ['22.0.0', '22.6.0', '22.6.1', '24.13.0', '26.5.0', '20.19.5', '21.9.9', '100.0.0']
SOURCES = ['gearsnlevers/record-keeper', 'o/k', 'a.b/c-d_e', '../x', 'a/..', 'a/b/c', 'x', '', 'o/k ']
SHAS = [hashlib.sha256(('content %d' % i).encode()).hexdigest() for i in range(12)]
BAD_HEX = ['', 'abc', 'A' * 64, 'g' * 64, SHAS[0][:63], SHAS[0] + '0', 5, None]


def pick(r, items):
    return items[r.randrange(len(items))]


def chance(r, p):
    return r.random() < p


def source_of(path):
    """Where a destination is kept in the kit: the part of the name that tells it apart."""
    return {'.github/record-keeper/': '', '.github/workflows/': 'templates/workflows/', 'docs/decisions/': 'templates/decisions/'}.get(next((p for p in ['.github/record-keeper/', '.github/workflows/', 'docs/decisions/'] if path.startswith(p)), ''), '') + path.split('/')[-1]


def make_files(r, count_managed, count_templates):
    files = []
    for path in r.sample(MANAGED, count_managed):
        files.append({'kind': 'managed', 'path': path, 'sha256': pick(r, SHAS), 'size': r.randrange(0, 5000), 'source': source_of(path)})
    for path in r.sample(TEMPLATES, count_templates):
        files.append({'kind': 'template', 'path': path, 'sha256': pick(r, SHAS), 'size': r.randrange(0, 5000), 'source': source_of(path) if path != TEMPLATES[0] else 'templates/settings.yml'})
    r.shuffle(files)
    return files


def make_manifest(r, tag, commit, files=None):
    if files is None:
        files = make_files(r, r.randint(1, 6), r.randint(0, 3))
    return {'commit': commit, 'files': files, 'generations': ['g1'], 'node': pick(r, ['>=22', '>=22', '>=22 <27', '>=20']), 'requires': {'rulesets': [{'branch': 'default', 'checks': ['Records integrity'], 'up-to-date': True}] if chance(r, 0.8) else [],
            'secrets': pick(r, [['RECORD_KEEPER_TOKEN'], [], ['A', 'B_2']]), 'settings': pick(r, [['owners'], [], ['owners', 'approvals']])}, 'schema': 1, 'tag': tag, 'version': tag[1:]}


def damage(r, m):
    """One damage to a manifest, chosen from many; a few of them leave it right. Returns the name."""
    edits = []

    def add(name, fn):
        edits.append((name, fn))

    def key(name, value):
        return lambda m: m.__setitem__(name, value)

    for value in [2, '1', None, 1.0, True, [1], 0]:
        add('schema', key('schema', value))
    add('drop key', lambda m: m.pop(pick(r, list(m.keys()))))
    add('extra key', lambda m: m.__setitem__(pick(r, ['extra', 'Z', '0', 'files ', '']), 1))
    add('lacking and extra', lambda m: (m.pop('node'), m.__setitem__('nodes', '>=22')))
    for value in ['v9.9.9', '', None, 5]:
        add('tag', key('tag', value))
    for value in ['9.9.9', 'v1.0.0', None, '', '1.0.0-1 ']:
        add('version', key('version', value))
    for value in ['abc', 'A' * 40, 'a' * 41, 'g' * 40, None, 5, ('a1' * 20) + '\n', COMMITS[3]]:
        add('commit', key('commit', value))
    for value in [[], ['x'], ['g1', 'g1'], 'g1', ['g0'], ['g1', 'g2'], ['g1234567890'], [1], None]:
        add('generations', key('generations', value))
    for value in NODES:
        add('node', key('node', value))
    add('requires missing', lambda m: m['requires'].pop(pick(r, list(m['requires'].keys()))))
    add('requires extra', lambda m: m['requires'].__setitem__('other', []))
    for value in ['x', [], None, {'secrets': [], 'settings': []}]:
        add('requires', key('requires', value))
    for value in [['bad'], ['A', 'A'], [1], 'A', ['A1'], ['1A'], ['RECORD KEEPER']]:
        add('secrets', lambda m, value=value: m['requires'].__setitem__('secrets', value))
    for value in [['Owners'], ['a', 'a'], [''], ['a b'], 'owners']:
        add('settings', lambda m, value=value: m['requires'].__setitem__('settings', value))
    for value in [[{'branch': 'default'}], [{'branch': 'a`b', 'checks': [], 'up-to-date': True}], [{'branch': 'default', 'checks': ['x'], 'up-to-date': 1}], ['x'], 'x', [{'branch': 5, 'checks': [], 'up-to-date': True}],
                  [{'branch': 'default', 'checks': ['a', 'a'], 'up-to-date': True}], [{'branch': 'default', 'checks': ['a|b'], 'up-to-date': False, 'more': 1}]]:
        add('rulesets', lambda m, value=value: m['requires'].__setitem__('rulesets', value))
    for value in [[], 'x', None, {}, [None]]:
        add('files', key('files', value))
    add('101 files', lambda m: m.__setitem__('files', [dict(m['files'][0], path='.github/record-keeper/f%d.mjs' % i) for i in range(101)]))
    add('100 files', lambda m: m.__setitem__('files', [dict(m['files'][0], kind='managed', path='.github/record-keeper/f%d.mjs' % i, size=1000) for i in range(100)]))
    add('entry drop', lambda m: pick(r, m['files']).pop(pick(r, ENTRY)))
    add('entry extra', lambda m: pick(r, m['files']).__setitem__('mode', '644'))
    add('entry not object', lambda m: m['files'].__setitem__(r.randrange(len(m['files'])), pick(r, [None, 'x', [], 5])))
    for value in ['other', 'Managed', None, '', 1, ['managed']]:
        add('kind', lambda m, value=value: pick(r, m['files']).__setitem__('kind', value))
    for value in HOSTILE_PATHS:
        add('path', lambda m, value=value: pick(r, m['files']).__setitem__('path', value))
    add('template as managed', lambda m: pick(r, m['files']).update(kind='managed', path=pick(r, TEMPLATES)))
    add('managed as template', lambda m: pick(r, m['files']).update(kind='template', path=pick(r, MANAGED)))
    for value in HOSTILE_SOURCES:
        add('source', lambda m, value=value: pick(r, m['files']).__setitem__('source', value))
    for value in BAD_HEX:
        add('sha256', lambda m, value=value: pick(r, m['files']).__setitem__('sha256', value))
    for value in [-1, 1.5, '1', None, True, 4 * 1024 * 1024 + 1, 10 ** 30, 1e300, 4 * 1024 * 1024, 7.0, [1]]:
        add('size', lambda m, value=value: pick(r, m['files']).__setitem__('size', value))
    add('same path twice', lambda m: m['files'].append(dict(pick(r, m['files']))))
    add('total too large', lambda m: [e.__setitem__('size', 4 * 1024 * 1024) for e in m['files']] and m['files'].extend(dict(m['files'][0], kind='managed', path='.github/record-keeper/big%d.mjs' % i, size=4 * 1024 * 1024) for i in range(4)))
    name, fn = pick(r, edits)
    try:
        fn(m)
    except (IndexError, KeyError, ValueError):
        pass
    return name


ENTRY = ['kind', 'path', 'sha256', 'size', 'source']


def text_of(r, manifest):
    """The text of a manifest, now and then damaged as text."""
    text = json.dumps(manifest, indent=pick(r, [None, 2]), sort_keys=chance(r, 0.5), ensure_ascii=chance(r, 0.9))
    data = text.encode('utf-8')
    pick_damage = r.random()
    if pick_damage < 0.01:
        return {'hex': (b'\xef\xbb\xbf' + data).hex()}
    if pick_damage < 0.02:
        return {'hex': (data[:len(data) // 2]).hex()}
    if pick_damage < 0.03:
        return {'hex': (data + b'\xff').hex()}
    if pick_damage < 0.04:
        return text + ' extra'
    if pick_damage < 0.05:
        return pick(r, ['', '[]', 'null', 'true', '"x"', '12', '{', 'NaN', '{"a": Infinity}', '{"a": 1,}'])
    if pick_damage < 0.06:
        # a key written twice: the second wins in both readers
        return text.replace('"schema": 1', '"schema": 2, "schema": 1', 1) if '"schema": 1' in text else text
    return text


def releases_of(r, pin_tag, clean=False):
    """The list of releases of the source: usable, drafts, entries that are not usable, a deleted pinned release."""
    pool = r.sample(TAGS, r.randint(1 if clean else 0, 8))
    if pin_tag is not None and chance(r, 0.8) and pin_tag not in pool:
        pool.append(pin_tag)
    if pin_tag is not None and chance(r, 0.1) and pin_tag in pool and not clean:
        pool.remove(pin_tag)
    out = []
    for tag in pool:
        entry = {'tag_name': tag, 'draft': False, 'prerelease': '-' in tag, 'body': 'notes'}
        roll = 0.5 if clean else r.random()
        if roll < 0.08:
            entry['draft'] = True
        elif roll < 0.15:
            entry['prerelease'] = not entry['prerelease']
        elif roll < 0.17:
            entry['prerelease'] = pick(r, [None, 'false', 0])
        elif roll < 0.19:
            entry['draft'] = pick(r, [None, 'false', 0])
        elif roll < 0.21:
            del entry['draft']
        out.append(entry)
    if not clean:
        for _ in range(r.choice([0, 0, 0, 1, 1, 2])):
            out.append({'tag_name': pick(r, ODD_TAGS), 'draft': False, 'prerelease': chance(r, 0.5)})
        if chance(r, 0.04) and out:
            out.append(dict(pick(r, out), draft=False))
        if chance(r, 0.03):
            out.append(pick(r, [None, 5, 'x', [], {'tag_name': 7}, {}]))
    r.shuffle(out)
    return out


def pin_text_of(r, pin):
    text = ref.render_pin(pin['source'], pin['version'], pin['commit'], pin['channel'])
    roll = r.random()
    if roll < 0.55:
        return text
    lines = text.split('\n')
    if roll < 0.62:
        lines = [lines[0]] + lines[1:][::-1]
    elif roll < 0.66:
        lines = lines[:1] + lines[1:-1] + ['', '# a comment', lines[-1]]
    elif roll < 0.70:
        lines = [lines[0].replace('#', ' #')] + lines[1:]
    elif roll < 0.73:
        lines = lines[1:]
    elif roll < 0.76:
        lines.insert(r.randrange(1, 5), pick(r, ['extra: 1', 'source: o/k', 'version: v1.0.0', 'channel: stable', 'commit: ' + COMMITS[0]]))
    elif roll < 0.79:
        del lines[r.randrange(1, 5)]
    elif roll < 0.83:
        i = r.randrange(1, 5)
        lines[i] = pick(r, [lines[i] + ' ', lines[i].replace(': ', ':  '), lines[i].replace(': ', ':'), lines[i] + '\r', ' ' + lines[i], lines[i].replace(': ', ': \t'), lines[i] + ' # c', lines[i].upper(), 'Source: o/k', 'a b c', 'source', ': x'])
    elif roll < 0.88:
        i = r.randrange(1, 5)
        key = lines[i].split(':')[0]
        lines[i] = key + ': ' + pick(r, ['', 'x', 'V1.0.0', 'v1.0', 'v1.0.0-01', 'stable ', 'next', 'o/', '/k', '../k', 'o/..', 'o/k/x', 'A' * 40, 'a' * 39, 'ä', 'o k', '"v1.0.0"'])
    else:
        text = pick(r, ['', '\n', '# only a comment\n', 'source: o/k', '\ufeff' + text, text.replace('\n', '\r\n'), text + text])
        return text
    return '\n'.join(lines)


def scenario(r, hits):
    # a clean preamble in most scenarios: a pin that is right, a list that is right and a target that exists, so that the plan is reached; the rest are as hostile as they come
    clean = chance(r, 0.7)
    pin = None
    if chance(r, 0.72):
        pin = {'source': pick(r, SOURCES[:3]) if clean or chance(r, 0.95) else pick(r, SOURCES), 'version': pick(r, TAGS), 'commit': pick(r, COMMITS), 'channel': pick(r, ['stable', 'stable', 'prerelease'])}
    pin_text = None if pin is None else (ref.render_pin(pin['source'], pin['version'], pin['commit'], pin['channel']) if clean else pin_text_of(r, pin))
    releases = releases_of(r, None if pin is None else pin['version'], clean)
    source = None
    if pin is None:
        source = pick(r, SOURCES[:3]) if clean else (None if chance(r, 0.15) else pick(r, SOURCES))
    elif chance(r, 0.1):
        source = pin['source'] if clean or chance(r, 0.6) else pick(r, SOURCES)
    channel = pick(r, [None, None, 'stable', 'prerelease']) if chance(r, 0.4) else None
    target = None
    if chance(r, 0.35):
        pool = [e['tag_name'] for e in releases if isinstance(e, dict) and isinstance(e.get('tag_name'), str)]
        target = pick(r, pool) if pool and (clean or chance(r, 0.8)) else pick(r, TAGS + ODD_TAGS[:3])
        if pin is not None and chance(r, 0.4):
            target = pin['version']
    if clean and pin is not None and target is None and chance(r, 0.5):
        newer = [e['tag_name'] for e in releases if isinstance(e, dict) and isinstance(e.get('tag_name'), str) and ref.parse_tag(e['tag_name']) and ref.compare_tags(e['tag_name'], pin['version']) >= 0]
        if newer:
            target = pick(r, newer)
    inp = {'pinText': pin_text, 'source': source, 'channel': channel, 'target': target, 'releases': releases, 'tagCommit': None, 'manifest': None, 'previous': None,
           'node': pick(r, RUNNING) if chance(r, 0.15) else '24.13.0', 'downloaded': {}, 'tree': {}}
    # what the reference chooses, so that the manifest is the manifest of the chosen release
    try:
        parsed = None if pin_text is None else ref.parse_pin(pin_text)
    except ref.Refused:
        return inp
    if parsed is None and not source:
        return inp
    if parsed is not None and source and source != parsed['source']:
        return inp
    chan = channel if channel is not None else (parsed['channel'] if parsed is not None else 'stable')
    try:
        kind, chosen = ref.select(parsed, chan, target, releases)
    except ref.Refused:
        return inp
    if kind == 'current':
        return inp
    tag = chosen['tag_name']
    commit = pick(r, COMMITS)
    if parsed is not None and tag == parsed['version'] and chance(r, 0.85):
        commit = parsed['commit']
    inp['tagCommit'] = commit if chance(r, 0.93) else pick(r, COMMITS)
    manifest = make_manifest(r, tag, commit)
    # the pinned release: its manifest is the one that the new files are compared with
    previous = None
    if parsed is not None and chance(r, 0.82):
        old_files = copy.deepcopy(manifest['files'])
        for entry in old_files:
            roll = r.random()
            if roll < 0.25:
                entry['sha256'] = pick(r, SHAS)
            elif roll < 0.30:
                entry['kind'] = 'template' if entry['kind'] == 'managed' and entry['path'] in TEMPLATES else entry['kind']
        old_files = [e for e in old_files if chance(r, 0.8)]
        for path in r.sample(MANAGED, r.randint(0, 6)):
            if all(e['path'] != path for e in old_files):
                old_files.append({'kind': 'managed', 'path': path, 'sha256': pick(r, SHAS), 'size': 10, 'source': source_of(path)})
        for path in r.sample(TEMPLATES, r.randint(0, 2)):
            if all(e['path'] != path for e in old_files):
                old_files.append({'kind': 'template', 'path': path, 'sha256': pick(r, SHAS), 'size': 10, 'source': 'templates/x'})
        if not old_files:
            old_files = make_files(r, 1, 0)
        previous = make_manifest(r, parsed['version'], parsed['commit'], old_files)
        if tag == parsed['version'] and chance(r, 0.6):
            previous = copy.deepcopy(manifest)
            previous['commit'] = parsed['commit']
        if chance(r, 0.15):
            damage(r, previous)
        previous = text_of(r, previous)
    if chance(r, 0.22):
        name = damage(r, manifest)
        hits['damage: ' + name] = hits.get('damage: ' + name, 0) + 1
    inp['manifest'] = text_of(r, manifest)
    inp['previous'] = previous
    # what was downloaded: the digests of the manifest, mostly
    files = manifest['files'] if isinstance(manifest.get('files'), list) else []
    for entry in files:
        if not isinstance(entry, dict) or not isinstance(entry.get('source'), str):
            continue
        got = {'sha256': entry.get('sha256'), 'size': entry.get('size')}
        roll = 0.5 if clean and chance(r, 0.8) else r.random()
        if roll < 0.04:
            got['sha256'] = pick(r, SHAS)
        elif roll < 0.07 and isinstance(got['size'], int):
            got['size'] += 1
        elif roll < 0.09:
            continue
        elif roll < 0.10:
            got = pick(r, [None, 5, 'x', []])
        inp['downloaded'][entry['source']] = got
    # the working tree
    paths = set(e.get('path') for e in files if isinstance(e, dict) and isinstance(e.get('path'), str))
    if previous is not None:
        try:
            paths |= set(e['path'] for e in json.loads(previous if isinstance(previous, str) else bytes.fromhex(previous['hex']).decode())['files'] if isinstance(e, dict) and isinstance(e.get('path'), str))
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            pass
    paths.add(ref.PIN_PATH)
    old_digest = {}
    if previous is not None:
        try:
            for e in json.loads(previous if isinstance(previous, str) else bytes.fromhex(previous['hex']).decode())['files']:
                if isinstance(e, dict) and isinstance(e.get('path'), str):
                    old_digest[e['path']] = e.get('sha256')
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            pass
    new_digest = {e['path']: e.get('sha256') for e in files if isinstance(e, dict) and isinstance(e.get('path'), str)}
    for path in paths:
        roll = r.random()
        if roll < 0.28:
            continue
        if roll < 0.46 and path in new_digest:
            inp['tree'][path] = {'kind': 'file', 'sha256': new_digest[path]}
        elif roll < 0.68 and path in old_digest:
            inp['tree'][path] = {'kind': 'file', 'sha256': old_digest[path]}
        elif roll < 0.97 or clean:
            inp['tree'][path] = {'kind': 'file', 'sha256': pick(r, SHAS + [None])}
        else:
            inp['tree'][path] = {'kind': pick(r, ['dir', 'link', 'other', 'blocked', 'dir', 'file']), 'sha256': pick(r, SHAS)} if chance(r, 0.5) else {'kind': pick(r, ['dir', 'link', 'other', 'blocked'])}
            if inp['tree'][path]['kind'] != 'file' and 'sha256' in inp['tree'][path] and chance(r, 0.5):
                del inp['tree'][path]['sha256']
    # the pin in the working tree
    if pin is not None and chance(r, 0.08):
        inp['pinText'] = ref.render_pin(parsed['source'], tag, commit, chan)
    return inp


def count_hits(hits, expect, inp):
    def hit(name):
        hits[name] = hits.get(name, 0) + 1
    status = expect['status']
    hit('answer: ' + status + (' ' + expect['code'] if status == 'refused' else ''))
    if status == 'refused' and expect['code'] == 'path-blocked':
        hit('path-blocked at ' + ('the pin' if expect['detail'] == ref.PIN_PATH else 'a managed path') + ' that is ' + inp['tree'][expect['detail']]['kind'])
    if status == 'refused' and expect['code'] in ('manifest-path', 'manifest-source', 'manifest-size', 'manifest-kind', 'manifest-entry', 'manifest-digest'):
        hit('entry refusal ' + expect['code'])
    if status in ('update', 'unchanged'):
        for key in ['added', 'changed', 'unchanged', 'templates', 'kept', 'remove', 'overwritten']:
            if expect[key]:
                hit('plan has ' + key)
        hit('plan pin ' + ('changed' if expect['pinChanged'] else 'same'))
        for key, size in [('remove', 4), ('added', 4), ('changed', 4), ('overwritten', 3), ('templates', 2), ('kept', 3), ('unchanged', 4)]:
            if len(expect[key]) >= size:
                hit('plan has %d or more in %s' % (size, key))
        for w in expect['warnings']:
            hit('warning ' + w['code'] + (' ' + w['detail'] if w['code'] == 'previous-unusable' else ''))
        hit('plan ' + ('first adoption' if expect['from'] is None else 'repair' if expect['from'] == expect['to'] else 'update'))
        hit('plan channel ' + expect['channel'])
        if not expect['warnings'] and expect['from'] is not None:
            hit('plan with a usable previous manifest')
    if status == 'current':
        hit('current')


def main():
    count, seed, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    r = random.Random(seed)
    hits = {}
    with open(out, 'w') as f:
        for _ in range(count):
            inp = scenario(r, hits)
            expect = ref.plan(copy.deepcopy(inp))
            count_hits(hits, expect, inp)
            f.write(json.dumps({'input': inp, 'expect': expect}) + '\n')
    print(count, 'inputs;', json.dumps(dict(sorted(hits.items()))))


main()
