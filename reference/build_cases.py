"""Build the `validate` fixtures: one small records folder per case, plus cases.json.
Usage: build_cases.py <out_dir>. The expected problems of every case are computed with validate_ref.py, and each case also
declares what it was written to produce: the generator fails if the two differ."""
import json, os, shutil, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
import validate_ref as ref

OUT = sys.argv[1]
if os.path.isdir(OUT): shutil.rmtree(OUT)
os.makedirs(OUT)

TEMPLATE = """---
status: proposed
date: YYYY-MM-DD
decision-makers:
  - maintainers
applies-to:
  - path/or/glob/**
issues:
  - owner/repo#123
---

# Short title of the decision

## Context and problem statement

What forced a decision?

## Decision

What we decided, as rules.

## Consequences

What changes.

## Alternatives considered

Optional.
"""

SEAL64 = '0123456789abcdef' * 4

R1 = """---
status: superseded by 0003
date: 2026-10-01
decision-makers:
  - maintainers
applies-to:
  - src/**
issues:
  - owner/repo#12
seal: sha256-g1:%s
---

# First decision

## Context and problem statement

Why a decision was needed.

## Decision

- Do the thing.

## Consequences

- The thing is done.

## Known deviations

- Deviation recorded for owner/repo#13.

### Remediation

Fix it later.

```sh
## not a heading
```

## Alternatives considered

- Not doing the thing.
""" % SEAL64

R2 = """---
status: proposed
date: 2026-11-01
decision-makers:
  - maintainers
---

# Second decision

## Context and problem statement

A second question.

## Decision

- Do the other thing.

## Consequences

- The other thing is done.
"""

R3 = """---
status: accepted
date: 2026-11-02
decision-makers:
  - maintainers
---

# Third decision

## Context and problem statement

A third question.

## Decision

- Do the third thing.

## Consequences

- The third thing is done.

## Errata

- 2026-11-03: fixed a typo.
"""

README = """# Decision records

Some words about the records.

## Index

| # | Title | Status |
| - | - | - |
| 0001 | [First decision](0001-first-decision.md) | superseded by 0003 |
| 0002 | [Second decision](0002-second-decision.md) | proposed |
| 0003 | [Third decision](0003-third-decision.md) | accepted |
"""

def base():
    return {'README.md': README, 'template.md': TEMPLATE, '0001-first-decision.md': R1, '0002-second-decision.md': R2, '0003-third-decision.md': R3}

def swap(text, old, new):
    assert old in text, old
    return text.replace(old, new, 1)

CASES = []   # (id, files, options, intended, note)
def case(cid, files, intended, note, **options):
    CASES.append((cid, files, options, intended, note))

def edit(name, old, new, files=None):
    f = dict(files if files is not None else base())
    f[name] = swap(f[name], old, new)
    return f

F1, F2, F3 = '0001-first-decision.md', '0002-second-decision.md', '0003-third-decision.md'

# ---- folders that are valid ------------------------------------------------------------------------------------
case('ok01-base', base(), [], 'Three records (one superseded, one with every optional section, one with an Errata section), the template and an index.')
case('ok02-no-records', {'README.md': '# Decision records\n\n## Index\n\n| # | Title | Status |\n| - | - | - |\n', 'template.md': TEMPLATE}, [], 'A folder with no record yet is valid.')
case('ok03-crlf', {k: v.replace('\n', '\r\n') for k, v in base().items()}, [], 'Every file has CRLF line endings.')
case('ok04-extra-key-allowed', edit(F2, 'decision-makers:\n  - maintainers\n', 'decision-makers:\n  - maintainers\nrepos:\n  - owner/one\n'), [], 'A key beyond the standard ones is allowed when the settings list it.', extra_keys=['repos'])
case('ok05-extra-key-as-value', edit(F2, 'decision-makers:\n  - maintainers\n', 'decision-makers:\n  - maintainers\nwindow: until 6.0\n'), [], 'An extra key may be a single value or a list.', extra_keys=['window'])
f = base(); f['shared/0001-anything.txt'] = 'not looked at\n'
case('ok06-shared-folder-not-looked-at', f, [], 'The shared folder (default name shared) is not looked at by this check.')
f = base(); f['core/0001-anything.txt'] = 'not looked at\n'
case('ok07-shared-folder-named-in-settings', f, [], 'The shared folder may have another name when the settings say so.', shared_folder='core')
f = base(); f['.hidden-file'] = 'junk\n'
case('ok08-dotfile-not-looked-at', f, [], 'Names that start with a dot are not looked at.')
case('ok09-index-after-another-table', edit('README.md', '## Index', '## Generations\n\n| Generation | Record | Status |\n| - | - | - |\n| g1 | [0001](0001-first-decision.md) | superseded by 0003 |\n\n## Index'), [], 'A table before the Index section that links a record is not the index.')
case('ok10-index-with-number-link', edit('README.md', README.split('## Index\n\n')[1], '| Number | Title | Status | Applies to |\n| - | - | - | - |\n| [0001](0001-first-decision.md) | First decision | superseded by 0003 | `src/**` |\n| [0002](0002-second-decision.md) | Second decision | proposed | repository-wide |\n| [0003](0003-third-decision.md) | Third decision | accepted | repository-wide |\n'), [], 'The number is the link and the title is its own cell: the row still shows the title and the status.')
case('ok11-index-text-after-table', edit('README.md', '| 0003 | [Third decision](0003-third-decision.md) | accepted |\n', '| 0003 | [Third decision](0003-third-decision.md) | accepted |\n\nA link to [0002](0002-second-decision.md) in a sentence.\n\n## Other\n\n| 0001 | [First decision](0001-first-decision.md) | wrong |\n'), [], 'Only the lines of the Index section count: text after it, and a later heading, do not.')
f = edit('README.md', '## Index', '```\n## Index\n\n| 0009 | [Ghost](0009-ghost.md) | accepted |\n```\n\n## Index')
case('ok12-index-heading-in-a-fence', f, [], 'A heading inside a code block is not the Index section.')
f = edit(F2, 'status: proposed', 'status: rejected'); f = edit('README.md', '| 0002 | [Second decision](0002-second-decision.md) | proposed |', '| 0002 | [Second decision](0002-second-decision.md) | rejected |', f)
case('ok13-status-rejected', f, [], 'rejected is a status.')
f = edit(F3, 'status: accepted', 'status: superseded by 0004'); f['0004-fourth-decision.md'] = R2.replace('Second decision', 'Fourth decision').replace('status: proposed', 'status: accepted')
f = edit('README.md', '| 0003 | [Third decision](0003-third-decision.md) | accepted |', '| 0003 | [Third decision](0003-third-decision.md) | superseded by 0004 |\n| 0004 | [Fourth decision](0004-fourth-decision.md) | accepted |', f)
case('ok14-supersede-chain', f, [], 'A record superseded by a higher number that exists.')
case('ok15-seal-of-another-generation', edit(F1, 'sha256-g1:' + SEAL64, 'sha256-g12:' + SEAL64), [], 'Only the form of the seal is checked here: a generation this version does not know is still well formed.')
body60 = R2.rstrip('\n') + '\n' + '\n'.join(['- filler line %d.' % i for i in range(60 - len(R2.rstrip('\n').split('\n')))]) + '\n'
assert len(body60.rstrip('\n').split('\n')) == 60
case('ok16-sixty-lines', edit(F2, R2, body60), [], 'A record of exactly 60 lines.')
case('ok17-heading-in-a-fence', edit(F2, '- Do the other thing.\n', '```md\n## Not a section\n```\n'), [], 'A line that starts with ## inside a code block is not a heading.')
case('ok18-list-indent-four', edit(F2, 'decision-makers:\n  - maintainers\n', 'decision-makers:\n    - maintainers\n    - owners\n'), [], 'List items may be indented by any number of spaces.')
case('ok19-scoped-package-name', edit(F2, '- Do the other thing.\n', '- Install @scope/name and @other/pkg.\n'), [], 'A scoped package name is not an e-mail address.')
case('ok20-heading-three-spaces-is-text', edit(F2, '- Do the other thing.\n', '- Do the other thing.\n\n   ## Not at column 1\n'), [], 'A ## heading indented by spaces is not a section heading for this check.')

