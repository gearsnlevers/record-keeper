# The format of a record and its folder

Status: draft for review (M1). This page says what `record-keeper validate` checks: the names and numbers of the files, the front matter, the sections, the length, and the index. It is not part of the protocol. Changing a rule here changes what the kit accepts from then on and never what a seal means, which is fixed by [generation g1](generation-g1.md); a repository takes a changed rule by taking the kit release that carries it.

`validate` looks at the format and at nothing that changed. Whether a record may be accepted, whether its seal verifies, whether a status change is allowed and what a pull request edited are other checks (see "Not checked here"). The [fixtures](../test/fixtures/validate/README.md) fix the answer for every rule below.

## Why one list of rules

The format is checked today by five copies that have drifted apart: the validator of the Issue Concierge, of frodo-lib, of the tap and of the umbrella repository (one script, copied and changed), and a separate test in frodo-cli. They agree on most of it and differ on a dozen points, listed in "What changes for the repositories". This page keeps the shared core, takes the Concierge's script as the starting point, and decides each difference once.

## Definitions

- **Records folder.** The directory that is checked (by default `docs/decisions`). A name that starts with a dot is not looked at.
- **Record file.** A file named `NNNN-short-title.md`: four digits, a hyphen, then one or more groups of lower case letters and digits separated by single hyphens, then `.md`. Its **number** is the four digits as an integer.
- **Shared folder.** A subfolder for records that bind several repositories, named by the setting `shared-folder` (default `shared`). This version does not look inside it.
- **Extra keys.** Front matter keys beyond the standard ones, named by the setting `extra-keys` (default none).
- **Line.** As in g1, after its step 1: CRLF becomes LF and no line ends in a space or a tab. A record is read as lines only once it has passed the rules of g1 (V-09), so its front matter and its fences are the ones g1 defines.
- **Entry of a key.** A key line and the continuation lines it owns (g1). Its **value** is the text after the colon without the spaces that follow it. An **item** is a continuation line of one or more spaces, a hyphen, one or more spaces, and then a character that is not a space; the text of the item is what follows. By its shape an entry is: **empty** (no value and no continuation line), a **single value** (a value and no continuation line), a **list** (no value, and every continuation line is an item) or **mixed** (anything else).
- **Body.** The lines after the closing `---` of the front matter. A **section heading** is a body line, not in a fence (g1), that starts with `## ` (two hash marks and a space) in column 1; the **name** is the rest of the line. A section **runs** to the next section heading or the end of the body, and **has content** when at least one of its lines is not empty (a fence, or a heading of level 3, counts).
- **Title.** The first line of the body that is not empty.
- **Index.** `README.md` is read as lines like a record. Its **Index section** runs from the first line, not in a fence, that is exactly `## Index`, up to the next line, not in a fence, that starts with `# ` or `## `, or to the end. A **row** is a line of that section that starts with `|`. The **cells** of a row are the trimmed texts between its pipes (the text after the last pipe counts only if it is not empty). A row **links** a file when it contains `](` followed by the name of a record file and `)`; if it has several such links the first counts. A row **shows** a text when one of its cells equals the text; it shows a title also when the text of one of its links (`[text](`) equals it.

## The rules

A problem has a file (or none, for the folder), a rule and a message. The problems of a folder are a list in which the same rule may occur several times, as the column "Once per" says. The column "Today" says which of the five copies already enforce something like the rule: C the Concierge, L frodo-lib, K frodo-cli, T the tap, U the umbrella; "new" means none does.

