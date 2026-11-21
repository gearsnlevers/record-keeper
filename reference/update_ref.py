"""A second implementation of the core of the updater (docs/updater.md), in Python with the standard library only. It is written from the page and shares no
code with updater.mjs: it reads a pin, chooses a release, judges a manifest as untrusted data and builds the plan of an update, or says why it refuses.

  plan(input) -> {'status': 'refused', 'code', 'detail'} | {'status': 'current', 'latest'} | {'status': 'update' | 'unchanged', ...}

The input is the one that updater.mjs `plan` takes, as JSON: pinText, source, channel, target, releases, tagCommit, manifest, previous, node, downloaded, tree, blocks.
`manifest` and `previous` are text, or {"hex": ...} for bytes that are not text. `blocks` maps the source of an entry of the kind `block` to its text (or {"hex": ...}), and
the tree entry of AGENTS.md may carry the bytes of the file as `hex`."""
import json
import math
import os
import re
import sys
import hashlib

sys.path.insert(0, os.path.dirname(__file__))
import agent_ref

PIN_PATH = '.github/record-keeper.yml'
TEMPLATES = ['.github/record-keeper/settings.yml', 'docs/decisions/README.md', 'docs/decisions/template.md', 'CLAUDE.md']
KINDS = ('managed', 'template', 'block')
SKILL_PATH = '.claude/skills/record-a-decision/SKILL.md'
AGENTS_PATH = 'AGENTS.md'
WRITES = ('create', 'append', 'replace')
CHANNELS = ['stable', 'prerelease']
MAX_FILES = 100
MAX_FILE = 4 * 1024 * 1024
MAX_TOTAL = 16 * 1024 * 1024
MAX_TAG = 80
FLAGS = re.ASCII

ID = r'(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
TAG = re.compile(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(' + ID + r'(?:\.' + ID + r')*))?', FLAGS)
COMMIT = re.compile(r'[0-9a-f]{40}|[0-9a-f]{64}', FLAGS)
SOURCE = re.compile(r'[A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100}', FLAGS)
NAME = r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*'
PROGRAM = re.compile(r'\.github/record-keeper/' + NAME + r'\.mjs', FLAGS)
WORKFLOW = re.compile(r'\.github/workflows/records-' + NAME + r'\.yml', FLAGS)
COMPARATOR = re.compile(r'(>=|<)(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?(?:\.(0|[1-9][0-9]*))?', FLAGS)
GENERATION = re.compile(r'g[1-9][0-9]{0,8}', FLAGS)
SECRET = re.compile(r'[A-Z][A-Z0-9_]{0,99}', FLAGS)
SETTING = re.compile(r'[a-z][a-z-]{0,49}', FLAGS)
LABEL = re.compile(r'[A-Za-z0-9 ._/()#:+-]{1,100}', FLAGS)
HEX64 = re.compile(r'[0-9a-f]{64}', FLAGS)
PIN_LINE = re.compile(r'([a-z]+): ([!-~]+)', FLAGS)
PIN_KEYS = ['source', 'version', 'commit', 'channel']
MANIFEST_KEYS = ['commit', 'files', 'generations', 'node', 'requires', 'schema', 'tag', 'version']
ENTRY_KEYS = ['kind', 'path', 'sha256', 'size', 'source']


class Refused(Exception):
    def __init__(self, code, detail=None):
        Exception.__init__(self, code)
        self.code = code
        self.detail = detail


def bytes_key(text):
    return text.encode('utf-8', 'replace')


def is_object(value):
    return isinstance(value, dict)


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_whole(value):
    """A JSON number with a whole value, 1 and 1.0 and 1e0 alike."""
    if not is_number(value):
        return False
    return isinstance(value, int) or (math.isfinite(value) and value == int(value))


# ------------------------------------------------------------------ versions

def parse_tag(text):
    if not isinstance(text, str) or len(text) > MAX_TAG:
        return None
    found = TAG.fullmatch(text)
    if found is None:
        return None
    return [found.group(1), found.group(2), found.group(3)], (found.group(4).split('.') if found.group(4) is not None else [])


def cmp_digits(a, b):
    if len(a) != len(b):
        return -1 if len(a) < len(b) else 1
    return (a > b) - (a < b)


def compare_tags(a, b):
    na, pa = parse_tag(a)
    nb, pb = parse_tag(b)
    for x, y in zip(na, nb):
        c = cmp_digits(x, y)
        if c:
            return c
    if not pa and not pb:
        return 0
    if not pa:
        return 1
    if not pb:
        return -1
    for x, y in zip(pa, pb):
        dx, dy = x.isdigit() and x.isascii(), y.isdigit() and y.isascii()
        if dx and dy:
            c = cmp_digits(x, y)
            if c:
                return c
        elif dx != dy:
            return -1 if dx else 1
        elif x != y:
            return -1 if x < y else 1
    return (len(pa) > len(pb)) - (len(pa) < len(pb))