# ---- the folder ----------------------------------------------------------------------------------------------------
case('bad01-folder-missing', {}, [(None, 'V-01')], 'The folder does not exist.', folder_missing=True)
f = base(); del f['README.md']
case('bad02-no-readme', f, [('README.md', 'V-02')], 'There is no README.md.')
f = base(); del f['template.md']
case('bad03-no-template', f, [('template.md', 'V-03')], 'There is no template.md.')
f = base()
case('bad04-symlink', f, [('0004-linked.md', 'V-04')], 'A record that is a symbolic link.', symlinks=[{'name': '0004-linked.md', 'target': F2}])
for cid, name, note in [('bad05a-stray-file', 'notes.txt', 'A file that is not a record.'), ('bad05b-capital-letters', '0004-Fourth-Decision.md', 'Capital letters in the name.'),
                        ('bad05c-underscore', '0004_fourth_decision.md', 'An underscore.'), ('bad05d-three-digits', '004-fourth.md', 'Three digits.'),
                        ('bad05e-no-title', '0004.md', 'A number and no title.'), ('bad05f-double-hyphen', '0004-fourth--decision.md', 'Two hyphens in a row.'),
                        ('bad05g-lowercase-readme', 'readme.txt', 'Another name for the README.'), ('bad05h-trailing-hyphen', '0004-fourth-.md', 'A hyphen at the end of the title.')]:
    f = base(); f[name] = R2
    case(cid, f, [(name, 'V-05')], note)
f = base(); f['archive/0001-old.md'] = R2
case('bad06-other-subfolder', f, [('archive', 'V-06')], 'A subfolder that is not the shared folder.')
f = base(); f['0002-another-second.md'] = R2.replace('Second decision', 'Another second')
f['README.md'] = swap(README, '| 0003 |', '| 0002 | [Another second](0002-another-second.md) | proposed |\n| 0003 |')
case('bad07-number-twice', f, [('0002-second-decision.md', 'V-07')], 'Two files with the number 0002: the later one is reported.')
f = base(); f['0005-fifth.md'] = R2.replace('Second decision', 'Fifth'); f['README.md'] = README + '| 0005 | [Fifth](0005-fifth.md) | proposed |\n'
case('bad08a-gap', f, [(None, 'V-08')], 'The numbers go 0001, 0002, 0003, 0005: 0004 is missing.')
f = base(); del f[F1]; f['README.md'] = swap(README, '| 0001 | [First decision](0001-first-decision.md) | superseded by 0003 |\n', ''); f[F3] = swap(f[F3], 'status: accepted', 'status: accepted')
case('bad08b-does-not-start-at-one', f, [(None, 'V-08')], 'The first record is 0002.')

# ---- the text of a record ------------------------------------------------------------------------------------------
case('bad09a-g1-comment', edit(F2, '- Do the other thing.\n', '<!-- hidden -->\n- Do the other thing.\n'), [(F2, 'V-09', 'G1-06')], 'A record that breaks a rule of generation g1 is reported with that rule, and nothing else is said about it.')
case('bad09b-g1-no-front-matter', edit(F2, '---\nstatus: proposed\ndate: 2026-11-01\ndecision-makers:\n  - maintainers\n---\n\n', ''), [(F2, 'V-09', 'G1-07')], 'No front matter.')
f = edit(F2, 'status: proposed', 'Status: proposed')
case('bad09c-g1-capital-status', f, [(F2, 'V-09', 'G1-11')], 'status written with a capital letter (g1 refuses it).')
f = base(); f[F2] = b'\xef\xbb\xbf' + R2.encode('utf-8')
case('bad09d-g1-byte-order-mark', f, [(F2, 'V-09', 'G1-02')], 'A byte order mark.')
case('bad09e-g1-and-no-index-row', {**edit(F2, '- Do the other thing.\n', '<!-- x -->\n'), 'README.md': swap(README, '| 0002 | [Second decision](0002-second-decision.md) | proposed |\n', '')}, [(F2, 'V-09', 'G1-06'), (F2, 'V-30')], 'The index is checked for a record that breaks g1 too, but its status and title are not, since they cannot be read.')
case('bad10-sixty-one-lines', edit(F2, R2, body60.replace('- filler line 1.\n', '- filler line 1.\n- one more.\n')), [(F2, 'V-10')], 'A record of 61 lines.')
case('bad11-credential', edit(F2, '- Do the other thing.\n', '- Use ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2' + ' to push.\n'), [(F2, 'V-11')], 'Something that looks like a GitHub token.')
case('bad12-email', edit(F2, '- Do the other thing.\n', '- Ask jane.doe@example.org.\n'), [(F2, 'V-12')], 'An e-mail address.')