| Rule | A problem is reported when | Once per | Today |
| ---- | -------------------------- | -------- | ----- |
| V-01 | the folder does not exist or is not a directory | folder | C L T U |
| V-02 | `README.md` is missing | folder | C L K T U |
| V-03 | `template.md` is missing | folder | C L K T U |
| V-04 | an entry is a symbolic link, or is neither a regular file nor a directory | entry | new |
| V-05 | a file is not `README.md`, `template.md` or a record file | file | C L T U (only `.md`), K |
| V-06 | a subfolder is not the shared folder | subfolder | new |
| V-07 | the number of a record file is the number of an earlier file (files in name order) | file | C L K T U |
| V-08 | the numbers of the record files, in ascending order and without repeats, are not 0001, 0002, 0003 and so on | folder, at the first gap | C L K T U |
| V-09 | the record breaks a rule of generation g1; the message names the G1 rule. V-10 to V-28 are not applied to this record | record | new |
| V-10 | the record has more than 60 lines, not counting the empty line after a final line feed | record | C L K T U (K counts one line more) |
| V-11 | the text matches the credential pattern below | record | C L T U |
| V-12 | the text matches the e-mail pattern below | record | C (K with its own pattern) |
| V-13 | a key is not `status`, `date`, `decision-makers`, `applies-to`, `issues` or `seal`, and is not an extra key | key | C L K T U |
| V-14 | the entry of `decision-makers`, `applies-to` or `issues` is a single value, or the entry of `status`, `date` or `seal` is a list | key | C L T U (K wants a value for `decision-makers`) |
| V-15 | the entry of a key is empty | key | C L K T U |
| V-16 | the entry of a key is mixed | key | C L K T U |
| V-17 | `status`, `date` or `decision-makers` is missing | missing key | C L K T U |
| V-18 | `status` is a single value that is not `proposed`, `accepted`, `rejected` or `superseded by NNNN` (four digits), and is not `deprecated` | record | C L K T U |
| V-19 | `status` is `deprecated`: a record ends only by a successor | record | new (all five allow it) |
| V-20 | `status` is `superseded by NNNN` and no record file has the number NNNN, or NNNN is not higher than the number of this record | record | C L T U (not "higher"), K |
| V-21 | `date` is a single value that is not a real calendar date written `YYYY-MM-DD` | record | C L K T U |
| V-22 | `seal` is a single value that is not `sha256-g`, one or more digits, `:`, and 64 lower case hexadecimal digits | record | new |
| V-23 | an item of `issues` is not written `owner/repo#N` | item | K |
| V-24 | the title is missing or does not start with `# ` followed by a character that is not a space | record | C L T U (K accepts a title anywhere) |
| V-25 | the name of a section heading is not one of the six below | heading | C L K T U |
| V-26 | one of the three required sections is missing | missing section | C L K T U |
| V-27 | the sections whose names are among the six are not in the order below, or one occurs twice | record | C L K T U |
| V-28 | a section has no content | section | C L T U |
| V-29 | `README.md` has no Index section. V-30 to V-34 are applied only when it has | file | K (C L T U read any table line) |
| V-30 | a record file has no row that links it | record | C L K T U |
| V-31 | a record file has more than one row that links it | record | K |
| V-32 | a row links a record file that does not exist | row | C L K T U |
| V-33 | the first row that links a record does not show its `status` | record | C L T U (as a substring), K |
| V-34 | the first row that links a record does not show its title | record | K |

The standard keys are lists for `decision-makers`, `applies-to` and `issues`, and single values for `status`, `date` and `seal`; an extra key may be either. `decision-makers`, `status` and `date` are required; `applies-to`, `issues` and `seal` are optional. A record that has no `applies-to` binds the whole repository.

The six sections, in the order they must have: `Context and problem statement`, `Decision`, `Consequences`, `Known deviations`, `Alternatives considered`, `Errata`. The first three are required. The names are compared as written. A heading of level 3 or deeper is not a section.

V-33 is not applied to a record whose status is missing or is reported by V-14, V-15, V-16, V-18 or V-19, and V-34 is not applied to a record whose title is reported by V-24; the same fault is not reported twice. Neither is applied to a record that V-09 reported.

The credential pattern (V-11), matched anywhere in the text:

```text
ghp_[A-Za-z0-9]{20,}  github_pat_[A-Za-z0-9_]{20,}  -----BEGIN [A-Z ]*PRIVATE KEY-----  AKIA[0-9A-Z]{16}  xox[baprs]-[A-Za-z0-9-]{10,}
```

The e-mail pattern (V-12), matched anywhere in the text:

```text
[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}
```

## How a problem is reported

