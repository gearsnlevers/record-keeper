# The setup check

Status: draft for review (M3c). This page says what the setup check looks at, every finding it can make with its code and its severity, what fails a run and what does not, what it reads and with which token, which part of the syntax of `CODEOWNERS` it understands, how its workflow is made, what it cannot know, and what has not been tried. It is not part of the protocol. It is read with [the install set](install.md), which says which files it checks, with [the updater](updater.md), whose pin and manifest it reads, and with [the audit run](audit-run.md), whose record it reads. **It has not been run against GitHub:** the first live proof is M3e, on a sandbox repository, and the first run of its workflow on this repository's own `main` comes with the merge that adds it. Until then it has been tried against a local server that plays GitHub, with the shapes of the answers that were read once from the API ([what is not verified](#what-is-verified-and-what-is-not)).

The setup check tells a repository when its installation of the kit is incomplete or wrong. A layer of the kit that is switched off by a missing ruleset, a dead schedule, an empty list of owners or a file that differs from the release does not fail by itself: a pull request that nothing stops merges, an audit that does not run reports nothing. So something has to look at the installation itself, and say so. This is the kit's counterpart of the deployment check of a repository that has one; the difference is that it also reads GitHub. It is one file, `setup-check.mjs`, with no dependencies, in `.github/record-keeper/` of a repository that installs the kit and at the root of the kit, and its workflow is `.github/workflows/records-setup-check.yml` (`Records setup check`). The program has two parts: a **core** that decides, from what was read, what is wrong, and does no input or output; and a **runner** that reads the files and GitHub. The runner does not write its own HTTP code, its reader of a pin or its rules for a manifest: it imports them from `updater.mjs` (and the reader of the settings from `record-keeper.mjs`, and the name of the log branch from `run-audit.mjs`), which stand in the same folder, so the setup check reads a pin and a manifest exactly as the updater does. [`reference/setup_ref.py`](../reference/setup_ref.py) is a second implementation of the core, written from this page.

## What it does