# ---- the front matter ----------------------------------------------------------------------------------------------
case('bad13a-unknown-key', edit(F2, 'decision-makers:', 'tags: x\ndecision-makers:'), [(F2, 'V-13')], 'A key that is not standard and not in the settings.')
case('bad13b-capitalised-key', edit(F2, 'decision-makers:', 'Title: x\ndecision-makers:'), [(F2, 'V-13')], 'Keys are lower case.')
case('bad13c-extra-key-not-listed', edit(F2, 'decision-makers:\n  - maintainers\n', 'decision-makers:\n  - maintainers\nrepos:\n  - owner/one\n'), [(F2, 'V-13')], 'repos is an extra key: not allowed unless the settings list it.')
case('bad13d-two-unknown-keys', edit(F2, 'decision-makers:', 'tags: x\nlabels: y\ndecision-makers:'), [(F2, 'V-13'), (F2, 'V-13')], 'Each unknown key is reported.')
case('bad14a-decision-makers-as-value', edit(F2, 'decision-makers:\n  - maintainers\n', 'decision-makers: maintainers\n'), [(F2, 'V-14')], 'decision-makers is a list, here a single value (a form that records in the field have).')
case('bad14b-date-as-list', edit(F2, 'date: 2026-11-01', 'date:\n  - 2026-11-01'), [(F2, 'V-09', 'G1-12')], 'date as a list: g1 already refuses an excluded key with continuation lines.')
case('bad14c-applies-to-as-value', edit(F1, 'applies-to:\n  - src/**\n', 'applies-to: src/**\n'), [(F1, 'V-14')], 'applies-to is a list.')
case('bad14d-issues-as-value', edit(F1, 'issues:\n  - owner/repo#12\n', 'issues: owner/repo#12\n'), [(F1, 'V-14')], 'issues is a list.')
case('bad15a-empty-list', edit(F1, 'applies-to:\n  - src/**\n', 'applies-to:\n'), [(F1, 'V-15')], 'A key with no value and no items.')
case('bad15b-empty-decision-makers', edit(F2, 'decision-makers:\n  - maintainers\n', 'decision-makers:\n'), [(F2, 'V-15')], 'decision-makers with no item.')
case('bad16a-value-and-items', edit(F2, 'decision-makers:\n  - maintainers\n', 'decision-makers: maintainers\n  - owners\n'), [(F2, 'V-16')], 'A value on the key line and list items under it.')
case('bad16b-line-that-is-not-an-item', edit(F2, 'decision-makers:\n  - maintainers\n', 'decision-makers:\n  maintainers\n'), [(F2, 'V-16')], 'A line under a key that is not a list item.')
case('bad16c-dash-without-space', edit(F2, 'decision-makers:\n  - maintainers\n', 'decision-makers:\n  -maintainers\n'), [(F2, 'V-16')], 'A dash with no space after it is not a list item.')
f = edit(F2, 'date: 2026-11-01\n', '')
case('bad17a-missing-date', f, [(F2, 'V-17')], 'No date.')
case('bad17b-missing-decision-makers', edit(F2, 'decision-makers:\n  - maintainers\n', ''), [(F2, 'V-17')], 'No decision-makers.')
case('bad17c-missing-status', edit(F2, 'status: proposed\n', ''), [(F2, 'V-17')], 'No status; the status is not judged because there is none.')
case('bad18a-capital-status', edit(F2, 'status: proposed', 'status: Proposed'), [(F2, 'V-18')], 'The status is lower case.')
case('bad18b-unknown-status', edit(F2, 'status: proposed', 'status: withdrawn'), [(F2, 'V-18')], 'A status that does not exist.')
case('bad18c-superseded-by-three-digits', edit(F1, 'superseded by 0003', 'superseded by 003'), [(F1, 'V-18')], 'The number after superseded by has four digits.')
case('bad18d-superseded-without-number', edit(F1, 'superseded by 0003', 'superseded'), [(F1, 'V-18')], 'superseded needs a number.')
case('bad19-deprecated', edit(F2, 'status: proposed', 'status: deprecated'), [(F2, 'V-19')], 'There is no bare deprecated: a record ends only by a successor.')
case('bad20a-superseded-by-missing', edit('README.md', '| 0001 | [First decision](0001-first-decision.md) | superseded by 0003 |', '| 0001 | [First decision](0001-first-decision.md) | superseded by 0009 |', edit(F1, 'superseded by 0003', 'superseded by 0009')), [(F1, 'V-20')], 'The successor does not exist.')
case('bad20b-superseded-by-itself', edit('README.md', '| 0001 | [First decision](0001-first-decision.md) | superseded by 0003 |', '| 0001 | [First decision](0001-first-decision.md) | superseded by 0001 |', edit(F1, 'superseded by 0003', 'superseded by 0001')), [(F1, 'V-20')], 'A record cannot supersede itself.')
case('bad20c-superseded-by-lower', edit(F3, 'status: accepted', 'status: superseded by 0002'), [(F3, 'V-20'), (F3, 'V-33')], 'The successor must have a higher number. (The index row, which says accepted, no longer shows the status.)')
case('bad21a-impossible-date', edit(F2, 'date: 2026-11-01', 'date: 2026-13-01'), [(F2, 'V-21')], 'There is no month 13.')
case('bad21b-short-date', edit(F2, 'date: 2026-11-01', 'date: 2026-1-1'), [(F2, 'V-21')], 'The date has two digits for the month and the day.')
case('bad21c-feb-30', edit(F2, 'date: 2026-11-01', 'date: 2026-02-30'), [(F2, 'V-21')], 'There is no 30 February.')
case('bad21d-date-with-time', edit(F2, 'date: 2026-11-01', 'date: 2026-11-01T10:00:00Z'), [(F2, 'V-21')], 'A date and no time.')
case('bad22a-seal-uppercase', edit(F1, 'sha256-g1:' + SEAL64, 'sha256-g1:' + SEAL64.upper()), [(F1, 'V-22')], 'The digits of a seal are lower case.')
case('bad22b-seal-short', edit(F1, 'sha256-g1:' + SEAL64, 'sha256-g1:' + SEAL64[:-1]), [(F1, 'V-22')], 'The seal has 64 digits.')
case('bad22c-seal-no-generation', edit(F1, 'sha256-g1:' + SEAL64, 'sha256:' + SEAL64), [(F1, 'V-22')], 'The seal names its generation.')
case('bad23a-issue-without-number', edit(F1, 'owner/repo#12', 'owner/repo'), [(F1, 'V-23')], 'An issue is written owner/repo#N.')
case('bad23b-issue-without-repo', edit(F1, 'owner/repo#12', '#12'), [(F1, 'V-23')], 'An issue names its repository.')
case('bad23c-issue-as-url', edit(F1, 'owner/repo#12', 'https://github.com/owner/repo/issues/12'), [(F1, 'V-23')], 'A link is not the form.')