`record-keeper validate [folder]` prints one line for each problem, `<file>: [V-14] <message>` (and the folder itself when a problem has no file), then a line with the number of problems. It exits 0 when there is none, 1 when there is at least one, and 2 for wrong usage. The order of the lines is not part of the rules; the list of problems is.

## What changes for the repositories

Run on the records that the maintainers' repositories have today (the numbers are from the day the rules were written):

| Repository | Records | Problems | What they are |
| ---------- | ------- | -------- | ------------- |
| Issue Concierge | 41 | none | The records are not edited to adopt the kit. |
| frodo-lib | 13 | 3 | V-19: records 0011, 0012 and 0013 are `deprecated`. |
| frodo-cli | 35 | 40 | V-14: `decision-makers` is a single value in all 35 records; the other repositories write a list. V-19: records 0023, 0024, 0025, 0026 and 0029 are `deprecated`. |
| the tap | none | none | Its records are all shared records. |
| Record Keeper itself | 1 | 1 | V-03: its records folder has no `template.md` yet. |

Where the five copies differ and this page chooses: frodo-cli counts the length one line stricter, so two frodo-lib records (at exactly 60 lines) would fail its count; frodo-cli forbids the names of coding tools in a record, which five Concierge records contain by necessity, so that rule is not kept; only frodo-cli judges the index by its title, its status as a whole cell and its Index heading, which this page extends to all because all five READMEs already comply; the tap, frodo-lib and the umbrella have no e-mail check and the Concierge does, which is kept because records are public and no existing record matches it.

## Not checked here

- **That the paths in `applies-to` exist.** The Concierge and frodo-cli both check it, in different ways (a pattern that matches a file, or the fixed part of a path that exists). It needs the tree of the repository, and moving code is a way round a record, so it belongs with the pull request check (M2) and, until the Concierge adopts the kit, stays in the Concierge's own test.
- **The seal, the status and their history.** That an `accepted` record carries a seal that verifies, that `superseded by NNNN` is vouched for by a sealed successor, that a status moved only in an allowed direction, and that a sealed record did not change are the work of the pull request check and the audit (M2).
- **Shared records** (the `core/` folders of frodo-cli, frodo-lib and the tap: the key `repos`, numbers with gaps, a table "Core decisions", links between records of the folder). The Concierge adopts first and has none; they are added with M6, when those repositories adopt the kit. Until then a shared folder is named in the settings and not looked at.
- **What a git tree can hide**: modes, symbolic links committed as blobs, a `.gitattributes` that touches the records folder. They need the tree and not the disk, so they belong to the pull request check (M2). V-04 only refuses a symbolic link in a working copy.
- **What a record says.** Whether it states a rule and not a value, or is public-safe beyond the two patterns, is for the reviewers.

## Choices in this draft for you to decide

1. **`decision-makers` is a list** (V-14), as in the Concierge, frodo-lib, the template and every shared record. frodo-cli writes a single value in 35 records; its adoption pull request changes those 35 lines.
2. **No bare `deprecated`** (V-19), as the design says. Eight records carry it today (frodo-cli 0023, 0024, 0025, 0026 and 0029; frodo-lib 0011, 0012 and 0013). They fail until M6 decides what ends each of them: a short sealed record that supersedes it, or an exception in the settings for legacy records.
3. **Six sections, `Errata` last, `Known deviations` before `Alternatives considered`** (V-25 to V-27). `Errata` is new to the format and is the one section the Concierge's script would reject today.
4. **A record is checked on top of g1** (V-09): a record that g1 rejects is reported with its G1 rule and nothing more, so a record that passes `validate` can always be sealed.
5. **The folder is checked strictly** (V-04 to V-06): a file or folder that is not expected is a problem, not ignored. The Concierge today ignores files that are not `.md`.
6. **The index is strict** (V-29 to V-34), as frodo-cli's already is: an `## Index` section, one row per record, its status as a cell of its own, its title shown.
7. **This version checks the Concierge's rules first.** Shared records and the `applies-to` paths come later, as listed above.

## The fixtures

[test/fixtures/validate](../test/fixtures/validate/README.md) holds one small records folder for each case and `cases.json`, which lists for each case the problems it must produce. An implementation is correct when it reports exactly those problems, by file and rule, for every case.
