"""Build test/fixtures/commit/cases.json: cases of `validate --commit`, each a case of the format page (or nothing) put into a
tree at a path, with changes that only a commit can have. The expected problems are computed with commit_ref.py, and every case
also declares what it was written to produce: the generator fails if the two differ.
Usage: build_commit_cases.py <validate fixtures dir> <out cases.json>"""
import json, os, shutil, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
import commit_lib, commit_ref

FIX, OUT = sys.argv[1], sys.argv[2]
F1, F2, F3 = '0001-first-decision.md', '0002-second-decision.md', '0003-third-decision.md'
DEFAULT = 'docs/decisions'
CASES = []

def case(cid, intended, note, base='ok01-base', folder=DEFAULT, place=None, changes=()):
    CASES.append(dict(id=cid, base=base, folder=folder, place=place, changes=list(changes), intended=intended, note=note))

def base_files(base):
    out = {}
    if base is None: return out
    root = os.path.join(FIX, base)
    for dirpath, dirs, files in os.walk(root):
        for f in files:
            full = os.path.join(dirpath, f)
            out[os.path.relpath(full, root).replace(os.sep, '/')] = open(full, 'rb').read()
    return out

def entries_of(c):
    """{path: (mode, content)} of the tree of a case."""
    folder = c['place'] or c['folder']
    tree = {f'{folder}/{p}': ('100644', data) for p, data in base_files(c['base']).items()}
    for op in c['changes']:
        if 'root' in op:
            if 'target' in op: tree[op['root']] = ('120000', op['target'].encode())
            elif op.get('submodule'): tree[op['root']] = ('160000', '0123456789012345678901234567890123456789')
            else: tree[op['root']] = (op.get('mode', '100644'), op['content'].encode())
        elif 'write' in op:
            tree[f"{folder}/{op['write']}"] = (op.get('mode', '100644'), op['content'].encode())
        elif 'symlink' in op:
            tree[f"{folder}/{op['symlink']}"] = ('120000', op['target'].encode())
        elif 'submodule' in op:
            tree[f"{folder}/{op['submodule']}"] = ('160000', '0123456789012345678901234567890123456789')
        elif 'remove' in op:
            del tree[f"{folder}/{op['remove']}"]
        else:
            path = f"{folder}/{op['mode']}"
            tree[path] = (op['to'], tree[path][1])
    return tree

ATTR = lambda path, text: {'root': path, 'content': text}

# ---- T-01 ----------------------------------------------------------------------------------------------------------
case('t01a-executable-record', [(F2, 'T-01')], 'A record with the executable mode.', changes=[{'mode': F2, 'to': '100755'}])
case('t01b-executable-readme-and-template', [('README.md', 'T-01'), ('template.md', 'T-01')], 'The README and the template are files of the folder too.', changes=[{'mode': 'README.md', 'to': '100755'}, {'mode': 'template.md', 'to': '100755'}])
case('t01c-executable-where-nobody-looks', [], 'The executable mode on a file whose name starts with a dot, and on a file of the shared folder: not files of the folder that the rules look at.', changes=[{'write': '.script', 'content': 'x\n', 'mode': '100755'}, {'write': 'shared/note.md', 'content': 'x\n', 'mode': '100755'}])
case('t01d-executable-unexpected-file', [('notes.txt', 'V-05'), ('notes.txt', 'T-01')], 'A file that is not expected is V-05, and T-01 as well when it is executable.', changes=[{'write': 'notes.txt', 'content': 'x\n', 'mode': '100755'}])

# ---- T-02 ----------------------------------------------------------------------------------------------------------
ALL5 = ['README.md', 'template.md', F1, F2, F3]
case('t02a-linguist-generated', [(n, 'T-02', 'linguist-generated: true') for n in ALL5], 'An attribute set from the root for every file of the folder, one that hides the diff of a file.',
     changes=[ATTR('.gitattributes', 'docs/decisions/*.md linguist-generated=true\n')])
case('t02b-attributes-file-in-the-folder', [(n, 'T-02', 'diff: unset') for n in ALL5], 'A .gitattributes in the records folder itself (a file with a dot, which the V rules do not look at).',
     changes=[{'write': '.gitattributes', 'content': '* -diff\n'}])
case('t02c-filter', [(n, 'T-02', 'filter: redact') for n in ALL5], 'A filter by extension: a working copy would show other bytes than the commit.',
     changes=[ATTR('.gitattributes', '*.md filter=redact\n')])
case('t02d-text-and-eol-only', [], 'text and eol are allowed, also with a pattern for every file: g1 ignores line endings.',
     changes=[ATTR('.gitattributes', '* text=auto eol=lf\n*.md -text\n')])
