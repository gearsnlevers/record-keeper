# Announcing an act

Status: draft for review (M2.9c). An act of the owners must not go unseen by an owner. [The audit](audit.md) finds the acts that reached the default branch and [the effects](audit-effects.md) judge whether the owners approved them. This page says how an act that was approved is **announced**: the audit opens an issue, written by the bot, with the diff and the pull request, and mentions the owners and the `witnesses`. Because the author is `github-actions[bot]`, GitHub notifies an owner even when the act was made with that owner's own token. That is the second pair of eyes in the single-owner mode, and the main protection against a stolen token ([the design](design.md#the-nightly-audit-and-the-log)).

An announcement is made for every repository and cannot be switched off. Deleting an announcement does not recall the notification; and the next run opens the issue again.

## What is announced

| Act | Announced |
| --- | --------- |
| `erratum`, `deviation` | yes |
| `amendment` | yes |
| `owners`, `settings` | yes (a change of the owners is also a change of the settings) |
| `pin`, `workflow`, `code` | yes |
| `accept` | no: it needs the owners' approvals, and it shows in the pull request like any new record |

An act of a commit is **announced** when its kind is in the table and the audit found no violation of [A-03](audit-effects.md#a-03-an-act-that-was-not-approved) for it, standing or excused by a note. A violation of A-03 has its own issue, the incident; an announcement says that the owners approved. A commit with no announced act has no announcement.

## One issue for each commit

An announcement is **one issue for each commit** that carries announced acts, with all of its announced acts in it. A merge that changed a workflow file and two code files is one issue, not three.

- **The key** is the full id of the commit (40 or 64 lower-case hexadecimal digits).
- **The marker** is the line `<!-- record-keeper:announcement <key> -->`, the first line of the body. An issue belongs to a key when the first line of its body is exactly that marker, read up to the first line feed with one carriage return before it taken off, as for the incidents ([the plan](audit-effects.md#which-issue-is-whose-keys-markers-trust)).
- **Only an issue that the bot wrote counts**, by the same rule as the incidents (`user.type` `Bot`, `user.login` `github-actions[bot]`). An issue with a marker and another author is not read: the audit opens its own.
- **An announcement is opened once and never changed.** If the key has an issue in any state, open or closed, the plan has nothing for it; if there is none, the plan opens one. Closing an announcement means "seen". Deleting one opens it again at the next run.

## Where it starts and how many

The audit starts at the commit that adopted the kit ([`--adopted`](audit-effects.md#where-the-audit-starts---adopted)), so the first run that announces opens an issue for every announced act since then that has no issue yet. There is no other state: a run that fails halfway leaves the rest for the next run.

**At most 20 issues are opened by one run**: those of the oldest commits. The others wait for the next run, which is the next night or the next push. The limit keeps a repository with a long history from opening hundreds of issues at once.

## The command: `announce-plan`

```
record-keeper announce-plan --head <revision> --adopted [--repo <path>] --evidence <file>
                            --issues <file> --logins <file> --now <time>
```

The options are those of `audit-plan`, with `--adopted` and `--evidence` required (without evidence nothing can be said to have been approved), plus `--logins`. It prints one JSON document and exits with 0 whatever the plan holds; 2 for anything unreadable or a missing required option. The files are read in this order, and the first that does not fit is the answer: the evidence, the issues, the logins; then the history is audited (a history with no adoption commit, or a commit that carries an act and has no entry in the evidence, is 2 too, with the messages of `audit-plan`).

```
{ "announcements": [ { "key", "title", "body" } ],
  "log":           [ { "at", "event", "key", "acts", "told" } ],
  "lookups":       [ 1001, 1002 ] }
```

with the keys in this order and no white space but the one inside texts. `announcements` are the issues to **open**, oldest commit first, at most 20. `log` has one entry for each, in the same order: `{"at": <now>, "event": "announced", "key": <key>, "acts": [{"kind", "path"}, ...], "told": [<id>, ...]}`, with the acts in the order of the audit and `told` the ids of the accounts that the issue mentions, in the order of the text.

**`--logins`** is a JSON object whose keys are account ids written as decimal numbers (a digit from 1 to 9 and at most 14 more, as in the settings) and whose values are the **current login** of the account, text, or `null` for an account that GitHub does not know any more. The settings write an owner as `login/id`, and the id is what identifies the account: the login may have been renamed, and the old name may belong to somebody else now. The program looks the ids up (`GET /user/<id>`) and hands the answers over. A value that is text but not a login (the form of the login of an owner: 1 to 39 letters, digits and single hyphens, not starting or ending with a hyphen) makes the file **unreadable**, so that nothing that comes from the network is put into the text of an issue unchecked. The reasons, the first that applies: `is not one JSON document`, `is not an object`, `<key>: is not an id`, `<key>: is neither a login nor null`.

**`lookups`** are the ids that the announcements to open need and that the file does not have, in ascending order, once each. The program runs the plan once with an empty object, looks up the `lookups`, and runs it again; the second answer has none. A plan that has `lookups` has told nobody it could not name: it writes `login/id (not looked up)` for them.

## Whom it tells

For each announcement, the accounts of **both** the base (the first parent) and the commit itself:

- **the owners** of the settings of the base and of the commit, each account once (by its id), and
- **the `witnesses`** of both, each account once, except those that are owners.

So a change of the owners tells the owner who is removed as well as the new one, and a change of `witnesses` tells the witness who was dropped. The settings are read as the check reads them ([settings](settings.md)); a settings file that is not read gives the defaults, which name nobody.

The text writes `@<login>` with the **current login** from `--logins` for an account that is found. An account whose value is `null` is not mentioned: it is written `<login>/<id> (no longer an account)`, with the login of the settings. When nobody is told the line says so.

## The text of the issue

The title is `Act: <kinds> (#<number>)`, where the kinds are those of the announced acts, each once, in the order `erratum`, `deviation`, `settings`, `owners`, `amendment`, `pin`, `workflow`, `code`, separated by a comma and a space, and `<number>` is the number of the pull request that the evidence names for the commit.

The body is, with `<` and `>` standing for what is filled in:

```
<!-- record-keeper:announcement <key> -->
The owners approved an act that is now on the default branch. The audit opens this issue once for each commit and does not change it. Close it when you have seen it.

- Commit: <key>
- Pull request: #<number>
- Acts: <kind> <path>, <kind> <path>
- Told: @<login> and @<login> (owners), @<login> (witnesses)

### <kind> <path>

```diff
<the diff>
```
```

- **`Acts`** lists every announced act of the commit as `<kind> <path>`, in the order of the audit, separated by a comma and a space; a path is written as the audit writes it, with a control or format character shown as `\u{...}`.
- **`Told`** lists the owners and then the witnesses (a group with no account is left out). A group is its accounts in the order of their ids, each written `@<login>`, or `<login>/<id> (no longer an account)` when the value in `--logins` is `null`, or `<login>/<id> (not looked up)` when the file has no value for it. The accounts of a group are joined by a comma and a space, except the last, which is joined by ` and `, and the group ends with ` (owners)` or ` (witnesses)`. The two groups are joined by a comma and a space. There is always an owner to tell: an act is announced only when owners of the base approved it.
- **One section for each announced act**, in the order of `Acts`, headed `### <kind> <path>`, with a diff block.
- **The diff** is what `git diff --no-color --no-ext-diff --no-textconv --no-renames --text --full-index --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --unified=3 <first parent> <commit> -- :(literal)<path>` prints. The options make the diff the same for every clone and every configuration of git; `--text` is there for a reason of its own: a commit that changes a file and marks it as binary (`-diff`) in its `.gitattributes` would otherwise show `Binary files differ` and hide the change from the owners. What git adds after the `@@` of a hunk (the last line before it that starts with a letter) follows the attributes of the clone. Control and format characters other than line feeds and tabs are written as `\u{...}`, so that nothing in a diff can hide text or move the reader. The fence is a run of backticks one longer than the longest run in the diff and at least three, so that the diff cannot end the block. A diff that git prints as `Binary files ... differ` is shown as it is; an empty diff (for a file whose bytes are the same) is replaced by the line `No text changed; see the commit.`
- **The room**: all the diffs of one issue together may have 40,000 characters (Unicode code points, a line feed counted for each line). A diff that does not fit is cut after the last whole line that does, and followed by the line `... <n> more lines; see the commit.` (`n` counts the lines left out). The acts after that get no diff block, only the line `The room of this issue is used; see the commit.` under their heading (an act whose diff is empty still gets its line `No text changed; see the commit.`). When not even the first line of a diff fits, that act gets the same line, and the room is used.
- **Nothing in the text comes from the network but the logins**, and those are checked.

## What the audit run does with it

[The audit run](audit-run.md) calls `announce-plan` after `audit-plan`. In this order: the log is written first, as before, with the lines of the incidents in `incidents.jsonl` and the lines of the announcements in `announcements.jsonl` (the file is made by the first announcement); then the issues of the incidents; then one `POST` for each announcement, **a second apart**, as GitHub asks of a client that makes several issues. A `POST` that GitHub refuses fails the run with a reason, as for an incident, and the announcements that are left are opened by the next run.

The announcement is not a reason for the job to fail, and does not change `failed`.

## What this does not do

- **It does not announce an act that was not approved.** That is an incident ([the plan](audit-effects.md#the-plan-audit-plan)).
- **It does not announce an `accept`.** The acceptance of a record is in its pull request and in the index.
- **It does not know that anybody read it.** GitHub notifies a mentioned account and an owner who watches the repository; whether the mail is read is not the audit's to tell.
- **It does not change or close an announcement.** The text of an issue that was opened is what it was.
- **It does not read the log branch.** Nothing is remembered but the issues themselves.
- **It does not announce to an account that the settings do not name.** A person who watches the repository sees the issue, as for any issue.

## Choices in this draft for you to decide

1. **The acts of the design plus `settings` and `code`.** The design names the erratum, the deviation, the amendment, and changes to the owners, `approvals`, the pin and the workflow files. The kit also guards its own program files (`code`) and every other change of the settings. Both can weaken the check as much as a workflow can, so they are announced. The acceptance of a record is not. Decided on 2026-11-13.
2. **One issue for each commit.** Decided on 2026-11-13.
3. **No state: the issues are the memory,** and the first run opens every announcement that is missing since the adoption. Decided on 2026-11-13. The cost is a run of issues once in a repository that has acts already; the benefit is that a deleted announcement comes back, and that nobody can start the announcements later than they began.
4. **A mention follows the account, not the name.** The login is looked up by the id in the settings. Decided on 2026-11-13.
5. **At most 20 issues for each run.** An answer to "what if a repository adopts the kit with a long history" that I added; the rest waits for the next run.
6. **The base and the commit are both told.** A change of the owners must tell the owner who is removed, who is not in the settings of the commit.
7. **Only the approved acts are announced,** and an act that A-03 excused is not. The note that excuses it is an act of its own and is announced.
8. **The log of the announcements is a file of its own,** `announcements.jsonl`, so that `incidents.jsonl` is still what its name says.
9. **The diff is in the issue and cut at 40,000 characters.** GitHub allows 65,536 for a body; the rest is for the lines around the diffs.
10. **A second between two issues.** GitHub asks it of a client that makes several; the run is slower by that much.

## The fixtures

[test/fixtures/announce](../test/fixtures/announce/README.md) holds histories, evidence files, issues files, logins files and the plans that `announce-plan` must print for them.
