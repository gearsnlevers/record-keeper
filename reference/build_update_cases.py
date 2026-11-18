"""Builds test/fixtures/update/cases.json. Every case states the answer it was written to show; the generator runs the Python reference (update_ref.py) on it and
stops if the two differ. Usage: build_update_cases.py <out.json>"""
import copy
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import update_ref as ref

SOURCE = 'gearsnlevers/record-keeper'
C1, C2, C3, C4 = 'a1' * 20, 'b2' * 20, 'c3' * 32, 'd4' * 20
HEADER = '# Written by the Record Keeper updater. Do not edit it by hand, except the channel, in a pull request.'
PIN = '.github/record-keeper.yml'
RK, CPR, RUN, UPD, SETUP = ['.github/record-keeper/%s.mjs' % n for n in ['record-keeper', 'check-pull-request', 'run-audit', 'updater', 'setup-check']]
WI, WA, WU = ['.github/workflows/records-%s.yml' % n for n in ['integrity', 'audit', 'updater']]
SET, RD, RT = '.github/record-keeper/settings.yml', 'docs/decisions/README.md', 'docs/decisions/template.md'
SRC = {RK: 'record-keeper.mjs', CPR: 'check-pull-request.mjs', RUN: 'run-audit.mjs', UPD: 'updater.mjs', SETUP: 'setup-check.mjs', WI: 'templates/workflows/records-integrity.yml',
       WA: 'templates/workflows/records-audit.yml', WU: 'templates/workflows/records-updater.yml', SET: 'templates/settings.yml', RD: 'templates/decisions/README.md', RT: 'templates/decisions/template.md'}
TEMPLATE_PATHS = [SET, RD, RT]

plans, pins, tags, ranges = [], [], [], []


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def pin_text(version='v1.0.0', commit=C1, channel='stable', source=SOURCE):
    return '%s\nsource: %s\nversion: %s\ncommit: %s\nchannel: %s\n' % (HEADER, source, version, commit, channel)


def entry(path, content):
    return {'kind': 'template' if path in TEMPLATE_PATHS else 'managed', 'path': path, 'sha256': digest(content), 'size': len(content), 'source': SRC[path]}


def manifest(tag, commit, files, node='>=22', requires=None):
    return {'commit': commit, 'files': files, 'generations': ['g1'], 'node': node,
            'requires': requires or {'rulesets': [{'branch': 'default', 'checks': ['Records integrity'], 'up-to-date': True}], 'secrets': ['RECORD_KEEPER_TOKEN'], 'settings': ['owners']},
            'schema': 1, 'tag': tag, 'version': tag[1:]}


def text(m):
    return json.dumps(m, indent=2, sort_keys=True) + '\n'


def release(tag, prerelease=None, draft=False):
    return {'tag_name': tag, 'draft': draft, 'prerelease': ('-' in tag) if prerelease is None else prerelease, 'body': 'notes of ' + tag}


# The installed kit at v1.0.0 and the kit of v1.1.0: record-keeper.mjs and updater.mjs change, the integrity workflow does not, the updater workflow is new, the
# check program is gone, and the template of a record is new.
FILES100 = [entry(RK, 'rk 1'), entry(CPR, 'cpr 1'), entry(UPD, 'upd 1'), entry(WI, 'wi 1'), entry(SET, 'settings'), entry(RD, 'readme')]
FILES110 = [entry(RK, 'rk 2'), entry(UPD, 'upd 2'), entry(WI, 'wi 1'), entry(WU, 'wu 2'), entry(SET, 'settings 2'), entry(RD, 'readme 2'), entry(RT, 'template')]
REQUIRES = {'rulesets': [{'branch': 'default', 'checks': ['Records integrity'], 'up-to-date': True}], 'secrets': ['RECORD_KEEPER_TOKEN'], 'settings': ['owners']}


def downloaded(files):
    return {e['source']: {'sha256': e['sha256'], 'size': e['size']} for e in files}


def installed(files):
    return {e['path']: {'kind': 'file', 'sha256': e['sha256']} for e in files}


def base():
    """An update from v1.0.0 to v1.1.0 in which everything is as it should be."""
    new = manifest('v1.1.0', C2, copy.deepcopy(FILES110))
    old = manifest('v1.0.0', C1, copy.deepcopy(FILES100))
    return {'pinText': pin_text(), 'source': None, 'channel': None, 'target': None,
            'releases': [release('v1.0.0'), release('v1.1.0'), release('v1.2.0-1'), release('v0.9.0')], 'tagCommit': C2, 'manifest': text(new), 'previous': text(old), 'node': '24.13.0',
            'downloaded': downloaded(new['files']), 'tree': {**installed(FILES100), PIN: {'kind': 'file', 'sha256': digest(pin_text())}}}


def put(s, key, value):
    s[key] = value


def edit_manifest(s, key, fn):
    m = json.loads(s[key])
    fn(m)
    s[key] = text(m)


def X(code, detail=None):
    return {'status': 'refused', 'code': code, 'detail': detail}


def U(to='v1.1.0', frm='v1.0.0', commit=C2, status='update', channel='stable', source=SOURCE, added=(), changed=(), unchanged=(), templates=(), kept=(), remove=(), overwritten=(), pin_changed=True,
      warnings=(), requires=REQUIRES):
    def by_bytes(paths):
        return sorted(paths, key=lambda path: path.encode())
    return {'status': status, 'source': source, 'channel': channel, 'from': frm, 'to': to, 'commit': commit, 'added': by_bytes(added), 'changed': by_bytes(changed), 'unchanged': by_bytes(unchanged),
            'templates': by_bytes(templates), 'kept': by_bytes(kept), 'remove': by_bytes(remove), 'overwritten': by_bytes(overwritten), 'pin': pin_text(to, commit, channel, source), 'pinChanged': pin_changed,
            'requires': requires, 'warnings': list(warnings)}


def P(id, note, expect, *mods, scenario=None):
    s = copy.deepcopy(scenario if scenario is not None else base())
    for mod in mods:
        mod(s)
    plans.append({'id': id, 'note': note, 'input': s, 'expect': expect})


STANDARD = dict(added=[WU], changed=[RK, UPD], unchanged=[WI], templates=[RT], kept=[SET, RD], remove=[CPR])

# ---------------------------------------------------------------- the update that goes right
P('p001-update', 'every list at once: a file added, two changed, one unchanged, a template installed, two kept, a file removed', U(**STANDARD))
P('p002-lists-are-in-byte-order', 'the lists are ordered by the bytes of the paths, not as the manifest lists them', U(**STANDARD), lambda s: edit_manifest(s, 'manifest', lambda m: m['files'].reverse()))
P('p003-local-change', 'a managed file that was edited is changed, and listed as a local change', U(**{**STANDARD, 'overwritten': [RK]}),
  lambda s: s['tree'].__setitem__(RK, {'kind': 'file', 'sha256': digest('edited')}))
P('p004-local-change-of-an-unchanged-file', 'an edit to a file that the release does not change is a file that is changed by the release, and an overwrite', U(**{**STANDARD, 'changed': [RK, UPD, WI], 'unchanged': [], 'overwritten': [WI]}),
  lambda s: s['tree'].__setitem__(WI, {'kind': 'file', 'sha256': digest('edited')}))
P('p005-edit-of-a-file-that-already-has-the-new-content', 'someone made the change by hand: the file is unchanged, and nothing is overwritten', U(**{**STANDARD, 'changed': [UPD], 'unchanged': [RK, WI]}),
  lambda s: s['tree'].__setitem__(RK, {'kind': 'file', 'sha256': digest('rk 2')}))
