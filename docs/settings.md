# The settings of a repository

Status: draft for review (M2.2, with `owners` and `approvals` added in M2.4). This page says how the kit reads the settings file of a repository from a commit, which settings exist, and what is wrong with a file that cannot be read. It is not part of the protocol. Like [the format of a record](record-format.md), a rule here changes what the kit accepts from then on and never what a seal means; a repository takes a changed rule by taking the kit release that carries it.

The settings decide what the kit looks at: which folder holds the records, which front matter keys are allowed besides the standard ones, who the owners are and how many of them must approve an act. A pull request that could edit them could loosen the check that judges it. So the kit reads them from **a commit that the caller names**, and the pull request check (M2.3) names the base branch, never the pull request. This page does not decide which commit that is; it decides how a commit is read.

## The file

The settings are one file, `.github/record-keeper/settings.yml`, edited by the maintainers. It is optional: a commit without it has every setting at its default. A file may set some settings and leave the rest.

The file is read with the kit's own reader, not with a YAML library, because a setting needs nothing more than a few lines and because a library reads far more than the kit should trust (anchors, tags, merge keys, several documents, several versions of what `yes` means). The reader reads a **subset** of YAML, and everything outside the subset is a problem and not an interpretation. A file in the subset means the same to the kit and to any YAML reader.

## The subset

- **Text.** The file is UTF-8. Lines end with a line feed or with a carriage return and a line feed; the last line needs no ending. A space is U+0020. A tab is not white space: it may stand only inside a comment.
- **Blank line.** Spaces only, or nothing.
- **Comment.** Spaces, then `#`, then anything. A comment may also follow a value, after at least one space.
- **Entry.** A **key** in column 1, then `:`, then end of line or one or more spaces and the **value**, then optional spaces and an optional comment. A key is a letter, then letters, digits, hyphens and underscores.
- **Value.** Nothing, or a scalar, or a list.
- **Scalar.** One of four forms. The first three mean a string and the fourth a number.
  - A **plain** scalar: a letter or an underscore, or a dot followed by a letter, then letters, digits, `.`, `_`, `/` and `-`. It must not be one of the words YAML reads as something other than a string: `null`, `true`, `false`, `yes`, `no`, `on`, `off`, `y`, `n`, `.inf` and `.nan`, in any mix of upper and lower case. Anything else is written in quotes.
  - A **single-quoted** scalar: `'`, text, `'`. A quote inside is written twice.
  - A **double-quoted** scalar: `"`, text, `"`. A quote inside is written `\"` and a backslash `\\`; no other backslash is read.
  - The text of a quoted scalar is on the line and has no tab.
  - An **integer**: `0`, or a digit from 1 to 9 followed by at most eight digits, and then the end of the value, a space, a comma or `]`. It means a number, to the kit and to any YAML reader, so only a setting that asks for a number takes it (S-07 for any other): `folder: 2024` is refused and `folder: "2024"` is the string. `007`, `1_000`, `0x1F`, `+1`, `1.5` and `1e3` are not integers of the subset, and a value that starts with a digit and is none of the forms is not in the subset.
- **List.** `[`, then zero or more scalars separated by commas, with spaces allowed around them, then `]`, all on one line. `[]` is the empty list.
- **Nothing else.** A line that starts with a space and is not blank or a comment, a line that starts with `-`, a block list on the lines after `key:`, a mapping inside a value, a nested list, an anchor (`&`), an alias (`*`), a tag (`!`), a block scalar (`|` or `>`), a document marker (`---`), a number that is not an integer of the subset, a plain scalar with characters outside the list above, and any entry that does not end after its value: none of it is in the subset.

The **kind** of a value is *none* (nothing after the colon), *single* (a scalar) or *list*.

## The settings

| Key | Kind | Default | A value is acceptable when |
| --- | ---- | ------- | -------------------------- |
| `folder` | single | `docs/decisions` | it is a **path of the tree**: parts separated by `/`, at least one, each part not empty, not `.`, not `..`, not `.git` in any case, and without a backslash. No leading or trailing `/`. |
| `shared-folder` | single | `shared` | it is one part of that kind (no `/`). |
| `extra-keys` | list | `[]` | every item has the form of a front matter key: a letter, then letters, digits, hyphens and underscores. A key may be listed twice and may be a standard key; neither changes anything. |
| `owners` | list | `[]` | every item is `login/id` ([approvals](approvals.md)): a GitHub **login** (1 to 39 letters, digits and single hyphens, not starting or ending with a hyphen), a slash, and the **numeric ID** of the account (a digit from 1 to 9 followed by at most 14 digits). No two items have the same ID. A login that starts with a digit is written in quotes. |
| `approvals` | single | `2` | it is an integer from 1 to 99. |