# ------------------------------------------------------------------ the pin

def render_pin(source, version, commit, channel):
    return ('# Written by the Record Keeper updater. Do not edit it by hand, except the channel, in a pull request.\n'
            'source: %s\nversion: %s\ncommit: %s\nchannel: %s\n' % (source, version, commit, channel))


def pin_value_ok(key, value):
    if key == 'source':
        return SOURCE.fullmatch(value) is not None and '.' not in value.split('/') and '..' not in value.split('/')
    if key == 'version':
        return parse_tag(value) is not None
    if key == 'commit':
        return COMMIT.fullmatch(value) is not None
    return value in CHANNELS


def parse_pin(text):
    found = {}
    for number, line in enumerate(text.split('\n'), 1):
        if line == '' or line.startswith('#'):
            continue
        match = PIN_LINE.fullmatch(line)
        if match is None:
            raise Refused('pin-line', number)
        key, value = match.group(1), match.group(2)
        if key not in PIN_KEYS:
            raise Refused('pin-key', key)
        if key in found:
            raise Refused('pin-duplicate', key)
        if not pin_value_ok(key, value):
            raise Refused('pin-value', key)
        found[key] = value
    for key in PIN_KEYS:
        if key not in found:
            raise Refused('pin-missing', key)
    return found


# ------------------------------------------------------------------ the choice of a release

def usable(releases):
    out = []
    for entry in releases:
        if is_object(entry) and entry.get('draft') is False and isinstance(entry.get('prerelease'), bool) and parse_tag(entry.get('tag_name')) is not None:
            out.append(entry)
    tags = set()
    for entry in out:
        if entry['tag_name'] in tags:
            raise Refused('release-duplicate', entry['tag_name'])
        tags.add(entry['tag_name'])
    return out


def select(pin, channel, target, releases):
    """('current', latest tag) or ('chosen', the entry)."""
    entries = usable(releases)
    if target is not None:
        for entry in entries:
            if entry['tag_name'] == target:
                if pin is not None and compare_tags(target, pin['version']) < 0:
                    raise Refused('older-than-pin', target)
                return 'chosen', entry
        raise Refused('release-missing', target)
    if channel == 'prerelease':
        wanted = entries
    else:
        wanted = [e for e in entries if e['prerelease'] is False and not parse_tag(e['tag_name'])[1]]
    if not wanted:
        raise Refused('release-none', channel)
    best = wanted[0]
    for entry in wanted[1:]:
        if compare_tags(entry['tag_name'], best['tag_name']) > 0:
            best = entry
    if pin is not None and compare_tags(best['tag_name'], pin['version']) <= 0:
        return 'current', best['tag_name']
    return 'chosen', best


# ------------------------------------------------------------------ the manifest

def parse_manifest(data):
    if isinstance(data, dict):
        data = bytes.fromhex(data['hex'])
    elif isinstance(data, str):
        data = data.encode('utf-8')

    def refuse_constant(name):
        raise ValueError(name)
    try:
        text = data.decode('utf-8')
        if text.startswith('\ufeff'):
            raise ValueError('byte order mark')
        return json.loads(text, parse_constant=refuse_constant)
    except (ValueError, RecursionError):
        raise Refused('manifest-json')


def path_problem(value):
    if not isinstance(value, str) or value == '' or re.fullmatch(r'[\x20-\x7e]+', value) is None:
        return True
    if value.startswith('/') or '\\' in value or ':' in value:
        return True
    for part in value.split('/'):
        if part in ('', '.', '..') or part.startswith(' ') or part.endswith(' ') or part.endswith('.') or part.lower() == '.git':
            return True
    return False


def may_install(kind, value):
    if kind == 'managed':
        return isinstance(value, str) and (PROGRAM.fullmatch(value) is not None or WORKFLOW.fullmatch(value) is not None or value == SKILL_PATH)
    if kind == 'block':
        return value == AGENTS_PATH
    return value in TEMPLATES


def parse_range(value):
    if not isinstance(value, str):
        return None
    out = []
    for word in value.split(' '):
        match = COMPARATOR.fullmatch(word)
        if match is None:
            return None
        out.append((match.group(1), [match.group(2), match.group(3) or '0', match.group(4) or '0']))
    return out


def cmp_version(a, b):
    for x, y in zip(a, b):
        c = cmp_digits(x, y)
        if c:
            return c
    return 0


def satisfies(node, comparators):
    have = node.split('.')
    for op, want in comparators:
        c = cmp_version(have, want)
        if (op == '>=' and c < 0) or (op == '<' and c >= 0):
            return False
    return True


