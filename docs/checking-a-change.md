# Checking a change

Status: draft for review (M2.3, with the owners' approval added in M2.4, errata and deviation notes in M2.6, the files of the check in M2.7a, the bar for an amendment in M2.7b and where a record applies in M2.7c). This page says how `record-keeper check-pr` judges a change: the records folder of a **head** commit against the records folder of a **base** commit. It is the core of the pull request check; [the owners' approval](approvals.md) says which acts are approved, and [the workflow](workflow.md) (M2.5), [errata and deviation notes](errata-and-deviations.md) (M2.6), [the files of the check](protected-files.md) (M2.7a) and [the bar for an amendment](amendments.md) (M2.7b) are added to it. It is not part of the protocol, but it is the place where [record 0001](decisions/0001-accepted-records-are-sealed-and-change-only-by-supersession-or-erratum.md) becomes checkable, so a rule here is read with that record next to it.

The check never trusts the change. It reads both commits through git ([reading a commit](reading-a-commit.md)), takes the settings from the base ([settings](settings.md)), and decides what the head may differ in. Everything it does not yet decide fails closed: a change it cannot judge is a problem, not a pass.

## The question

For each record of the base, is the head allowed to hold what it holds? For each record that is new in the head, or changed, is it fit to enter? A record is in one of two states at a commit:

- **sealed**: the record is a readable record (it passes [generation g1](generation-g1.md)), its status is a single value that is `accepted` or `superseded by NNNN`, and its `seal:` is a single value that verifies under g1. Only the status line of a sealed record may change, and only in the one direction the protocol allows.
- **not sealed**: anything else. A proposed record, a rejected one, a record that claims to be accepted and has no seal that verifies, a record that g1 rejects. It may be edited freely, and it is judged by the format rules when it changes.

This is the whole of the idea. The rules below only say it exactly.

## Definitions

- **Base, head.** Two commits named by the caller. The check needs the base to be an ancestor of the head (P-09): a change is what the head adds to the base, and a head that was cut from an older base also undoes what the base gained since.
- **Settings.** Those of the **base**, read as [the settings page](settings.md) says. A problem in a setting leaves the default for that setting. The records folder **F**, the shared folder and the extra keys are used for both commits, so a change cannot choose the rules it is judged by.
- **Record file.** A direct entry of F in a commit, a regular file (mode `100644` or `100755`), named as a record file ([the format](record-format.md)). Its **number** is the four digits of its name. If several record files have one number, the **record of a number** is the first of them in name order (V-07 reports the others).
- **Entry.** Anything directly in F; two entries are **the same** when they have the same kind and the same blob or tree id. An entry is **changed** by the head when the head's entry is not the same as the base's, or the base has none.
- **Status, seal, supersedes.** The values of those keys of a readable record. `status` and `seal` count when their entry is a single value; `supersedes` counts as the list of its items that are four digits. A status **names** a record file when it is `superseded by NNNN` and a record file has the number NNNN.
- **Changed paths.** The paths of the files that differ between the two trees, as `git diff-tree -r` lists them, without rename detection; a directory replaced by a file or a link is listed as the files it held and the path of the new entry.
- **Lines.** For the comparison of two versions of a sealed record, the bytes split at each line feed (U+000A), kept exactly: no line ending is converted and no trailing white space is cut.

## The rules

A problem has a file (relative to F; none for the folder as a whole), a rule and a detail, as in the format page. The column "Kind" says what the rule needs: a **change** rule looks at both commits, a **state** rule at one commit, and is applied to the base and to the head.

| Rule | A problem is reported when | Kind | Detail |
| ---- | -------------------------- | ---- | ------ |
| P-01 | a record file of the base is not a record file of the head under the same name | change | |
| P-02 | a record sealed at the base is a record file of the head, its text has changed, and the change is not a status change | change | `line N` |
| P-03 | a record sealed at the base is a record file of the head, the change is a status change, and it is not the one allowed | change | `old -> new` |
| P-04 | a record has the status `superseded by NNNN` and the record of NNNN does not vouch for it | state | `NNNN: ` and the reason |
| P-05 | a sealed record lists a number in `supersedes` and the record of that number is not `superseded by` it | state | the listed number |
| P-06 | a record has the status `accepted` or `superseded by NNNN` and no seal that verifies | state | the reason |
| P-07 | a record has a `seal:` key and the status `proposed` or `rejected` | state | |
| P-08 | a path in the shared folder has changed | change | |
| P-09 | the base is not an ancestor of the head (or the same commit) | change | |
| P-10 | a record is sealed and its section `Errata` is not a chain of erratum entries | state | the first reason |
| P-11 | an erratum's new entry does not follow from the base | change | the first reason |
| P-12 | an erratum changes `applies-to`, `repos`, `window` or `supersedes` | change | the key |
| P-13 | an erratum changes the sealed text and has not been open for 48 hours | change | `Nh of 48h` or `no clock` |
| P-14 | a deviation note is wrong | change | the first reason |
| P-15 | a workflow file other than the kit's is added or changed and names the check | change | the path |
| P-16 | a record becomes sealed with the key `emergency` and does not replace a protocol record | change | |
| P-17 | a record becomes sealed and an item of its `applies-to` matches no file of the head | change | the item |
| P-18 | an item of an accepted record matched a file at the base and matches none at the head | change | the item |

