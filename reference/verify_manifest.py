"""A second implementation of the release manifest (docs/releases.md, docs/install.md), in Python with the standard library only. It shares no code with
tools/build-release-manifest.mjs: it reads install.json and package.json, hashes the files of a working tree, and either compares the result with a
manifest (`--verify`) or writes the manifest it would build (`--build`), so that the two programs can be run against each other.

  verify_manifest.py --verify <manifest> [--root <folder>]
  verify_manifest.py --build <version> <tag> <commit> [--root <folder>]      prints the manifest as the canonical text

Exit status: 0 when the manifest verifies (or was built), 1 when it does not or something is refused, 2 for wrong usage. A problem is printed as
`verify_manifest: <problem>`; the problems of --verify are worded as those of the Node program."""
import hashlib, json, os, re, stat, sys

SEMVER = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?')
COMMIT = re.compile(r'([0-9a-f]{40}|[0-9a-f]{64})')
GENERATION = re.compile(r'g[1-9][0-9]{0,8}')


class Refused(Exception):
    pass


def pairs(items):
    out = {}
    for key, value in items:
        if key in out:
            raise Refused('a key is written twice: ' + key)
        out[key] = value
    return out


def read_regular(root, relative, what):
    """The bytes of a regular file below root; a link anywhere on the way is refused."""
    here = root
    parts = relative.split('/')
    for i, part in enumerate(parts):
        here = os.path.join(here, part)
        last = i == len(parts) - 1
        try:
            mode = os.lstat(here).st_mode
        except OSError:
            raise Refused(f'{what} {relative}: no such file')
        if stat.S_ISLNK(mode):
            raise Refused(f'{what} {relative}: ' + ('is a symbolic link' if last else '/'.join(parts[:i + 1]) + ' is a symbolic link'))
        if last and not stat.S_ISREG(mode):
            raise Refused(f'{what} {relative}: is not a regular file')
        if not last and not stat.S_ISDIR(mode):
            raise Refused(f'{what} {relative}: ' + '/'.join(parts[:i + 1]) + ' is not a folder')
    with open(here, 'rb') as handle:
        return handle.read()


def read_json(root, relative):
    data = read_regular(root, relative, 'file')
    try:
        text = data.decode('utf-8')
        if text.startswith('﻿'):
            raise ValueError('byte order mark')
        return json.loads(text, object_pairs_hook=pairs)
    except (ValueError, Refused):
        raise Refused(f'{relative}: is not one JSON document in UTF-8 without a byte order mark')


def path_problem(value):
    if not isinstance(value, str) or value == '':
        return 'is not a path'
    if any(ord(c) < 0x20 or ord(c) > 0x7e for c in value):
        return 'has a character other than printable ASCII'
    if value[0] == '/':
        return 'is absolute'
    if '\\' in value or ':' in value:
        return 'has a backslash or a colon'
    for part in value.split('/'):
        if part == '':
            return 'has an empty part'
        if part in ('.', '..'):
            return 'has a part that is . or ..'
        if part[0] == ' ' or part[-1] in ' .':
            return 'has a part that starts with a space or ends with a space or a dot'
        if part.lower() == '.git':
            return 'has a part that is .git'
    return None


def texts(value, where):
    if not isinstance(value, list) or not all(isinstance(x, str) and x != '' for x in value):
        raise Refused(f'{where}: must be a list of texts')
    if len(set(value)) != len(value):
        raise Refused(f'{where}: names something twice')
    return value


def keys_are(obj, keys, where):
    for key in obj:
        if key not in keys:
            raise Refused(f'{where}: unknown key {key}')
    for key in keys:
        if key not in obj:
            raise Refused(f'{where}: missing key {key}')


def read_install(root):
    data = read_json(root, 'install.json')
    if not isinstance(data, dict):
        raise Refused('install.json: must be an object')
    keys_are(data, ['schema', 'generations', 'files', 'requires'], 'install.json')
    if isinstance(data['schema'], bool) or not isinstance(data['schema'], (int, float)) or data['schema'] != 1:
        raise Refused('install.json: schema must be 1')
    generations = texts(data['generations'], 'install.json: generations')
    if not generations or not all(GENERATION.fullmatch(g) for g in generations):
        raise Refused('install.json: generations must name at least one generation, like g1')
    if not isinstance(data['files'], list) or not data['files']:
        raise Refused('install.json: files must be a list with at least one entry')
    requires = data['requires']
    if not isinstance(requires, dict):
        raise Refused('install.json: requires must be an object')
    keys_are(requires, ['secrets', 'settings', 'rulesets'], 'install.json: requires')
    texts(requires['secrets'], 'install.json: requires.secrets')
    texts(requires['settings'], 'install.json: requires.settings')
    if not isinstance(requires['rulesets'], list):
        raise Refused('install.json: requires.rulesets must be a list')
    for ruleset in requires['rulesets']:
        if not isinstance(ruleset, dict):
            raise Refused('install.json: a ruleset must be an object')
        keys_are(ruleset, ['branch', 'checks', 'up-to-date'], 'install.json: a ruleset')
        if not isinstance(ruleset['branch'], str) or ruleset['branch'] == '':
            raise Refused('install.json: a ruleset needs a branch')
        texts(ruleset['checks'], 'install.json: a ruleset: checks')
        if not isinstance(ruleset['up-to-date'], bool):
            raise Refused('install.json: a ruleset: up-to-date must be true or false')
    seen = {}
    for number, entry in enumerate(data['files'], 1):
        where = f'install.json: entry {number}'
        if not isinstance(entry, dict):
            raise Refused(f'{where}: must be an object')
        keys_are(entry, ['source', 'path', 'kind'], where)
        if entry['kind'] not in ('managed', 'template'):
            raise Refused(f'{where}: kind must be managed or template')
        for key in ('source', 'path'):
            problem = path_problem(entry[key])
            if problem:
                raise Refused(f'{where}: {key} {problem}')
        if not (entry['path'].startswith('.github/') or entry['path'].startswith('docs/decisions/')):
            raise Refused(f'{where}: path {entry["path"]} is outside .github/ and docs/decisions/')
        folded = entry['path'].lower()
        if folded in seen:
            raise Refused(f'{where}: path {entry["path"]} is already the destination of {seen[folded]}')
        seen[folded] = entry['path']
    for one in seen:
        for other in seen:
            if other.startswith(one + '/'):
                raise Refused(f'install.json: {seen[one]} is a file and {seen[other]} is below it')
    return generations, data['files'], requires