# ---- the body ------------------------------------------------------------------------------------------------------
case('bad24a-no-title', edit(F2, '# Second decision\n\n', ''), [(F2, 'V-24')], 'The body starts with a section, not a title.')
case('bad24b-title-without-space', edit(F2, '# Second decision', '#Second decision'), [(F2, 'V-24')], 'No space after the #.')
case('bad24d-text-before-the-title', edit(F2, '# Second decision', 'Some text.\n\n# Second decision'), [(F2, 'V-24')], 'Text before the title.')
case('bad25a-unknown-section', edit(F2, '## Consequences', '## Notes\n\nSomething.\n\n## Consequences'), [(F2, 'V-25')], 'A section that is not one of the six.')
case('bad25b-two-spaces', edit(F2, '## Decision', '##  Decision'), [(F2, 'V-25'), (F2, 'V-26')], 'Two spaces after ##: not the section Decision (so it is also missing).')
case('bad25c-trailing-colon', edit(F2, '## Consequences', '## Consequences:'), [(F2, 'V-25'), (F2, 'V-26')], 'A colon at the end of the name.')
case('bad25d-lower-case', edit(F2, '## Decision', '## decision'), [(F2, 'V-25'), (F2, 'V-26')], 'The names of the sections are written as given.')
case('bad26a-missing-consequences', edit(F2, '## Consequences\n\n- The other thing is done.\n', ''), [(F2, 'V-26')], 'No Consequences.')
case('bad26b-missing-context', edit(F2, '## Context and problem statement\n\nA second question.\n\n', ''), [(F2, 'V-26')], 'No Context and problem statement.')
case('bad26c-missing-decision-and-consequences', edit(F2, '## Decision\n\n- Do the other thing.\n\n## Consequences\n\n- The other thing is done.\n', ''), [(F2, 'V-26'), (F2, 'V-26')], 'Two required sections missing: each is reported.')
case('bad27a-alternatives-before-consequences', edit(F2, '## Consequences\n\n- The other thing is done.\n', '## Alternatives considered\n\n- Nothing.\n\n## Consequences\n\n- The other thing is done.\n'), [(F2, 'V-27')], 'Alternatives considered must come after Consequences.')
case('bad27b-repeated-section', edit(F2, '## Consequences', '## Decision\n\n- Again.\n\n## Consequences'), [(F2, 'V-27')], 'A section twice.')
case('bad27c-errata-before-alternatives', edit(F1, '## Alternatives considered\n\n- Not doing the thing.\n', '## Errata\n\n- 2026-11-03: fixed.\n\n## Alternatives considered\n\n- Not doing the thing.\n'), [(F1, 'V-27')], 'Errata is the last section.')
case('bad27d-deviations-after-alternatives', {**base(), F1: swap(swap(R1, '## Alternatives considered\n\n- Not doing the thing.\n', ''), '## Known deviations', '## Alternatives considered\n\n- Not doing the thing.\n\n## Known deviations')}, [(F1, 'V-27')], 'Known deviations comes before Alternatives considered.')
case('bad28a-empty-section', edit(F2, '## Decision\n\n- Do the other thing.\n', '## Decision\n'), [(F2, 'V-28')], 'A section with nothing in it.')
case('bad28b-only-blank-lines', edit(F2, '## Decision\n\n- Do the other thing.\n', '## Decision\n\n\n\n'), [(F2, 'V-28')], 'A section of blank lines.')
case('ok22-row-without-closing-pipe', edit('README.md', '| 0002 | [Second decision](0002-second-decision.md) | proposed |', '| 0002 | [Second decision](0002-second-decision.md) | proposed'), [], 'A row does not need a closing pipe.')
case('ok21-section-of-a-subheading', edit(F2, '## Decision\n\n- Do the other thing.\n', '## Decision\n\n### Rule\n'), [], 'A level 3 heading is content.')