case('t02e-binary-macro-for-one-file', [(F2, 'T-02', 'binary: set, diff: unset, merge: unset')], 'The binary macro: it is reported with the attributes it stands for. text is unset by it too, and is not listed, because text is allowed.',
     changes=[ATTR('.gitattributes', 'docs/decisions/0002-second-decision.md binary\n')])
case('t02f-attributes-for-elsewhere', [], 'Attributes for paths outside the records folder.', changes=[ATTR('.gitattributes', 'test/** linguist-generated\n*.lock.yml linguist-generated=true\n')])
case('t02g-attributes-file-of-a-parent-folder', [(F1, 'T-02', 'ident: set')], 'A .gitattributes in docs/, with a pattern relative to docs/.', changes=[ATTR('docs/.gitattributes', 'decisions/0001-first-decision.md ident\n')])
case('t02h-unset-attribute', [(n, 'T-02', 'linguist-generated: unset') for n in ALL5], 'An attribute that is unset counts as one: the rule is about the attributes a commit names, not about their effect.', changes=[ATTR('.gitattributes', '*.md -linguist-generated\n')])
case('t02i-later-line-resets-the-attribute', [], 'A later line that resets an attribute (!name) leaves it unspecified, as git decides.', changes=[ATTR('.gitattributes', '*.md linguist-generated=true\n*.md !linguist-generated\n')])
case('t02j-attribute-of-a-dotfile', [], 'An attribute for a file whose name starts with a dot is not reported.', changes=[{'write': '.note', 'content': 'x\n'}, ATTR('.gitattributes', 'docs/decisions/.note diff\n')])
case('t02l-attributes-in-name-order', [(F1, 'T-02', 'aaa: 1, mmm: 1, zzz: 1'), (F2, 'T-02', 'aaa: 1, mmm: 1, zzz: 1')], 'The attributes of a file are listed in the order of their names, whatever the order of the line (git itself lists them in the reverse of the line).',
     changes=[ATTR('.gitattributes', 'docs/decisions/0001-first-decision.md aaa=1 mmm=1 zzz=1\ndocs/decisions/0002-second-decision.md zzz=1 mmm=1 aaa=1\n')])
case('t02k-attributes-of-the-shared-folder-only', [], 'An attribute for a file inside the shared folder is not reported.', changes=[{'write': 'shared/x.md', 'content': 'x\n'}, ATTR('.gitattributes', 'docs/decisions/shared/* linguist-generated\n')])

# ---- T-03 ----------------------------------------------------------------------------------------------------------
case('t03a-other-folder-with-a-readme', [(None, 'T-03', 'docs/adr')], 'Another conventional folder holds a README.md.', changes=[{'root': 'docs/adr/README.md', 'content': '# x\n'}])
case('t03b-other-folder-with-a-record-file', [(None, 'T-03', 'decisions')], 'Another conventional folder holds a file named like a record.', changes=[{'root': 'decisions/0001-x.md', 'content': 'x\n'}])
case('t03c-two-other-folders', [(None, 'T-03', 'adr'), (None, 'T-03', 'doc/adr')], 'Each other folder is reported.', changes=[{'root': 'adr/README.md', 'content': 'x\n'}, {'root': 'doc/adr/0007-x.md', 'content': 'x\n'}])
case('t03d-other-folder-with-nothing-of-a-records-folder', [], 'A conventional folder that holds neither a README.md nor a record file.', changes=[{'root': 'docs/adr/notes.txt', 'content': 'x\n'}, {'root': 'docs/adr/0001-A.md', 'content': 'x\n'}, {'root': 'docs/adr/readme.md', 'content': 'x\n'}])
case('t03e-folder-that-is-not-conventional', [], 'A folder with a README.md and a record file that is not on the list.', changes=[{'root': 'docs/other/README.md', 'content': 'x\n'}, {'root': 'records/0001-a.md', 'content': 'x\n'}, {'root': 'docs/decisions-old/README.md', 'content': 'x\n'}])
case('t03f-conventional-folder-inside-the-checked-one', [('decisions', 'V-06')], 'The checked folder is docs: docs/decisions is a subfolder of it, V-06, and not another folder.', folder='docs', changes=[{'root': 'docs/decisions/README.md', 'content': 'x\n'}])
case('t03g-the-checked-folder-has-a-conventional-name', [(None, 'T-03', 'docs/decisions')], 'The checked folder is decisions; docs/decisions is another folder.', folder='decisions', changes=[{'root': 'docs/decisions/README.md', 'content': 'x\n'}])
case('t03h-the-checked-folder-alone', [], 'The checked folder has a conventional name and is not another folder to itself.', folder='adr')
case('t03i-conventional-folder-that-is-a-link', [], 'A conventional folder that is a symbolic link holds nothing: a link is not followed.', changes=[{'root': 'docs/adr', 'target': 'decisions'}])
case('t03j-readme-that-is-a-link', [], 'A README.md that is a symbolic link is not a file.', changes=[{'root': 'docs/adr/README.md', 'target': '../decisions/README.md'}])
case('t03k-readme-that-is-a-submodule', [], 'A README.md that is a submodule is not a file.', changes=[{'root': 'docs/adr/README.md', 'submodule': True}])