def expected(root, version, tag, commit):
    if not isinstance(version, str) or not SEMVER.fullmatch(version):
        raise Refused(f'version {json.dumps(version)} is not a semantic version without build metadata')
    if tag != 'v' + version:
        raise Refused(f'tag {json.dumps(tag)} is not v{version}')
    if not isinstance(commit, str) or not COMMIT.fullmatch(commit):
        raise Refused(f'commit {json.dumps(commit)} is not a full commit id of 40 or 64 lower case hexadecimal digits')
    package = read_json(root, 'package.json')
    node = package.get('engines', {}).get('node') if isinstance(package, dict) and isinstance(package.get('engines'), dict) else None
    if not isinstance(node, str) or node == '':
        raise Refused('package.json: engines.node is missing')
    generations, files, requires = read_install(root)
    listed = []
    for entry in files:
        data = read_regular(root, entry['source'], 'source')
        listed.append({'kind': entry['kind'], 'path': entry['path'], 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data), 'source': entry['source']})
    listed.sort(key=lambda item: item['path'].encode('utf-8'))
    return {'commit': commit, 'files': listed, 'generations': generations, 'node': node, 'requires': requires, 'schema': 1, 'tag': tag, 'version': version}


def canonical(value):
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + '\n'


def verify(text, root):
    try:
        manifest = json.loads(text)
    except ValueError:
        return ['the manifest is not one JSON document']
    if not isinstance(manifest, dict):
        return ['the manifest is not an object']
    try:
        want = expected(root, manifest.get('version'), manifest.get('tag'), manifest.get('commit'))
    except Refused as error:
        return [str(error)]
    problems = []
    listed = manifest.get('files') if isinstance(manifest.get('files'), list) else []
    have = {}
    named = [entry for entry in listed if isinstance(entry, dict) and isinstance(entry.get('path'), str)]
    for entry in named:
        have[entry['path']] = entry
    for item in want['files']:
        entry = have.get(item['path'])
        if entry is None:
            problems.append('missing from the manifest: ' + item['path'])
        elif entry.get('sha256') != item['sha256']:
            problems.append('digest mismatch: ' + item['path'])
        elif entry.get('size') != item['size'] or isinstance(entry.get('size'), bool):
            problems.append('size mismatch: ' + item['path'])
        elif entry.get('kind') != item['kind'] or entry.get('source') != item['source']:
            problems.append('kind or source mismatch: ' + item['path'])
    wanted_paths = {item['path'] for item in want['files']}
    for entry in listed:
        if not isinstance(entry, dict) or entry.get('path') not in wanted_paths:
            problems.append('not in install.json: ' + (str(entry.get('path')) if isinstance(entry, dict) and 'path' in entry else json.dumps(entry)))
    if len(named) != len(have):
        problems.append('the manifest lists a path twice')
    for key in ('schema', 'generations', 'node', 'requires'):
        if canonical(manifest.get(key)) != canonical(want[key]):
            problems.append(f'{key} is not what install.json and package.json give')
    if not problems and text != canonical(want):
        problems.append('the manifest is not in canonical form')
    return problems


def main(argv):
    root = '.'
    if '--root' in argv:
        at = argv.index('--root')
        if at + 1 >= len(argv):
            return usage()
        root = argv[at + 1]
        argv = argv[:at] + argv[at + 2:]
    try:
        if len(argv) == 2 and argv[0] == '--verify':
            with open(argv[1], 'rb') as handle:
                text = handle.read().decode('utf-8')
            problems = verify(text, root)
            for problem in problems:
                print('verify_manifest: ' + problem, file=sys.stderr)
            if problems:
                return 1
            print(f'verified {len(json.loads(text)["files"])} files')
            return 0
        if len(argv) == 4 and argv[0] == '--build':
            sys.stdout.write(canonical(expected(root, argv[1], argv[2], argv[3])))
            return 0
    except Refused as error:
        print('verify_manifest: ' + str(error), file=sys.stderr)
        return 1
    except (OSError, UnicodeDecodeError) as error:
        print('verify_manifest: cannot read the manifest: ' + str(error), file=sys.stderr)
        return 1
    return usage()


def usage():
    print('Usage:\n  verify_manifest.py --verify <manifest> [--root <folder>]\n  verify_manifest.py --build <version> <tag> <commit> [--root <folder>]', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
