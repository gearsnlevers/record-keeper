# What the audit does with what it finds

Status: draft for review (M2.9a). This page is the offline half of the audit's effects. [The audit](audit.md) reads the history and lists violations and acts. This page says how the acts are checked against the reviews of the pull requests that merged them, and how the violations become a **plan**: which incident issues to open, update, reopen or close, which lines to append to the incident log, and what to write as the record of the run. It is plain code that reads git and files and prints a plan. It reads nothing from GitHub and writes nothing anywhere. The program that asks GitHub for the evidence and carries the plan out, and the workflow that runs it every night, are M2.9b; the announcements are M2.9c. This page is not part of the protocol. It is read with [the audit](audit.md), whose rules it extends, and with [the owners' approval](approvals.md), whose counting it reuses.

## How the pieces fit

M2.9b will run, in this order, in a full clone of the default branch:

1. `record-keeper audit --json --adopted --head HEAD`: the violations and **the acts**, with the commit that carries each.
2. For each commit that carries an act, ask GitHub which merged pull request contains it, what its reviews are and when the check first ran on its head. Write that down as the **evidence file**.
3. `record-keeper audit-plan ...` with the evidence and the **issues** that exist: the plan.
4. Do what the plan says, and exit with a failure while a violation stands.

Steps 1 and 3 are this page. Between them there is only a file, so every rule below can be tested with files and no network.

## Where the audit starts: `--adopted`

`audit --adopted` takes the place of `--from`. It starts the audit at **the commit that adopted the kit**: the oldest commit on the first-parent history of the head whose tree holds the settings file ([settings](settings.md)) as a regular file (mode `100644` or `100755`). That commit is not judged and its tree is the base of the next, as for `--from`. History before it was not under the rules.