`folder` is where the records live; `shared-folder` and `extra-keys` are the options of the same names that [`validate`](record-format.md) takes. `owners` and `approvals` say who may approve an act and how many of them must: [the page on approvals](approvals.md) says what the check does with them. An owner is matched by the ID, never by the login, which a person can change and another can then claim; the login is there for people to read and for mentions. The default of `owners` is nobody, so a repository that has not named its owners cannot approve any act. A key that is not in this table is not a setting. Each further setting is added in the change that gives it an effect, and with it a row here; until then it is a problem (S-05), so that a file written for a later kit shows its unknown lines under an earlier one instead of being believed.

A **template**, with every key commented out at its default, is what a repository copies:

```yaml
# folder: docs/decisions        # where the records live
# shared-folder: shared         # the subfolder of the records folder for records that bind several repositories
# extra-keys: []                # front matter keys beyond the standard ones, for example [repos]
# owners: []                    # the accounts that approve acts, as login/id, for example [alice/1001, bob/1002]
# approvals: 2                  # how many owners must approve an act; 1 is the single-owner mode
```

## The rules

A problem has a rule, a line of the file (none for S-01 and for the S-02 that is not UTF-8) and a detail. A detail longer than 40 characters (code points) is cut there. The column "Once per" says how often a rule may be reported for one commit.

| Rule | A problem is reported when | Once per | Detail |
| ---- | -------------------------- | -------- | ------ |
| S-01 | the settings path is not a regular file of the commit, or something other than a folder stands on its way | commit | the path that blocks |
| S-02 | the text is not text that the kit reads | file | the reason |
| S-03 | a line is not in the subset | line | the line |
| S-04 | a key is set by more than one line | line | the key |
| S-05 | a key is not a setting | line | the key |
| S-06 | a key has a value of the wrong kind | line | the key |
| S-07 | a value is not acceptable for its key | line | the value |

- **S-01.** The path is `.github/record-keeper/settings.yml`. Nothing at that path is not a problem: every setting has its default. But a symbolic link, a submodule or a directory at the path, or a symbolic link, a submodule or a file at `.github` or at `.github/record-keeper`, is: the kit follows nothing, and a link in front of the file must not look like no file. The detail is the first path, from the top, that blocks. The executable mode is allowed on the file; it changes nothing.
- **S-02.** The first of these that applies is reported, and nothing else is read: every setting has its default.
  1. *not UTF-8*: the bytes are not valid UTF-8. No line.
  2. *byte order mark*: U+FEFF stands anywhere.
  3. *control character*: a character from U+0000 to U+001F other than tab, line feed and carriage return, one from U+007F to U+009F, or U+FFFE or U+FFFF (YAML readers refuse them).
  4. *separator or direction control*: U+2028 or U+2029, or one of U+061C, U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069. The characters U+0085, U+2028 and U+2029 are line ends to some YAML readers; the others change what a person sees.
  5. *bare carriage return*: a carriage return that no line feed follows.
  The line is the number of the line, counting line feeds from 1, on which the first such character stands.
- **S-03.** A line that is not blank, not a comment and not an entry of the subset. The detail is the line without its trailing spaces, cut after 40 characters (code points). A line that begins with a key and a colon but is not an entry (an unfinished quote, a list that does not close, text after a value) still counts as a line of that key, for S-04 and for the default below.
- **S-04.** A known key that more than one line sets, counting a line that is S-03 and has that key. Every other line of the key is reported with S-04, and the key takes its default: neither value is believed. A line that is S-03 keeps its S-03.
- **S-05.** A key that is not in the table, compared exactly (`Folder` and `shared_folder` are not settings). The line is ignored.
- **S-06.** The kind of the value is not the kind of the key: a list for `folder`, a single value or nothing for `extra-keys`, nothing for any key.
- **S-07.** A single value, or an item of a list, that the table does not accept. For a list the detail is the first item that is not.

A line has at most one problem. When a key has a problem its setting has its default, and the other settings are read as usual: a problem in one line does not silence the rest of the file.

## How a problem is reported

`record-keeper config --commit <revision> [--repo <path>]` reads the settings of the commit and prints them, so that a maintainer sees what the kit will use. It prints the five settings on the standard output, one `key: value` line each (`folder: docs/decisions`, `shared-folder: shared`, `extra-keys: [repos]`, `owners: [alice/1001, bob/1002]`, `approvals: 2`; `extra-keys: []` and `owners: []` for none). Then it prints one line on the error output for each problem, `<path>:<line>: [S-05] <what is wrong> (<detail>)` (without `:<line>` when the problem has no line), and a line `<path>: N problems`; when there is no problem that last line goes to the standard output. The path is that of the settings file. It exits 0 when there is no problem, 1 when there is at least one, and 2 for wrong usage: also when the revision names no commit, the repository cannot be read or `git` cannot be run.