# ---- the index -----------------------------------------------------------------------------------------------------
case('bad29a-no-index-heading', edit('README.md', '## Index', '## Records'), [('README.md', 'V-29')], 'The README has no Index section: only that is reported, not a missing row for every record.')
case('bad29b-index-heading-trailing-text', edit('README.md', '## Index', '## Index of records'), [('README.md', 'V-29')], 'The heading is exactly ## Index.')
case('bad30-record-without-row', edit('README.md', '| 0002 | [Second decision](0002-second-decision.md) | proposed |\n', ''), [(F2, 'V-30')], 'A record with no row in the index.')
case('bad31-two-rows', edit('README.md', '| 0003 |', '| 0002 | [Second decision](0002-second-decision.md) | proposed |\n| 0003 |'), [(F2, 'V-31')], 'A record with two rows in the index.')
case('bad32-row-for-missing-record', edit('README.md', '| 0003 |', '| 0004 | [Ghost](0004-ghost.md) | accepted |\n| 0003 |'), [('README.md', 'V-32')], 'A row that links a record that does not exist.')
case('bad33a-status-differs', edit('README.md', '| 0002 | [Second decision](0002-second-decision.md) | proposed |', '| 0002 | [Second decision](0002-second-decision.md) | accepted |'), [(F2, 'V-33')], 'The row says accepted, the record says proposed.')
case('bad33b-status-in-longer-text', edit('README.md', '| 0002 | [Second decision](0002-second-decision.md) | proposed |', '| 0002 | [Second decision](0002-second-decision.md) | proposed (draft) |'), [(F2, 'V-33')], 'A cell equals the status; a longer text does not.')
case('bad33c-empty-status-cell', edit('README.md', '| 0002 | [Second decision](0002-second-decision.md) | proposed |', '| 0002 | [Second decision](0002-second-decision.md) | |'), [(F2, 'V-33')], 'An empty status cell.')
case('bad34a-title-differs', edit('README.md', '[Second decision]', '[Second choice]'), [(F2, 'V-34')], 'The row shows another title.')
case('bad34b-title-case', edit('README.md', '[Second decision]', '[second decision]'), [(F2, 'V-34')], 'The title is compared as written.')
case('multi01-value-and-deprecated', {**base(), F2: edit(F2, 'decision-makers:\n  - maintainers\n', 'decision-makers: maintainers\n')[F2], F3: swap(R3, 'status: accepted', 'status: deprecated')}, [(F2, 'V-14'), (F3, 'V-19')], 'A record with decision-makers as a value (V-14), and one that is deprecated (V-19): records in the field have both today.')


# ---- value-level rules: many records in one folder -----------------------------------------------------------------
def rec(title, status='accepted', date='2026-11-01', dm='decision-makers:\n  - maintainers\n', extra='', body=None, title_line=None):
    body = body if body is not None else '## Context and problem statement\n\nWhy.\n\n## Decision\n\n- Do.\n\n## Consequences\n\n- Done.\n'
    return f'---\nstatus: {status}\ndate: {date}\n{dm}{extra}---\n\n{title_line or "# " + title}\n\n{body}'

def bulk(cid, items, note, **options):
    """items: records ({'slug', 'text', 'title', 'status', 'rules'}) get the next number and an index row; {'name', 'text', 'rule'} is a file that is not a record."""
    files = {'template.md': TEMPLATE}
    rows, intended, n = [], [], 0
    for it in items:
        if 'name' in it:
            files[it['name']] = it['text']
            if it.get('rule'): intended.append((it['name'], it['rule']))
            continue
        n += 1
        name = f"{n:04d}-{it['slug']}.md"
        files[name] = it['text']
        rows.append(f"| {n:04d} | [{it['title']}]({name}) | {it.get('status', 'accepted')} |")
        intended.extend((name, r) for r in it.get('rules', []))
    files['README.md'] = '# Decision records\n\n## Index\n\n| # | Title | Status |\n| - | - | - |\n' + '\n'.join(rows) + '\n'
    case(cid, files, intended, note, **options)

def dated(dates, bad):
    return [{'slug': f'date-{i}', 'title': f'Date {d}', 'text': rec(f'Date {d}', date=d), 'rules': ['V-21'] if bad else []} for i, d in enumerate(dates)]