P('p006-removed-file-edited', 'a file that the release removes and that was edited is removed and listed', U(**{**STANDARD, 'overwritten': [CPR]}),
  lambda s: s['tree'].__setitem__(CPR, {'kind': 'file', 'sha256': digest('edited')}))
P('p007-removed-file-missing', 'a file that the release removes and that is not there is not removed', U(**{**STANDARD, 'remove': []}), lambda s: s['tree'].pop(CPR))
P('p008-removed-path-is-a-folder', 'a path that the release removes and that is a folder is left alone', U(**{**STANDARD, 'remove': []}), lambda s: s['tree'].__setitem__(CPR, {'kind': 'dir'}))
P('p009-removed-path-is-a-link', 'and a link is left alone', U(**{**STANDARD, 'remove': []}), lambda s: s['tree'].__setitem__(CPR, {'kind': 'link'}))
P('p010-removed-path-is-blocked', 'and a path under a file is left alone', U(**{**STANDARD, 'remove': []}), lambda s: s['tree'].__setitem__(CPR, {'kind': 'blocked'}))
P('p011-file-not-installed-by-the-pinned-release', 'a file of the release that the pinned release did not install and that is there with other content is an overwrite',
  U(**{**STANDARD, 'added': [], 'changed': [RK, UPD, WU], 'overwritten': [WU]}), lambda s: s['tree'].__setitem__(WU, {'kind': 'file', 'sha256': digest('mine')}))
P('p012-file-not-installed-with-the-new-content', 'the same, with the content that the release has: unchanged', U(**{**STANDARD, 'added': [], 'unchanged': [WI, WU]}),
  lambda s: s['tree'].__setitem__(WU, {'kind': 'file', 'sha256': digest('wu 2')}))
P('p013-new-template-is-installed', 'a template that the pinned release did not list and that is missing is installed once', U(**STANDARD))
P('p014-new-template-exists', 'a template that the release brings and that is there is kept', U(**{**STANDARD, 'templates': [], 'kept': [RD, RT, SET]}),
  lambda s: s['tree'].__setitem__(RT, {'kind': 'file', 'sha256': digest('mine')}))
P('p015-old-template-deleted', 'a template that the pinned release listed and that was deleted is not installed again', U(**{**STANDARD, 'kept': [RD, SET]}),
  lambda s: s['tree'].pop(SET))
P('p016-template-changed-by-the-release', 'a template that exists is never overwritten, whatever the release holds', U(**STANDARD),
  lambda s: s['tree'].__setitem__(RD, {'kind': 'file', 'sha256': digest('my readme')}))
P('p017-template-is-a-folder', 'a template path that is a folder is kept', U(**{**STANDARD, 'templates': [], 'kept': [RD, RT, SET]}), lambda s: s['tree'].__setitem__(RT, {'kind': 'dir'}))
P('p018-template-is-blocked', 'a template path under a file is kept: nothing is installed there', U(**{**STANDARD, 'templates': [], 'kept': [RD, RT, SET]}), lambda s: s['tree'].__setitem__(RT, {'kind': 'blocked'}))
P('p019-template-is-a-link', 'a template path that is a link is kept', U(**{**STANDARD, 'templates': [], 'kept': [RD, RT, SET]}), lambda s: s['tree'].__setitem__(RT, {'kind': 'link'}))
P('p022-nothing-differs', 'every file is what the release holds, every template is there, and the pin is what the updater writes: the release is installed', U(status='unchanged', frm='v1.1.0', pin_changed=False, unchanged=[RK, UPD, WI, WU], kept=[RD, RT, SET]),
  lambda s: s.update(pinText=pin_text('v1.1.0', C2), target='v1.1.0'), lambda s: s['tree'].clear(), lambda s: s['tree'].update(installed(FILES110)), lambda s: s['tree'].__setitem__(PIN, {'kind': 'file', 'sha256': digest(pin_text('v1.1.0', C2))}),
  lambda s: s.update(previous=s['manifest']))
P('p023-only-the-pin-differs', 'the files are the release\'s and the pin has other comments: the pin is rewritten and that is an update', U(frm='v1.1.0', pin_changed=True, unchanged=[RK, UPD, WI, WU], kept=[RD, RT, SET]),
  lambda s: s.update(pinText=pin_text('v1.1.0', C2).replace('Do not edit it', 'Do not touch it'), target='v1.1.0'), lambda s: s['tree'].clear(), lambda s: s['tree'].update(installed(FILES110)),
  lambda s: s.update(previous=s['manifest']))

# ---------------------------------------------------------------- the pinned release's manifest
P('p030-no-previous-manifest', 'the pinned release has no manifest to read: the update is built without removals and local changes, with a warning, and no template is installed',
  U(added=[WU], changed=[RK, UPD], unchanged=[WI], templates=[], kept=[RD, RT, SET], remove=[], warnings=[{'code': 'previous-missing', 'detail': 'v1.0.0'}]),
  lambda s: s.update(previous=None), lambda s: s['tree'].__setitem__(RK, {'kind': 'file', 'sha256': digest('edited')}))
P('p031-previous-is-not-json', 'a previous manifest that is not JSON is a warning', U(added=[WU], changed=[RK, UPD], unchanged=[WI], kept=[RD, RT, SET], warnings=[{'code': 'previous-unusable', 'detail': 'manifest-json'}]),
  lambda s: s.update(previous='{'))
P('p032-previous-is-for-another-tag', 'a previous manifest of another tag is a warning', U(added=[WU], changed=[RK, UPD], unchanged=[WI], kept=[RD, RT, SET], warnings=[{'code': 'previous-unusable', 'detail': 'manifest-tag'}]),
  lambda s: edit_manifest(s, 'previous', lambda m: m.update(tag='v0.9.0', version='0.9.0')))
P('p033-previous-names-another-commit', 'a previous manifest whose commit is not the pin\'s is a warning', U(added=[WU], changed=[RK, UPD], unchanged=[WI], kept=[RD, RT, SET], warnings=[{'code': 'previous-unusable', 'detail': 'manifest-commit-moved'}]),
  lambda s: edit_manifest(s, 'previous', lambda m: m.update(commit=C3)))
P('p034-previous-is-damaged-in-a-file', 'a previous manifest with a path that is not allowed is a warning, and it is not read at all', U(added=[WU], changed=[RK, UPD], unchanged=[WI], kept=[RD, RT, SET], warnings=[{'code': 'previous-unusable', 'detail': 'manifest-path'}]),
  lambda s: edit_manifest(s, 'previous', lambda m: m['files'].append({'kind': 'managed', 'path': '../x', 'sha256': digest('x'), 'size': 1, 'source': 'x'})))
P('p035-previous-needs-no-node', 'the range of Node.js of the pinned release is read but not asked of the running Node.js', U(**STANDARD),
  lambda s: edit_manifest(s, 'previous', lambda m: m.update(node='>=99')))
P('p036-previous-with-an-unreadable-range', 'a range that the updater cannot read in the pinned release is a warning', U(added=[WU], changed=[RK, UPD], unchanged=[WI], kept=[RD, RT, SET], warnings=[{'code': 'previous-unusable', 'detail': 'manifest-node'}]),
  lambda s: edit_manifest(s, 'previous', lambda m: m.update(node='^22')))
