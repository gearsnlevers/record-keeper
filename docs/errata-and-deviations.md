# Errata and deviations

Status: draft for review (M2.6). This page says what `record-keeper check-pr` does with the two additions that [record 0001](decisions/0001-accepted-records-are-sealed-and-change-only-by-supersession-or-erratum.md) allows to a sealed record besides a change of its status: an **erratum**, which corrects sealed text and the seal with it, and an entry in **Known deviations**, which notes a case in which the record was not followed. Until now both were reported as P-02. It also fixes the **form of the two kinds of entry**, which neither the record nor the design specified, and the **48 hours** that an erratum must stay open. It is not part of the protocol; it is how the kit enforces it, and [checking a change](checking-a-change.md) is read with it.

Three things come from outside the two commits, and the kit has no network code ([the workflow](workflow.md) reads them): whether a cited issue or pull request exists (`--cases`), and since when the head commit has been open (`--since`). The third, whether a cited commit is in the history of the base, is read from git.

## The entries

An erratum is a pull request that changes the text of a sealed record, writes the new seal, and adds one entry to the section `## Errata`. A deviation note is a pull request that adds entries to the section `## Known deviations` and changes nothing else. The sections are the ones of the [format](record-format.md) and of [generation g1](generation-g1.md); both are outside the seal, which is why they can grow. An entry is a block of lines:

```text
## Known deviations

### Deviation 1

- date: 2026-11-07
- case: pull 28
- reason: The check did not run while the ruleset was being set up.

## Errata

### Erratum 1

- date: 2026-11-08
- previous entry: none
- previous seal: sha256-g1:<64 hexadecimal digits>
- seal: sha256-g1:<64 hexadecimal digits>
- reason: A link in the Decision pointed to a page that was renamed.
```

- **An entry** starts at a heading line that is exactly `### Deviation N` or `### Erratum N` (N a number from 1 to 9999 without a leading zero, as many as there are entries before it, plus one) and ends at the last non-empty line before the next entry, the next section or the end of the text. The line after the heading is empty. Then come the key lines, in the order shown, with no empty line between them: each is `- `, the name of the key, `: `, and a value without a space at either end. No other line belongs to an entry, and a line that is in no entry is *text outside an entry*.
- **`date`** is a real calendar date written `YYYY-MM-DD`. It is the day of the entry, not a check on one: the date key of the record, which is outside the seal, does not change.
- **`reason`** is one line of 1 to 500 characters.
- **`case`** (a deviation) is one of `issue N`, `pull N` (N from 1 to 999999999 without a leading zero) or `commit` followed by a space and 40 or 64 lower case hexadecimal digits. It names an issue, a pull request or a commit **of this repository**.
- **`previous entry`** (an erratum) is `none` for the first entry, and otherwise the **hash of the entry before**: `sha256:` and 64 lower case hexadecimal digits, the SHA-256 of the lines of that entry, from its heading to its last non-empty line, each line followed by one line feed (the lines as g1 reads them: CRLF read as LF, no space or tab at the end of a line).
- **`previous seal`, `seal`** are seals as the format page writes them, `sha256-g1:` and 64 digits. The new seal is the seal of the record after the erratum; the previous seal is the one the record had before. So the entries of `Errata` form a chain from the seal at acceptance to the seal now.

The section `Errata` of a sealed record is a **chain** when its entries are numbered from 1 in order, each has the keys of an erratum, the first has `previous entry: none`, each later one names the hash of the one before and has as its previous seal the seal of the one before, and the last one has as its seal the `seal:` of the record. A section with no entry is a chain of no entries. Nothing in the section outside the entries is allowed. For the section `Known deviations` the kit only reads **what a change adds**: a record may have been accepted with text in that section, and that text is left alone.

## Which change is which

