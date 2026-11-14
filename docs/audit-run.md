# The audit run

Status: draft for review (M2.9b, with the announcements of M2.9c). This page says how the audit runs every night: the workflow, the program `run-audit.mjs` that asks GitHub for the evidence, plans with [the effects of the audit](audit-effects.md) and carries the plan out, the branch `record-keeper/log` that it writes, what it does when it cannot run, and what a repository must set. It is not part of the protocol. It is the second program of the kit that talks to the network, and the only one that writes. [The audit](audit.md) and [its effects](audit-effects.md) say what is found and what is planned; this page is the plumbing between them and GitHub.

Two files make the run. `.github/workflows/records-audit.yml` is the workflow. `run-audit.mjs` is the program it runs. Both are guarded as acts ([the files of the check](protected-files.md)). `check-pull-request.mjs`, which runs with a token that only reads for any pull request, has no code that writes; this one has, and nothing else runs with its token.

## What the workflow is

- **Three triggers:** `schedule` (every night at 03:17 UTC), `push` to the default branch (`main` in this repository), and `workflow_dispatch` with the input `dry-run` (a boolean, false by default). A scheduled workflow runs from the default branch, and so does a push to it; nothing a pull request holds is ever run by this workflow.
- **One job, named `Records audit`,** with no `if:`. It is not a required check: nothing waits for it, and it fails while a violation stands.
- **A token that writes what it must and no more:** `contents: write` (the log branch), `issues: write` (the incident issues), `pull-requests: read` (the reviews) and `checks: read` (when the check first ran), and nothing else. The permissions of the workflow are none; the job asks for these four.
- **One run at a time.** The concurrency group is `records-audit` and a run in progress is never cancelled. A run that waits is replaced by a newer one that waits: each run audits the whole history, so the newest is enough.
- **The default branch, with its whole history.** The job checks out `github.event.repository.default_branch` with `fetch-depth: 0`. The credentials of the checkout stay, because the program pushes the log branch with them. The audit refuses a shallow clone.
- **Nothing from the event goes into a shell.** The repository reaches the program as an environment variable; the input `dry-run` as another. Every action is pinned to a commit, the same two as the tests use.

## What the program does

`node run-audit.mjs --repo <owner/name> [--dry-run]`, in a clone of the default branch whose `origin` is that repository, with the token in `GITHUB_TOKEN` and, when it is not GitHub.com, the address of the API in `GITHUB_API_URL`. In this order:

1. **Read the repository** (`GET /repos/{repo}`): the name of its default branch.
2. **Ask the audit for the acts:** `audit --json --adopted --head HEAD` ([the effects](audit-effects.md#the-result-as-data---json)). The distinct commits of its `acts` are the commits that need evidence. More than 300 of them is a reason not to run (below).
3. **Collect the evidence** for each of those commits, one after the other:
   1. `GET /repos/{repo}/commits/{id}/pulls?per_page=100`, every page. GitHub names the pull requests that contain the commit, also those it only sits in.
   2. **Choose the pull request.** Only a pull request that is **merged and was made against the default branch** is a candidate: a pull request against another branch gated nothing here. If exactly one candidate has the commit as its `merge_commit_sha`, that is the one. Otherwise, if there is exactly one candidate, that is the one. If there is none, there is no pull request (`"pull": null`). If there are several and none has the commit as its merge commit, the run **stops** and says which ([When it cannot run](#when-it-cannot-run)).
   3. For the one chosen: its reviews (`GET /repos/{repo}/pulls/{number}/reviews?per_page=100`, every page, kept as pages) and the time the check `Records integrity` first ran on its head commit (`GET /repos/{repo}/commits/{head}/check-runs?check_name=Records%20integrity&filter=all&per_page=100`, every page; the earliest `started_at` of a run of that name by the app `github-actions`, or `null` when there is none). The pull request check takes the time of now when there is none; the audit does not, because a check that never ran is the finding.
   4. The entry is `{ "pull": { "number", "user": { "id" } or null, "head": { "sha" }, "merged_at" }, "started", "reviews" }`, or `{ "pull": null, "started": null, "reviews": [] }`. These are the fields [the evidence file](audit-effects.md#evidence---evidence-file) reads.
4. **Read the issues** that the bot wrote: `GET /repos/{repo}/issues?state=all&creator=github-actions%5Bbot%5D&per_page=100`, every page, kept as pages. The filter only makes the list short; the plan trusts what is in the answer, not the filter.
5. **Plan:** `audit-plan --head HEAD --adopted --evidence <evidence> --issues <issues> --now <the time of the run>`. The files are held in memory and never written. The time is the clock of the runner, written like `2026-11-12T03:17:05Z`.
6. **Plan the announcements** ([announcements](announcements.md)): `announce-plan --head HEAD --adopted --evidence <evidence> --issues <issues> --logins <logins> --now <the time of the run>`, first with an empty `logins` object. When the plan has `lookups`, the run reads each account, once, in ascending order (`GET /user/{id}`: the `login` of a 200, `null` for a 404, anything else is a reason not to run), and plans again with the answers. The files are held in memory.
7. **Say what the audit says:** what `audit --adopted --evidence` prints for the same history, on the standard output and the standard error, so that the job log shows the violations that stand, also when no issue has changed.
8. **A dry run stops here.** It prints what it would do (below) and writes nothing: no log, no issue. It has read the accounts, as a read.
9. **Write the log** ([the log branch](#the-log-branch)): the entries of the plan, the lines of the announcements and the record of the run.
10. **Make a fresh connection,** with one more `GET /repos/{repo}`: the audit and the log took their time, and a connection that the server closed meanwhile would fail the first write. Then **carry out the issue actions** of the plan, in its order: `open` is `POST /repos/{repo}/issues` with `title` and `body`; `update` is `PATCH /repos/{repo}/issues/{number}` with `title` and `body`; `reopen` is the same with `state: "open"`; `close` is `PATCH` with `state: "closed"`, `state_reason` `completed` (`not_planned` for a duplicate) and `body`. Then **one `POST /repos/{repo}/issues` for each announcement**, in the order of the plan, with `title` and `body`, **a second apart** (the first at once): GitHub asks a client that makes several issues to wait between them. A request that GitHub refuses ends the run with 2; the announcements that were not made are made by the next run, which finds the issues that exist.
11. **Print the summary and end.** The exit status is 1 when the plan says `failed`, otherwise 0. An announcement never changes it.

The log is written before any issue is touched: if an issue request fails, the run ends with 2 and the next run plans the same effect again, so the log may then repeat an event but never lose one. That holds for the announcements too: the line of an announcement that was not made is written again by the run that makes it.

### What it prints

After the lines of step 7, one line for each action of the plan: `opened <key> #<number>`, `updated <key> #<number>`, `reopened <key> #<number>`, `closed <key> #<number>` (`would open <key>`, `would update <key> #<number>` and so on in a dry run), and one for each announcement, `announced <commit> #<number>` (`would announce <commit>`). Then, in a run that wrote, `log: <n> entries and the record of the run pushed to record-keeper/log`, or `log: the record of the run pushed to record-keeper/log` when there is no entry; in a dry run `dry run: nothing was written`.

## The log branch

The branch is `record-keeper/log`. It holds, at its root:

| File | What |
| ---- | ---- |
| `incidents.jsonl` | The entries of the `log` of every plan, one JSON document on each line, appended. Never rewritten by the program. |
| `announcements.jsonl` | The `log` of every plan of announcements, one JSON document on each line, appended. Made by the first announcement; a run that announces nothing leaves it as it is. |
| `last-run.json` | The `run` of the last plan, one line, replaced at every run. It is what the setup check (M3) reads to see that the audit runs. |
| `README.md` | Written when the branch is made: what the files are. |

- **One commit for each run,** also when the plan has no entry: the record of the run changes every time. The commit has the author and the committer `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`, the time of the run, and the message `Audit of <head> at <at>: <violations> violations, <entries> entries` (`1 violation` and `1 entry` in the singular), with `, <n> announcements` (`1 announcement`) added when the run announced something.
- **The commit is made without a work tree,** from the blobs and trees of git itself, on top of the tip of the branch as the remote has it. The first run makes the branch with no parent. The clone is left as it was, but for git objects and, once the branch exists, the ref `refs/record-keeper/log` that holds the tip that was fetched.
- **A push is never forced.** If the remote refuses it because the branch moved, the program fetches the new tip, builds the commit again on top of it (the entries are appended to the file as it now is) and pushes again, three times at most. A refusal for any other reason, or a third refusal, ends the run with 2.
- **A file that does not end in a line feed** gets one before the entries are appended, so a line that was cut short stays a line of its own.
- Nothing is read back from the branch for any decision. The audit judges the history of the default branch; the log is a record that a run leaves, and anyone with write access can add to it ([the design](design.md#the-nightly-audit-and-the-log)).
- Every run adds a commit to the repository, which GitHub counts as activity: this keeps the scheduled workflow from being disabled for inactivity. That is documented for activity in general and not tested here.

## When it cannot run

The program ends with the status 2 and prints `Records audit could not run:` and a reason. The job fails. The reasons:

| Reason | When |
| ------ | ---- |
| `no token` | `GITHUB_TOKEN` is empty or missing. |
| `repository: must be owner/name`, `API address: ...` | as for [the pull request check](workflow.md#when-the-check-cannot-run). |
| `GET <path> answered <status>`, `GET <path> failed: <why>` | as for the pull request check: anything but 200; no answer, 30 seconds, or a redirect (never followed). A `GET` whose connection was reset (a connection that the server closed while the program computed) is made once more first. |
| `<method> <path> answered <status>`, `<method> <path> failed: <why>` | a request that writes was refused (anything but 200 or 201) or got no answer. It is never made again: it may have been received. |
| `the answer to <path> is not what the audit needs` | not JSON, not a list where one is needed, or a field the audit reads is missing or of the wrong kind. |
| `the link to the next page is not the API`, `more than 200 pages of <what>` | as for the pull request check. |
| `the audit could not read the history: <message>` | the audit exited with 2: the repository is a shallow clone, no commit holds the settings file, a revision is not a commit. |
| `more than 300 commits with acts` | the evidence would take more requests than a token may make in an hour. |
| `several merged pull requests name the commit <id>: #<a>, #<b>` | step 3.2. |
| `git <command> failed: <message>` | git could not do what the log needs, with its message printed without control characters. |
| `could not push the log after 3 attempts` | the branch moved every time. |
| `logins.json: <id>: is neither a login nor null` | GitHub gave a login that does not have the form of one (the account of an owner or a witness is an app, for example). Nothing is written. |

A failure of the kit's own commands is the same as when a person runs them: `audit` and `audit-plan` end with 2 for input they cannot use ([the effects](audit-effects.md)).

## What a repository must set

- **The ruleset on `record-keeper/log`:** no deletion and no force push, nothing else. The program makes the branch, so creation must not be restricted; it only adds commits, so updates must not be. The branch does not have to exist when the ruleset is made.
- **That the token of the workflow may write** `contents` and `issues`: the workflow asks for them in its own file, so a repository whose default is read-only needs no change, but an organisation that forbids the permission at all would stop the run (with a `403` and a reason).
- **The settings file with the owners** ([settings](settings.md)); the audit starts at the commit that adopted the kit.
- **The pull request check** (`Records integrity`) on pull requests, and the ruleset that requires it: the audit reads when it first ran.

## What was verified on GitHub

On 2026-11-11, by asking GitHub for the pull requests of this repository, read only:

- **E11, which pull request contains a commit.** For the merge commit of a pull request, `GET /commits/{id}/pulls` named that one pull request within a minute of the merge, with the commit as its `merge_commit_sha`. For a commit that sits in the branch of a merged pull request it named the pull request too, with another `merge_commit_sha`. For the first commit of the repository, which was pushed, it named none.
- **E12, the bot.** The issues that `github-actions[bot]` wrote in other repositories of the organisation have `user.login` `github-actions[bot]`, `user.type` `Bot` and `user.id` `41898282`. `GET /issues?creator=github-actions%5Bbot%5D` returned only those, where the list without the filter held 70 pull requests among 71 entries.
- **The check runs** named `Records integrity` are on the head commit of the pull request and not on its merge commit (0 on the merge commit).

On 2026-11-13, with the workflow on `main` (it ran on Node 24 with npm 11.19.1; the audit itself took about 11 seconds):

- **E13, a manual run with `dry-run` set** (run 43363416280): green. It printed `audit: 0 violations, 0 excused, 11 commits judged` and `dry run: nothing was written`, and the tip of `record-keeper/log` was the same before and after.
- **E14, real runs.** The first real run was the one that the merge of #43 started (run 43363306423, see E16). It made `record-keeper/log`: one commit with no parent, written by `github-actions[bot]`, with `README.md`, an empty `incidents.jsonl` and `last-run.json`. A second run by hand (43363494921) added one commit on the first, replaced `last-run.json` and left `incidents.jsonl` as it was; no issue was opened, as there was no incident. The ruleset on the branch was made after these two runs. A third run by hand (43363991402) then added a commit under it, and the push was not refused. The ruleset has the rules `deletion` and `non_fast_forward` for `refs/heads/record-keeper/log` and no actor who may bypass it; `GET /rules/branches/record-keeper/log` lists exactly those two, and the branch is reported as protected.
- **E16, the run that a push starts right after a merge.** The merge was at 04:06:21Z and the run was created at 04:06:23Z. The merge commit changes `records-audit.yml`, `record-keeper.mjs` and `run-audit.mjs`, so it is an act, and the run judged it with #43 as its pull request and reported no violation. Had GitHub not yet named the pull request, the commit would have failed with `no pull request`. GitHub named it at once, as E11 had shown.

On 2026-11-14:

- **E15, the first scheduled run** (run 43586180525). The slot is `17 3 * * *`, and the run was created at **10:37:41Z, seven hours and twenty minutes after 03:17Z**: GitHub starts a scheduled run when it can, not at its minute, and no other run of that day was a scheduled one. It ran the code of the default branch of that moment (568c7be, before the announcements), judged 12 commits, found 0 violations, and added one commit to `record-keeper/log` (`Audit of 568c7be… : 0 violations, 0 entries`). A reader of `last-run.json` must therefore allow many hours of delay before it calls a night missed.
- **E17, the first announcements** (run 43622516977, started by the push of the merge of #46, 17:41:59Z; the run before it, started by the merge of #45 at 17:25:35Z, ran the code without announcements and wrote none). The run printed `audit: 0 violations, 0 excused, 14 commits judged`, opened **nine issues, #47 to #55**, between 17:42:24Z and 17:42:36Z (about one and a half seconds apart: the second that the run waits plus the request), and added one commit to the log branch that says `0 violations, 0 entries, 9 announcements`. Nine, and not the eight that were expected: the merge of #46 is an act itself (`code`), the run checks out that merge commit, and so it announced itself, as #55. What was read from GitHub afterwards:
  - **The author** of each issue is `github-actions[bot]`, `user.type` `Bot`, `author_association` `NONE`; no label, no assignee, no comment; all open.
  - **The text** is the one that `announce-plan` prints. The `Told` line of each is `@<owner> and @<owner> (owners)`, with the current logins that `GET /user/<id>` gave; `witnesses` is empty. The titles are `Act: workflow, code (#33)`, `Act: code (#35)`, `(#36)`, `(#37)`, `(#38)`, `Act: code (#42)`, `Act: workflow, code (#43)`, `Act: code (#45)` and `Act: code (#46)`.
  - **The sizes** are from 3,334 to 36,923 characters; none reached the room of 40,000, so no diff was cut (the phrases `... n more lines` and `The room of this issue is used` are in #55 only as lines of the program that its diff shows). No control character is in any body, and every fence is closed.
  - **The rendering** (`body_html` of #47, #53 and #55): one code block for each act (three in #47 and #53), the two owners as mentions, and the marker comment not visible.
  - **`announcements.jsonl`** on the log branch has nine lines, each with `event` `announced`, the full id of the commit, the acts (a commit with two files of code has two entries) and `told` with the two ids of the owners.
- **E18, a second run changes nothing.** A run by hand with `dry-run` set (run 43622711851, 17:44Z, two minutes after E17) judged the 14 commits again and printed no `would announce` and no `would open`: the nine markers were read back from the issues of GitHub, in any state, and the plan had nothing to open. This is the only memory that the announcements have.

**Still to run:** that the owners were notified (a mention by the bot reaches the owner's notifications and, if the owner has chosen it, mail; only the owner can say), and that a witness who is not an owner is told; the repository has none yet.

## What this does not do

- **It does not announce** an act that was not approved, or an acceptance ([announcements](announcements.md#what-this-does-not-do)).
- **It does not ping a monitor outside the repository** (a dead-man's switch is a later option), and it does not read `last-run.json` back; the setup check (M3) does.
- **It does not keep the evidence of earlier runs.** Every run asks again for every commit with an act, which is why there is a limit.
- **It does not restrict who writes the log branch.** The ruleset keeps its history; it cannot keep a person with write access from adding to it, because the token of a workflow cannot be put on the list of those who may.
- **It does not read a pull request that is not merged,** or one made against another branch.
- **It does not repair anything.** It opens and closes its own issues and adds to its own branch.

## Choices in this draft for you to decide

1. **A new file, `run-audit.mjs`,** and not a second mode of `check-pull-request.mjs` or a command of the rules file (decided). The cost is one more file to guard and to pin; the HTTP code of the two programs is written twice on purpose, so that each can be read alone.
2. **The log first, then the issues** (decided).
3. **Several merged pull requests and none whose merge commit is the commit: stop** (decided).
4. **The log is pushed with git** (decided), from objects made without a work tree.
5. **Pull requests against another branch do not count.** A commit pushed to the default branch cannot be cleared by a pull request that went into a branch the ruleset does not guard.
6. **A check that never ran is `started: null`,** which makes an erratum or an amendment fail with `no clock`, where the pull request check would wait from now.
7. **Every run commits `last-run.json`,** a commit a night and one for each push, which is the heartbeat and may keep the schedule alive. The alternative, writing it only when something changed, would make the age of the file meaningless.
8. **The job fails while a violation stands** (decided), also on nights when nothing changed.
9. **The nightly time is 03:17 UTC** and the push trigger names `main`; a repository with another default branch changes the file, which is an act.
10. **The run stops at 300 commits with acts.** A repository with more needs a cache of the evidence, which is not built.

## The tests

[test/audit-workflow.test.mjs](../test/audit-workflow.test.mjs) reads the workflow file and states, as tests, what is written above: the triggers, the job name, the absence of `if:`, the four permissions, the concurrency, the pinned actions, the checkout of the default branch with its whole history, and that no expression of the event reaches a `run:`. [test/audit-run.test.mjs](../test/audit-run.test.mjs) runs the program against a local server that plays GitHub and against git repositories, the histories of [the fixtures of the effects](../test/fixtures/audit-effects/README.md): each case that has a plan is run from the history to the requests that the server sees and the branch that the remote holds, and each reason of the table is shown.