def text_list(value, pattern):
    return isinstance(value, list) and all(isinstance(i, str) and pattern.fullmatch(i) is not None for i in value) and len(set(value)) == len(value)


def check_manifest(m, tag, commit):
    if not is_object(m):
        raise Refused('manifest-shape')
    if not is_whole(m.get('schema')) or m.get('schema') != 1:
        raise Refused('manifest-schema')
    keys = sorted(m.keys(), key=bytes_key)
    unknown = [k for k in keys if k not in MANIFEST_KEYS]
    lacking = [k for k in MANIFEST_KEYS if k not in m]
    if unknown or lacking:
        raise Refused('manifest-keys', (unknown + lacking)[0])
    if m['tag'] != tag:
        raise Refused('manifest-tag')
    if not isinstance(m['version'], str) or parse_tag('v' + m['version']) is None or 'v' + m['version'] != tag:
        raise Refused('manifest-version')
    if not isinstance(m['commit'], str) or COMMIT.fullmatch(m['commit']) is None:
        raise Refused('manifest-commit')
    if m['commit'] != commit:
        raise Refused('manifest-commit-moved')
    if not isinstance(m['generations'], list) or len(m['generations']) == 0 or not text_list(m['generations'], GENERATION):
        raise Refused('manifest-generations')
    if parse_range(m['node']) is None:
        raise Refused('manifest-node', m['node'])
    r = m['requires']
    good = is_object(r) and sorted(r.keys()) == ['rulesets', 'secrets', 'settings'] and text_list(r['secrets'], SECRET) and text_list(r['settings'], SETTING) and isinstance(r['rulesets'], list)
    if good:
        for item in r['rulesets']:
            if not (is_object(item) and sorted(item.keys()) == ['branch', 'checks', 'up-to-date'] and isinstance(item['branch'], str) and LABEL.fullmatch(item['branch']) is not None
                    and text_list(item['checks'], LABEL) and isinstance(item['up-to-date'], bool)):
                good = False
    if not good:
        raise Refused('manifest-requires')
    files = m['files']
    if not isinstance(files, list) or len(files) == 0 or len(files) > MAX_FILES:
        raise Refused('manifest-files')
    for number, entry in enumerate(files, 1):
        if not is_object(entry) or sorted(entry.keys()) != ENTRY_KEYS:
            raise Refused('manifest-entry', number)
        if entry['kind'] not in KINDS:
            raise Refused('manifest-kind', number)
        if not may_install(entry['kind'], entry['path']):
            raise Refused('manifest-path', entry['path'])
        if path_problem(entry['source']):
            raise Refused('manifest-source', entry['source'])
        if not isinstance(entry['sha256'], str) or HEX64.fullmatch(entry['sha256']) is None:
            raise Refused('manifest-digest', number)
        if not is_whole(entry['size']) or entry['size'] < 0 or entry['size'] > MAX_FILE:
            raise Refused('manifest-size', number)
    seen = set()
    for entry in files:
        if entry['path'] in seen:
            raise Refused('manifest-duplicate', entry['path'])
        seen.add(entry['path'])
    if sum(int(entry['size']) for entry in files) > MAX_TOTAL:
        raise Refused('manifest-too-large')


# ------------------------------------------------------------------ the plan

def raw(value):
    """The bytes of a text that a fixture gives as text or as {"hex": ...}."""
    return value.encode('utf-8') if isinstance(value, str) else bytes.fromhex(value['hex'])


def plan_block(entry, here, text):
    """What the update does with the block of AGENTS.md: {'path', 'action', 'why', 'digest'}; `text` is the bytes of the block of the release."""
    if text is None:
        raise Refused('download-missing', entry['source'])
    if sha256_hex(text) != entry['sha256']:
        raise Refused('digest-mismatch', entry['path'])
    said = lambda action, why=None, digest=None: {'path': entry['path'], 'action': action, 'why': why, 'digest': digest}
    if here['kind'] == 'large':
        return said('refused', 'too-large')
    if here['kind'] not in ('absent', 'file'):
        return said('refused', 'not-a-file')
    current = None if here['kind'] == 'absent' else bytes.fromhex(here['hex'])
    result = agent_ref.splice_block(current, text)
    if not result['ok']:
        return said('refused', result['why'])
    return said(result['action'], None, sha256_hex(agent_ref.block_of(current)) if result['action'] == 'replace' else None)