For a record that is sealed at the base and a record file of the head, with bytes that differ, the lines of the two versions (the bytes split at each line feed, as in [checking a change](checking-a-change.md#the-rules)) are cut into the two **excluded sections** and the **rest**, which is everything else: the front matter, the other sections, the title. A section runs as g1 says. The change is, in this order:

1. **A status change**, when it is one by P-02 (one line differs, the status line). Unchanged.
2. **A deviation note**, when the rest is identical to the base's, byte for byte, the section `Errata` is identical (both without it, or the same lines), and the section `Known deviations` differs.
3. **An erratum**, when the section `Errata` differs, the section `Known deviations` is identical, and the key lines `status` and `date` of the head are the ones of the base. The rest may differ in anything else, `seal:` included.
4. **Anything else is P-02**, as before, with the number of the first line that differs. That includes a head that g1 rejects (it is no erratum, and V-09 is not asked of a sealed record), a change of the text without an entry, a change of the status together with the text, and a pull request that changes both sections of one record.

**A record that does not verify.** The list is for a record that is sealed at the base. A record that says `accepted` or `superseded by NNNN` and has no seal, or a seal that does not match its text (P-06, `no seal` and `seal does not match`), has no sealed text left to protect. It can still have a violation to excuse: the commit that edited it, or that accepted it without a seal. So the change (2) is also a deviation note when the **base** record is of that kind, with the same test: the rest identical to the base's byte for byte, the section `Errata` identical, the section `Known deviations` different. It is judged like every note (P-14, the same format rules, the act `deviation`), and nothing else is allowed in the same change: an erratum, a change of the status or of the text, or a note together with any of them is a change to a record that does not verify, and P-06 is reported as before. A seal from another generation (`unknown generation`) and a seal that is not a seal at all (V-14, V-22) are not of that kind: this version does not know where their sections are, so any change fails.

The rest of this page is about (2) and (3).

## The rules

The five rules are in the table of [checking a change](checking-a-change.md#the-rules) (P-10 to P-14), with the other P rules. Here is what each one says.

- **P-10** (state). A record is sealed and its section `Errata` is not a chain. It is judged like the other state rules, at the head and at the base, and not reported when the base has the same problem and the file is unchanged. The detail is the first of these, going through the entries in order:
  - `text outside an entry`;
  - `entry N: number: expected N`;
  - `entry N: keys: expected date, previous entry, previous seal, seal, reason`;
  - `entry N: date: not a date`;
  - `entry N: previous entry: expected none` (the first) or `entry N: previous entry: expected sha256:...` (the hash it must be);
  - `entry N: previous seal: not a seal` (the first) or `entry N: previous seal: expected sha256-g1:...` (the seal of the entry before);
  - `entry N: seal: not a seal`;
  - `entry N: reason: empty or too long`;
  - and, after the last entry, `seal: the last entry is not the seal of the record`.
- **P-11** (change). An erratum is the change (3) and its relation to the base is wrong. The first of: `earlier entry changed` (the lines of the section `Errata` of the base are not the first lines of the head's section); `not one new entry` (the head's section has other than one entry more than the base's); `previous seal: expected sha256-g1:...` (the new entry does not name the **seal of the base** as its previous seal); `no change of the text` (the rest, leaving out the `seal:` line, is the same as the base's). Whether the new entry is well formed is P-10's: it is judged at the head like any entry.
- **P-12** (change). For each of `applies-to`, `repos`, `window` and `supersedes` (the names compared in lower case) whose entry, the key line and the lines it owns, is not the same in both versions, present in one and not in the other included. The detail is the key. Changing one of them is a new record, not an erratum.
- **P-13** (change). The head's seal, computed from its text, is not the base's seal: the sealed text has changed, and not only in what g1 does not see. The change then needs to have been open for 48 hours, counted from the time given by `--since` to now. The detail is the whole hours it has been open and `of 48h`, or `no clock` when `--since` was not given. A change that leaves the seal as it is (trailing spaces, line endings, blank lines) needs no wait.
- **P-14** (change). A deviation note is the change (2), and it is wrong. The detail is, for the whole section, the first of `earlier entry changed` (the base's lines of the section are not the first lines of the head's) `text outside an entry` (a line after those that is in no entry) and `no new entry` (the section differs and gained no entry); otherwise, for each new entry that has a fault, `entry K: ` (K counts the new entries from 1) and the first of: `number: expected N` (one more than the greatest N of a line `### Deviation N` in the base's section, 0 if none, then one more for each new entry), `keys: expected date, case, reason`, `date: not a date`, `case: expected issue N, pull N or commit HEX`, `reason: empty or too long`, and `case does not resolve`.

- **Old problems and a note.** For a record whose change is a deviation note, a state problem (P-04 to P-07, P-10) that the base has too is **not reported again**, as for a record that the change does not touch: a note changes nothing those rules read, and a note that cannot be added to a record with a violation cannot excuse that violation ([the audit](audit.md#what-a-note-excuses)). A state problem that the change brings is reported as ever.

A case **resolves** when, in this repository:

- `issue N`: `--cases` lists N under `issue`. `pull N`: under `pull`. Without `--cases` no issue and no pull request resolves. The caller states them ([the workflow](workflow.md) asks GitHub); an issue is not a pull request, though GitHub numbers them together.
- `commit HEX`: the commit exists and is the base commit or one of its ancestors. The base is the tip of the branch the pull request goes into, which is the default branch for the pull request that matters; the commit has to be there already, not in the change itself.

The format rules of the head, V, apply as follows to a record that one of these changes touches. For an erratum all the content rules of the format page apply to the head as they do to a record that is not sealed, **except V-10**, the length, which is judged when a record is accepted. For a deviation note only V-11 and V-12 (a credential, an e-mail address), V-27 (the order of the sections) and V-28 (a section without content) apply, also to a record that does not verify. In both cases a problem that the base has too, for the same file and rule, is not reported: an erratum may correct a record that had one. The rules of the index (V-30 to V-34) and the commit rules apply as they always do.

## The acts

| Act | Found when | Path |
| --- | ---------- | ---- |
| `erratum` | a record file is the change (3), whether or not it has a problem | the record |
| `deviation` | a record file is the change (2), whether or not it has a problem | the record |

Both are approved as an acceptance is ([approvals](approvals.md)); the order of the acts is `accept`, `erratum`, `deviation`, `settings`, `owners`, `pin`. Two records changed in one pull request are two acts.

## The 48 hours

An erratum that changes the sealed text stays open at least 48 hours, so that the people who follow the repository can see it ([record 0001](decisions/0001-accepted-records-are-sealed-and-change-only-by-supersession-or-erratum.md)). The kit counts: P-13 is reported while the time from `--since` to now is under 48 hours (172,800 seconds), and `--since` must be a UTC time written `YYYY-MM-DDTHH:MM:SSZ`. What `--since` is, is for the caller. [The workflow](workflow.md) gives it the **start of the first run of the check `Records integrity` on the head commit**, which GitHub records and the author of the change cannot move. So the clock **starts again with every push**: a change that is swapped for another one after 48 hours has to wait again. An owner presses Re-run after the 48 hours, as for an approval, and the result replaces the one that failed. No such run in the list counts as no time at all. Two limits: a commit that was already the head of another pull request, or of a branch that ran the check, counts from its first run there, because it could be seen then; and the runs of a pull request from a fork are not tested yet (the check runs of such a head have not been read on GitHub).

## What `needs` prints

`record-keeper needs --base <revision> --head <revision> [--repo <path>]` runs the same judgment and prints what the caller has to look up, one line each, in this order: a line `case issue N` or `case pull N` for each distinct issue or pull request in a well-formed new deviation entry (by number, issues first), and the line `clock` when there is an erratum that changes the seal, or an act of [the bar for an amendment](amendments.md) that its record does not waive. It prints nothing when the change needs nothing, and exits 0; it exits 2 for wrong usage and when the repository cannot be read, as `check-pr` does. [The workflow](workflow.md) calls it first, asks GitHub, writes the answers to a file and calls `check-pr` with `--cases` and `--since`.

`--cases <file>` is a JSON object `{"issue": [12, 15], "pull": [4]}` with exactly these two keys, each a list of at most 1000 distinct numbers (1 to 999999999), the ones that exist in this repository as an issue and as a pull request. A file that does not fit is exit status 2, as for `--reviews`.

## What this version does not do

- **It does not post the diff of an erratum.** The design has the check comment on the pull request. The check has a token that only reads, and a write permission for the one job that decides is the thing [the workflow](workflow.md) refused. The announcement by a bot with its own identity belongs to M2.9; until then the diff is the diff of the pull request.
- **It does not ask whether a case is the cause of anything.** A case has to exist. Which violation it excuses, and that it excuses no later one, is for the audit to match against the history (M2.8). Citing the pull request that adds the note is not refused here.
- **It does not read the history of a record.** That the first previous seal is the seal at acceptance and that no earlier entry was ever rewritten is for the audit; the check compares the two commits.
- **It does not protect the workflow, the settings or the pin** beyond finding them as acts ([the files of the check](protected-files.md)).

## Choices in this draft for you to decide

1. **The form of an entry** is a heading and a list of `- key: value` lines with the keys in a fixed order, not a table, a sentence or YAML. A fixed order and one line each make the hash of an entry the hash of lines anyone can cut out, and keep the subset of YAML out of the body of a record. The numbers in the headings make "append only" something a person can see.
2. **The hash of an entry lives on this page, not in generation g1.** g1 fixes how a region is cut and hashed; it does not read the sections it cuts out. The cost is that the chain is a rule of the kit that, once record 0001 is accepted, changes only like the protocol does, by amendment. The alternative is to add it to the g1 page, which is frozen at acceptance and has [test vectors](../test/vectors/g1/README.md) for every rule.
3. **A whitespace-only erratum is one that leaves the seal as it is.** 0001 says an erratum that changes "more than whitespace" waits 48 hours. Whitespace is then exactly what g1 does not see. A change of two spaces to one, or of the indentation of a list, changes the seal and waits. The alternative is a rule about white space of its own, which needs a second normal form that someone has to keep in step with g1's.
4. **One erratum for a record in one pull request,** and a pull request that changes both sections of a record, or an erratum and a status, is P-02. Two entries in one commit would need a seal for a text that no commit holds, and the chain would not be checkable from the commits.
5. **Any number of deviation entries in one pull request.** They have no seals to chain.
6. **The date of the record does not change with an erratum** (it is outside the seal and a change to it is P-02, as before). The entry has its own date.
7. **The format rules for an erratum are all of them but the length, and for a deviation note the two about secrets and the two about the section.** The erratum rewrites the text and the head has to be a record that could have been accepted. A deviation note leaves the sealed text alone, so the rules about what that text says are not asked again; it adds a section, so where the section stands and that it has something in it are.
8. **The base, not the default branch, is the history a commit case is read in.** For a pull request into the default branch they are the same; for one into another branch the commit has to be in that branch.
9. **The clock is the first run of the check on the head commit, not the creation of the pull request.** With the creation time the clock cannot move but a change can be swapped after 48 hours; with the first run it restarts with every push. The cost is one more permission for the token of the workflow, `checks: read`, and one more request when the change is an erratum that changes the seal. A commit that was already a branch with runs earlier counts from there: it was visible then.
10. **No diff comment in this version** (above). The 48 hours are counted, not announced.
11. **A case in another repository is not a case.** The key does not take `owner/repo#N`; a note about a violation in this repository cites something in this repository, as 0001 says.
12. **A note may be added to a record that has no seal or a seal that does not match.** [The design](design.md#the-nightly-audit-and-the-log) names three ways out of a violation: a revert, an erratum, a note. Without this, a direct push that edited a sealed record could be resolved by a revert only, because the pull request that adds the note changes a record that does not verify and so repeats P-06. The alternative is to keep that, and a note excuses nothing that broke a seal. Two limits, both fail-closed: an erratum needs a seal to start its chain from, so there is none for such a record; and a seal of another generation, or one that is not a seal, is not read, because the sections are g1's.
13. **A note leaves the old state problems of its record alone** (above), also for a sealed record: a chain of Errata that is already broken (P-10) does not stop a note either. The alternative, to repeat them only for records that do not verify, would give one rule for two cases that differ in nothing the note touches.

## The fixtures

[test/fixtures/change](../test/fixtures/change/README.md) holds the cases of the change rules, among them the errata and the deviation notes (the groups `r`, `k`, `s` and `x`), with the `cases`, the `since` and the `now` they are judged with and the `needs` they must give; commit cases name a base commit by its id, which the generator fills in. The cases of `needs` and of the files `--cases` and `--since`, and the lookups of the workflow, are in the tests of the commands ([the program](../test/github.test.mjs)).