`record-keeper validate --commit <revision> --settings-from <revision>` checks the records folder of the first commit with the settings of the second, normally the base of a change. It takes the folder, the shared folder and the extra keys from the settings, reports the problems of the settings first and then those of the records, and counts them together. It is wrong usage to give it a folder, `--extra-key` or `--shared-folder` as well: there must be one source of the settings. `--settings-from` needs `--commit`.

## What changes for the repositories

None of the maintainers' repositories has a settings file yet, so each one reads as the defaults, which are what `validate` assumed: its results are those of the earlier version.

## What this does not do

- **It does not choose the commit.** The pull request check (M2.3) reads the settings of the base of a pull request; `config` and `--settings-from` read the commit they are given.
- **It does not read the pin.** The plan for M2 said the settings file and the pin. The pin, `.github/record-keeper.yml`, tells the updater which release a repository wants; the check runs from the kit installed on the base branch, so the running code already is the pinned version, and nothing in M2 reads the content of the pin. Its fields are the updater's to define (M3). Protecting it against a change needs only its path (M2.7).
- **It adds no setting without an effect.** `witnesses` comes with the announcements (M2.9), `branches` and `compactor` with the compactor (M8). `owners` and `approvals` came with the owners' approvals (M2.4).
- **It does not say what the check does with a problem in the settings.** A problem is reported and the default stays, as the design says. What `Records integrity` does when the settings of the base have a problem, and how the pull request that fixes them can still pass, is for M2.3 and M2.7 to settle.
- **It does not check that an owner exists.** An ID that belongs to no account, or to a different person than the login says, is not found here; the setup check will compare the two with GitHub.
- **It does not change the list of conventional folders of T-03** ([reading a commit](reading-a-commit.md)), which stays fixed.

## Choices in this draft for you to decide

1. **A subset of YAML, read by the kit's own code.** The kit has no dependency, and a YAML library is the largest piece of code a settings file could reach; it also differs between versions of YAML. The cost is that a file in a style the subset does not read is red, with the line named. In particular a **block list** (`extra-keys:` followed by `- repos` lines) is refused: write `extra-keys: [repos]`. The alternative is to read block lists as well, which is a few more lines of code and a few more ways to misread.
2. **Plain scalars are limited to letters, digits and `. _ / -`, and may not be words YAML reads as other types.** Anything else is quoted. The point is that every YAML reader reads an accepted file the same way: a folder called `no` or `2024` would be a boolean or a number to some of them. The cost is that `folder: "2024-records"` needs its quotes.
3. **A problem is reported and the key takes its default.** This is what the design says ("an unreadable or unknown setting is reported and the default stays"). A key that is set twice takes its default as well, with both lines reported, because neither value is more believable than the other. A repository whose `folder` line is broken is checked at `docs/decisions` and is red; M2.3 decides what red means for the pull request check.
4. **Five settings now, and an unknown key is a problem.** Each further setting arrives with the change that gives it an effect. So a settings file that names `witnesses` is red until the kit that announces to witnesses is installed, which is intended: a list that nothing reads must not look like protection. (`owners` and `approvals` were in this position until M2.4.)
5. **The pin is not read in M2.** See "What this does not do". The alternative is to parse it now, with three fields I would have to guess the updater's final form for.
6. **A link in front of the file is a problem, not "no file".** A repository whose `.github` is a symbolic link would otherwise run on the defaults without a word.
7. **An owner is one word, `login/id`, and the subset gains the integer.** The design wrote `owners: [{login: alice, id: 1001}]`. A mapping inside a list is a second kind of nesting for the reader, and its `id: 1001` is a number anyway. A word keeps the reader as it is, reads the same to every YAML reader, and holds what a person needs: the login to read and to mention, the ID to match. The cost is a form that is the kit's own. The alternative is to read flow mappings too, which is more code and more ways to misread a line.
8. **`approvals: 2` needs a number, so the subset gains the integer** in the narrow form above (no leading zero, no sign, at most nine digits). A string `"2"` is refused for it, so that the value means the same to every reader. The cost is that `folder: 2024` changes from S-03 to S-07. The alternative is to write the number in quotes and have the kit read it, which would be the one place where the kit reads a string as a number.
9. **A bad owner list has no owners.** A problem in `owners` leaves the default, nobody, as every other setting does, and nobody can approve an act while the base is in that state. It fails closed, and so the repair of a broken `owners` line needs an administrator ([approvals](approvals.md) says so). The alternative is to keep the items that are fine, which is more helpful and breaks the rule that a key with a problem has its default.

## The fixtures

[test/fixtures/config](../test/fixtures/config/README.md) holds `cases.json`: each case is the text of a settings file, or a small tree, with the settings and the problems that the kit must report for it.
