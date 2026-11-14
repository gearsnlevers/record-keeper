# The audit

Status: draft for review (M2.8). This page says what `record-keeper audit` finds when it reads the whole history of a repository. It is the core of the nightly audit that [the design](design.md#the-nightly-audit-and-the-log) describes: plain code that reads git and answers. What runs it every night, the issues it opens, the log it keeps and the announcements are [the effects](audit-effects.md), [the run](audit-run.md) and [the announcements](announcements.md); this page is only what the code finds. It is not part of the protocol. It is read with [checking a change](checking-a-change.md), whose rules it replays.

The pull request check judges a change before it is merged. It does not see a push that went round it (an administrator's bypass, a ruleset that was off for an hour), a rewritten history, or a change that was merged after a check that could not run. The audit looks again, from the commits themselves, at what the default branch really holds.

## What it reads

`record-keeper audit --head <revision> [--from <commit>] [--since <commit>] [--repo <path>]`:

- **`--head`**: the commit to audit, normally the tip of the default branch.
- **`--from`**: the commit where the protocol began in this repository (the commit that adopted the kit). History up to it is not judged, because the rules did not exist; its tree is the base of the next commit. Without it the history is judged from the first commit, against an empty tree.
- **`--since`**: the last commit that was audited. Commits up to it are not judged again. It is a speed-up and no more: a nightly run leaves it out, so that the whole history from `--from` is judged every night and a pointer moved past a bad commit hides nothing.
- Both are the **full id** of a commit (40 or 64 hexadecimal digits), which the audit wrote down earlier. A repository that is a shallow clone cannot be audited: the history it lacks would look like commits that add everything (exit status 2).

## What it judges

1. **Every commit** on the first-parent history of the head after `--from` and `--since`, oldest first, against its **first parent** (against an empty tree for a first commit). A merge commit is the net change of its pull request; a direct push is a commit of its own. The rules are those of `check-pr`, run by the same code ([checking a change](checking-a-change.md)), with what only a pull request knows taken out:
   - There are **no reviews**, so no act is judged approved or not. The acts of the commit are **listed** (below) and left to M2.9, which asks GitHub for the reviews.
   - The **48 hours** of an erratum (P-13) are not judged: the time a commit was first seen cannot be read from git.
   - A cited **issue or pull request** is taken to exist (P-14 does not report `case does not resolve` for them): M2.9 asks GitHub. A cited **commit** is judged, against the first parent of the commit.
2. **The register of record numbers.** The audit lists every addition of a record file in the records folder over the whole history (also before `--from` and up to `--since`), and keeps the first name that each number had. A record file added under a number with another name is **A-02**, at the commit that adds it. The same name coming back (a revert of a deletion) is not.
3. **The tip.** The integrity rules for the tree of the head, as a state: P-04 to P-07 and P-10 (the seal of an accepted record, the vouching of supersession, the chain of Errata) and, for each accepted record, an item of `applies-to` that matches no regular file (the rule of P-18 as a state, reported as **P-19**). A format rule (V, T) is not a state rule here: the format binds when a record is accepted, and a stricter format later does not turn old records red. A problem of the tip that **one of the commits judged already reported** (the same record, rule and detail) is not repeated: it is the same violation, and it carries that commit's excuse. A problem that no commit judged explains (it predates `--from`, or there is no `--from` and the history is outside what the rules covered) is reported at the tip.

### History that has been rewritten

If `--from` or `--since` is not a commit of the history of the head (it was never there, or it is no longer reachable, or the repository does not have it), that is **A-01**: the history was rewritten, or the repository is not the one that was audited. The audit then judges from the other bound, or from the first commit, so that the violations are found anyway.

## What a note excuses

A violation of a record at a commit is **excused** when the section `Known deviations` of that record, **at the tip**, holds a well-formed note ([errata and deviation notes](errata-and-deviations.md)) whose `case` names the commit:

| Case | Names the commits whose |
| ---- | ----------------------- |
| `commit HEX` | id is exactly `HEX` |
| `pull N` | subject starts with `Merge pull request #N ` or ends with `(#N)` (GitHub's messages for a merge and a squash) |
| `issue N` | message mentions `#N`, as a word: not followed by a digit and not part of another word |

A note can be added after the fact to a record that the violation left without a seal that verifies: the pull request that adds it is judged as a note, and does not repeat the problems the record already had ([errata and deviation notes](errata-and-deviations.md#which-change-is-which)). A record with a seal from another generation, or whose seal is not a seal, takes no note.

Only violations **of that record** are excused: a violation with no record (a problem of the folder, of the settings, of a workflow file, A-01) cannot be excused by a note, nor can another record's. An excused violation is not counted; it is listed, with the note, so that the log can show what was excused. A note does not excuse a later violation of the same record: that is another commit.

## What it returns

For each violation: the commit, the file (a record, or none), the rule, the detail, and where it was found (`commit`, `state` for the tip, `register`, `history`). For each commit judged: the **acts** it carries (kind and path, and the number of the pull request if the subject names one: `Merge pull request #N` or `(#N)`) and the **cases** (issues and pull requests) that its new notes cite, which M2.9 checks on GitHub. Violations come oldest commit first, then by file, rule and detail as bytes; those of the tip last.

The command prints one line for each violation, `<12 hex digits of the commit>: <file>: [<rule>] <what is wrong> (<detail>)`, then `audit: N violations, M excused, K commits judged`. It exits 0 when there is no violation, 1 when there is one, and 2 for wrong usage, a repository it cannot read, a shallow clone, or a revision that names no commit.

| Rule | A violation is reported when | Detail |
| ---- | ---------------------------- | ------ |
| A-01 | `--from` or `--since` is not in the history of the head | `from` or `since`, and the id |
| A-02 | a record file is added under a number that another file name already had | `NNNN: old name -> new name` |
| A-03 | an act of a commit was not approved: with the evidence of [the effects of the audit](audit-effects.md), it came in with no pull request or with too few approvals or too soon | `<kind> <path>: <reason>` |
| P-19 | an accepted record has an `applies-to` item that no file of the tip matches, and no commit judged reported its loss | the item |

## What this does not do

- **It does not know whether an act was approved**, unless it is given the evidence for it ([the effects of the audit](audit-effects.md#evidence---evidence-file)). Without it the acts are listed.
- **It does not check the 48 hours** of an erratum, or that a cited issue or pull request exists. Both need GitHub.
- **It does not read the installed text that agents read, or hash the workflow files against a manifest.** The design lists both; they need the pin and the installed files of M3 and M4.
- **It does not judge a history that is not on the first-parent line.** What a pull request did inside its branch is not on the default branch; its net change is.
- **It is not fast on a long history.** Every commit is read and judged. A repository with thousands of commits takes minutes; a push can use `--since`, the nightly run does not.
- **It does not repair anything.** It writes nothing, anywhere.

## Choices in this draft (decided)

1. **First-parent commits, judged by the rules of the pull request check,** minus what a pull request alone knows. One rule set, so the audit and the check cannot disagree.
2. **The tip is judged by the integrity rules only,** and a tip problem that a commit already reported is not repeated.
3. **A note excuses by the commit it names,** with `pull` and `issue` mapped to commits by their messages.
4. **The acts of the history are listed and verified by M2.9,** not judged here.
5. **`--from` is a bound the audit is given.** The core has no memory of its own; the adoption commit and the last audited commit come from the log branch in M2.9.

## The fixtures

[test/fixtures/audit](../test/fixtures/audit/README.md) holds small histories (a list of commits, each with its parents and its changes to a tree) and the violations, the excused violations, the acts and the cases that the audit must return for them.
