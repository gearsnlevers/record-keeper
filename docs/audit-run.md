# The audit run

Status: draft for review (M2.9b). This page says how the audit runs every night: the workflow, the program `run-audit.mjs` that asks GitHub for the evidence, plans with [the effects of the audit](audit-effects.md) and carries the plan out, the branch `record-keeper/log` that it writes, what it does when it cannot run, and what a repository must set. It is not part of the protocol. It is the second program of the kit that talks to the network, and the only one that writes. [The audit](audit.md) and [its effects](audit-effects.md) say what is found and what is planned; this page is the plumbing between them and GitHub.

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
6. **Say what the audit says:** what `audit --adopted --evidence` prints for the same history, on the standard output and the standard error, so that the job log shows the violations that stand, also when no issue has changed.
7. **A dry run stops here.** It prints what it would do (below) and writes nothing: no log, no issue.
8. **Write the log** ([the log branch](#the-log-branch)): the entries of the plan and the record of the run.
9. **Carry out the issue actions** of the plan, in its order: `open` is `POST /repos/{repo}/issues` with `title` and `body`; `update` is `PATCH /repos/{repo}/issues/{number}` with `title` and `body`; `reopen` is the same with `state: "open"`; `close` is `PATCH` with `state: "closed"`, `state_reason` `completed` (`not_planned` for a duplicate) and `body`.
10. **Print the summary and end.** The exit status is 1 when the plan says `failed`, otherwise 0.

The log is written before any issue is touched: if an issue request fails, the run ends with 2 and the next run plans the same effect again, so the log may then repeat an event but never lose one.

### What it prints

After the lines of step 6, one line for each action of the plan: `opened <key> #<number>`, `updated <key> #<number>`, `reopened <key> #<number>`, `closed <key> #<number>` (`would open <key>`, `would update <key> #<number>` and so on in a dry run). Then, in a run that wrote, `log: <n> entries and the record of the run pushed to record-keeper/log`, or `log: the record of the run pushed to record-keeper/log` when there is no entry; in a dry run `dry run: nothing was written`.

## The log branch

The branch is `record-keeper/log`. It holds, at its root:

| File | What |
| ---- | ---- |
| `incidents.jsonl` | The entries of the `log` of every plan, one JSON document on each line, appended. Never rewritten by the program. |
| `last-run.json` | The `run` of the last plan, one line, replaced at every run. It is what the setup check (M3) reads to see that the audit runs. |
| `README.md` | Written when the branch is made: what the two files are. |

- **One commit for each run,** also when the plan has no entry: the record of the run changes every time. The commit has the author and the committer `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`, the time of the run, and the message `Audit of <head> at <at>: <violations> violations, <entries> entries` (`1 violation` and `1 entry` in the singular).
- **The commit is made without a work tree,** from the blobs and trees of git itself, on top of the tip of the branch as the remote has it. The first run makes the branch with no parent.
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
| `GET <path> answered <status>`, `GET <path> failed: <why>` | as for the pull request check: anything but 200; no answer, 30 seconds, or a redirect (never followed). |
| `<method> <path> answered <status>` | a request that writes was refused: anything but 200 or 201. |
| `the answer to <path> is not what the audit needs` | not JSON, not a list where one is needed, or a field the audit reads is missing or of the wrong kind. |
| `the link to the next page is not the API`, `more than 200 pages of <what>` | as for the pull request check. |
| `the audit could not read the history: <message>` | the audit exited with 2: the repository is a shallow clone, no commit holds the settings file, a revision is not a commit. |
| `more than 300 commits with acts` | the evidence would take more requests than a token may make in an hour. |
| `several merged pull requests name the commit <id>: #<a>, #<b>` | step 3.2. |
| `git <command> failed: <message>` | git could not do what the log needs, with its message printed without control characters. |
| `could not push the log after 3 attempts` | the branch moved every time. |

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

**Still to run after the merge,** with the workflow on `main`: E13, a manual run with `dry-run` set; E14, a real manual run (the branch is made, `last-run.json` and the entries are pushed, the ruleset does not refuse); E15, the first scheduled run; E16, the run that a push starts, right after a merge (does GitHub name the pull request at once?). They are recorded here when they have been run.

## What this does not do

- **It does not announce** an act that was approved (M2.9c), and it does not post the diff of an erratum.
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

[test/workflow.test.mjs](../test/workflow.test.mjs) reads the workflow file and states, as tests, what is written above: the triggers, the job name, the absence of `if:`, the four permissions, the concurrency, the pinned actions, the checkout of the default branch with its whole history, and that no expression of the event reaches a `run:`. [test/audit-run.test.mjs](../test/audit-run.test.mjs) runs the program against a local server that plays GitHub and against git repositories, the histories of [the fixtures of the effects](../test/fixtures/audit-effects/README.md): each case that has a plan is run from the history to the requests that the server sees and the branch that the remote holds, and each reason of the table is shown.