P('p037-previous-with-bytes-that-are-not-text', 'a previous manifest that is not UTF-8 is a warning', U(added=[WU], changed=[RK, UPD], unchanged=[WI], kept=[RD, RT, SET], warnings=[{'code': 'previous-unusable', 'detail': 'manifest-json'}]),
  lambda s: s.update(previous={'hex': 'ff7b7d'}))
P('p039-previous-lists-the-new-template', 'a template that the pinned release listed already is not new: it is not installed, though it is missing',
  U(**{**STANDARD, 'templates': [], 'kept': [SET, RD, RT]}), lambda s: edit_manifest(s, 'previous', lambda m: m['files'].append(entry(RT, 'template'))))
P('p064-precedence-of-numbers', 'v1.10.0 is newer than v1.9.0', U(to='v1.10.0', commit=C3, **STANDARD), lambda s: s.update(releases=[release('v1.0.0'), release('v1.9.0'), release('v1.10.0')], tagCommit=C3),
  lambda s: edit_manifest(s, 'manifest', lambda m: m.update(tag='v1.10.0', version='1.10.0', commit=C3)))

# ---------------------------------------------------------------- the first adoption
FIRST = dict(frm=None, added=[RK, UPD, WI, WU], templates=[RD, RT, SET], kept=[], remove=[], overwritten=[])
adopt = [lambda s: s.update(pinText=None, source=SOURCE, previous=None), lambda s: s['tree'].clear()]
P('p040-first-adoption', 'no pin and a source: every managed file is added and every template is installed, with no warning', U(**FIRST), *adopt)
P('p041-first-adoption-settings-exist', 'the settings that the owners wrote first are kept', U(**{**FIRST, 'templates': [RD, RT], 'kept': [SET]}), *adopt, lambda s: s['tree'].__setitem__(SET, {'kind': 'file', 'sha256': digest('owners: [a/1]')}))
P('p042-first-adoption-over-hand-installed-files', 'files of the kit that someone put there by hand are replaced, and not reported: there is no pinned release to compare with',
  U(**{**FIRST, 'added': [UPD, WI, WU], 'changed': [RK]}), *adopt, lambda s: s['tree'].__setitem__(RK, {'kind': 'file', 'sha256': digest('by hand')}))
P('p043-first-adoption-prerelease-by-option', 'the channel of the first adoption is the option', U(**FIRST, channel='prerelease'), *adopt, lambda s: s.update(channel='prerelease', target='v1.1.0'))
P('p044-first-adoption-picks-the-newest-stable', 'without a target the newest release of the stable channel', U(**FIRST), *adopt)
P('p045-first-adoption-no-release', 'a source with no usable release', X('release-none', 'stable'), *adopt, lambda s: s.update(releases=[release('v1.0.0', draft=True), release('v1.1.0-1')]))
P('p046-no-pin-no-source', 'no pin and no source', X('source-missing'), lambda s: s.update(pinText=None, source=None))
P('p047-no-pin-empty-source', 'an empty source is none', X('source-missing'), lambda s: s.update(pinText=None, source=''))
P('p048-source-differs-from-the-pin', 'a source that is not the pin\'s', X('source-mismatch', SOURCE), lambda s: s.update(source='other/kit'))
P('p049-source-equals-the-pin', 'a source that is the pin\'s is fine', U(**STANDARD), lambda s: s.update(source=SOURCE))

# ---------------------------------------------------------------- which release
P('p050-current', 'nothing newer than the pin on the channel', {'status': 'current', 'latest': 'v1.0.0'}, lambda s: s.update(releases=[release('v1.0.0'), release('v0.9.0'), release('v1.1.0-1')]))
P('p051-current-newest-is-older', 'the newest release of the channel is older than the pin', {'status': 'current', 'latest': 'v0.9.0'}, lambda s: s.update(pinText=pin_text('v1.0.0'), releases=[release('v0.9.0'), release('v0.8.0')]))
P('p052-stable-ignores-prerelease', 'the stable channel does not take a prerelease', {'status': 'current', 'latest': 'v1.0.0'}, lambda s: s.update(releases=[release('v1.0.0'), release('v1.2.0-1'), release('v1.1.0-3')]))
P('p053-stable-ignores-flag', 'a release flagged as a prerelease is not stable, whatever its tag says', {'status': 'current', 'latest': 'v1.0.0'}, lambda s: s.update(releases=[release('v1.0.0'), release('v1.1.0', prerelease=True)]))
P('p054-stable-ignores-prerelease-tag', 'a tag with a prerelease part is not stable, whatever the flag says', {'status': 'current', 'latest': 'v1.0.0'}, lambda s: s.update(releases=[release('v1.0.0'), release('v1.1.0-rc.1', prerelease=False)]))
P('p055-prerelease-channel', 'the prerelease channel takes the newest of all', U(to='v1.2.0-1', commit=C3, channel='prerelease', added=[WU], changed=[RK, UPD], unchanged=[WI], templates=[RT], kept=[RD, SET], remove=[CPR]),
  lambda s: s.update(pinText=pin_text(channel='prerelease'), tagCommit=C3), lambda s: edit_manifest(s, 'manifest', lambda m: m.update(tag='v1.2.0-1', version='1.2.0-1', commit=C3)),
  lambda s: s['tree'].__setitem__(PIN, {'kind': 'file', 'sha256': digest(pin_text(channel='prerelease'))}))
P('p056-channel-option-over-the-pin', 'the option beats the channel of the pin, and the new pin has it', U(to='v1.2.0-1', commit=C3, channel='prerelease', added=[WU], changed=[RK, UPD], unchanged=[WI], templates=[RT], kept=[RD, SET], remove=[CPR]),
  lambda s: s.update(channel='prerelease', tagCommit=C3), lambda s: edit_manifest(s, 'manifest', lambda m: m.update(tag='v1.2.0-1', version='1.2.0-1', commit=C3)))
P('p057-prerelease-is-older-than-the-stable-of-the-same-version', 'on the prerelease channel 1.1.0 is newer than 1.1.0-rc.1', U(**STANDARD, channel='prerelease'),
  lambda s: s.update(pinText=pin_text(channel='prerelease'), releases=[release('v1.0.0'), release('v1.1.0'), release('v1.1.0-rc.1')]), lambda s: s['tree'].__setitem__(PIN, {'kind': 'file', 'sha256': digest(pin_text(channel='prerelease'))}))
P('p058-pinned-prerelease-to-its-stable', 'a pin on a prerelease goes to the stable release of the same version', U(frm='v1.1.0-rc.1', **STANDARD), lambda s: s.update(pinText=pin_text('v1.1.0-rc.1'), releases=[release('v1.1.0-rc.1'), release('v1.1.0')]),
  lambda s: edit_manifest(s, 'previous', lambda m: m.update(tag='v1.1.0-rc.1', version='1.1.0-rc.1')), lambda s: s.__setitem__('pinText', pin_text('v1.1.0-rc.1', C1)))
P('p059-draft-is-ignored', 'a draft is not a release', {'status': 'current', 'latest': 'v1.0.0'}, lambda s: s.update(releases=[release('v1.0.0'), release('v1.1.0', draft=True)]))
P('p060-odd-tags-are-ignored', 'tags that are not tags of the kit are left out', {'status': 'current', 'latest': 'v1.0.0'},
  lambda s: s.update(releases=[release('v1.0.0')] + [release(t, prerelease=False) for t in ['nightly', 'v2.0', '2.0.0', 'v02.0.0', 'v2.0.0+build', 'V2.0.0', 'v2.0.0-', 'v2.0.0-01', '']]))