def plan_update(pin, source, channel, tag, tag_commit, manifest, previous, node, downloaded, tree, pin_text, blocks=None):
    m = parse_manifest(manifest)
    check_manifest(m, tag, tag_commit)
    if not satisfies(node, parse_range(m['node'])):
        raise Refused('node-version', m['node'])
    if pin is not None and tag == pin['version'] and m['commit'] != pin['commit']:
        raise Refused('release-moved', tag)
    files = sorted(m['files'], key=lambda e: bytes_key(e['path']))
    for entry in files:
        got = downloaded.get(entry['source']) if isinstance(downloaded, dict) else None
        if not is_object(got):
            raise Refused('download-missing', entry['source'])
        if got.get('size') != entry['size']:
            raise Refused('size-mismatch', entry['path'])
        if got.get('sha256') != entry['sha256']:
            raise Refused('digest-mismatch', entry['path'])

    def state(path):
        return tree.get(path, {'kind': 'absent'})
    for path in [PIN_PATH] + [e['path'] for e in files if e['kind'] == 'managed']:
        if state(path)['kind'] not in ('absent', 'file'):
            raise Refused('path-blocked', path)
    warnings = []
    old = None
    if pin is not None and previous is None:
        warnings.append({'code': 'previous-missing', 'detail': pin['version']})
    elif pin is not None:
        try:
            candidate = parse_manifest(previous)
            check_manifest(candidate, pin['version'], pin['commit'])
            old = candidate
        except Refused as refusal:
            warnings.append({'code': 'previous-unusable', 'detail': refusal.code})
    was = {}
    was_templates = set()
    was_block = {}
    if old is not None:
        for entry in old['files']:
            if entry['kind'] == 'managed':
                was[entry['path']] = entry
            elif entry['kind'] == 'block':
                was_block[entry['path']] = entry
            else:
                was_templates.add(entry['path'])
    added, changed, unchanged, templates, kept, overwritten = [], [], [], [], [], []
    block = None
    for entry in files:
        here = state(entry['path'])
        if entry['kind'] == 'block':
            block = plan_block(entry, here, (blocks or {}).get(entry['source']))
            if block['action'] == 'replace' and old is not None and (entry['path'] not in was_block or was_block[entry['path']]['sha256'] != block['digest']):
                overwritten.append(entry['path'])
            continue
        if entry['kind'] == 'template':
            if here['kind'] == 'absent' and (pin is None or (old is not None and entry['path'] not in was_templates)):
                templates.append(entry['path'])
            else:
                kept.append(entry['path'])
        elif here['kind'] == 'absent':
            added.append(entry['path'])
        elif here.get('sha256') == entry['sha256']:
            unchanged.append(entry['path'])
        else:
            changed.append(entry['path'])
            if old is not None and (entry['path'] not in was or was[entry['path']]['sha256'] != here.get('sha256')):
                overwritten.append(entry['path'])
    listed = set(e['path'] for e in files)
    remove = []
    for path in sorted(was.keys(), key=bytes_key):
        if path in listed or state(path)['kind'] != 'file':
            continue
        remove.append(path)
        if state(path).get('sha256') != was[path]['sha256']:
            overwritten.append(path)
    text = render_pin(source, m['tag'], m['commit'], channel)
    changed_pin = pin_text != text
    if block is not None and block['action'] == 'refused':
        warnings.append({'code': 'block-refused', 'detail': block['why']})
    return {
        'status': 'update' if (added or changed or templates or remove or changed_pin or (block is not None and block['action'] in WRITES)) else 'unchanged',
        'source': source,
        'channel': channel,
        'from': None if pin is None else pin['version'],
        'to': m['tag'],
        'commit': m['commit'],
        'added': added,
        'changed': changed,
        'unchanged': unchanged,
        'templates': templates,
        'kept': kept,
        'remove': remove,
        'block': None if block is None else {'path': block['path'], 'action': block['action'], 'why': block['why']},
        'overwritten': sorted(overwritten, key=bytes_key),
        'pin': text,
        'pinChanged': changed_pin,
        'requires': m['requires'],
        'warnings': warnings,
    }


def plan(inp):
    try:
        pin = None if inp.get('pinText') is None else parse_pin(inp['pinText'])
        given = inp.get('source')
        if pin is None and not given:
            raise Refused('source-missing')
        if pin is not None and given and given != pin['source']:
            raise Refused('source-mismatch', pin['source'])
        source = given if pin is None else pin['source']
        channel = inp['channel'] if inp.get('channel') is not None else (pin['channel'] if pin is not None else 'stable')
        kind, chosen = select(pin, channel, inp.get('target'), inp['releases'])
        if kind == 'current':
            return {'status': 'current', 'latest': chosen}
        return plan_update(pin, source, channel, chosen['tag_name'], inp.get('tagCommit'), inp.get('manifest'), inp.get('previous'), inp['node'],
                           inp.get('downloaded') or {}, inp.get('tree') or {}, inp.get('pinText'), {k: raw(v) for k, v in (inp.get('blocks') or {}).items()})
    except Refused as refusal:
        return {'status': 'refused', 'code': refusal.code, 'detail': refusal.detail}


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()
