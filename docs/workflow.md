# The pull request check

Status: draft for review (M2.5, with the lookups of errata and deviation notes added in M2.6). This page says how the `Records integrity` workflow runs [`check-pr`](checking-a-change.md) on a pull request: what it reads from GitHub, what it runs, what it does when it cannot read, and what a repository must set so that the check means something. It is not part of the protocol. The rules for *what is allowed* are on [the page about checking a change](checking-a-change.md) and [the page about approvals](approvals.md); this page is only the plumbing between GitHub and those rules, and the plumbing is where a check is most easily turned off.

Two files make the check. `.github/workflows/records-integrity.yml` is the workflow. `check-pull-request.mjs` is the program it runs: it is the only part of the kit that talks to the network, and it does nothing but read, ask `check-pr`, and pass on the answer. `record-keeper.mjs`, which holds every rule, still has no network code and no token.

## What the workflow is

- **One trigger: `pull_request_target`**, for the events `opened`, `synchronize`, `reopened`, `ready_for_review` and `edited` (a change of title, text or **base branch**). GitHub runs a `pull_request_target` workflow from the **default branch** of the repository, so a pull request cannot change the check it is judged by. A copy of the workflow that exists only in a pull request or on another branch does not run for it ([the design](design.md#how-a-pull-request-is-checked), experiment E1).
- **One job, named `Records integrity`.** The name of the job is the name of the check that a ruleset requires. The job has no `if:` and the trigger has no `paths:` and no `branches:`, because a skipped or neutral job satisfies a required check and a `paths:` filter leaves a pull request blocked for ever. A job that fails, or is cancelled, blocks.
- **A token that reads and cannot write:** `checks: read`, `contents: read` and `pull-requests: read`, and nothing else. The check reports through the result of its own job. `checks: read` is for one thing, the start of the first run of the check on the head commit (step 5).
- **It never runs what the pull request holds.** The job checks out the **default branch**, with its whole history, and nothing else. The commits of the pull request are fetched as git objects and read through git; no file of them is checked out, installed, imported or run. The program and `record-keeper.mjs` are the ones of the default branch.
- **Nothing from the event goes into a shell.** The pull request number reaches the program as an environment variable, and the repository as `GITHUB_REPOSITORY`. Everything else the program needs it reads from the API itself.
- **Every action is pinned to a commit.** The same two as the tests use: `actions/checkout` and `actions/setup-node`.

## What the program does

`node check-pull-request.mjs --repo <owner/name> --pr <number>`, in a clone whose `origin` is that repository, with the token in `GITHUB_TOKEN` and, when it is not GitHub.com, the address of the API in `GITHUB_API_URL`. In this order:

1. **Read the pull request** (`GET /repos/{repo}/pulls/{number}`): its state, the id of its head commit, the name of its base branch and the numeric id of its author. The event that started the run is **not** used for any of it. A re-run of a workflow carries the event of the first run, and a pull request moves between the event and the run; the live pull request is the one that gets merged.
2. **Read every review** (`GET .../pulls/{number}/reviews?per_page=100`), following the `Link` header with `rel="next"` until there is none.
3. **Read the pull request again.** If its head commit or its base branch is not the one of step 1, the run stops: the reviews were read for a commit that is no longer the head.
4. **Fetch the commits** with git: the head from `refs/pull/{number}/head`, the tip of the base branch from `refs/heads/{base}`. The id that came out of the head must be the id of step 1, or the run stops.
5. **Ask `record-keeper needs`** with the same two commits what the change cites or waits for ([errata and deviation notes](errata-and-deviations.md#what-needs-prints)), and look it up. For each distinct issue or pull request that a new deviation entry cites, in the order `needs` prints them, `GET /repos/{repo}/issues/{number}`: a `404` or a `410` means it does not exist, and a pull request is an answer that has a `pull_request` key. If `needs` printed `clock` (an erratum that changes the seal, or an act of [the bar for an amendment](amendments.md) that is not waived), `GET /repos/{repo}/commits/{head}/check-runs?check_name=Records%20integrity&filter=all&per_page=100` (every page) and take the earliest `started_at` of the runs of the app `github-actions` with that name; with none, the time of now. A change that needs neither makes neither request.
6. **Run `check-pr`** with the tip of the base branch as `--base`, the head commit as `--head`, the reviews as `--reviews`, the id of the author as `--author`, and, when step 5 looked something up, the issues and pull requests that exist as `--cases` and the start of the first run as `--since`. Print what it prints. The exit status of the job is the exit status of `check-pr`.

The program is the same code as `check-pr` for everything after that, so the result for a pull request is the one the command gives for the same two commits and the same reviews. The pull request is judged against the **tip of the base branch**, not against the point where it branched: a branch that is behind the base fails with P-09 (a stale head), whatever the ruleset says.

## When the check cannot run

The program ends with the status 2 and prints `Records integrity could not run:` and a reason. The job fails, and a failed job blocks. A re-run, once the cause is gone, replaces the result. The reasons:

| Reason | When |
| ------ | ---- |
| `no token` | `GITHUB_TOKEN` is empty or missing. |
| `repository: must be owner/name`, `pull request number: must be a positive integer of at most 9 digits`, `API address: ...` | an argument is not what it must be: `owner/name` of letters, digits, dots, hyphens and underscores (neither part `.` or `..`); a positive integer of at most 9 digits; an address that is `https` (or `http` for `localhost` or `127.0.0.1`, used by the tests) without credentials, query or fragment. |
| `GET <path> answered <status>` | the API answered with anything but 200 (for an issue, also but 404 and 410, which mean it does not exist). |
| `GET <path> failed: <why>` | no answer: the connection failed, the 30 seconds for one request ran out, or the API answered with a redirect (a redirect is never followed, so the token cannot be sent to another place). |
| `the answer to <path> is not what the check needs` | the answer is not JSON, is not a list (or an object with a list of check runs) where that is needed, or lacks a field the check reads or holds one of the wrong kind. |
| `the pull request is not open` | its state is not `open`. |
| `the pull request has no author` | its author is `null` (an account that was deleted). |
| `the link to the next page is not the API` | the `Link` header points to another origin than the API, or to a page that was already read. |
| `more than 200 pages of reviews`, `more than 200 pages of check runs` | the list does not end. 200 pages are 20,000 entries. |
| `more than 50 cases to look up` | a change cites more than 50 distinct issues and pull requests. |
| `record-keeper needs printed something that is not a need` | the answer of the kit does not have the form the page of errata gives; a sign that the two files are not of one version. |
| `the head moved` | step 3 or 4 found another head commit or base branch than step 1. |
| `git fetch failed: ...`, `git rev-parse failed: ...` | git could not fetch or resolve, for instance because the base branch or `refs/pull/{number}/head` is not in `origin`. The message of git is printed without control characters. |

The kit's own failures keep their meaning: `check-pr` exits 1 for a problem or an act that is not approved, and 2 for input it cannot use (which includes a reviews file that does not fit, see [approvals](approvals.md#what-the-caller-gives)).

## How an approval reaches the check

`pull_request_target` has no event for a review, so the check does not run when a review arrives. The owner who has approved presses **Re-run** on the check, or pushes; the run reads the live reviews as above and replaces its earlier result. Whoever can write may press the button, and nobody can forge an approval by doing so, because the reviews are read from GitHub with the code of the default branch. A run that started before the review arrived, and ends after it, has read whichever it has read: the next one is correct.

## What was verified on GitHub

The experiments E1 to E5 of 2026-10-29 (a same-named job, `skipped` and `neutral`, a `paths:` filter, `[skip ci]`, the re-run, what a review holds) are on [the design page](design.md#prerequisites-and-what-was-verified). They used throwaway workflows. On 2026-11-07, with the workflow of this page on `main` (`c8d312e`), two of the three that had to wait were done, on throwaway pull requests that were closed afterwards (GitHub keeps the closed pull requests #29 to #31):

- **E6, a pull request against another branch.** Two pull requests, each with one file outside the records folder: #29 against a branch made from `main`, and #30 against a branch made from the commit before the workflow existed, so that it held no workflow file. `Records integrity` ran on both, as a `pull_request_target` run, and passed (`docs/decisions: 0 problems`, 6 and 9 seconds). So the workflow comes from the default branch whatever the base of the pull request is, and a pull request against any branch is judged, as [What the workflow is](#what-the-workflow-is) says.
- **E8, an approval by a second account.** #31, opened by `vscheuber`, accepted record 0001 in a branch that was never merged, so that the check had one act. The first run printed `approvals: 1 of 1 (vscheuber/28791378: author, volker-bornagainpatriots/348527658: none)` and `1 act approved`: the author counts, with `approvals: 1`. Then `volker-bornagainpatriots` submitted an `APPROVE` review of the head commit. The program, run by hand against the real API, printed `approvals: 2 of 1 (vscheuber/28791378: author, volker-bornagainpatriots/348527658: approved)` and exited 0; a **Re-run** of the job on GitHub (attempt 2) printed the same and succeeded. So a real review is read as the page says (the account id, the state `APPROVED` and the commit it was made on), and a re-run replaces the earlier result. The first number of the line is the count of owners who count (here both), the second is how many are needed.

**Not tested: E7**, whether a `workflow_run` or `issue_comment` workflow of the default branch could run the check again by itself when a review arrives. Until it is, an approval reaches the check by a re-run or a push.

## What a repository must set

The workflow does nothing for a pull request that can be merged without it. These are set in the settings of the repository, once, by an administrator:

- A ruleset (or branch protection) on the default branch that **requires the checks `Records integrity` and `Test gate`** (the second only if the repository uses it), and **requires branches to be up to date** before merging.
- That the roles allowed to **bypass** the ruleset are no more than are needed, and that none of them is in the mode that allows a direct push (`always`).
- The **settings file** with the owners ([settings](settings.md)). Without owners no act can be approved: the first settings file is installed by an administrator, because a pull request that names the first owners would be judged by a base that has none.

## What this version does not do

- **It guards the workflow file and the program only as acts.** A change to `.github/workflows/records-integrity.yml` or to `check-pull-request.mjs` needs the approval of the owners ([the files of the check](protected-files.md)); the amendment bar of M2.7b is not asked of it. Whether the owners notice a change that weakens the check is for them.
- **It does not announce anything or post the diff of an erratum** (M2.9). It reads the issues and pull requests that a deviation note cites and the time of the first run on the head commit, and the kit counts the 48 hours ([errata and deviation notes](errata-and-deviations.md)).
- **It does not re-run itself** when a review arrives (see above). Whether a workflow that is started by another event could do it is not tested yet.
- **It does not read the pull request's files** for anything but `check-pr`. It does not look at code, and it has no opinion on any file outside the records folder, the settings file and the pin.
- **It has no job summary and no annotations.** The output is the output of `check-pr`.

## Choices in this draft for you to decide

1. **The reading is a second program, `check-pull-request.mjs`, not a command of `record-keeper.mjs`.** The file with the rules stays free of network code and of a token, as [the approvals page](approvals.md) says; the cost is that a repository installs two files and the updater (M3) has two files to pin. The alternative is a command `record-keeper.mjs github-pr`, which is one file and one hash, and puts the network next to the rules.
2. **One job, no separate verdict job.** The design describes a final job that runs `if: always()` and fails unless the jobs before it succeeded. With one job without conditions nothing can be skipped, and a verdict job would only repeat its result. It is added the day the workflow gets a second job.
3. **Everything is read live, and a head that moves ends the run.** The event is not trusted for the head, the base or the author. The cost is that a push that arrives while a run is in the middle makes that run fail, and the run of the push judges the new head.
4. **The base is the tip of the base branch.** A branch that is behind fails in the check itself (P-09), so the check does not depend on the setting "require branches to be up to date" for that.
5. **`edited` is a trigger.** A change of the base branch of a pull request is an `edited` event, and the pull request must be judged again. The cost is one more run when a title changes.
6. **No `branches:` filter, no `concurrency:`.** A pull request against any branch is judged, though the ruleset guards the default branch only. Without `concurrency:` two runs for one pull request may overlap; both read the live pull request, so they agree.
7. **The credentials of the checkout stay.** The job needs them to fetch `refs/pull/{number}/head` from a private repository. The token is read-only and nothing the pull request holds is run, so the only code that can use it is the code of the default branch.
8. **A pull request that is not open fails.** A re-run on a merged pull request has no base to compare with and says so.
9. **A page of reviews that cannot be read ends the run**, whatever the reason, and the run says why. The alternative, judging the pages that were read, could miss the later review that requests changes.
10. **The token reads checks** (`checks: read`), for the 48 hours of an erratum. It is the one permission added since the first version of this page; the lookup is made only for a change that needs it, so a failure of that API ends the run of that kind of change and of no other. The alternative, the creation time of the pull request, needs no permission and lets a change be swapped after 48 hours ([errata and deviation notes](errata-and-deviations.md#choices-in-this-draft-for-you-to-decide), choice 9).

## The tests

[test/workflow.test.mjs](../test/workflow.test.mjs) reads the workflow file and states, as tests, what is written above: the trigger, the job name, the absence of `if:`, `paths:` and `branches:`, the permissions, the pinned actions, the checkout of the default branch only, and that no expression of the event reaches a `run:`. [test/github.test.mjs](../test/github.test.mjs) runs the program against a local server that plays GitHub, and against git repositories: it follows the pages, it ends on every reason of the table, and an approval on the first page is cancelled by a request for changes on the third.