P('p061-entries-that-are-not-releases', 'an entry that is not an object, or has no draft flag, or no prerelease flag, is left out', {'status': 'current', 'latest': 'v1.0.0'},
  lambda s: s.update(releases=[release('v1.0.0'), None, 5, 'v9.0.0', [], {'tag_name': 'v9.0.0', 'prerelease': False}, {'tag_name': 'v9.0.0', 'draft': False}, {'tag_name': 'v9.0.0', 'draft': 'false', 'prerelease': False},
                               {'tag_name': 'v9.0.0', 'draft': False, 'prerelease': 'no'}, {'tag_name': 9, 'draft': False, 'prerelease': False}]))
P('p062-same-tag-twice', 'two usable entries with one tag cannot both be right', X('release-duplicate', 'v1.1.0'), lambda s: s['releases'].append(release('v1.1.0')))
P('p063-same-tag-twice-one-a-draft', 'a draft with the tag of a release is no second release', U(**STANDARD), lambda s: s['releases'].append(release('v1.1.0', draft=True)))
P('p065-no-releases', 'an empty list', X('release-none', 'stable'), lambda s: s.update(releases=[]))
P('p066-no-stable-release-for-a-pin', 'a pin and no stable release at all', X('release-none', 'stable'), lambda s: s.update(releases=[release('v1.0.0-1')]))

# ---------------------------------------------------------------- a target
P('p070-target', 'a target that is not the newest', U(to='v1.1.0', **STANDARD), lambda s: s.update(target='v1.1.0', releases=[release('v1.0.0'), release('v1.1.0'), release('v1.2.0')]))
P('p071-target-ignores-the-channel', 'a prerelease can be asked for on the stable channel', U(to='v1.2.0-1', commit=C3, added=[WU], changed=[RK, UPD], unchanged=[WI], templates=[RT], kept=[RD, SET], remove=[CPR]),
  lambda s: s.update(target='v1.2.0-1', tagCommit=C3), lambda s: edit_manifest(s, 'manifest', lambda m: m.update(tag='v1.2.0-1', version='1.2.0-1', commit=C3)))
P('p072-target-missing', 'a target that is not in the list', X('release-missing', 'v3.0.0'), lambda s: s.update(target='v3.0.0'))
P('p073-target-is-a-draft', 'a draft cannot be a target', X('release-missing', 'v1.1.0'), lambda s: s.update(target='v1.1.0', releases=[release('v1.0.0'), release('v1.1.0', draft=True)]))
P('p074-target-older-than-the-pin', 'an update never goes back', X('older-than-pin', 'v0.9.0'), lambda s: s.update(target='v0.9.0'))
P('p075-target-older-prerelease', 'v1.0.0-1 is older than the pin v1.0.0', X('older-than-pin', 'v1.0.0-1'), lambda s: s.update(target='v1.0.0-1', releases=[release('v1.0.0'), release('v1.0.0-1')]))
P('p076-target-is-the-pin', 'a repair: the pinned release is the target, and the files that differ are written', U(to='v1.0.0', commit=C1, status='update', pin_changed=False, changed=[RK], unchanged=[CPR, UPD, WI], kept=[RD, SET], overwritten=[RK]),
  lambda s: s.update(target='v1.0.0', tagCommit=C1, manifest=s['previous'], downloaded=downloaded(FILES100)), lambda s: s['tree'].__setitem__(RK, {'kind': 'file', 'sha256': digest('edited')}))
P('p077-repair-with-nothing-to-repair', 'the pinned release again, with nothing that differs', U(to='v1.0.0', commit=C1, status='unchanged', pin_changed=False, unchanged=[CPR, RK, UPD, WI], kept=[RD, SET]),
  lambda s: s.update(target='v1.0.0', tagCommit=C1, manifest=s['previous'], downloaded=downloaded(FILES100)))
P('p078-repair-with-a-moved-tag', 'the pinned release whose manifest names another commit than the pin recorded', X('release-moved', 'v1.0.0'),
  lambda s: s.update(target='v1.0.0', tagCommit=C3, manifest=s['previous']), lambda s: edit_manifest(s, 'manifest', lambda m: m.update(commit=C3)))
P('p079-a-newer-release-does-not-care-about-the-pin-commit', 'only the pinned release is held to the commit of the pin', U(**STANDARD), lambda s: s.update(pinText=pin_text('v1.0.0', C4)),
  lambda s: edit_manifest(s, 'previous', lambda m: m.update(commit=C4)))
P('p080-pin-commit-differs-from-previous', 'the pin names a commit that the pinned manifest does not: the pinned release cannot be compared with', U(added=[WU], changed=[RK, UPD], unchanged=[WI], kept=[RD, RT, SET], warnings=[{'code': 'previous-unusable', 'detail': 'manifest-commit-moved'}]),
  lambda s: s.update(pinText=pin_text('v1.0.0', C4)))

# ---------------------------------------------------------------- the pin
P('p090-pin-with-a-line-that-is-nothing', 'a refusal of the pin is a refusal of the update', X('pin-line', 2), lambda s: s.update(pinText='# c\nsource gearsnlevers/record-keeper\n'))
P('p091-pin-with-an-unknown-key', 'an unknown key', X('pin-key', 'branch'), lambda s: s.update(pinText=pin_text() + 'branch: main\n'))
P('p092-pin-with-a-key-twice', 'a key twice', X('pin-duplicate', 'commit'), lambda s: s.update(pinText=pin_text() + 'commit: ' + C2 + '\n'))
P('p093-pin-with-a-bad-value', 'a value that is wrong', X('pin-value', 'version'), lambda s: s.update(pinText=pin_text(version='1.0.0')))
P('p094-pin-with-a-missing-key', 'a key that is missing', X('pin-missing', 'channel'), lambda s: s.update(pinText='source: o/k\nversion: v1.0.0\ncommit: %s\n' % C1))
P('p095-empty-pin', 'an empty pin lacks the source first', X('pin-missing', 'source'), lambda s: s.update(pinText=''))