bulk('ok23-valid-dates', dated(['2026-01-01', '2026-01-31', '2026-02-28', '2024-02-29', '2000-02-29', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31'], False),
     'The last day of every month, and 29 February of a leap year (2024, and 2000 which is divisible by 400).')
bulk('bad21e-invalid-dates', dated(['2026-02-29', '2100-02-29', '1900-02-29', '2026-02-30', '2026-04-31', '2026-06-31', '2026-09-31', '2026-11-31', '2026-01-32', '2026-12-32', '2026-00-10', '2026-13-01', '2026-01-00', '2026-1-01', '2026-01-1', '26-01-01', '2026/01/01', '2024-02-30', 'v2026-01-01', 'on 2026-01-01'], True),
     'Each date is not a real one: 29 February of a year that is not a leap year (also 2100 and 1900), a day past the end of its month, a month or day 00, month 13, and spellings that are not YYYY-MM-DD.')

NAMES_OK = [('v2-release', 'V2 release'), ('a1-b2-c3', 'A1 B2 C3'), ('x', 'X'), ('long-title-with-many-hyphen-separated-words', 'Long title')]
bulk('ok24-record-names', [{'slug': slug, 'title': title, 'text': rec(title)} for slug, title in NAMES_OK], 'Names with digits in the title, one letter, and many groups.')
bad_names = ['x0004-late.md', '0004-late.mdx', '0004-late.md.bak', '0004-.md', '-0004-late.md', '0004--late.md', '0004-Late.md', '00004-late.md', '004-late.md', '0004late.md', '0004-late_md.md', '0004-other.MD', '0004-late-.md', '0004 late.md']
bulk('bad05i-name-variants', [{'slug': slug, 'title': title, 'text': rec(title)} for slug, title in NAMES_OK[:2]] + [{'name': n, 'text': rec('Late'), 'rule': 'V-05'} for n in bad_names],
     'Names that look like a record file and are not: text before the number, another extension, an extra suffix, an empty or doubled hyphen group, capitals, an underscore, a space, the wrong number of digits.')

TOKENS_BAD = [('ghp', 'ghp_aB3dE6gH9jK2mN5pQ8sT1'), ('github-pat', 'github_pat_11ABCDEFG0aBcDeF_hIjKlMnOp'), ('private-key', '-----BEGIN RSA PRIVATE KEY-----'), ('private-key-plain', '-----BEGIN PRIVATE KEY-----'),
              ('aws', 'AKIAIOSFODNN7EXAMPLE'), ('slack-b', 'xoxb-1234567890-AbCdEfGhIj'), ('slack-p', 'xoxp-1234567890'),
              ('slack-a', 'xoxa-10345-6789'), ('slack-r', 'xoxr-10345-6789'), ('slack-s', 'xoxs-10345-6789'), ('ghp-exact', 'ghp_aB3dE6gH9jK2mN5pQ8s0'), ('pat-exact', 'github_pat_11ABCDEFG0aBcDeF_hI0')]
bulk('bad11b-credential-kinds', [{'slug': slug, 'title': f'Token {slug}', 'text': rec(f'Token {slug}', body=f'## Context and problem statement\n\nWhy.\n\n## Decision\n\n- Never write {tok} here.\n\n## Consequences\n\n- Done.\n'), 'rules': ['V-11']} for slug, tok in TOKENS_BAD],
     'One record for each kind of credential the pattern knows, at its shortest length where the pattern has one.')
TOKENS_OK = [('ghp-short', 'ghp_aB3dE6gH9jK2mN5pQ8s'), ('pat-short', 'github_pat_11ABCDEFG0aBcDeF_hI'), ('aws-short', 'AKIAIOSFODNN7EXAMPL'), ('slack-short', 'xoxb-123456789'), ('slack-short-hyphen', 'xoxb-12345-678'), ('public-key', '-----BEGIN PUBLIC KEY-----'), ('prefix-only', 'ghp_ and github_pat_ and AKIA and xoxb-')]
bulk('ok25-near-credentials', [{'slug': slug, 'title': f'Near {slug}', 'text': rec(f'Near {slug}', body=f'## Context and problem statement\n\nWhy.\n\n## Decision\n\n- Never write {tok} here.\n\n## Consequences\n\n- Done.\n')} for slug, tok in TOKENS_OK],
     'Text that is one character short of a credential, a public key header, and the bare prefixes.')

MAILS_BAD = [('plain', 'jane@example.org'), ('dots-plus', 'first.last+tag@sub-domain.example.co.uk'), ('mixed', 'A_B%C-9@Example.ORG'), ('digits', '9mail@x9.io')]
bulk('bad12b-email-forms', [{'slug': slug, 'title': f'Mail {slug}', 'text': rec(f'Mail {slug}', body=f'## Context and problem statement\n\nWhy.\n\n## Decision\n\n- Write to {m}.\n\n## Consequences\n\n- Done.\n'), 'rules': ['V-12']} for slug, m in MAILS_BAD],
     'E-mail addresses with dots, a plus, hyphens, an underscore, a percent sign, capitals, digits, several domain levels and a two-letter top level.')
MAILS_OK = [('one-letter-tld', 'a@b.c'), ('scoped', '@scope/name'), ('no-dot', 'user@localhost'), ('at-sign', 'a @ b.org')]
bulk('ok26-near-emails', [{'slug': slug, 'title': f'Near {slug}', 'text': rec(f'Near {slug}', body=f'## Context and problem statement\n\nWhy.\n\n## Decision\n\n- Write {m} somewhere.\n\n## Consequences\n\n- Done.\n')} for slug, m in MAILS_OK],
     'A top level of one letter, a scoped package name, a host with no dot, and an at sign with spaces are not addresses.')

issues = lambda items: 'issues:\n' + ''.join(f'  - {i}\n' for i in items)
bulk('ok27-issue-forms', [{'slug': 'issues', 'title': 'Issues', 'text': rec('Issues', extra=issues(['Owner-Name/repo.name_1#123', 'a/b#1', 'A9/Z_9#007', 'example-org/example-repo#35', 'my_org.name/repo#1']))}], 'Issues with hyphens, dots, underscores, capitals, digits and leading zeros.')
bad_issues = ['/repo#1', 'owner/#1', 'owner/repo#', 'owner/repo#12x', 'owner/repo #1', 'owner/repo/extra#1', 'owner#1', 'owner/re po#1', 'owner/repo#-1']
bulk('bad23d-issue-forms', [{'slug': f'issue-{i}', 'title': f'Issue {i}', 'text': rec(f'Issue {i}', extra=issues([b])), 'rules': ['V-23']} for i, b in enumerate(bad_issues)], 'Items that are not owner/repo#N: a missing owner, repository or number, text after the number, a space, a second slash, a negative number.')

STATUS_BAD = ['superseded by 0001 now', 'was superseded by 0001', 'Superseded by 0001', 'superseded  by 0001', 'superseded by 00001', 'proposed.', 'accepted;', 'rejected!', 'in review']
bulk('bad18e-status-forms', [{'slug': 'first', 'title': 'First', 'text': rec('First')}] + [{'slug': f'status-{i}', 'title': f'Status {i}', 'text': rec(f'Status {i}', status=st), 'status': st, 'rules': ['V-18']} for i, st in enumerate(STATUS_BAD)],
     'Statuses that only look like a valid one: text before or after, a capital, two spaces, five digits, punctuation, a word that is not a status.')
bulk('bad22d-seal-forms', [{'slug': f'seal-{i}', 'title': f'Seal {i}', 'text': rec(f'Seal {i}', extra=f'seal: {v}\n'), 'rules': ['V-22']} for i, v in enumerate([
    'sha256-g:' + SEAL64, 'xsha256-g1:' + SEAL64, 'sha256-g1:' + 'G' * 64, 'sha256-g1:' + SEAL64[:-1] + 'g', 'sha256-g1:' + SEAL64 + '0', 'sha256-g1:' + SEAL64[:-1], 'sha256-gx:' + SEAL64, 'sha1-g1:' + SEAL64[:40], SEAL64])],
     'Seals with no generation number, text before, a letter past f, one digit too many or too few, and no prefix.')
bulk('ok29-seal-forms', [{'slug': f'seal-{i}', 'title': f'Seal {i}', 'text': rec(f'Seal {i}', extra=f'seal: {v}\n')} for i, v in enumerate(['sha256-g1:' + SEAL64, 'sha256-g7:' + SEAL64, 'sha256-g100:' + '9876543210fedcba' * 4])],
     'Seals with digits in the hash, and one-, and three-digit generation numbers.')

# ---- more edges of the body, the front matter and the index ----------------------------------------------------------
def sixty(n, final_newline):
    base = R2.rstrip('\n').split('\n')
    text = '\n'.join(base + ['- filler line %d.' % i for i in range(n - len(base))])
    return text + ('\n' if final_newline else '')
assert len(sixty(61, False).split('\n')) == 61 and len(sixty(60, False).split('\n')) == 60
case('bad10b-sixty-one-lines-no-final-newline', edit(F2, R2, sixty(61, False)), [(F2, 'V-10')], 'A record of 61 lines with no line feed at the end.')
case('ok30-sixty-lines-no-final-newline', edit(F2, R2, sixty(60, False)), [], 'A record of 60 lines with no line feed at the end.')
case('ok31-one-character-item', edit(F2, 'decision-makers:\n  - maintainers\n', 'decision-makers:\n  - a\n'), [], 'An item of one character is an item.')
case('ok32-title-right-after-front-matter', edit(F2, '---\n\n# Second decision', '---\n# Second decision'), [], 'No empty line between the front matter and the title.')
case('bad27e-first-two-sections-swapped', edit(F2, '## Context and problem statement\n\nA second question.\n\n## Decision\n\n- Do the other thing.\n', '## Decision\n\n- Do the other thing.\n\n## Context and problem statement\n\nA second question.\n'), [(F2, 'V-27')], 'Decision comes before Context and problem statement: the first two sections are out of order.')
case('ok33-readme-trailing-white-space', {**base(), 'README.md': README.replace('## Index', '## Index \t').replace('| proposed |', '| proposed |  ')}, [], 'Trailing spaces and tabs in the README are not part of what is read.')
case('ok34-index-heading-on-the-first-line', {**base(), 'README.md': README.replace('# Decision records\n\nSome words about the records.\n\n', '')}, [], 'The README may start with the Index heading.')
case('bad29c-index-section-is-empty', {**base(), 'README.md': README.replace('## Index\n\n', '## Index\n## Notes\n\n')}, [(F1, 'V-30'), (F2, 'V-30'), (F3, 'V-30')], 'The line right after the Index heading is another heading: the section is empty, so no record has a row.')
case('ok35-status-in-the-first-column', {**base(), 'README.md': README.split('## Index')[0] + '## Index\n\n| Status | Title |\n| - | - |\n| superseded by 0003 | [First decision](0001-first-decision.md) |\n| proposed | [Second decision](0002-second-decision.md) |\n| accepted | [Third decision](0003-third-decision.md) |\n'}, [], 'The status is the first cell of the row and the title is the second.')
case('ok36-title-only-in-a-cell', {**base(), 'README.md': README.split('## Index')[0] + '## Index\n\n| Status | Link | Title |\n| - | - | - |\n| superseded by 0003 | [read](0001-first-decision.md) | First decision |\n| proposed | [read](0002-second-decision.md) | Second decision |\n| accepted | [read](0003-third-decision.md) | Third decision |\n'}, [], 'The title is a cell of its own and the link text is something else.')
case('ok37-title-only-in-the-link', {**base(), 'README.md': README.split('## Index')[0] + '## Index\n\n| Status | Title |\n| - | - |\n| superseded by 0003 | [First decision](0001-first-decision.md) extra text |\n| proposed | [Second decision](0002-second-decision.md) |\n| accepted | [Third decision](0003-third-decision.md) |\n'}, [], 'The title is the text of the link, in a cell that has more text.')


case('ok38-readme-text-with-backticks', {**base(), 'README.md': README.replace('Some words about the records.', 'Write ``` in a sentence, or a line of just two backticks:\n\n``\n\nand go on.')}, [], 'Backticks in a sentence, or two of them alone on a line, do not open a code block in the README.')
f = base(); f['README.md'] = README.replace('## Index', '````\nx ```\n## Index\n| 0009 | [Ghost](0009-ghost.md) | accepted |\n```\n````\n\n## Index', 1)
case('ok39-readme-code-block-with-fence-text', f, [], 'A line that ends in three backticks, inside a code block of four, does not close it, so the Index heading inside the block is not the index.')
f = base(); f['README.md'] = README + '| 0009 | [Not a record](0009-.md) | accepted |\n| 0009 | [Not a record either](0009-x-.md) | accepted |\n| 0009 | [Not a record](0009-X.md) | accepted |\n'
case('ok40-index-links-that-are-not-record-names', f, [], 'A row whose link is not the name of a record file is not a row for a record.')

# ---- supersedes ------------------------------------------------------------------------------------------------------
sup = lambda items: 'supersedes:\n' + ''.join(f'  - {i}\n' for i in items)
DM = 'decision-makers:\n  - maintainers\n'
case('ok41-supersedes', edit(F3, DM, DM + sup(['0001'])), [], 'A record that replaces record 0001 lists it.')
case('ok42-supersedes-several-in-any-order', edit(F3, DM, DM + sup(['0002', '0001'])), [], 'Several numbers, in any order. Record 0002 is still proposed: the format does not ask that a record listed is already superseded.')
case('ok43-supersedes-before-status', edit(F3, '---\nstatus: accepted\n', '---\n' + sup(['0001']) + 'status: accepted\n'), [], 'The key may come anywhere in the front matter.')
case('ok44-supersedes-the-same-number-twice', edit(F3, DM, DM + sup(['0001', '0001'])), [], 'A number listed twice is not a problem of the format.')
bulk('ok45-supersedes-forms', [{'slug': 'first', 'title': 'First', 'text': rec('First')},
                              {'slug': 'second', 'title': 'Second', 'text': rec('Second', extra=sup(['0001']))},
                              {'slug': 'third', 'title': 'Third', 'text': rec('Third', extra=sup(['0001', '0002']))},
                              {'slug': 'fourth', 'title': 'Fourth', 'text': rec('Fourth', extra=sup(['0003']))}],
     'A record may list the record right before it, and every earlier record.')
case('bad14e-supersedes-as-value', edit(F3, DM, DM + 'supersedes: 0001\n'), [(F3, 'V-14')], 'supersedes is a list, here a single value.')
bad_numbers = ['1', '001', '00001', 'abcd', '0001x', 'x0001', '#0001', '-0001', '0x01', '1e3', '0001.0', '0001 0002', '0001 # replaced', '０００１']
bulk('bad35a-supersedes-forms', [{'slug': 'first', 'title': 'First', 'text': rec('First')}] + [{'slug': f'number-{i}', 'title': f'Number {i}', 'text': rec(f'Number {i}', extra=sup([b])), 'rules': ['V-35']} for i, b in enumerate(bad_numbers)],
     'Items that are not a number of four digits: too few or too many, letters or other text around the digits, a sign, a hexadecimal or exponent form, two numbers in one item, a comment, full-width digits.')
case('bad36a-supersedes-missing', edit(F3, DM, DM + sup(['0009'])), [(F3, 'V-36')], 'The record listed does not exist.')
case('bad36b-supersedes-itself', edit(F3, DM, DM + sup(['0003'])), [(F3, 'V-36')], 'A record cannot replace itself.')
case('ok46-emergency', edit(F3, DM, DM + 'emergency: A broken hash function.\n'), [], 'The key emergency is a standard key: a single value with the reason.')
case('ok47-emergency-500-characters', edit(F3, DM, DM + 'emergency: ' + 'x' * 500 + '\n'), [], 'A reason of exactly 500 characters.')
case('ok47b-emergency-500-wide-characters', edit(F3, DM, DM + 'emergency: ' + '\u00e9' * 500 + '\n'), [], '500 characters that take two bytes each: the limit counts characters.')
case('bad37a-emergency-501-characters', edit(F3, DM, DM + 'emergency: ' + 'x' * 501 + '\n'), [(F3, 'V-37')], 'A reason of 501 characters.')
case('bad37b-emergency-501-wide-characters', edit(F3, DM, DM + 'emergency: ' + '\u00e9' * 501 + '\n'), [(F3, 'V-37')], '501 characters that take two bytes each.')
case('bad14g-emergency-as-list', edit(F3, DM, DM + 'emergency:\n  - a reason\n'), [(F3, 'V-14')], 'emergency is a single value, here a list.')
case('bad15f-emergency-empty', edit(F3, DM, DM + 'emergency:\n'), [(F3, 'V-15')], 'emergency has no value.')
case('bad36c-supersedes-a-higher-number', edit(F2, DM, DM + sup(['0003'])), [(F2, 'V-36')], 'The record listed exists and has a higher number: a record replaces only an earlier one.')
case('bad36d-supersedes-zero', edit(F3, DM, DM + sup(['0000'])), [(F3, 'V-36')], 'There is no record 0000.')
case('bad36e-supersedes-each-item', edit(F3, DM, DM + sup(['0001', '0009', '0003', '0002'])), [(F3, 'V-36'), (F3, 'V-36')], 'Each item that fails is reported: 0009 does not exist and 0003 is the record itself.')
case('bad36f-supersedes-two-rules', edit(F3, DM, DM + sup(['12', '0009', '0001'])), [(F3, 'V-35'), (F3, 'V-36')], 'An item that is not four digits is reported by V-35 only; V-36 judges the others.')

# ---- compute, check the intent, write -----------------------------------------------------------------------------
CASES = [c for c in CASES if c is not None]
ids = [c[0] for c in CASES]
assert len(ids) == len(set(ids)), [i for i in ids if ids.count(i) > 1]
out_cases = []
for cid, files, options, intended, note in CASES:
    d = os.path.join(OUT, cid)
    lowered = [n.lower() for n in files]
    assert len(lowered) == len(set(lowered)), (cid, 'two names that differ only in case cannot live in one folder on macOS or Windows')
    if not options.get('folder_missing'):
        os.makedirs(d)
        for name, content in files.items():
            p = os.path.join(d, name)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'wb') as fh: fh.write(content if isinstance(content, bytes) else content.encode('utf-8'))
    # evaluate on a temporary copy so that symlinks can be added without storing them
    with tempfile.TemporaryDirectory() as tmp:
        work = os.path.join(tmp, 'f')
        if options.get('folder_missing'): work = os.path.join(tmp, 'missing')
        else:
            shutil.copytree(d, work)
            for s in options.get('symlinks', []): os.symlink(s['target'], os.path.join(work, s['name']))
        got = ref.validate(work, tuple(options.get('extra_keys', [])), options.get('shared_folder', 'shared'))
    want = sorted((f, r) for f, r, *_ in [(x[0], x[1]) for x in intended])
    have = sorted((f if f is not None else '', r) for f, r, _ in got)
    want = sorted((f if f is not None else '', r) for f, r in want)
    assert have == want, (cid, 'wanted', want, 'got', have)
    entry = {'id': cid, 'folder': 'no-such-folder' if options.get('folder_missing') else cid}
    if options.get('extra_keys'): entry['extra-keys'] = options['extra_keys']
    if options.get('shared_folder'): entry['shared-folder'] = options['shared_folder']
    if options.get('symlinks'): entry['symlinks'] = options['symlinks']
    expect = []
    for (f, r, detail) in sorted(got, key=lambda x: ((x[0] or ''), x[1])):
        e = {'file': f, 'rule': r}
        if r == 'V-09': e['g1'] = detail
        expect.append(e)
    entry['expect'] = expect
    entry['note'] = note
    out_cases.append(entry)
with open(os.path.join(OUT, 'cases.json'), 'w') as fh:
    json.dump({'cases': out_cases}, fh, indent=2, ensure_ascii=False); fh.write('\n')
print(len(out_cases), 'cases:', sum(1 for c in out_cases if not c['expect']), 'valid,', sum(1 for c in out_cases if c['expect']), 'with problems')
import collections
rules = collections.Counter(e['rule'] for c in out_cases for e in c['expect'])
print('rules exercised:', len(rules), sorted(rules))