- **P-01.** A record is never deleted, renamed, renumbered or moved, whatever its status. The file is the name at the base. It is also reported when the head's entry of that name is not a regular file, and when the head has no records folder at all.
- **P-02.** Compare the two versions as lines. If they are the same, nothing happened. Otherwise the change is a **status change** exactly when the lines differ at one index only, that index is the line of the `status` key in the base, the head's line at that index is a `status` key line, and the two status values differ. (A key line is `status:`, then nothing or a space and the rest; trailing spaces, tabs and a carriage return are cut off first, and the value is the rest without the spaces that follow the colon, as in the format page.) If the change is not a status change the text has changed and P-02 is reported. The detail is the index of the first line that differs, counted from 1; when one version is the start of the other, the number of the first line the shorter one lacks. A change of white space, of a line ending, of the `date`, of the `seal:` line: all of it is P-02. So is an added erratum or deviation entry, unless the change is exactly one of the two additions that [errata and deviation notes](errata-and-deviations.md#which-change-is-which) describe, which are acts and have rules of their own (P-10 to P-14).
- **P-03.** The status of a sealed record may change in one way: from `accepted` to `superseded by NNNN`. Every other status change is P-03, with the old and the new value as the detail (`accepted -> proposed`, `superseded by 0007 -> superseded by 0009`; an empty value is written `(empty)`). That the successor vouches for the new status is P-04, which is a state rule and applies to the head as it applies to any commit.
- **P-04.** The record of NNNN must exist and have a higher number than the record (otherwise V-20 reports it, and P-04 does not), must be sealed, and must list the number of this record in its `supersedes`. The detail is `NNNN: ` and the first reason that applies: `not sealed` or `does not list this record`. The successor may itself be `superseded by` another record: it was accepted, and it still says what it replaced. A record that g1 rejects (V-09) is not looked at.
- **P-05.** For a sealed record R and each item NNNN of its `supersedes` for which the record of NNNN exists and has a lower number than R (otherwise V-35 and V-36 report it): that record must have the status `superseded by` R's number (a record that is not readable has no status, so it does not). Each distinct number is reported once. So accepting a record that replaces others also changes the others, in the same change: the status vouching of record 0001 has two sides, and this is the second.
- **P-06.** The record is readable and its status is `accepted` or `superseded by NNNN`, and it is not sealed because the seal is missing (`no seal`), is from another generation (`unknown generation gN`) or does not match the text (`seal does not match`). A seal that is not a single value written `sha256-gN:` and 64 hexadecimal digits is V-22 or V-14, not P-06. A seal is created only under the generation of this kit (g1): any other fails closed.
- **P-07.** A seal on a record that is not accepted: a sealed record is never `proposed` again, and a seal is not written ahead of the acceptance.
- **P-08.** The shared folder is not looked at by this version, so any change in it fails: the file is the changed path relative to F (`shared/0003-x.md`). Checking shared records is M6 and M9.
- **P-09.** Nothing else is judged when P-09 is reported, because the comparison means nothing.
- **P-10 to P-14.** [Errata and deviation notes](errata-and-deviations.md) say what they mean, and which changes of a sealed record they judge. P-10 is a state rule like P-04 to P-07; the others are change rules.
- **P-15.** [The files of the check](protected-files.md#the-rule) says what it means. It has no file; its detail is the path of the workflow file.
- **P-16.** [The bar for an amendment](amendments.md#emergency) says what it means.
- **P-17, P-18.** [Where a record applies](applies-to.md) says what they mean and in which dialect the items are read. Their detail is the item.

### Format and commit rules in a change

The rules of the [format page](record-format.md) (V) and of [reading a commit](reading-a-commit.md) (T) are applied to the head and to the base, with the settings of the base, and a problem of the head is reported only if the change brings it:

- A head problem is **not reported** when the base has the same problem and either the problem has no file, or the head's entry of that file is the same as the base's. Two problems are the same when file and rule are the same, and the detail too for the rules whose detail is part of the answer (P-02 to P-07, T-02 and T-03); the detail of a V rule only helps the reader. So a records folder that already had problems can take a change that adds none: a problem is reported for what the change adds or touches. One consequence: V-08 has no file, so a gap that a change adds to a folder that already has a gap is not reported by it.
- A record **sealed at the base and still a record file of the head** is not judged by the content rules of the format: V-09 to V-19, V-21 to V-28 and V-35 to V-37 are not reported for it. What it says cannot change (P-02), and a stricter format later must not turn it red. The exceptions are the two additions of [errata and deviation notes](errata-and-deviations.md#the-rules): after an erratum all of them but V-10 are, and after a deviation note V-11, V-12, V-27 and V-28, each only when the base does not have the same problem. The rules that depend on other files stay: V-20 (the status names a record that exists and is higher), V-30 to V-34 (its row in the index), V-07, and the commit rules T-01 and T-02 (its mode and its attributes).
- The state rules P-04 to P-07 and P-10 follow the same rule: a problem of the head is not reported when the base has the same problem and the file is not changed, **or the change of the file is only a deviation note** ([errata and deviation notes](errata-and-deviations.md#the-rules)): a note changes nothing those rules read, and a note that a violation stops cannot excuse it.

A record **new** in the head, or **not sealed at the base and changed**, is judged by all rules: a record cannot enter with a format problem, and an acceptance cannot carry one. The one exception is a record that says `accepted` or `superseded by NNNN` and has no seal or a seal that does not match, when the change only adds a deviation note: it is judged as a note, with the content rules above ([errata and deviation notes](errata-and-deviations.md#which-change-is-which)).

## Acts

An **act** is a change the owners must approve. This page finds the acts; [the page on approvals](approvals.md) decides whether they are approved. Without the reviews of the pull request (`--reviews`) every act is unapproved, and `check-pr` fails when there is one.

| Act | Found when | Path |
| --- | ---------- | ---- |
| `accept` | a record file of the head is sealed at the head and is not sealed at the base: it is new, or it was not sealed there | the record |
| `erratum` | a record sealed at the base is changed as an erratum, whether or not it has a problem ([errata and deviation notes](errata-and-deviations.md)) | the record |
| `deviation` | a record sealed at the base gains deviation entries and nothing else | the record |
| `settings` | a changed path is the settings file, a folder in front of it, or something below it | `.github/record-keeper/settings.yml` |
| `owners` | the act `settings` is found, and the settings of the head (read as for the base) name other owners, by ID, or a lower `approvals`; met by [the bar for an amendment](amendments.md) | `.github/record-keeper/settings.yml` |
| `amendment` | a record becomes sealed and replaces a protocol record, or the protocol records named in the README change; met by [the bar](amendments.md); it replaces the act `accept` for that record | the record, or the README |
| `pin` | a changed path is the pin, a folder in front of it, or something below it | `.github/record-keeper.yml` |
| `workflow` | a changed path is one of the kit's workflow files, a folder in front of it, or something below it ([the files of the check](protected-files.md)) | that file |
| `code` | the same for the files the workflow runs | that file |

A record that is not sealed is never an acceptance. The acts `owners` and `amendment` are met by the bar for an amendment (all owners, seven days), not by the count of approvals: [that page](amendments.md) says how. The rules on `applies-to` (P-17, P-18) are on [their own page](applies-to.md).

## Problems in the settings

The settings of the base are what the check judges by, so a problem in them (the S rules) is a problem of the check, reported first:

- The problems of the settings of the **base** are reported, each with its line, unless the change is a **repair**.
- If the change touches the settings (the act `settings`), the problems of the settings of the **head** are reported too: a change must not leave settings the next check cannot read. A problem found in both is reported once.
- A change is a **repair** when the base's settings have a problem, there is at least one changed path, every changed path is the settings file, a folder in front of it, or something below it, and the head's settings have no problem. Without that exit every change would fail while the settings are broken, the one that repairs them included. A change that touches anything else must wait for the repair. A repair changes no record, so the records have nothing to report.

The records are judged by the base's settings in every case, with the default for a setting that has a problem.

## How a problem is reported

`record-keeper check-pr --base <revision> --head <revision> [--repo <path>] [--reviews <file> --author <id>] [--cases <file>] [--since <time>]` (the last two are those of [errata and deviation notes](errata-and-deviations.md#the-48-hours)) prints, on the error output, the problems of the settings (as `config` does), then one line for each problem, `<folder>/<file>: [P-02] <what is wrong> (<detail>)` (the folder alone for a problem without a file), then one line for each act that is not approved, `<path>: needs the owners' approval (accept)` (or `erratum`, `deviation`, `settings`, `pin`, `workflow`, `code`; for `owners` and `amendment` the line is `<path>: needs the amendment bar (<kind>): <reason>`, see [the bar](amendments.md#what-check-pr-prints)) (for the act `owners`: `<path>: needs the amendment bar, which this version cannot check (owners)`), then, when the reviews were given and there is an act, the line of the approvals ([approvals](approvals.md)), and last a count, `<folder>: N problems` (the problems of the settings included), with `, M acts` when there are acts, and ` approved` after them when all of them are. The lines come in this order: the problems of the settings by line (one without a line first), then rule, then detail; the problems of the records by file (one without a file first), then rule, then detail; the acts by kind (`accept`, `erratum`, `deviation`, `settings`, `owners`, `amendment`, `pin`, `workflow`, `code`), then path. Texts are ordered by their UTF-8 bytes. Names and details are printed as `validate` prints them ([the format page](record-format.md#how-a-problem-is-reported)): a control character in a file name is written out, not sent to the log. It exits 0 when there is no problem and no act that is not approved, in which case the line of the approvals and the count go to the standard output, 1 when there is at least one of either, and 2 for wrong usage: also when a revision names no commit, the repository cannot be read, `git` cannot be run, or the reviews cannot be read. `--repo` defaults to the current folder.

## What changes for the repositories

None of the maintainers' repositories installs the check yet, and none keeps a seal on a record: every record that says `accepted` has no `seal:`, so it is not sealed in the sense of this page until its repository seals it (M4 for the first, M6 for the others). Until then the check lets such a record stand and turns red when a change touches it (P-06, with the format problems of the record on top), unless the change only adds a deviation note. Run on copies of the default branches of the ten repositories that keep records (the Issue Concierge, the five action repositories, frodo-lib, frodo-cli, the umbrella repository and this one; the tap keeps only shared records), with the settings that frodo-lib (`folder: decisions`), frodo-cli (`shared-folder: core`) and the umbrella repository (`extra-keys: [repos]`) need:

- A change that adds a proposed record with its index row gives no problem in any of the ten, though frodo-cli already has 40 format problems: they are the base's.
- A change that edits the last record gives P-06 in nine of them (frodo-cli also V-14, because the edited file is judged whole), and nothing in this repository, whose only record is proposed.
- A change that deletes the last record gives P-01, V-08 and V-32 in all ten (frodo-cli also V-20, for the record that was superseded by the deleted one).

## What this does not do

- **It does not post the diff of an erratum, or read the history of the errata** (see [errata and deviation notes](errata-and-deviations.md#what-this-version-does-not-do)), and it does not judge that an amendment replaces the protocol in full ([the bar](amendments.md#what-this-does-not-do)). The acts above are the places where they plug in; the approvals are on [their own page](approvals.md).
- **It does not know that code moved,** only that the files an `applies-to` item matched are gone ([where a record applies](applies-to.md#what-this-does-not-do)).
- **It does not read the shared folder** (P-08), and it does not read the pin.
- **It does not look at the history between the commits**, only at the two trees. [The audit](audit.md) (M2.8) looks at the history.
- **It does not decide which commits are the base and the head.** [The workflow](workflow.md) (M2.5) does: the tip of the base branch and the head commit of the pull request.
- **It cannot stop two changes that are valid alone and invalid together** if the ruleset does not require an up-to-date branch; P-09 makes the stale one fail, and the ruleset makes the second one wait.

## Choices in this draft for you to decide

1. **A change is judged by what it adds or touches** (the rule under "Format and commit rules in a change"). A repository with older problems can install the check before it has fixed them, and a sealed record cannot be turned red by a stricter format later. The alternative is to judge the whole folder every time, which needs every old problem fixed before the check can be installed and breaks the agreed rule that format binds at acceptance.
2. **Any byte of a sealed record other than its status line is P-02,** also white space and line endings, which g1 would not see. 0001 says "any other change to a record is a violation, however small". The cost is that fixing a trailing space needs an erratum, which is an act ([errata and deviation notes](errata-and-deviations.md)).
3. **Superseding is two-sided and atomic:** a record is `superseded by` N only if N is sealed and lists it (P-04), and a sealed N that lists a record needs that record to be `superseded by` N (P-05). Accepting a replacement therefore flips the replaced records in the same change, and two replacements of one record cannot both be accepted.
4. **A repair of the settings is let through** when it touches nothing else (the rule above). The alternative, judging the repair against the last settings that read cleanly, needs the history; the alternative of the owners' approval alone would make a broken file wait for M2.4.
5. **Acts fail the command unless the owners approved them.** In M2.3 that meant always; with M2.4 and the reviews of the pull request, an act passes when enough owners approved the head commit.
6. **A stale head fails (P-09).** The ruleset's up-to-date branch would do it too, but the check has to be right where the ruleset is not set.
7. **A change in the shared folder fails (P-08).** A repository that has shared records cannot use the check until they are read; none of the first repositories does.

## The fixtures

[test/fixtures/change](../test/fixtures/change/README.md) holds `cases.json`: small repositories (a base tree) and for each case a head (a change to it), with the settings problems, problems and acts the check must report.