# ---------------------------------------------------------------- the manifest
for n, (code, detail, mod, note) in enumerate([
    ('manifest-json', None, lambda s: s.update(manifest=''), 'an empty manifest'),
    ('manifest-json', None, lambda s: s.update(manifest='{'), 'a manifest that is cut'),
    ('manifest-json', None, lambda s: s.update(manifest={'hex': 'ef' 'bb' 'bf' + text(manifest('v1.1.0', C2, FILES110)).encode().hex()}), 'a byte order mark'),
    ('manifest-json', None, lambda s: s.update(manifest={'hex': 'ff' + text(manifest('v1.1.0', C2, FILES110)).encode().hex()}), 'bytes that are not UTF-8'),
    ('manifest-json', None, lambda s: s.update(manifest='NaN'), 'a constant that JSON does not have'),
    ('manifest-json', None, lambda s: s.update(manifest=text(manifest('v1.1.0', C2, FILES110)) + ' x'), 'text after the document'),
    ('manifest-shape', None, lambda s: s.update(manifest='[]'), 'a list'),
    ('manifest-shape', None, lambda s: s.update(manifest='null'), 'null'),
    ('manifest-shape', None, lambda s: s.update(manifest='"x"'), 'a string'),
    ('manifest-schema', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(schema=2)), 'another schema'),
    ('manifest-schema', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(schema='1')), 'a schema that is text'),
    ('manifest-schema', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(schema=True)), 'a schema that is true'),
    ('manifest-schema', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.pop('schema')), 'no schema'),
    ('manifest-keys', 'extra', lambda s: edit_manifest(s, 'manifest', lambda m: m.update(extra=1)), 'a key that is not on the page'),
    ('manifest-keys', 'node', lambda s: edit_manifest(s, 'manifest', lambda m: m.pop('node')), 'a key that is missing'),
    ('manifest-keys', 'Z', lambda s: edit_manifest(s, 'manifest', lambda m: m.update(Z=1, extra=2)), 'two unknown keys: the first in the order of the bytes'),
    ('manifest-keys', 'zz', lambda s: edit_manifest(s, 'manifest', lambda m: (m.pop('files'), m.update(zz=1))), 'an unknown key is named before a missing one'),
    ('manifest-tag', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(tag='v1.0.0')), 'a manifest of another tag'),
    ('manifest-version', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(version='1.0.0')), 'a version that is not the tag\'s'),
    ('manifest-version', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(version=5)), 'a version that is a number'),
    ('manifest-version', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(version='v1.1.0')), 'a version with a v'),
    ('manifest-commit', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(commit='abc')), 'a short commit'),
    ('manifest-commit', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(commit=C2.upper())), 'a commit in capitals'),
    ('manifest-commit', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(commit=None)), 'no commit'),
    ('manifest-commit-moved', None, lambda s: s.update(tagCommit=C3), 'the tag points at another commit'),
    ('manifest-commit-moved', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(commit=C4)), 'the manifest names another commit'),
    ('manifest-generations', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(generations=[])), 'no generation'),
    ('manifest-generations', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(generations=['g1', 'g1'])), 'a generation twice'),
    ('manifest-generations', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(generations=['g0'])), 'g0'),
    ('manifest-generations', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(generations='g1')), 'a generation that is no list'),
    ('manifest-generations', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(generations=['g1234567890'])), 'ten digits'),
    ('manifest-node', '^22', lambda s: edit_manifest(s, 'manifest', lambda m: m.update(node='^22')), 'a caret'),
    ('manifest-node', '>=22 || >=18', lambda s: edit_manifest(s, 'manifest', lambda m: m.update(node='>=22 || >=18')), 'an or'),
    ('manifest-node', '', lambda s: edit_manifest(s, 'manifest', lambda m: m.update(node='')), 'no range'),
    ('manifest-node', '>=22  <27', lambda s: edit_manifest(s, 'manifest', lambda m: m.update(node='>=22  <27')), 'two spaces'),
    ('manifest-node', '>= 22', lambda s: edit_manifest(s, 'manifest', lambda m: m.update(node='>= 22')), 'a space after the operator'),
    ('manifest-node', '>=22.x', lambda s: edit_manifest(s, 'manifest', lambda m: m.update(node='>=22.x')), 'a letter'),
    ('manifest-node', '>=022', lambda s: edit_manifest(s, 'manifest', lambda m: m.update(node='>=022')), 'a leading zero'),
    ('manifest-node', '<=22', lambda s: edit_manifest(s, 'manifest', lambda m: m.update(node='<=22')), 'an operator that is not read'),
    ('manifest-node', 22, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(node=22)), 'a number'),
    ('manifest-requires', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(requires=[])), 'requirements that are a list'),
    ('manifest-requires', None, lambda s: edit_manifest(s, 'manifest', lambda m: m['requires'].pop('settings')), 'requirements without settings'),
    ('manifest-requires', None, lambda s: edit_manifest(s, 'manifest', lambda m: m['requires'].update(extra=[])), 'requirements with a key more'),
    ('manifest-requires', None, lambda s: edit_manifest(s, 'manifest', lambda m: m['requires'].update(secrets=['token'])), 'a secret in lower case'),
    ('manifest-requires', None, lambda s: edit_manifest(s, 'manifest', lambda m: m['requires'].update(secrets=['A', 'A'])), 'a secret twice'),
    ('manifest-requires', None, lambda s: edit_manifest(s, 'manifest', lambda m: m['requires'].update(settings=['Owners'])), 'a setting in capitals'),
    ('manifest-requires', None, lambda s: edit_manifest(s, 'manifest', lambda m: m['requires'].update(rulesets=[{'branch': 'default'}])), 'a ruleset without checks'),
    ('manifest-requires', None, lambda s: edit_manifest(s, 'manifest', lambda m: m['requires'].update(rulesets=[{'branch': 'a`b', 'checks': [], 'up-to-date': True}])), 'a backtick in a branch'),
    ('manifest-requires', None, lambda s: edit_manifest(s, 'manifest', lambda m: m['requires'].update(rulesets=[{'branch': 'default', 'checks': ['@alice'], 'up-to-date': True}])), 'a mention in a check'),
    ('manifest-requires', None, lambda s: edit_manifest(s, 'manifest', lambda m: m['requires'].update(rulesets=[{'branch': 'default', 'checks': [], 'up-to-date': 'yes'}])), 'an up-to-date that is no boolean'),
    ('manifest-requires', None, lambda s: edit_manifest(s, 'manifest', lambda m: m['requires'].update(rulesets=['x'])), 'a ruleset that is no object'),
    ('manifest-files', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(files=[])), 'no files'),
    ('manifest-files', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(files={})), 'files that are no list'),
    ('manifest-files', None, lambda s: edit_manifest(s, 'manifest', lambda m: m.update(files=[dict(m['files'][0], path='.github/record-keeper/f%d.mjs' % i) for i in range(101)])), 'a hundred and one files'),
    ('manifest-entry', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'].__setitem__(0, 'x')), 'an entry that is a text'),
    ('manifest-entry', 2, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][1].pop('size')), 'an entry without a size'),
    ('manifest-entry', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(mode='755')), 'an entry with a key more'),
    ('manifest-kind', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(kind='other')), 'another kind'),
    ('manifest-kind', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(kind=None)), 'no kind'),
    ('manifest-path', '../x', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path='../x')), 'a path with ..'),
    ('manifest-path', '/etc/passwd', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path='/etc/passwd')), 'an absolute path'),
    ('manifest-path', '.github/record-keeper/../../x.mjs', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path='.github/record-keeper/../../x.mjs')), 'a way out of the folder'),
    ('manifest-path', '.github/record-keeper/sub/x.mjs', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path='.github/record-keeper/sub/x.mjs')), 'a program in a sub-folder'),
    ('manifest-path', '.github/record-keeper/Record-Keeper.mjs', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path='.github/record-keeper/Record-Keeper.mjs')), 'capitals'),
    ('manifest-path', '.github/record-keeper/a--b.mjs', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path='.github/record-keeper/a--b.mjs')), 'two hyphens'),
    ('manifest-path', '.github/record-keeper/x.js', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path='.github/record-keeper/x.js')), 'another extension'),
    ('manifest-path', '.github/workflows/test.yml', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path='.github/workflows/test.yml')), 'a workflow that is not a records workflow'),
    ('manifest-path', '.github/workflows/records-a.yaml', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path='.github/workflows/records-a.yaml')), 'a workflow with another extension'),
    ('manifest-path', '.github/record-keeper/settings.yml', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path=SET)), 'the settings as a managed file'),
    ('manifest-path', 'docs/decisions/README.md', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path=RD)), 'the records README as a managed file'),
    ('manifest-path', '.github/record-keeper.yml', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path=PIN)), 'the pin as a managed file'),
    ('manifest-path', 5, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(path=5)), 'a path that is a number'),
    ('manifest-path', '.github/record-keeper/updater.mjs', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(kind='template', path=UPD)), 'a program as a template'),
    ('manifest-path', 'docs/decisions/0001-x.md', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][-1].update(path='docs/decisions/0001-x.md')), 'a record as a template'),
    ('manifest-path', 'docs/decisions/README.md ', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][-1].update(path='docs/decisions/README.md ')), 'a space at the end'),
    ('manifest-source', '../x', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(source='../x')), 'a source with ..'),
    ('manifest-source', '/abs', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(source='/abs')), 'an absolute source'),
    ('manifest-source', 'a\\b', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(source='a\\b')), 'a backslash'),
    ('manifest-source', 'a:b', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(source='a:b')), 'a colon'),
    ('manifest-source', 'a//b', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(source='a//b')), 'an empty part'),
    ('manifest-source', 'a/./b', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(source='a/./b')), 'a dot part'),
    ('manifest-source', 'a/ b', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(source='a/ b')), 'a part that starts with a space'),
    ('manifest-source', 'a/b.', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(source='a/b.')), 'a part that ends with a dot'),
    ('manifest-source', 'a/.GIT/x', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(source='a/.GIT/x')), '.git in capitals'),
    ('manifest-source', '', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(source='')), 'no source'),
    ('manifest-source', 'café', lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(source='café')), 'a letter that is not ASCII'),
    ('manifest-source', None, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(source=None)), 'a source that is null'),
    ('manifest-digest', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(sha256='abc')), 'a short digest'),
    ('manifest-digest', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(sha256=m['files'][0]['sha256'].upper())), 'a digest in capitals'),
    ('manifest-digest', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(sha256=5)), 'a digest that is a number'),
    ('manifest-size', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(size=-1)), 'a negative size'),
    ('manifest-size', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(size=1.5)), 'a size with a fraction'),
    ('manifest-size', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(size='5')), 'a size that is text'),
    ('manifest-size', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(size=True)), 'a size that is true'),
    ('manifest-size', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(size=4 * 1024 * 1024 + 1)), 'a size over the limit'),
    ('manifest-size', 1, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'][0].update(size=10 ** 30)), 'a huge size'),
    ('manifest-duplicate', RK, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'].append(dict(m['files'][0], source='other.mjs'))), 'a path twice'),
    ('manifest-too-large', None, lambda s: edit_manifest(s, 'manifest', lambda m: m['files'].extend(dict(m['files'][0], path='.github/record-keeper/big%d.mjs' % i, size=4 * 1024 * 1024) for i in range(4))), 'files that are together too large'),
    ('node-version', '>=22', lambda s: s.update(node='21.7.3'), 'a Node.js that is too old'),
    ('node-version', '>=22', lambda s: s.update(node='9.0.0'), 'a Node.js with one digit less'),
    ('node-version', '>=22.6.1', lambda s: (edit_manifest(s, 'manifest', lambda m: m.update(node='>=22.6.1')), s.update(node='22.6.0')), 'a patch that is too old'),
    ('node-version', '>=22 <24', lambda s: (edit_manifest(s, 'manifest', lambda m: m.update(node='>=22 <24')), s.update(node='24.0.0')), 'a Node.js at the upper bound'),
    ('node-version', '<22', lambda s: edit_manifest(s, 'manifest', lambda m: m.update(node='<22')), 'a range with an upper bound only'),
], 1):
    P('m%03d-%s' % (n, code), note, X(code, detail), mod)