# ---- what only a tree has: links and submodules, in front of the folder and in it -------------------------------------
case('t04a-folder-is-a-link', [(None, 'V-01')], 'The folder is a symbolic link to a folder with records: not followed, so missing.', place='elsewhere', changes=[{'root': 'docs/decisions', 'target': '../elsewhere'}])
case('t04b-parent-is-a-link', [(None, 'V-01')], 'docs is a symbolic link: the folder is not in the tree.', place='elsewhere/decisions', changes=[{'root': 'docs', 'target': 'elsewhere'}])
case('t04c-folder-is-a-file', [(None, 'V-01')], 'The path of the folder is a file.', base=None, changes=[{'root': 'docs/decisions', 'content': 'x\n'}])
case('t04d-folder-is-a-submodule', [(None, 'V-01')], 'The path of the folder is a submodule.', base=None, changes=[{'root': 'docs/decisions', 'submodule': True}])
case('t04e-link-named-like-a-record', [('0004-late.md', 'V-04')], 'A symbolic link in the folder.', changes=[{'symlink': '0004-late.md', 'target': F2}])
case('t04f-submodule-named-like-a-record', [('0004-late.md', 'V-04')], 'A submodule in the folder.', changes=[{'submodule': '0004-late.md'}])
case('t04g-readme-is-a-link', [('README.md', 'V-04'), ('README.md', 'V-02')], 'The README is a symbolic link: V-04, and the README is missing.', changes=[{'symlink': 'README.md', 'target': 'template.md'}])
case('t04h-deep-folder', [], 'A folder deep in the tree.', folder='a/b/c/d')
case('t04i-readme-in-the-shared-folder', [], 'A README.md inside the shared folder: the shared folder is not looked at.', changes=[{'write': 'shared/README.md', 'content': 'x\n'}])
case('t05-all-three', [(F3, 'T-01'), (F3, 'T-02', 'linguist-generated: set'), (None, 'T-03', 'adr')], 'A record that is executable and has an attribute, and another folder: the rules do not hide one another.',
     changes=[{'mode': F3, 'to': '100755'}, ATTR('.gitattributes', 'docs/decisions/0003-third-decision.md linguist-generated\n'), {'root': 'adr/README.md', 'content': 'x\n'}])

# ---- build, compute, check ----------------------------------------------------------------------------------------------
ids = [c['id'] for c in CASES]
assert len(ids) == len(set(ids)), [i for i in ids if ids.count(i) > 1]
tmp = tempfile.mkdtemp(prefix='commit-cases-')
repo = os.path.join(tmp, 'r.git')
commit_lib.build_repo(repo, [(c['id'], entries_of(c)) for c in CASES])
out = []
for c in CASES:
    got = commit_ref.commit_validate(repo, c['id'], c['folder'])
    def norm(f, r, d): return (f or '', r, d if r in ('T-02', 'T-03') else '')
    have = sorted(norm(*g) for g in got)
    want = sorted(norm(*(w + ('',) * (3 - len(w)))) for w in c['intended'])
    assert have == want, (c['id'], 'wanted', want, 'got', have)
    expect = []
    for f, r, d in sorted(got, key=lambda x: (x[0] or '', x[1], x[2])):
        e = {'file': f, 'rule': r}
        if r in ('T-02', 'T-03'): e['detail'] = d
        expect.append(e)
    entry = {'id': c['id'], 'base': c['base'], 'folder': c['folder']}
    if c['place']: entry['place'] = c['place']
    if c['changes']: entry['changes'] = c['changes']
    entry['expect'] = expect
    entry['note'] = c['note']
    out.append(entry)
shutil.rmtree(tmp)
json.dump({'cases': out}, open(OUT, 'w'), indent=2, ensure_ascii=False)
open(OUT, 'a').write('\n')
import collections
print(len(out), 'cases;', sum(1 for c in out if not c['expect']), 'valid;', 'rules:', sorted(collections.Counter(e['rule'] for c in out for e in c['expect'])))