1. **Reads the working tree:** the settings file, the pin, `CODEOWNERS`, the audit workflow, and, when it knows the pinned release, the files that the release installs.
2. **Reads GitHub** with the token of the workflow, which can read and nothing else ([the token](#the-token)): the default branch and the rules that apply to it, the bypass list of the rulesets that carry the check, the account of each owner, the manifest of the pinned release, the record of the last run of the audit and, when there is none, the age of the audit workflow. A read that fails is not a failure of the run: it is a notice, `not checked`, that says what was not looked at ([not checked](#not-checked)).
3. **Decides** ([the findings](#the-findings), [how each is decided](#how-each-finding-is-decided)): a list of findings with a code and a severity, and the checks that were made and found fine.
4. **Says it:** one annotation for each finding in Actions (`::error`, `::warning` and `::notice`), one plain line each outside Actions, the job summary when GitHub gives a file for it, and a last line that counts them. With `--json` the same as one JSON document.
5. **Exits** with 1 when a finding is an error and with 0 when none is. The exit status is 2 when the run could not be made at all, or the command line was wrong.

It **writes nothing anywhere** but the job summary: no issue, no comment, no branch, no status. It does not run what it reads, and it never changes a setting or a ruleset.

## The findings

Every finding has a stable **code**, a **severity** and a short text. The text is made from the code and from one detail (the thing the finding names) and ends with the step that mends it. The codes are the contract of this page; the words of the texts are not.

| Code | Severity | When |
| ---- | -------- | ---- |
| `audit-dead` | error | The `at` of `last-run.json` on the log branch is older than 48 hours (two days); or there is no such file, and the audit workflow has been on the default branch for more than 48 hours ([the audit](#the-audit)). |
| `check-not-required` | error | The rules that apply to the default branch could be read, and none of them requires the status check `Records integrity`, and branch protection (the older setting) does not either. |
| `check-not-strict` | warning | A rule requires the check, but none of the rules that require it also requires branches to be up to date (`strict`), as `requires.rulesets` of the pinned release says. |
| `bypass-always` | warning | A ruleset that carries the rule that requires the check lets an actor bypass it in a mode other than `pull_request`: `always`, or any other word. Direct pushes to the default branch skip the rule. One finding for each actor. |
| `codeowners-missing` | warning | There is no `CODEOWNERS` file in `.github/`, at the root or in `docs/`. |
| `codeowners-uncovered` | warning | `CODEOWNERS` gives no owner to the settings file, the pin or one of the four workflow files of the kit. The detail lists them. |
| `owners-few` | warning | The settings list fewer owners than `approvals` needs. |
| `owner-mismatch` | warning | An owner of the settings has an ID that no account has, or whose login on GitHub is not the login in the settings (compared without regard to case). One finding for each owner. |
| `managed-differs` | warning | A managed file that the pinned release installs is missing, is not a file, or differs by SHA-256 or size from the manifest of the pinned release. One finding, with the first eight paths. |
| `manifest-unreadable` | warning | The pinned release is not in the list of the source, has no manifest, or its manifest is refused by the rules of the updater. The installed files then cannot be compared. |
| `pin-missing` | warning | There is no pin, `.github/record-keeper.yml`. |
| `pin-unusable` | warning | The pin is not in the form the updater reads. The detail is the code of the updater's refusal. |
| `settings-missing` | warning | There is no settings file. |
| `settings-unusable` | warning | The settings file is not a regular file of text, or has a problem ([settings](settings.md)). The detail is the first problem, and how many more there are. |
| `secret-not-set` | warning | The pinned release lists `RECORD_KEEPER_TOKEN` among the secrets it needs and the workflow says that the secret is not set, so the updater cannot open pull requests. |
| `audit-workflow-missing` | warning | `.github/workflows/records-audit.yml` is not a file of the working tree. |
| `audit-record-unreadable` | warning | `last-run.json` exists and is not a JSON object with an `at` that is a UTC time. |
| `audit-record-future` | warning | The `at` of `last-run.json` is more than five minutes in the future. |
| `single-owner` | notice | `approvals` is 1: the single-owner mode is on. **On every run while it is, with no way to switch it off:** [record 0001](decisions/0001-accepted-records-are-sealed-and-change-only-by-supersession-or-erratum.md) says that the setup check says so on every run. |
| `audit-not-yet` | notice | There is no record of an audit run yet, and the audit workflow is less than 48 hours old on the default branch (or not on it yet): its first run is not due. |
| `not-checked` | notice | A check could not be made. The detail names the topic and why ([not checked](#not-checked)). |

### What fails the run, and what does not

**Two findings are errors, and only they fail the run:** a dead audit and a check that is not required. These are the two that **silently switch a layer off**: nobody would ever see a violation, or nothing would stop a pull request that breaks the protocol. Everything else is a warning (something is wrong and the layers still work) or a notice (something that a person should know, or something that was not looked at). This is the maintainer's decision of 2026-11-18: [the design](design.md#the-layers) lists more findings that fail (a bypass role that allows direct pushes, for one); this draft follows the decision and reports the others as warnings, and the design text is left as it is.

The workflow is **not a required check and must not be made a required check.** It has a filter on paths, so a pull request that changes nothing of the kit does not run it, and a required check that does not run leaves the pull request waiting for ever ([the workflow](workflow.md)). It also fails for reasons that no pull request caused.

### Not checked

A check that could not be made is **never a pass and never a fail**: it is a notice, `not checked: <what> (<why>)`, with the step that fixes it. The topics, each with the thing that was not looked at:

| Topic | What was not looked at | Why it can happen |
| ----- | ---------------------- | ----------------- |
| `github` | everything that GitHub holds | `--local` |
| `repository` | the default branch, its rules and the last run of the audit | the repository could not be read (a missing or too weak token, GitHub down) |
| `rules` | the rules that apply to the default branch | the read failed or the answer was not what the check needs |
| `strict` | whether the check must be up to date | the check is required by branch protection only, whose setting the token cannot read |
| `bypass` | who may bypass a ruleset | the token was not shown the list (which may need more than the token of a workflow has: not tried), or the ruleset could not be read |
| `accounts` | the account of an owner | `GET /user/{id}` failed, or there are more than 30 owners |
| `codeowners` | who `CODEOWNERS` gives the files to | the file is not a small file of text, or has a line the check does not read ([the syntax](#codeowners-the-syntax-that-is-read)) |
| `own` | the pin, the pinned release and the installed files | this is the kit's own repository (`install.json` is at its root), which does not install itself |
| `release` | the manifest of the pinned release | the list of releases or the download failed |
| `secret` | whether `RECORD_KEEPER_TOKEN` is set | the run is for a pull request (it is given no secrets of a fork), or the workflow did not say |
| `audit` | the last run of the audit | the read failed |
| `age` | how long the audit workflow has been on the default branch | the read failed, or the answer was not a time |

A repository that sees a `not checked` on every run has either a token that is too weak or a setting that cannot be read, and the fix is in the text of the notice. **A notice that is there every day is not nothing:** a check that is never made cannot find anything.

## What it reads, and with which token

### The token

The workflow gives the program **the token of the workflow, `GITHUB_TOKEN`, with `contents: read` and nothing else.** There is no second secret and **the program never receives `RECORD_KEEPER_TOKEN`**: the workflow passes only whether it is set, as the value of `HAS_RECORD_KEEPER_TOKEN` (`${{ secrets.RECORD_KEEPER_TOKEN != '' }}`, the way the release workflow tells whether the key of the language model is set). `actions: read` is not asked for: the record of the audit is on a branch and the age of the workflow is the history of a file, both of which the contents of the repository give.

The token is read from `GITHUB_TOKEN` only, **is never printed** (every line of output has it taken out, and so has the value of `RECORD_KEEPER_TOKEN` if it were ever in the environment), and is sent **only to the API address** (`GITHUB_API_URL`, `https://api.github.com` by default; plain `http` is accepted for `localhost` only). The program follows no redirect with it; the download of the manifest of a release is sent on once, without the token, to the API host or to `githubusercontent.com`, exactly as [the updater](updater.md#the-token) does, because it is the same code. A run without a token reads the public parts of a public repository and nothing else.

**Which checks depend on what the token may read.** That is not known until M3e, which tries it on a sandbox repository. The reads, and what is lost if one is refused:

| Read | For | If refused |
| ---- | --- | ---------- |
| `GET /repos/{repo}` | the default branch | `repository`: the default branch, its rules and the audit are not checked |
| `GET /repos/{repo}/rules/branches/{branch}` | `check-not-required`, `check-not-strict` | `rules` |
| `GET /repos/{repo}/branches/{branch}` | branch protection as a second way to require the check | a `check-not-required` that says branch protection could not be read |
| `GET /repos/{repo}/rulesets/{id}` | `bypass-always` (and the name of the ruleset) | `bypass`; an answer without `bypass_actors`, as a token without administrator rights may get, is `bypass` too |
| `GET /user/{id}` | `owner-mismatch` | `accounts` |
| `GET /repos/{source}/releases` and the asset `release-manifest.json` of the pinned release | `manifest-unreadable`, `managed-differs`, `secret-not-set`, the strictness the release asks for | `release` |
| `GET /repos/{repo}/contents/last-run.json?ref=record-keeper/log`, raw | `audit-dead`, `audit-record-*` | `audit` |
| `GET /repos/{repo}/commits?path=...records-audit.yml` | `audit-dead` when there is no record | `age` |

`{source}` is the repository named in the pin. A request that GitHub answers with 5xx, or asks to wait for (the secondary limit, up to 60 seconds), or that fails to connect, is repeated, at most twice more; every request is a `GET`. Every answer is read only as far as a limit (1 MiB, 64 KiB for the record of the audit), and a longer one is a failed read.

### The files

| File | Read as |
| ---- | ------- |
| `.github/record-keeper/settings.yml` | by the kit's own reader of the settings ([settings](settings.md)); a file of more than 64 KiB, a link, a folder or text that is not UTF-8 without control characters is `settings-unusable` |
| `.github/record-keeper.yml` | by the updater's reader of the pin ([updater](updater.md#the-pin)) |
| `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS` | the first of the three that exists, as GitHub reads them; at most 1 MiB, UTF-8, no control character but the tab and the line ends |
| the managed files of the pinned release | by SHA-256 and size, **never run** |
| `.github/workflows/records-audit.yml` | whether it is a file |
| `install.json` | whether it is a file: that is how the kit's own repository is told from a repository that installs the kit |

No file is followed through a link: a link, or a link on the way, is "not a file".

## How each finding is decided

**The settings.** No file: `settings-missing`. A file that cannot be read as text, or is not a regular file: `settings-unusable`, and what depends on the owners is not judged. A file with problems: `settings-unusable` with the first of them (`S-05 at line 3 and 2 more`), and the owners and `approvals` that the kit reads from it, which are the defaults for what it cannot read, are judged. Fewer owners than `approvals`: `owners-few`. `approvals` that is 1: `single-owner`.

**The accounts.** For each of the first 30 owners, `GET /user/{id}`: an ID that no account has, or a login that GitHub gives that is not the listed login (compared without regard to case, for the letters A to Z only), is `owner-mismatch`; a read that failed, and the owners after the 30th, are `not checked`. The witnesses are not looked up.

**`CODEOWNERS`.** The first file of the three places. None: `codeowners-missing`. A file that cannot be read, or has a line that the check does not read: `not checked`, for the whole file (a later line can take back what an earlier one gave, so one line that is not understood puts every answer in doubt). Otherwise the owners of each of the six files (the settings file, the pin, and the four workflows) are those of the last pattern that matches it, and a file with none is listed in `codeowners-uncovered`. Whether the owners that are named are the owners of the settings is not looked at, and neither is whether a ruleset requires the review of a code owner.

**The rules of the default branch.** `GET /repos/{repo}/rules/branches/{branch}` lists the rules of every ruleset that applies, each with its ruleset. A rule of the type `required_status_checks` that lists `Records integrity` (compared as it is written) **requires the check**. No such rule: the older branch protection is asked (`protection.required_status_checks` of `GET /repos/{repo}/branches/{branch}`: it requires the check when its enforcement level is not `off` and it names it). If that requires it, the check is required, the strictness is `not checked` (the older setting does not tell the token), and nothing more is said of bypass. If it does not, or could not be read, and the rules were read: **`check-not-required`**. When it is required by a rule, **`check-not-strict`** is a warning unless one of the rules that require it has `strict_required_status_checks_policy` true, or the pinned release's `requires.rulesets` for `default` says `up-to-date: false`; when the manifest cannot be read the check is taken to want it.

**The bypass list.** For each ruleset (the first ten, in the order of their numbers) that carries a rule that requires the check, `GET /repos/{repo}/rulesets/{id}`: an actor whose `bypass_mode` is not `pull_request` is `bypass-always`. Without `bypass_actors` in the answer the list was not shown and it is `not checked`. Nothing is said of who the actors are: a role is a number, and the page cannot tell an administrator from a maintainer; the finding names the type and the number as GitHub gives them.

**The pin and the release.** No pin: `pin-missing`; a pin the updater does not read: `pin-unusable`. With a pin, the list of releases of its source is read, every page, and the entry whose tag is the pinned version is taken; its manifest asset is downloaded and judged by the rules of the updater, as untrusted data, for that tag and the pin's commit ([the manifest](updater.md#the-manifest-as-untrusted-data)). Not in the list, no asset, or a refusal: `manifest-unreadable`. Otherwise every file of the manifest with the kind `managed` is compared with the working tree by SHA-256 and size: a file that is missing, is not a file, or has another digest or size makes one `managed-differs` with the first eight paths in the order of their bytes. The templates are not compared (the repository owns them), and a managed file that is in the working tree and not in the manifest is not looked for. It does not ask whether the tag was moved: a manifest whose commit is not the pinned one is `manifest-unreadable` (`manifest-commit-moved`), and nothing else is done about it.

**The secret.** When the manifest lists `RECORD_KEEPER_TOKEN` among `requires.secrets`: for a `pull_request` run it is `not checked` (a pull request from a fork is given no secrets, so the answer would say nothing); when `HAS_RECORD_KEEPER_TOKEN` is `true` it is fine, when it is `false` it is `secret-not-set`, and when the variable is missing or not one of the two (a run with `--local` by hand) it is `not checked`.

### The audit

**The record.** `last-run.json` on `record-keeper/log` is written by the audit at every run ([the log branch](audit-run.md#the-log-branch)) and is read here as data from a branch that only the audit may write and that anyone with write access can still change, so it is parsed strictly: UTF-8, one JSON object, with an `at` that is a string `YYYY-MM-DDTHH:MM:SSZ` that is a real time of the years 1970 to 9999. Anything else is `audit-record-unreadable` and not a pass.

- `at` more than **five minutes** after the time of the run: `audit-record-future` (a time in the future is not a pass; the five minutes are for the clocks of two runners).
- `at` more than **48 hours** before the time of the run: **`audit-dead`**. At exactly 48 hours it is fine. GitHub starts a scheduled run when it can: the first scheduled run of this repository came seven hours and twenty minutes after its minute ([the audit run](audit-run.md#what-was-verified-on-github)), so two days is room for a late night and a failed night, not for a dead audit.
- otherwise it is fine.

**No record.** A repository that installed the kit a day ago has not had its first audit. The audit workflow runs on every push to the default branch, so it is not usually a day away, but the check does not rely on it. When `last-run.json` does not exist (or the log branch does not), and the audit workflow is a file of the working tree, the check reads **the history of that file on the default branch**: `GET /repos/{repo}/commits?sha={branch}&path={workflow}&per_page=100`, page after page up to five pages, newest first, and takes **the date of the commit of the oldest one** (the committer date, as the API writes it). That is how long the file has been in the repository, at least as the history tells it. Older than 48 hours: **`audit-dead`**. Younger: `audit-not-yet`, a notice. No commit of the default branch touches the file yet (a pull request that adds it): `audit-not-yet`. The history could not be read, or has more than 500 commits for the file, or the date is not a time: `not checked`, `age`. The `Link` header is not used: its `rel="last"` was seen to be wrong for this list ([what is verified](#what-is-verified-and-what-is-not)). **A weakness:** the commit date of a commit that was made on a branch is the date it was written and not the date of the merge, so a file that sat for three days in a pull request is "three days old" the hour it is merged; that matters only when the first audit then also fails to write its record.

No record and no audit workflow file in the working tree: `audit-workflow-missing`, and nothing is called dead.

## `CODEOWNERS`: the syntax that is read

`CODEOWNERS` follows the rules of `.gitignore` with three exceptions that GitHub names: no `\` to escape, no `!` to negate and no `[ ]` for a range. The check reads this **subset**, and a line that is not in it makes the whole file `not checked`:

- A line is blank, or a comment (its first word starts with `#`), or a **pattern** and its owners. A `#` that starts a word after the pattern starts a comment. Words are separated by spaces and tabs; a line may end in a carriage return.
- The owners are `@name`, `@org/team` and an e-mail address. A pattern with no owner takes the owners away from what it matches.
- **A pattern** is read from `/` at the start (anchored to the root), `/` at the end (a folder: what is below it), `*` (any characters but `/`), and `**` as a whole part (`**/x`, `a/**/x`, `a/**`). A pattern with a `/` in the middle is anchored too. A pattern with no `/` at the start or in the middle matches a name at any depth.
- **The last pattern that matches a path decides.** A name that is not a folder matches the file or folder of that name and, for a folder, what is below it (`/.github` is the same as `/.github/`); a pattern whose last part has a `*` in it does not go below (`/docs/*` is the files directly in `docs`, as GitHub says).
- **Not read**, and then the file is `not checked`: a pattern with `\`, `[`, `]` or `?`; one that starts with `!`; one with an empty part (`a//b`), none at all (`/`), `**` inside a name (`a**b`), more than twelve parts or more than 300 characters; an owner that is none of the three forms.

| The reason the check gives | When |
| -------------------------- | ---- |
| `a pattern with \, [, ] or ?` | the pattern holds one of the four |
| `a pattern that starts with !` | a negation |
| `a pattern with no name` | the pattern is `/` or `//` |
| `a pattern with an empty part` | `a//b` |
| `a pattern with ** inside a name` | `a**b`, `**b` |
| `a pattern with more than 12 parts` | |
| `a pattern longer than 300 characters` | |
| `an owner that is not @name, @org/team or an e-mail address` | the words after the pattern |

[The fixtures](../test/fixtures/setup/README.md) show every pattern of this list.

## The workflow

`Records setup check` (`.github/workflows/records-setup-check.yml`, installed from `templates/workflows/records-setup-check.yml`, and the kit has a copy of its own, because it has the same layers to check) has **three triggers and no other:** `schedule`, every day at 07:37 UTC (a minute away from the audit's 03:17 and the updater's 05:41); `workflow_dispatch`, with no input; and `pull_request` (**never `pull_request_target`**) for a change to a file of the kit: `.github/record-keeper.yml`, `.github/record-keeper/**`, `.github/workflows/records-*.yml`, `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`, `install.json` and the five programs at the root (`record-keeper.mjs`, `check-pull-request.mjs`, `run-audit.mjs`, `setup-check.mjs` and `updater.mjs`), which a repository that installs the kit does not have and the kit does. A pull request runs the program on what it holds, with a token that can only read, and no secret of the repository is given to the program in any run. Its one job is named `Records setup check` and has no `if:`.

The permissions are **`contents: read` and nothing else**, at the top of the file and nowhere else. The job checks out the commit of the event with **`persist-credentials: false`** (there is nothing to push, and nothing is left in the clone), sets up Node.js 24, and runs `node .github/record-keeper/setup-check.mjs --repo "$GITHUB_REPOSITORY"` (`node setup-check.mjs ...` in the kit). Nothing from the event reaches the shell: the environment has the token of the workflow as `GITHUB_TOKEN` and `HAS_RECORD_KEEPER_TOKEN`, and that is all. The concurrency group is `records-setup-check-` and the ref, and a run that is replaced by a newer one for the same ref is cancelled, which loses nothing, because the check writes nothing. Its actions are pinned to a commit with the version in a comment. [test/setup-check-workflow.test.mjs](../test/setup-check-workflow.test.mjs) states each of these as a test of both files, line by line, and tries them on damaged copies; the two files are one file with the path of the program and the link to this page changed ([the install set](install.md#the-workflows-of-a-repository)).

## Commands

```
node .github/record-keeper/setup-check.mjs --repo owner/name       read the working tree and GitHub
node .github/record-keeper/setup-check.mjs --local                 read the working tree only: for a first adoption before anything is pushed
node .github/record-keeper/setup-check.mjs --repo owner/name --json
```

| Option | Meaning |
| ------ | ------- |
| `--repo <owner/name>` | the repository to read on GitHub; the default is `GITHUB_REPOSITORY` |
| `--local` | read the files only; everything GitHub holds is said once to be `not checked` |
| `--root <dir>` | the working tree (default `.`) |
| `--now <time>` | the time of the run, `YYYY-MM-DDTHH:MM:SSZ` (for tests; the default is the clock) |
| `--json` | print one JSON document (`repository`, `at`, `findings` with `code`, `severity`, `detail` and `text`, and `passed`) |

An option may be given once. The environment is `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_API_URL`, `GITHUB_EVENT_NAME`, `GITHUB_ACTIONS`, `GITHUB_STEP_SUMMARY` and `HAS_RECORD_KEEPER_TOKEN`; the program reads no other. **Exit status:** 0 when no finding is an error (also with warnings), 1 when one is, 2 when the run could not be made (a repository that is not `owner/name`, an address of the API that is not one, a file that cannot be read, or a mistake of the program itself, said as `unexpected ...`, so that the status 1 always means a finding that is an error) or the options are wrong. What it prints, in Actions one annotation for each finding, with the code as its title, and outside Actions one line:

```
error: [audit-dead] the audit is not running: the last run was at 2026-11-14T08:00:00Z, more than two days ago. Open the runs of ...
warning: [codeowners-missing] there is no CODEOWNERS file (.github/CODEOWNERS, CODEOWNERS or docs/CODEOWNERS). Add one that ...
notice: [single-owner] the single-owner mode is on (approvals: 1). The owner is the whole authority: ...
setup check: 1 error, 1 warning, 1 notice
```

The job summary is a table of the same, and the checks that were found fine. GitHub shows at most ten annotations of each kind for a step, so the findings that are lists (`managed-differs`, `codeowners-uncovered`) are one finding each.

## What it trusts, and what it never does

**Nothing that it reads is trusted to be what it says.** What comes from GitHub, from a file or from a manifest reaches an annotation only after every control character, line or paragraph separator, direction control and byte order mark has been written as `\u{hex}`, and then with the escapes that GitHub documents (`%` as `%25`, a carriage return as `%0D`, a line feed as `%0A`; a property also `:` as `%3A` and `,` as `%2C`). A login, a path or a message cannot start another workflow command or hide one: it cannot start a line, and the title of an annotation is always a code of this page. The job summary is Markdown, so a text is also written so that it makes no link, no image, no mention, no table and no HTML. [test/setup-check.test.mjs](../test/setup-check.test.mjs) tries hostile values (`::error::`, `::stop-commands::`, `%0A`, line separators, direction controls) in every finding.

It **never runs** what it reads, never writes a file but the summary, never follows a link in the working tree, never makes a request that writes (every request is a `GET`), never sends the token anywhere but the API, and never prints it.

## What it cannot do

- It **cannot see a secret's value**, and only whether the workflow says it is set; it cannot tell that a token has expired or has the wrong permissions.
- It **cannot see a ruleset that the token may not read**, nor the bypass list of one: that is `not checked`, not a pass.
- It **cannot tell who is an administrator**, who is in a team, or whether an owner of the settings is the same person as an owner of `CODEOWNERS`.
- It **cannot tell that the audit is the kit's audit**: it reads a file that the audit writes. Anyone with write access to the log branch can write a recent `at`, and an administrator can write a ruleset that passes. The check finds the ordinary failures, not an owner who means to cheat ([the design](design.md#threat-review)).
- It **cannot see a file that was installed and is not in the manifest**, or a workflow of another name that runs the programs.
- It does not look at **what a managed file does**, only at its digest.

## What is verified and what is not

**Tried:** the core, with the fixtures of [test/fixtures/setup](../test/fixtures/setup/README.md), and against a Python second implementation on random inputs, every branch of which was reached ([reference](../reference/README.md)); the runner, with a local server that plays GitHub, with the shapes below, and temporary repositories (every finding made by a real read, every way a read can fail, the token that never appears, the pagination, the redirect that is not followed, hostile answers); the workflow as a file, line by line, and on damaged copies ([test/setup-check-workflow.test.mjs](../test/setup-check-workflow.test.mjs)).

**Read once from the real API on 2026-11-18, with a person's token that is an administrator of the repository,** on the kit's own repository (public) and one other public repository, with twelve read-only requests (and a thirteenth, without a token, that the rate limit of the shared address refused), and no write:

- `GET /repos/{repo}/rules/branches/{branch}` is a list with one object for each rule of each ruleset that applies: `type`, `ruleset_source_type`, `ruleset_source`, `ruleset_id`, and `parameters` for the types that have them. A `required_status_checks` rule has `parameters.required_status_checks`, a list of `{ context }` (and `integration_id` when a check is tied to an application), `strict_required_status_checks_policy` and `do_not_enforce_on_create`. A branch name with a slash is accepted raw and as `%2F`.
- `GET /repos/{repo}/rulesets/{id}` has `bypass_actors`, a list of `{ actor_id, actor_type, bypass_mode }` (`RepositoryRole`, `pull_request`), and `current_user_can_bypass`, and its `rules` and `conditions`. The list of rulesets (`GET /repos/{repo}/rulesets`) has none of that. **Whether a token that is not an administrator is shown `bypass_actors` was not tried:** an attempt without a token was refused by the rate limit of the shared address. The program takes an answer without the field as "not shown".
- `GET /repos/{repo}/contents/last-run.json?ref=record-keeper/log` with `Accept: application/vnd.github.raw+json` answers with the file as it is, one line of JSON with `at`, `head`, `from`, `judged`, `violations` and `excused`.
- `GET /repos/{repo}/commits?sha={branch}&path={file}&per_page=1` lists the commits that touch a file, newest first, with the date of each in `commit.committer.date`. **Its `Link` header was wrong:** it had a `rel="next"` to page 2 and a `rel="last"` that was page 1. The program does not use `last`, and reads full pages until a page is not full.
- `GET /user/{id}` gives `login`, `id` and `type`, also for an application (`github-actions[bot]`), and answers 404 with `{"message":"Not Found",...}` for an ID that no account has.
- `GET /repos/{repo}/branches/{branch}` has `protected`, and `protection` with `enabled` and `required_status_checks` with `enforcement_level` (`off`, `non_admins`, `everyone`), `contexts` (the names) and `checks` (`{ app_id, context }`). For a branch that a ruleset protects it says `protected: true` and `protection.enabled: false`; for a branch with branch protection it lists the checks, also for a person who is not an administrator of that repository.

**Not tried, because it needs GitHub and a sandbox repository (M3e):** that the token of a workflow with `contents: read` may do every read of the table above (the bypass list is the doubtful one, and `GET /user/{id}` and the list of releases of another repository are not known to be allowed); that the `Records setup check` of a pull request from a fork runs without the secrets as GitHub says; that `${{ secrets.RECORD_KEEPER_TOKEN != '' }}` is `true` and `false` as expected in a workflow; that the annotations and the summary look as intended; the daily schedule and how late it starts; the filter on the paths; how GitHub reads a `CODEOWNERS` pattern that names a folder without a slash at its end, or one that ends in a star (the subset above is from GitHub's page and from the `.gitignore` rules, not from a try); that an `exempt` bypass mode exists (the program treats every mode but `pull_request` alike); how GitHub counts a bypass of an organisation's ruleset in `GET /repos/{repo}/rulesets/{id}`.

## Choices in this draft for you to decide

1. **The codes and their words are mine,** 21 of them, with the details that the page and the fixtures show. The maintainer's table says which are errors; the names, and the choice to have one finding for a list (`managed-differs`) and one for each actor (`bypass-always`) and each owner (`owner-mismatch`), are the draft's. Cost: a name that is changed later changes the annotations that people see.
2. **The looser severity table** is the maintainer's (a dead audit and a check that is not required fail; everything else warns). The design still says that a bypass role in the mode `always` fails the check; this page and the code follow the decision. Cost: the design text and this page disagree until the design is amended.
3. **A bypass mode other than `pull_request` is a warning,** whatever its name, because the design says the mode `pull_request` is the one that closes direct pushes. Cost: a mode that GitHub adds later (`exempt` is one that exists as far as I know) is reported as if it were `always`, which is the safe side.
4. **Branch protection counts as requiring the check,** read from `GET /repos/{repo}/branches/{branch}`, so that a repository that uses the older setting does not get a failed run that is wrong. Cost: whether the branch must be up to date cannot be read from there, so that is `not checked` for such a repository; and the pages of the kit describe rulesets, so such a repository has something to move.
5. **A time in the future is a warning only when it is more than five minutes ahead,** and `audit-dead` needs more than 48 hours. Cost: two limits that are mine. A clock that is five minutes wrong is not told.
6. **The age of the audit workflow is the date of the oldest commit** that touches it on the default branch, read from the history through the contents of the repository, and not from `actions: read` (the workflow's creation date), which would be the date of the first push to the default branch and so more exact. Cost: a commit that was written days before it was merged makes the file look older than it is; a request or five. Alternative: ask for `actions: read`.
7. **A read that fails is a notice, not a failure of the run,** also when it fails every day. Cost: a repository whose token cannot read the rules never gets an error from `check-not-required`, only a notice that it was not checked. The alternative, to fail on an unreadable ruleset, would turn every repository whose token is too weak red.
8. **One `CODEOWNERS` line that the check does not read puts the whole file in doubt,** because the last matching pattern wins and the line could be the last. Cost: a repository that uses a bracket in an unrelated pattern gets a notice every day and no check of the coverage.
9. **The coverage that is asked of `CODEOWNERS` is six files:** the settings, the pin and the four workflows, as [the design](design.md) says. The programs in `.github/record-keeper/` are guarded by the check as code, and a person who writes `/.github/` covers them too, but a repository that lists only the files above gets no warning for them. Cost: a gap that the design leaves.
10. **The owners of `CODEOWNERS` are not compared with the owners of the settings,** and a ruleset's `require_code_owner_review` is not read. Cost: a `CODEOWNERS` that gives the files to someone who is not an owner passes.
11. **Only the owners are looked up, the first thirty,** and not the witnesses, whose login is wrong in the same way. Cost: a witness who is not told. The extra requests are cheap and the fix is a line in the page and a branch in the code.
12. **The kit's own repository is recognised by `install.json` at its root,** so that it is not told it has no pin and that none of its files differ from a release that does not exist. Cost: a repository that has an `install.json` for another reason gets no check of its pin.
13. **`pull_request` runs get no check of the secret,** because a pull request from a fork is not given secrets, so `false` would be wrong. Cost: a pull request that removes the secret is not told; the daily run is.
14. **The time is 07:37 UTC, and it runs on a pull request with a filter on paths.** The filter is the five programs, the two folders, `install.json` and the three places of `CODEOWNERS`; the workflow is not required, which is what makes the filter safe. Cost: a pull request that changes the ruleset (which is not a file) does not run it.
15. **The token is optional,** so a run without one reads what an unauthenticated request may. Cost: the limit of 60 requests an hour and many `not checked`; the workflow always has one.
16. **No `actions: read`.** If M3e shows that a check needs it, it is added here and in the workflow together.
17. **The list of releases is read page after page up to fifty,** as the updater does, to find one release. Cost: up to fifty requests for a repository with many releases; asking for the tag directly (`GET /repos/{source}/releases/tags/{tag}`) would be one, and the updater's code would not be reused.
18. **A pin whose tag moved is not found here.** The manifest is judged against the pin's commit as the updater judges the manifest of a pinned release, which finds a manifest that names another commit but not a tag that now points elsewhere with an unchanged manifest. Cost: a case that the updater finds on its next run.
19. **Exit status 2 for a run that could not be made,** so that "red because of a finding" and "red because the job could not run" differ in the log. The workflow fails on both.