P('m100-node-range-with-a-bound-on-each-side', 'a range with two comparators that the running Node.js satisfies', U(**STANDARD), lambda s: edit_manifest(s, 'manifest', lambda m: m.update(node='>=22 <25')))
P('m101-node-at-the-lower-bound', 'a Node.js at the lower bound', U(**STANDARD), lambda s: (edit_manifest(s, 'manifest', lambda m: m.update(node='>=24.13.0')), s.update(node='24.13.0')))
P('m102-node-range-of-one-number', 'a range of the major only', U(**STANDARD), lambda s: (edit_manifest(s, 'manifest', lambda m: m.update(node='>=22')), s.update(node='22.0.0')))
P('m103-node-compares-numbers', 'the minor version 10 is above 9', U(**STANDARD), lambda s: (edit_manifest(s, 'manifest', lambda m: m.update(node='>=22.9')), s.update(node='22.10.0')))
P('m104-schema-as-a-float', 'a schema written 1.0 is the number 1', U(**STANDARD), lambda s: s.update(manifest=text(json.loads(s['manifest'])).replace('"schema": 1', '"schema": 1.0')))
P('m105-size-as-a-float', 'a size written 4.0 is the number 4', U(**STANDARD), lambda s: s.update(manifest=s['manifest'].replace('"size": 4,', '"size": 4.0,')))
P('m106-key-twice-last-wins', 'a key written twice: the last is the value, as for any reader', X('manifest-schema'), lambda s: s.update(manifest=s['manifest'].replace('"schema": 1', '"schema": 1, "schema": 2')))
P('m107-extra-requires-secret', 'secrets in the requirements are passed through', U(**STANDARD, requires={'rulesets': [], 'secrets': ['A', 'B_2'], 'settings': ['owners', 'approvals']}),
  lambda s: edit_manifest(s, 'manifest', lambda m: m.update(requires={'rulesets': [], 'secrets': ['A', 'B_2'], 'settings': ['owners', 'approvals']})))
P('m108-templates-only-three', 'the three templates of the kit are the only templates', U(**FIRST, requires=REQUIRES), *adopt)

# ---------------------------------------------------------------- the files
P('f001-download-missing', 'no digest for a source', X('download-missing', 'record-keeper.mjs'), lambda s: s['downloaded'].pop('record-keeper.mjs'))
P('f002-download-is-not-an-object', 'a digest that is no object', X('download-missing', 'record-keeper.mjs'), lambda s: s['downloaded'].__setitem__('record-keeper.mjs', 'x'))
P('f003-size-mismatch', 'a download of another size', X('size-mismatch', RK), lambda s: s['downloaded']['record-keeper.mjs'].update(size=s['downloaded']['record-keeper.mjs']['size'] + 1))
P('f004-digest-mismatch', 'a download with another digest', X('digest-mismatch', UPD), lambda s: s['downloaded']['updater.mjs'].update(sha256=digest('other')))
P('f005-digest-null', 'a download with no digest', X('digest-mismatch', UPD), lambda s: s['downloaded']['updater.mjs'].update(sha256=None))
P('f006-size-before-digest', 'the size is judged before the digest of one file', X('size-mismatch', RK), lambda s: s['downloaded']['record-keeper.mjs'].update(size=1, sha256=digest('other')))
P('f007-first-in-path-order', 'of two files that do not match the first by path is named, whatever the order of the manifest', X('digest-mismatch', RK),
  lambda s: s['downloaded']['updater.mjs'].update(sha256=digest('other')), lambda s: s['downloaded']['record-keeper.mjs'].update(sha256=digest('other')), lambda s: edit_manifest(s, 'manifest', lambda m: m['files'].reverse()))
P('f009-extra-downloads-are-ignored', 'a digest that no file of the manifest asks for is ignored', U(**STANDARD), lambda s: s['downloaded'].__setitem__('stray.mjs', {'sha256': digest('x'), 'size': 1}))
P('f010-same-source-twice', 'two destinations of one source: the digest of the source is asked twice', U(**{**STANDARD, 'added': [WA, WU]}),
  lambda s: edit_manifest(s, 'manifest', lambda m: m['files'].append(dict(next(e for e in m['files'] if e['path'] == WU), path=WA))))