- It is derived and not configured: anyone can recompute it from the history, and it is not stored where a writer could move it. The cost is that the audit cannot tell that the early history was rewritten; the pointer to the last audited commit, which the program keeps, catches that ([the audit](audit.md#history-that-has-been-rewritten)).
- `--adopted` and `--from` together are a usage error (exit status 2). A history in which no commit holds the settings file is not an adopted repository: `audit --adopted` prints `record-keeper: no commit of the history holds .github/record-keeper/settings.yml` and exits with 2.
- The result of the audit gains the field `from`: the full id that was used, or `null` when there was none.

## The result as data: `--json`

`audit --json` prints the result of the audit as one JSON document on one line and exits with 0 whatever it holds (2 for anything unreadable). The document is the object `{ "head", "from", "folder", "judged", "violations", "excused", "acts", "cases" }` that [the audit](audit.md#what-it-returns) returns, in this order: `from` is the full id the audit started at or `null`, and each violation is `{ "commit", "kind", "file", "rule", "detail" }`, with `line` for a violation of the settings. The program reads the commits that carry acts from it.

## Evidence: `--evidence <file>`

Without evidence the audit lists the acts of every commit and does not judge whether they were approved ([the audit](audit.md#what-it-judges)). With `--evidence <file>` it does. The file is one JSON document: an object whose keys are full commit ids (40 or 64 hexadecimal digits, in lower case) and whose values have exactly these keys:

| Key | Value |
| --- | ----- |
| `pull` | `null` when no merged pull request contains the commit; otherwise the pull request as GitHub's REST API returns it, of which these fields are read: `number` (positive integer), `user.id` (positive integer, or `null` for an account that was deleted), `head.sha` (full commit id), `merged_at` (a time like `2026-11-07T12:00:00Z`) |
| `started` | the time the check `Records integrity` first ran on `head.sha`, written like `merged_at`, or `null` when it never ran |
| `reviews` | the reviews of the pull request as GitHub returns them, a list or a list of pages, exactly as for `--reviews` of `check-pr` ([approvals](approvals.md#what-the-caller-gives)); `[]` when `pull` is `null` |

A file that does not fit is **unreadable**: the audit prints `record-keeper: <file>: <reason>` and exits with 2, as it does for `--reviews`. The reasons, the first that applies, with the entry named by its key:

| Reason | When |
| ------ | ---- |
| `is not one JSON document` | the bytes are not UTF-8 or not one JSON document |
| `is not an object` | the document is not an object |
| `<key>: is not a full commit id` | a key is not 40 or 64 lower-case hexadecimal digits |
| `<key>: is not an object with the keys pull, reviews and started` | a value is not an object, or its keys are not exactly those three |
| `<key>: pull: is not null or an object` | `pull` is neither |
| `<key>: pull: number is not a positive integer` | `number` is not one |
| `<key>: pull: user is neither null nor an object with a positive integer id` | `user` is |
| `<key>: pull: head.sha is not a full commit id` | `head.sha` is missing or not one |
| `<key>: pull: merged_at is not a time like 2026-11-07T12:00:00Z` | `merged_at` is missing or not one |
| `<key>: started: is neither null nor a time like 2026-11-07T12:00:00Z` | `started` is |
| `<key>: reviews: <reason>` | `reviews` does not fit; the reason is that of `--reviews` |

The entries are read in the order of their keys as bytes. A number is a positive integer when it is a JSON number that is a whole number from 1 to 2^53 - 1.

- **Every commit that carries an act needs an entry.** With evidence given, a commit with an act and no entry is not a violation but an error: the audit prints `record-keeper: no evidence for the commit <id>` and exits with 2. A run that could not collect its evidence fails and says so. It does not accuse. Entries for commits without an act are ignored.
- **Which pull request.** The program passes the merged pull request that GitHub names for the commit. The audit does not check that the pull request's merge commit is the commit: a rebase merge puts several commits of one pull request on the branch.
- **Reviews after the merge do not count.** A review whose `submitted_at` is later than `merged_at` is left out before the count. An approval that arrives after the merge approves nothing that was checked.

## A-03: an act that was not approved

For a commit that carries acts, with evidence given, the audit judges the same change again with what only the pull request knew: it runs the code of `check-pr` ([checking a change](checking-a-change.md)) with the author, the reviews, the clock and the head commit of the evidence. Settings are those of the base, as always. Then:

- **The head commit** the reviews must name is `head.sha` of the pull request, not the commit on the branch: a squash or a rebase gives the branch a commit that no review names.
- **The clock** starts at `started`. Where `check-pr` uses "now", the audit uses `merged_at`. So an erratum that changes the seal is also judged for its 48 hours (**P-13**, reported with its own rule and detail, as the pull request check does), and an amendment for its seven days. Without `started`, `P-13` says `no clock`, and the bar for an amendment says `no clock`.
- **The issues and pull requests that a note cites** are still taken to exist, as in the audit without evidence.

Each act of the commit that is not met is a violation of the rule **A-03**, found at that commit, with the detail `<kind> <path>: <reason>`:

| Reason | When |
| ------ | ---- |
| `no pull request` | `pull` is `null`: the act reached the branch some other way (a direct push, a bypass) |
| `<n> of <m> approvals` | an act of any kind but `owners` and `amendment`: `n` owners count, `m` are needed |
| `<n> of <m> owners` | an `owners` or `amendment` act: the owners' count is below every owner |
| `<h>h of 168h` | the owners all approve, and the last approval came less than seven days after `started` |
| `no owners`, `no clock` | the bar cannot be met: the settings name no owner, or `started` is `null` |

The wording of the last three is that of `check-pr`, which prints them for the same cause. A violation of **A-03** has the file of the act when the act is one of a record (`accept`, `erratum`, `deviation`, `amendment` of a record file), so a `Known deviations` note of that record that names the commit excuses it, as it excuses any violation of that record ([the audit](audit.md#what-a-note-excuses)). For an act of the settings, the pin, the workflow files or the code the file is `null`, and nothing excuses it but a revert.

## The plan: `audit-plan`

```
record-keeper audit-plan --head <revision> [--adopted | --from <id>] [--since <id>] [--repo <path>]
                         [--evidence <file>] --issues <file> --now <time>
```

The audit options are those of `audit` (`--adopted` and `--from` together are a usage error here too). `--issues` is a file with the **issues of the repository** as GitHub returns them, a list or a list of pages. An entry with a `pull_request` key is a pull request and is ignored. Of an issue these fields are read: `number` (a positive integer), `state` (`open` or `closed`), `title` (text), `body` (text or `null`) and `user` (`null`, or an object with the text `login` and the text `type`). `--now` is the time of the run, like `2026-11-10T03:00:00Z`; anything else is a usage error. A file that does not fit is unreadable, as above, with the reasons `is not one JSON document`, `is not a list`, `mixes issues and pages`, and `entry <n>: <why>` with `is not an object`, `number is not a positive integer`, `state is neither open nor closed`, `title is not text`, `body is neither null nor text` or `user is neither null nor an object with the text login and type`, counted from 1 over the flattened entries.

It prints one JSON document and exits with 0. **Its exit status is not the verdict**: the program has to carry out the plan also when a violation stands. The verdict is the field `failed`. The status is 2 for anything unreadable, as for `audit`.

```
{ "run":    { "at", "head", "from", "judged", "violations", "excused" },
  "failed": true | false,
  "issues": [ { "action", "key", "number"?, "title", "body" } ],
  "log":    [ { "at", "event", "key", "violations": [ ... ] } ] }
```

with the keys in this order and no white space but the one inside texts. `failed` is true when `violations` is not 0: when any violation stands that no note excuses.

### Which issue is whose: keys, markers, trust

- **The incident key** of a violation is `<subject>:<rule>`, where the subject is the four digits of the number of the record when the file of the violation is a record file, `other` when it is another file, and `-` when it has none. So there is **one issue for each record and each rule**; all the files that are not records share one for each rule.
- **The marker** of a key is the line `<!-- record-keeper:incident <key> -->`, the first line of the body of the issue. An issue belongs to a key when the first line of its body is exactly that marker (below).
- **Only an issue that the bot wrote counts.** The author of an issue is trusted when its `user.type` is `Bot` and its `user.login` is `github-actions[bot]`. An issue with a marker and another author is not an issue of the audit: the plan does not read it, does not change it and does not count it. Anyone can open an issue that carries a marker; if they could make the audit update theirs, they could also make it close the real one.

### What the plan says about each key

For every key that has a violation, or has an open issue of the audit:

| The key has | The plan has |
| ----------- | ------------ |
| a violation, no issue of the audit | `open` |
| a violation, and an open issue (the one with the lowest number if there are several) whose title or body differs from the one the audit would write | `update` that issue, with `number` |
| a violation, and an open issue that has the same title and body | nothing |
| a violation, and only closed issues | `reopen` the one with the lowest number, with the title and body |
| no violation, and an open issue | `close` every open issue of the key, with `body` the text of a resolved issue |
| a violation, and more than one open issue | the one with the lowest number as above, and `close` for each other, with `body` the marker and `Duplicate of #<number>.` |
| no violation, and no open issue | nothing |

An `open` has no `number`; a `close` has no `title`; every other action has both. The actions come in the order of the keys, as bytes, and for one key in the order `open`, `reopen`, `update`, `close`, with equal actions in the order of their numbers.

**The title** is `Records: <label>: [<rule>] <what>`, where the label is the number of the record, `other files` or `the repository`, and `<what>` is the text of the rule as the audit prints it ([the audit](audit.md#what-it-returns)). Every violation of a key has the rule of the key, so the title is the same for all of them.

**The body** is the marker, a line that says what the issue is, an empty line, and one line for each violation of the key in the order of the audit, each ending in a line feed:

```
<!-- record-keeper:incident 0012:P-02 -->
The audit of the default branch found this. It is updated on every run and closed when the violation no longer stands. To resolve it: revert the commit, add an erratum to the record, or add a note to its Known deviations that names the commit.

- 9f2c1d0b...: docs/decisions/0012-the-name.md: [P-02] is sealed and its text has changed
```

A violation line is `- <place>: <where>: [<rule>] <what>`, and ` (<detail>)` when there is one, as `audit` prints it, except that `<place>` is the whole commit id, `the tip <id of the head>` for a violation of the state, and `the history` for a rewritten one. A violation of the settings has the settings path (and `:<line>` when it has one) as `<where>`, a violation with no file the records folder, and any other the path of the file in it. The full id is there so that GitHub links it.

A **resolved** issue has the marker, a line feed, and `No violation of this kind stands. Closed by the audit.` and a line feed. A **duplicate** has the marker, a line feed, and `Duplicate of #<number>.` and a line feed.

An issue whose first line is the marker, read up to the first line feed with one carriage return before it taken off, belongs to the key; GitHub keeps the line endings that were written.

### The log and the run record

For each action in the plan the `log` has one entry, in the same order: `{"at": <now>, "event": <event>, "key": <key>, "violations": [...]}` with `event` `opened`, `reopened`, `changed` (for `update`) or `closed`. `violations` are the violations of the key, each as `{"commit", "kind", "file", "rule", "detail"}` in the order of the audit, and `[]` for `closed`. The `detail` of a violation of a rule of the format (a rule that begins with `V-`) is `""` in the log and absent from the line of the body: the pages do not say what the format rules put there, and the text of an issue should not change with the version of the kit. A duplicate that is closed has the extra key `"duplicate"` with the number it duplicates, before `violations`. M2.9b appends each entry to `incidents.jsonl` on the branch `record-keeper/log`, one line each.

`run` is what M2.9b writes as `last-run.json`: `at` is `--now`; `head` the full id of the head; `from` the full id the audit started at, or `null`; `judged`, `violations` and `excused` the counts of the audit. It is what the setup check (M3) reads to see that the audit runs, and what shows the age of the last run.

## What this does not do

- **It does not read GitHub.** Which pull request contains a commit, its reviews and the start of the check are the program's to ask; this page says what it must hand over.
- **It does not write an issue, a branch or a status.** The plan is data.
- **It does not announce.** An act that was approved is not mentioned; the announcement issues are M2.9c.
- **It does not read a pull request that is not merged.** Evidence is only for what reached the branch.
- **It does not know whether the bot is the author of an issue.** It believes the fields of the issues file. That the file is GitHub's answer is the program's to see to.
- **It does not remember anything.** Every run plans from the whole history and the issues as they are; the log and the last-run record are written, never read.

## Choices in this draft for you to decide

1. **Evidence is a file the program makes, not a call the audit makes.** The audit stays free of the network and of a token, as the rest of `record-keeper.mjs`. The cost is a second step in the program and a file format to keep in step.
2. **An act with no pull request is a violation, whoever pushed it.** In the single-owner mode too: the author counts as an approval of a pull request, not of a push. The audit exists to see what went round the check.
3. **A missing entry is an error, not a violation.** A run that could not collect its evidence fails with 2, and the failure is visible, but nobody is accused of what the program failed to read.
4. **Reviews after the merge do not count, and the clock stops at the merge.** The alternative, the live reviews as of the audit, would let an approval after the fact make an old violation disappear.
5. **One issue for each record and rule, not each commit.** A record changed in three commits has one issue with three lines. The alternative, one issue for each commit, is more to read and more to close.
6. **A violation that returns reopens the old issue** and does not open a new one, so the history of one problem stays on one page. Duplicates are closed.
7. **The files that are not records share an issue for each rule,** whatever their names, so that a marker never holds a name that could break out of the comment.
8. **The verdict is a field, not the exit status,** so that the program can always carry out the plan.
9. **Only `github-actions[bot]` is trusted** as the author. A deployment that uses an app of its own would need a setting; none exists yet.

## The fixtures

[test/fixtures/audit-effects](../test/fixtures/audit-effects/README.md) holds histories, evidence files, issues files and the plans that the audit must print for them.