P('f011-release-moved-is-asked-before-the-files', 'a moved release is refused before the digests are asked', X('release-moved', 'v1.0.0'),
  lambda s: s.update(target='v1.0.0', tagCommit=C3, manifest=s['previous'], downloaded={}), lambda s: edit_manifest(s, 'manifest', lambda m: m.update(commit=C3)))
P('f012-node-is-asked-before-the-files', 'the Node.js is asked before the files', X('node-version', '>=22'), lambda s: s.update(node='20.0.0', downloaded={}))
P('f013-manifest-is-judged-before-the-node', 'a manifest that is wrong is refused before its range is asked', X('manifest-tag'), lambda s: s.update(node='20.0.0'), lambda s: edit_manifest(s, 'manifest', lambda m: m.update(tag='v9.9.9')))

# ---------------------------------------------------------------- the working tree
for n, kind in enumerate(['dir', 'link', 'other', 'blocked'], 1):
    P('t%03d-managed-path-is-%s' % (n, kind), 'a managed path that is not a file: nothing can be written there', X('path-blocked', RK), lambda s, kind=kind: s['tree'].__setitem__(RK, {'kind': kind}))
P('t005-pin-is-a-folder', 'the pin path is a folder', X('path-blocked', PIN), lambda s: s['tree'].__setitem__(PIN, {'kind': 'dir'}))
P('t006-pin-is-blocked', 'the pin path is under a file', X('path-blocked', PIN), lambda s: s['tree'].__setitem__(PIN, {'kind': 'blocked'}))
P('t007-pin-comes-first', 'the pin is named before a managed file', X('path-blocked', PIN), lambda s: s['tree'].__setitem__(PIN, {'kind': 'link'}), lambda s: s['tree'].__setitem__(RK, {'kind': 'dir'}))
P('t008-first-in-path-order', 'of two managed paths that are blocked the first by path is named', X('path-blocked', RK), lambda s: s['tree'].__setitem__(UPD, {'kind': 'dir'}), lambda s: s['tree'].__setitem__(RK, {'kind': 'dir'}))
P('t009-blocked-is-asked-after-the-files', 'a digest that does not match is named before a path in the way', X('digest-mismatch', UPD), lambda s: s['tree'].__setitem__(RK, {'kind': 'dir'}),
  lambda s: s['downloaded']['updater.mjs'].update(sha256=digest('other')))
P('t010-path-of-a-removed-file-is-not-asked', 'a folder where a file of the pinned release stood does not block the update', U(**{**STANDARD, 'remove': []}), lambda s: s['tree'].__setitem__(CPR, {'kind': 'dir'}))
P('t011-file-without-a-digest', 'a file that was too large to be hashed differs from everything', U(**{**STANDARD, 'overwritten': [RK]}), lambda s: s['tree'].__setitem__(RK, {'kind': 'file', 'sha256': None}))
P('t012-tree-without-the-pin', 'a repository that has no pin file but a pin option is a first adoption, and a pin that is only in the text is rewritten', U(**STANDARD), lambda s: s['tree'].pop(PIN))
P('t013-unlisted-paths-are-ignored', 'a path of the tree that the manifest does not name is not looked at', U(**STANDARD), lambda s: s['tree'].__setitem__('.github/record-keeper/mine.mjs', {'kind': 'dir'}))

# ---------------------------------------------------------------- the small groups
for n, (text_, expect) in enumerate([
    (pin_text(), {'source': SOURCE, 'version': 'v1.0.0', 'commit': C1, 'channel': 'stable'}),
    ('source: o/k\nversion: v1.2.3-rc.1\ncommit: %s\nchannel: prerelease' % C3, {'source': 'o/k', 'version': 'v1.2.3-rc.1', 'commit': C3, 'channel': 'prerelease'}),
    ('# a\n\n# b\nsource: a.b/c_d-e\nversion: v0.0.0\ncommit: %s\nchannel: stable\n\n' % C1, {'source': 'a.b/c_d-e', 'version': 'v0.0.0', 'commit': C1, 'channel': 'stable'}),
    ('channel: stable\ncommit: %s\nversion: v1.0.0\nsource: o/k\n' % C1, {'source': 'o/k', 'version': 'v1.0.0', 'commit': C1, 'channel': 'stable'}),
    ('source: o/k\nversion: v1.0.0\ncommit: %s\nchannel: stable\n' % ('f' * 64), {'source': 'o/k', 'version': 'v1.0.0', 'commit': 'f' * 64, 'channel': 'stable'}),
], 1):
    pins.append({'id': 'a%02d-good' % n, 'note': 'a pin that is read', 'text': text_, 'expect': {'pin': expect}})
GOOD = pin_text().split('\n')
for n, (note, text_, code, detail) in enumerate([
    ('a carriage return', pin_text().replace('\n', '\r\n'), 'pin-line', 2),
    ('a comment that is indented', ' # c\n' + '\n'.join(GOOD[1:]), 'pin-line', 1),
    ('two spaces after the colon', pin_text().replace('source: ', 'source:  '), 'pin-line', 2),
    ('no space after the colon', pin_text().replace('source: ', 'source:'), 'pin-line', 2),
    ('a space at the end', pin_text().replace('stable', 'stable '), 'pin-line', 5),
    ('a tab', pin_text().replace('stable', 'sta\tble'), 'pin-line', 5),
    ('a key in capitals', pin_text().replace('channel:', 'Channel:'), 'pin-line', 5),
    ('a key with a digit', pin_text() + 'a1: x\n', 'pin-line', 6),
    ('a value that is not ASCII', pin_text().replace('stable', 'stablé'), 'pin-line', 5),
    ('a blank line with a space', pin_text() + ' \n', 'pin-line', 6),
    ('a byte order mark', '\ufeff' + pin_text(), 'pin-line', 1),
    ('an empty value', pin_text().replace('stable', ''), 'pin-line', 5),
    ('a comment after a value', pin_text().replace('stable', 'stable # c'), 'pin-line', 5),
    ('a key that is not one', pin_text() + 'extra: 1\n', 'pin-key', 'extra'),
    ('the first problem wins: a line, then a key', 'bad line\nextra: 1\n', 'pin-line', 1),
    ('the first problem wins: a key, then a value', 'extra: 1\nversion: x\n', 'pin-key', 'extra'),
    ('a key twice', pin_text() + 'source: a/b\n', 'pin-duplicate', 'source'),
    ('a duplicate before a bad value', 'source: a/b\nsource: a/b\nversion: x\n', 'pin-duplicate', 'source'),
    ('a bad value before the second', 'source: a/b\nversion: x\nsource: a/b\n', 'pin-value', 'version'),
    ('a source with one part', pin_text().replace(SOURCE, 'record-keeper'), 'pin-value', 'source'),
    ('a source with three parts', pin_text().replace(SOURCE, 'a/b/c'), 'pin-value', 'source'),
    ('a source with ..', pin_text().replace(SOURCE, 'a/..'), 'pin-value', 'source'),
    ('a source with .', pin_text().replace(SOURCE, './b'), 'pin-value', 'source'),
    ('a source with a colon', pin_text().replace(SOURCE, 'a:b/c'), 'pin-value', 'source'),
    ('a source part of 101 characters', pin_text().replace(SOURCE, 'a' * 101 + '/b'), 'pin-value', 'source'),
    ('a version without v', pin_text().replace('v1.0.0', '1.0.0'), 'pin-value', 'version'),
    ('a version with two parts', pin_text().replace('v1.0.0', 'v1.0'), 'pin-value', 'version'),
    ('a version with build metadata', pin_text().replace('v1.0.0', 'v1.0.0+b'), 'pin-value', 'version'),
    ('a version with a leading zero', pin_text().replace('v1.0.0', 'v01.0.0'), 'pin-value', 'version'),
    ('a version with a numeric prerelease with a leading zero', pin_text().replace('v1.0.0', 'v1.0.0-01'), 'pin-value', 'version'),
    ('a version of 81 characters', pin_text().replace('v1.0.0', 'v1.0.0-' + 'a' * 74), 'pin-value', 'version'),
    ('a commit that is short', pin_text().replace(C1, C1[:39]), 'pin-value', 'commit'),
    ('a commit in capitals', pin_text().replace(C1, C1.upper()), 'pin-value', 'commit'),
    ('a commit of 41 digits', pin_text().replace(C1, C1 + 'a'), 'pin-value', 'commit'),
    ('a channel that is not one', pin_text().replace('stable', 'next'), 'pin-value', 'channel'),
    ('a channel in capitals', pin_text().replace('stable', 'Stable'), 'pin-value', 'channel'),
    ('no source', '\n'.join(l for l in GOOD if not l.startswith('source')), 'pin-missing', 'source'),
    ('no version', '\n'.join(l for l in GOOD if not l.startswith('version')), 'pin-missing', 'version'),
    ('no commit', '\n'.join(l for l in GOOD if not l.startswith('commit')), 'pin-missing', 'commit'),
    ('no channel', '\n'.join(l for l in GOOD if not l.startswith('channel')), 'pin-missing', 'channel'),
    ('the first missing key is named', 'channel: stable\n', 'pin-missing', 'source'),
    ('an empty text', '', 'pin-missing', 'source'),
    ('only comments and blank lines', '# a\n\n# b\n', 'pin-missing', 'source'),
], 1):
    pins.append({'id': 'b%02d-%s' % (n, code), 'note': note, 'text': text_, 'expect': {'refused': {'code': code, 'detail': detail}}})

ORDER = ['v0.9.0', 'v1.0.0-1', 'v1.0.0-2', 'v1.0.0-10', 'v1.0.0-alpha', 'v1.0.0-alpha.1', 'v1.0.0-alpha.beta', 'v1.0.0-beta', 'v1.0.0-beta.2', 'v1.0.0-beta.11', 'v1.0.0-rc.1', 'v1.0.0', 'v1.0.1', 'v1.9.0', 'v1.10.0',
         'v2.0.0', 'v10.0.0', 'v10.0.1']
for i, a in enumerate(ORDER):
    for j, b in enumerate(ORDER):
        if i == j or abs(i - j) == 1 or (i, j) in ((0, len(ORDER) - 1),) or (i + j) % 5 == 0:
            tags.append({'id': 'c%03d' % (len(tags) + 1), 'a': a, 'b': b, 'expect': (i > j) - (i < j)})
tags.extend({'id': 'c%03d' % (len(tags) + 1), 'a': a, 'b': b, 'expect': e} for a, b, e in [('v1.0.0-alpha.1', 'v1.0.0-alpha.1', 0), ('v99999999999999999999.0.0', 'v99999999999999999998.0.0', 1), ('v1.0.0-9', 'v1.0.0-a', -1),
                                                                                       ('v1.0.0-a', 'v1.0.0-B', 1), ('v1.0.0-a.1', 'v1.0.0-a', 1), ('v1.0.0-1a', 'v1.0.0-2', 1), ('v1.0.0-99999999999999999999', 'v1.0.0-100000000000000000000', -1)])

for n, (rng, node, satisfied) in enumerate([
        ('>=22', '22.0.0', True), ('>=22', '21.9.9', False), ('>=22', '100.0.0', True), ('>=22 <25', '24.99.99', True), ('>=22 <25', '25.0.0', False), ('>=22.6', '22.5.9', False), ('>=22.6', '22.6.0', True),
        ('>=22.6.1', '22.6.0', False), ('<22', '21.99.99', True), ('<22', '22.0.0', False), ('<22.6.1', '22.6.0', True), ('<22.6.1', '22.6.1', False), ('>=0', '0.0.0', True), ('>=22 >=23', '22.9.0', False),
        ('>=22 >=23', '23.0.0', True), ('>=1.2.3', '1.10.0', True), ('>=9', '10.0.0', True), ('>=10', '9.9.9', False), ('>=22 <23 <22.5', '22.6.0', False), ('>=22 <23 <22.5', '22.4.0', True),
        ('^22', '22.0.0', None), ('', '22.0.0', None), ('>=22 ', '22.0.0', None), (' >=22', '22.0.0', None), ('>=22||>=18', '22.0.0', None), ('>=22.x', '22.0.0', None), ('>22', '23.0.0', None),
        ('<=22', '22.0.0', None), ('>=22.1.2.3', '22.0.0', None), ('>=-1', '1.0.0', None), ('>=1_0', '1.0.0', None), ('=22', '22.0.0', None), ('>=v22', '22.0.0', None), ('>=00', '1.0.0', None),
        ('>=1.00', '1.0.0', None), (7, '22.0.0', None), (None, '22.0.0', None)], 1):
    parsed = ref.parse_range(rng)
    if (parsed is not None and ref.satisfies(node, parsed)) is not (satisfied is True) or (parsed is None) != (satisfied is None):
        print('DIFFERENT range', rng, node, 'intended', satisfied)
        sys.exit(1)
    ranges.append({'id': 'r%02d' % n, 'range': rng, 'node': node, 'expect': {'parsed': None if parsed is None else [[op, v] for op, v in parsed], 'satisfied': satisfied}})

# ---------------------------------------------------------------- check against the reference
failed = 0
for c in plans:
    got = ref.plan(copy.deepcopy(c['input']))
    if json.dumps(got, sort_keys=True) != json.dumps(c['expect'], sort_keys=True):
        failed += 1
        print('DIFFERENT', c['id'], '\n  intended', json.dumps(c['expect'], sort_keys=True)[:700], '\n  reference', json.dumps(got, sort_keys=True)[:700])
for c in pins:
    try:
        got = {'pin': ref.parse_pin(c['text'])}
    except ref.Refused as refusal:
        got = {'refused': {'code': refusal.code, 'detail': refusal.detail}}
    if got != c['expect']:
        failed += 1
        print('DIFFERENT', c['id'], '\n  intended', c['expect'], '\n  reference', got)
for c in tags:
    if ref.compare_tags(c['a'], c['b']) != c['expect']:
        failed += 1
        print('DIFFERENT', c['id'], c['a'], c['b'], c['expect'], ref.compare_tags(c['a'], c['b']))
if failed:
    print(failed, 'cases differ')
    sys.exit(1)
ids = [c['id'] for group in (plans, pins, tags, ranges) for c in group]
assert len(ids) == len(set(ids)), 'ids repeat'
out = {'plans': plans, 'pins': pins, 'tags': tags, 'ranges': ranges}
with open(sys.argv[1], 'w', encoding='utf-8') as handle:
    json.dump(out, handle, ensure_ascii=True, indent=1)
    handle.write('\n')
print(len(plans), 'plan cases,', len(pins), 'pin cases,', len(tags), 'tag cases,', len(ranges), 'range cases; the reference agrees with all of them')
