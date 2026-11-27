# The updater

Status: describes the released kit (v1.3.0 is the current release; written in M3b, with the files that agents read added in M3d). This page says what the updater does step by step, which files it replaces, which it copies once and which it writes into between two markers, what it reads from the pin and from a release and what it refuses, how it builds the one pull request, the token it needs, how a repository adopts the kit by hand the first time, what it trusts and what it never does, and what has not been tried. It is not part of the protocol. It is read with [the install set](install.md), which says what a release installs, with [releases](releases.md), which says how the manifest that the updater checks is made, and with [the setup check](setup-check.md), which reads the same pin and manifest to say when the files that were installed are not the release's. **It has been run against GitHub,** in a test repository (2026-11-22 to 2026-11-24): a first adoption by hand from a published release, a repair of a drift and an update from v1.0.0 to v1.1.0 end to end; and in six repositories (2026-11-25 to 2026-11-26) it made the pull request of the update from v1.1.0 to v1.2.0, on its daily schedule or, after a failed run, by hand. It has also been tried against a local server that plays GitHub and against local git repositories ([what is verified](#what-is-verified-and-what-is-not)).

The updater keeps a repository on a released version of the kit. A repository pins a release and never a branch ([releases](releases.md)); the updater is the only way a repository learns that a newer one exists. It is one file, `updater.mjs`, with no dependencies, in `.github/record-keeper/` of a repository that installs the kit, and at the root of the kit. Its workflow is `.github/workflows/records-updater.yml` (`Records updater`). The program has two parts: a **core** that decides, from the pin, the releases, the manifest and the digests, what an update is or why it is refused, and does no input or output; and a **runner** that talks to GitHub and to git. [`reference/update_ref.py`](../reference/update_ref.py) is a second implementation of the core, written from this page.

## What it does

1. **Reads the pin**, `.github/record-keeper.yml`, from the working tree: the source repository, the pinned version and its commit, and the channel ([the pin](#the-pin)).
2. **Asks the source for its releases,** every page, and chooses one ([which release](#which-release)). With a pin and nothing newer on the channel it is done, and an open update pull request that has nothing to update to is closed with a comment.
3. **Resolves the tag** of that release to a commit, through an annotated tag if there is one, and **downloads `release-manifest.json`** of the release.
4. **Checks the manifest as untrusted data** ([the manifest](#the-manifest-as-untrusted-data)): its form, its tag, its commit, the versions of Node.js it runs on, and every path it installs. A manifest that is wrong in any way is a refusal and nothing is written.
5. **Downloads every file of the manifest at the commit of the tag** and checks its SHA-256 digest and its size against the manifest. A mismatch ends the run before anything is written.
6. **Downloads the manifest of the pinned release,** the one the pin names, to tell which files this release no longer installs and which local changes the update overwrites. It is checked against the pin (its tag and its commit). When it cannot be read the update goes on and says so: the update is then built without that knowledge ([the plan](#the-plan)).
7. **Builds the plan** from the digests of the downloaded files and of the working tree: the managed files it adds, changes and removes, the templates it installs, the local changes it overwrites, and the new pin.
8. **In Actions, rebuilds the branch `record-keeper/update`** from the default branch with the plan, commits, pushes that branch and no other, and **opens or updates the one pull request** ([the pull request](#the-pull-request)). With `--local` it writes the plan into the working tree and does nothing else ([first adoption](#first-adoption-by-hand)).

The updater replaces **itself** too: it is one of the managed files, and the process that is running keeps the old code until it ends. It never runs what it downloads, and it needs neither the `gh` command nor `npm`.

## What is managed and what is a template

| Kind | The updater | Where it may be | What a release installs there today |
| ---- | ----------- | --------------- | ----------------------------------- |
| `managed` | adds it, **replaces it when it differs,** and removes it when the release no longer lists it | `.github/record-keeper/<name>.mjs`, `.github/workflows/records-<name>.yml`, or exactly `.claude/skills/record-a-decision/SKILL.md` | the five programs, the four workflows and the skill |
| `block` | writes **the text between two marker lines of the file, and nothing else in it**: creates the file when there is none, adds the block at the end when the file has no markers, replaces what is between the markers when it differs; a file whose markers are broken is left as it is and reported | exactly `AGENTS.md` | the block for agents ([the files that agents read](agent-files.md)) |
| `template` | installs it **when it is missing** at the first adoption, and in the update that brings it; **never overwrites it** | exactly `.github/record-keeper/settings.yml`, `docs/decisions/README.md`, `docs/decisions/template.md` and `CLAUDE.md` | the settings with every key commented out, the records README with an empty index, the template of a record, and the one line `@AGENTS.md` |

`<name>` is lower-case letters and digits, with single hyphens between them, starting with a letter (`record-keeper`, `run-audit`). A managed file is one file in the folder, never in a sub-folder; the settings file is not a managed file, and the skill is the one managed file outside those two places. `AGENTS.md` is a block and no other kind: a managed `AGENTS.md` would replace a file that the maintainers own. These are **the only places the updater writes** besides the pin and, in Actions, the one branch: a manifest that names any other place is refused ([the manifest](#the-manifest-as-untrusted-data)).

**When a template is installed.** A template is installed when nothing is at its path **and** either there is no pin (the first adoption) or the pinned release did not list it as a template (the update brings it). An existing `CLAUDE.md` is therefore never touched, at the first adoption too. A template that is missing but was in the pinned release is **not** installed again: the repository deleted it, or keeps its records somewhere else, and an update must not undo that. Where the pinned release could not be read, nothing tells the two cases apart and no template is installed. The updater does not read the settings file, so a repository whose records are not in `docs/decisions` removes the two files of that folder from its first adoption pull request; the updater does not bring them back.

## The pin

The pin is `.github/record-keeper.yml`: four lines, written by the updater and never edited by hand, except the channel.

```yaml
# Written by the Record Keeper updater. Do not edit it by hand, except the channel, in a pull request.
source: gearsnlevers/record-keeper
version: v1.0.0
commit: 5bec31d90a04d7045bb2849799f4934fe52d6351
channel: stable
```

The format is strict. A line is blank, or a comment (it starts with `#`), or `key: value` with one space after the colon and a value of printable ASCII without a space. Lines end with a line feed; a carriage return makes the line wrong. The reading is refused with the first of these that applies, scanning the lines from the top:

| Refusal | When |
| ------- | ---- |
| `pin-text` | the file is not a regular file (a link, a folder), is larger than 64 KiB, or is not UTF-8 without a byte order mark |
| `pin-line` | a line is none of the three (the detail is its number) |
| `pin-key` | a key is not `source`, `version`, `commit` or `channel` |
| `pin-duplicate` | a key is written twice |
| `pin-value` | a value is not what the key may have (below) |
| `pin-missing` | one of the four keys is missing; the first missing in the order `source`, `version`, `commit`, `channel` |

| Key | A value is acceptable when |
| --- | -------------------------- |
| `source` | `owner/name`: two parts of letters, digits, `.`, `_` and `-` (1 to 100 each, neither part `.` or `..`) |
| `version` | a tag of the kit: `v` and a semantic version without build metadata, at most 80 characters (`v1.2.3`, `v1.0.0-1`, `v2.0.0-rc.1`) |
| `commit` | a full commit id: 40 or 64 lower-case hexadecimal digits; the commit that the tag pointed at when it was pinned |
| `channel` | `stable` or `prerelease` |

A file that is not in this form is not repaired, and an update is not made on top of it. It is refused with its reason and a person fixes the file in a pull request. The check treats a change to the pin as the act `pin` ([the files of the check](protected-files.md)).

## Which release

The releases are what the source's API lists, every page (at most 50 pages of 30), and the updater picks one by these rules.

1. **Which entries count.** An entry is **usable** when it is an object, its `draft` is `false`, its `prerelease` is `true` or `false`, and its `tag_name` is a tag of the kit (as for the pin). Every other entry is left out: a draft, a tag like `nightly`, a tag with build metadata, an entry that is not a release.
2. **Two usable entries with one tag are refused** (`release-duplicate`). The list cannot be right.
3. **With `--target <tag>`** the release is that tag, whatever the channel says. It must be a usable entry (`release-missing`). It must not be older than the pinned version (`older-than-pin`); it may be the pinned one, which repairs a drift ([commands](#commands)).
4. **Without a target** the entries are filtered by the channel. `stable` takes an entry whose `prerelease` is `false` **and** whose version has no prerelease part, so that a mistake on either side keeps a prerelease out. `prerelease` takes every usable entry. No entry is left: `release-none`.
5. **The newest** of them, by semantic version precedence ([semver.org](https://semver.org/#spec-item-11): `1.0.0-1` is older than `1.0.0`, numeric parts compare as numbers), is the candidate. When there is a pin and the candidate is **not newer than the pinned version**, there is nothing to do: the result is `current`. A pin on a prerelease that is newer than every stable release is `current` on the stable channel; the updater never goes back.
6. Otherwise the candidate is the release to go to.

Before the rules, `source-missing` is refused when there is no pin and no `--source` (and, in Actions or without `--local` and `--dry-run`, whenever there is no pin: the pull request is for a repository that has adopted the kit), and `source-mismatch` when there is a pin and a `--source` that is another repository (the pin is the repository's word about where the kit comes from; to move the source, a person edits the pin in a pull request). The channel is `--channel`, else the pin's, else `stable`.

## The manifest, as untrusted data

The manifest ([releases](releases.md#the-manifest)) is an asset of a release that anyone with the right to publish a release of the source made. It is read as data that may be hostile. Two refusals come before it can be read, and are the runner's and not the core's: **`tag-target`**, when the tag of the release does not point at a commit (it points at a tree or a blob, or an annotated tag that ends in one), and **`manifest-missing`**, when the release has no asset named `release-manifest.json`. Then the first of these that applies is the refusal; all of them hold for the manifest of the pinned release too, except the version of Node.js, which is only asked of the manifest of the release it goes to.

| # | Refusal | When |
| - | ------- | ---- |
| 1 | `manifest-large` | the download is larger than 1 MiB |
| 2 | `manifest-json` | it is not one JSON document in UTF-8 without a byte order mark |
| 3 | `manifest-shape` | it is not an object |
| 4 | `manifest-schema` | `schema` is not the number `1` |
| 5 | `manifest-keys` | it has a key that is not `commit`, `files`, `generations`, `node`, `requires`, `schema`, `tag` or `version`, or lacks one (the detail is the first unknown key in the order of the bytes of the keys, else the first missing key in the order of that list) |
| 6 | `manifest-tag` | `tag` is not the tag of the release it was downloaded for |
| 7 | `manifest-version` | `version` is not a text that makes the tag with a `v` in front |
| 8 | `manifest-commit` | `commit` is not a full commit id |
| 9 | `manifest-commit-moved` | `commit` is not the commit that the tag points at (asked of the API, through an annotated tag) |
| 10 | `manifest-generations` | `generations` is not a non-empty list of different texts like `g1` (`g` and 1 to 9 digits, not starting with 0) |
| 11 | `manifest-node` | `node` is not a range that the updater reads: one or more comparators separated by single spaces, each `>=` or `<` and a version of one, two or three numbers (`>=22`, `>=22.1 <26`); anything else (`^22`, `22.x`, `||`) is a refusal, never a guess |
| 12 | `manifest-requires` | `requires` is not `{ rulesets, secrets, settings }` with `secrets` a list of different names in capitals, digits and `_` starting with a capital, `settings` a list of different keys in lower case and `-` starting with a letter, and `rulesets` a list of `{ branch, checks, up-to-date }` with printable names (letters, digits, space and `._/()#:+-`, 1 to 100) and a boolean |
| 13 | `manifest-files` | `files` is not a list of 1 to 100 entries |
| 14 | `manifest-entry`, `manifest-kind`, `manifest-path`, `manifest-source`, `manifest-digest`, `manifest-size` | for the entries in the order of the list, the first of these: it is not an object with exactly `kind`, `path`, `sha256`, `size` and `source` (`manifest-entry`); `kind` is not `managed`, `template` or `block`; `path` is not a place the updater installs for that kind ([managed and template](#what-is-managed-and-what-is-a-template)); that is a stricter rule than a path of the kit, and every path it allows is one; `source` is not a path of the kit; `sha256` is not 64 lower-case hexadecimal digits; `size` is not a whole number from 0 to 4 MiB. The detail is the number of the entry, counted from 1, except for `manifest-path` and `manifest-source`, whose detail is the `path` or the `source` as written |
| 15 | `manifest-duplicate` | two entries have the same `path` (the detail is the path) |
| 16 | `manifest-too-large` | the sizes of the files add up to more than 16 MiB |
| 17 | `node-version` | the Node.js that runs the updater does not satisfy `node` |

**A path of the kit** is printable ASCII, relative, written with `/`: no backslash and no colon, no empty part, no `.` or `..`, no part that starts or ends with a space or ends with a dot, no part that is `.git` in any case ([install](install.md#installjson), the same rule that the builder of the manifest applies). A `source` is only ever asked of GitHub at the commit of the tag, each part percent-encoded. The strictest rule that works is on purpose: a manifest that wants the updater to write somewhere else, or to read a range it does not know, is a refusal, and the kit's answer to a release that needs more is a new updater, put in place by hand ([troubleshooting](#troubleshooting)).

## The files

The files of the manifest are asked of the contents API of the source, `ref` being the commit of the tag, as raw bytes, one request for each different `source`. A response is read only as far as the size that the manifest names: a file that is longer is a `size-mismatch`, and the rest of it is not read. Then, for the entries in the order of their `path` (by bytes), the first of these is the refusal:

| Refusal | When |
| ------- | ---- |
| `release-moved` | the release is the pinned one and its manifest names another commit than the pin (the tag was moved, or the manifest changed after it was pinned) |
| `download-missing` | no digest was computed for the `source` |
| `size-mismatch` | the size of what was downloaded is not `size` |
| `digest-mismatch` | the SHA-256 of what was downloaded is not `sha256` |
| `path-blocked` | the pin, or a managed path, is in the working tree and is not a file: a folder, a link, something else, or a file or link is in the way of the folders above it |

Nothing is written before every file is checked, and a run that is refused has written nothing and pushed nothing.

## The plan

The plan is built from the files, ordered by the bytes of their paths, and from what the working tree holds at each path: nothing, a file with a digest, or something else. For the pinned release's manifest, when it is usable, the managed files it lists are the ones the updater installed before.

| List | A path is in it when |
| ---- | -------------------- |
| `added` | it is a managed file of the release and nothing is there |
| `changed` | it is a managed file of the release and a file with another digest is there |
| `unchanged` | it is a managed file of the release and a file with the same digest is there |
| `templates` | it is a template, and it is to be installed ([when a template is installed](#what-is-managed-and-what-is-a-template)) |
| `kept` | it is a template and is not installed |
| `remove` | the pinned release listed it as managed, the release does not list it at all (neither as managed nor as a template), and a file is there |
| `overwritten` | it is in `changed` and the pinned release's manifest is usable, and the pinned release did not list it as managed or listed it with another digest than the file has; or it is in `remove` and the file has another digest than the pinned release listed; or it is `AGENTS.md`, its block is replaced, and the pinned release did not list a block or listed one with another digest than the block that stands in the file |

The block of `AGENTS.md` is not in the lists above: it has a field of its own, **`block`**, which is `null` when the release has no entry of the kind `block`, and otherwise `{ path, action, why }`: the action is `create` (there is no file), `append` (the file has no marker), `replace` (the text between the markers is not the block of the release), `current` (it is the block byte for byte: nothing is written) or `refused` with a `why` ([a refused block](agent-files.md#a-refused-block)). The core is given the bytes of `AGENTS.md` (`tree`) and the text of the block of the release (`blocks`), and refuses with `digest-mismatch` or `download-missing` a text that is not the one the manifest names, so that nothing is spliced that the manifest does not vouch for. A file `AGENTS.md` of more than 1 MiB is not read: its block is `refused` with `too-large`, and so is a path that holds something other than a file (`not-a-file`). The runner then makes the same splice again and writes the result. The path is written in `overwritten` as `AGENTS.md`, and the pull request says that it is the text between the markers.
`overwritten` is **the local changes this update overwrites** (or removes): a managed file that someone edited, or that was not installed by the updater. A path that is a folder or a link is never removed. **On a first adoption there is no pinned release to compare with, so nothing is `overwritten`:** a managed file that is there already is in `changed` (the run says `change <path>`), and the last line of the run leaves the count out: a `0 local changes overwritten` would say that the updater looked, and it cannot. An update and a repair, which have a pin, keep the count, `0` included. The body of the pull request has the section of local changes only when `overwritten` is not empty, so no body of a first adoption has it. The pin is rewritten when it is not byte for byte what `renderPin` makes of the new release: the header comment, then `source`, `version`, `commit` of the release's manifest, and `channel`.

The result is `update` when anything is added, changed, removed or installed, or the block of `AGENTS.md` is to be created, appended or replaced, or the pin changes, and `unchanged` when nothing is: the release is installed already. The plan also carries three warnings: **`block-refused`** when the block of `AGENTS.md` cannot be written (the detail is the `why`; the rest of the update is built as always and the pull request says it as a problem), **`previous-missing`** when there is a pin and the pinned release has no manifest to read (it is not in the list or has no such asset), and **`previous-unusable`** when it has one and it is refused by the rules of the table above (the detail is the refusal), with the pin's version as its tag and the pin's commit as its commit. In both of the last two the update is built without `remove` and `overwritten`, and with no template installed, and the pull request says so. A transient failure to download that manifest is not a warning: the run fails, so that the next run reads it.

The core is `plan(input)`: from the pin text, the options, the releases, and for the release it chooses its commit, manifest, the pinned manifest, the digests and the tree, it returns `refused` with a code and a detail, `current` with the newest tag of the channel, or `update` or `unchanged` with the lists above. The fixtures in [test/fixtures/update](../test/fixtures/update/README.md) show every case, and the reference computes the same answers.

## The pull request

In Actions the updater makes **one branch and one pull request**, and nothing else is written to the repository.

- **The working tree** must be at the head of the default branch on `origin` and clean, or the run stops (`failed`). The branch is built from that head, never from the update branch of the last run, and is **never merged into**: a pull request that waited for a month holds everything since the last merge, and two update pull requests cannot conflict.
- **The branch is `record-keeper/update` and no other.** The program refuses to push any other name, and pushes with `--force` to `refs/heads/record-keeper/update` only. Nobody pushes to that branch; the next run replaces it.
- **The commit** has the title of the pull request, the identity `github-actions[bot]`, and the date of the commit it is built on, so that the same update on the same base is the same commit. A run that finds the branch already at that commit pushes nothing, and the checks of the pull request do not start again.
- **The pull request** is the open one from the branch to the default branch, which is updated (title and body) when there is one, and made when there is not. There is never a second: it is looked up before it is made, and a run that updates it makes no new one.
- **When GitHub fails to make it,** the run does not give up at the first answer, and it does not ask twice at once. If the request that makes the pull request is answered 5xx, or the connection fails after the request may have been sent, GitHub may have made the pull request all the same, so the run **waits five seconds and looks for the open pull request of the branch first.** If there is one, the run uses it: it says that GitHub answered the error and that the pull request exists, updates its title and body as it does for every open one, and reports it as opened by this run. If there is none, the run **asks for the pull request once more,** and no more than that. An answer that is no 5xx (a refusal, a limit, a 422) is not repeated and not looked for: the run fails at once. No other write of the run is repeated: not the update of a pull request that exists, not the comment, not the closing. The run is red only when the second request fails too (the message is the one of the second answer, and says that the run tried twice) or when the look for the pull request fails (the message says that the look failed and that the pull request may or may not exist). The wait of five seconds is a choice, not a measurement ([what is verified](#what-is-verified-and-what-is-not)).
- **The title** is `chore: update Record Keeper v1.0.0 to v1.1.0`, with ASCII `to`; `chore: repair Record Keeper v1.0.0` when the target is the pinned release.
- **The body of a repair is short.** A repair installs nothing new, so its body does not repeat the notes of the release: it says what a repair is (it restores the files of the repository that differ from release `vX`, and installs nothing newer), links to the page of the release (`https://github.com/<source>/releases/tag/vX`, made of the source and the tag, which the rules above checked), and then has the same parts as any body from the files on: what it changes, the local changes it overwrites, what the release requires, the warnings and the paragraph about the approval. Every other pull request, a first adoption through the updater included, keeps the notes.
- **The body of an update** has, in this order: the release notes, the files added, changed and removed, the templates installed and the block of `AGENTS.md` (`AGENTS.md is created, with the Record Keeper block in it`, `the Record Keeper block is added at the end of AGENTS.md, and nothing else in the file changes` or `the Record Keeper block in AGENTS.md is replaced, and nothing outside the two markers changes`), the pin, **the local changes this update overwrites**, **what the release requires** (the secrets, the settings and the rulesets: the updater cannot see them, so it lists them), the warnings, and a paragraph that merging needs the owners' approval, because the update changes the pin, the workflows and the programs that judge every later pull request. **The release notes are untrusted text.** They are cut after 6,000 characters, every control or direction character becomes `?`, every `@` becomes `(at)`, and the whole is put in a fence that is longer than any run of backticks in it, so that no mention, link, image or reference is made live. Everything else in the body is made from values that the rules above checked.
- **Nothing newer.** When the updater finds that there is nothing to update to (`current`, or `unchanged`) and a pull request from the update branch is open, it **closes that pull request with a comment** that says why. The release it was for may have been withdrawn, or the update may have been made by hand. The branch stays, and the next run that has an update rebuilds it. A pull request that a person closed is not reopened: the next run that has an update opens a new one.
- **Without the token** ([the token](#the-token)) the run does the reading and the plan and prints them, writes nothing, and fails when there was something to write.

## The workflow

`Records updater` (`.github/workflows/records-updater.yml`, installed from `templates/workflows/records-updater.yml`) has **two triggers and no other:** `schedule`, every day at 05:41 UTC, and `workflow_dispatch` with the inputs `target` (a release tag, none by default) and `dry-run` (a boolean, off by default). **A scheduled run comes hours after its minute:** on 2026-11-23 to 25 the runs were created between 15:59 and 16:30 UTC, ten to eleven hours late, for a cause that is not known ([what was seen](audit-run.md#what-was-verified-on-github)). A missing run before the evening is not a failure, and `workflow_dispatch` starts the same run at once. A pull request never starts it, and nothing a pull request holds reaches it. Its one job is named `Records updater` and has no `if:`, so nothing can skip it unseen. It checks out the default branch, sets up Node.js 24, and runs `node .github/record-keeper/updater.mjs`, with `--target` and `--dry-run` when the inputs say so; the inputs reach the shell through the environment, never through an expression in the command. The permissions are `contents: read` and nothing else: the writes are made with the secret ([the token](#the-token)). One run at a time holds the group `records-updater`, and a run that has started is never cancelled, because it may be half way through its writes. Its actions are pinned to a commit with the version in a comment. The kit has no copy of this workflow that it runs itself: the kit does not update itself. [test/updater-workflow.test.mjs](../test/updater-workflow.test.mjs) states each of these as a test of the file, line by line, and tries them on damaged copies.

## The token

The updater needs a token that can push a branch and open a pull request, which the token of a workflow cannot do under the policy planned for the organisation ([the design](design.md#delivery-and-versions)), and whose pull requests would not start the checks. The decision of the maintainer is the repository secret **`RECORD_KEEPER_TOKEN`**: a **fine-grained personal access token limited to the one repository**, with these permissions and no other:

| Permission | Why |
| ---------- | --- |
| Contents: write | to push the branch |
| Pull requests: write | to open and update the pull request, and to close one |
| Workflows: write | an update changes files under `.github/workflows/`, which a token may not push without it |

Fine-grained tokens expire; the expiry is the owner's to remember. A pull request that is opened with this token is authored by the account that made it, and its checks start, which a pull request that a workflow opens with its own token does not do.

The token is read from `RECORD_KEEPER_TOKEN` only, **is never printed** (every line of output has it taken out before it is written; the program prints no header, and of an answer that is an error only the first 200 characters), and is sent **only to the API address** (`GITHUB_API_URL`, `https://api.github.com` by default; plain `http` is accepted for `localhost` only). The program follows no redirect with it. The one exception to "no redirect" is the download of the manifest, which GitHub answers with a redirect to the place that holds the asset: the updater follows it once, to the API host itself or to a `githubusercontent.com` host, **without the token**. A redirect to anywhere else is a failure.

The workflow gives the secret to two steps, and to no others: the checkout, so that git can push the update branch, and the step that runs the program. Without the secret the checkout falls back to the token of the workflow, with which the program can read and cannot push, and the run says that `RECORD_KEEPER_TOKEN` is not set.

**Which token which program reads.** The updater reads `RECORD_KEEPER_TOKEN` only: a `GITHUB_TOKEN` in its environment is not read. For a public kit it needs no token at all for `--local` or for a dry run (it asks as an unauthenticated client, which GitHub limits). The setup check is the other way round: it reads `GITHUB_TOKEN` only, and its workflow tells it only whether the secret is set (`HAS_RECORD_KEEPER_TOKEN`), never the secret ([the setup check](setup-check.md#the-token)).

## First adoption by hand

The first adoption is the one change that nothing checks, because the check is part of what it installs, so the maintainers read the whole diff with care. It is made **once, by hand**, with `--local`. It was tried from a published release, in a test repository (2026-11-22 to 2026-11-24): every file was verified against the manifest, the pin was written, and the dry runs said `current` and `unchanged`.

1. **Write the owners first.** Create `.github/record-keeper/settings.yml` with the `owners` (and `approvals`) before anything else ([settings](settings.md)), committed by an administrator. Without owners no act can be approved, and the updater never overwrites that file: a template is copied only where nothing is. A pull request that names the first owners would be judged by a base that has none ([the workflow](workflow.md#what-a-repository-must-set)).
2. **Choose the release** (`TAG`, the newest stable release unless you mean another) and fetch the updater of that tag. This copy is **not yet verified**; step 3 replaces it with the verified one.

   ```sh
   TAG=v1.0.0
   git switch -c record-keeper/first-adoption
   curl -fsSL -o "$TMPDIR/updater.mjs" "https://raw.githubusercontent.com/gearsnlevers/record-keeper/$TAG/updater.mjs"
   shasum -a 256 "$TMPDIR/updater.mjs"        # compare with the sha256 of updater.mjs in release-manifest.json of the release
   ```
3. **Run it with `--local`** from the root of the repository. It writes the verified files and the pin and installs the templates that are missing, and it does not touch git. For the files that agents read it creates `AGENTS.md`, or adds the block at its end, or replaces the text between its markers, and installs `CLAUDE.md` only if there is none; it prints a warning, and writes nothing to `AGENTS.md`, when the markers are broken ([the first adoption of these files](agent-files.md#the-first-adoption)).

   ```sh
   node "$TMPDIR/updater.mjs" --local --source gearsnlevers/record-keeper --target "$TAG"
   ```

   A token is not needed (a run makes about twenty requests); set `RECORD_KEEPER_TOKEN` to any token that can read public repositories to get past the limit of unauthenticated requests ([which token which program reads](#the-token)).

   **A file of the install set that is there already is replaced** (a managed file) or left alone (a template), and the run says so: `change <path>` for a file it replaces. With no pin there is no earlier release to compare with, so the last line of the run does not count local changes at all, and does not say `0` ([the plan](#the-plan)); the diff of the pull request in step 4 is where to look.
4. **Read the diff,** open the pull request by hand, and have the owners approve and merge it. Remove `docs/decisions/README.md` and `docs/decisions/template.md` from it if the records are not there, and `CLAUDE.md` if the Claude Code memory of the repository is `.claude/CLAUDE.md`. The setup check runs on this pull request and shows `[check-not-required]` as a notice, because the ruleset of step 5 is set after the merge (the pull request adds the pin, and its base has none); that is expected, and `Records integrity` does not run on a pull request whose base has no kit yet ([install](install.md#first-adoption)).
5. **Create the secret** `RECORD_KEEPER_TOKEN` ([the token](#the-token)), and set the ruleset ([install](install.md#installjson), `requires`). From then on updates arrive as pull requests, daily at 05:41 UTC or when the workflow is run by hand.

A repository that kept decision records before the kit seals them in a second pull request, after this one ([adopting with records that already exist](install.md#adopting-with-records-that-already-exist)).

`node .github/record-keeper/updater.mjs --dry-run` in the merged repository must then say `current: v1.0.0 is the newest stable release of gearsnlevers/record-keeper`, and with `--target v1.0.0` it must say `unchanged: v1.0.0 is installed and nothing differs`: the second is the proof that every file is the release's.

## Commands

```
node .github/record-keeper/updater.mjs                         update to the newest release of the pinned channel: the branch and the pull request
node .github/record-keeper/updater.mjs --dry-run               say what would change, and change nothing (no token needed)
node .github/record-keeper/updater.mjs --target v1.2.0         a specific release; the pinned one repairs a drift (a file that differs from the release)
node .github/record-keeper/updater.mjs --local                 write the verified files and the pin into the working tree: no branch, no push, no pull request
node .github/record-keeper/updater.mjs --local --source gearsnlevers/record-keeper [--target v1.0.0] [--channel stable|prerelease]
                                                               the first adoption: `--source` is needed while there is no pin
```

| Option | Meaning |
| ------ | ------- |
| `--dry-run` | read, plan and print; write nothing. With `--local` too, `--dry-run` wins. |
| `--local` | the first adoption, or a manual update, into the working tree |
| `--target <tag>` | a release other than the newest of the channel; a tag of the kit |
| `--source <owner/name>` | the repository of the kit; needed without a pin, and it must agree with the pin when there is one |
| `--channel <stable\|prerelease>` | the channel of the new pin |

An option may be given once. The environment is `GITHUB_REPOSITORY` (the repository, for the branch and the pull request), `GITHUB_API_URL` and `RECORD_KEEPER_TOKEN`. **Exit status:** 0 when it is done, when there is nothing to do and for a dry run; 1 when it refused, failed, or has an update to write and no token; 2 for wrong usage. What it prints, one line each:

```
current: v1.0.0 is the newest stable release of gearsnlevers/record-keeper
update v1.0.0 to v1.1.0 (stable)
  add .github/record-keeper/setup-check.mjs
  change .github/record-keeper/record-keeper.mjs
  remove .github/record-keeper/old.mjs
  install template docs/decisions/new.md
  local change overwritten .github/record-keeper/run-audit.mjs
  replace the block of AGENTS.md
  write .github/record-keeper.yml
warning: the pinned release v1.0.0 has no manifest to read; local changes and removals are not listed
1 file to add, 1 to change, 1 to remove, 1 template to install, 1 local change overwritten, the block of AGENTS.md to replace
pushed record-keeper/update (a1b2c3d)
opened pull request #7
```

The count of local changes is the last line's only when there is a pin: on a first adoption (`update (nothing installed) to v1.0.0 (stable)`) the line ends with the templates, or with the block, and says nothing about local changes. A block that is `create`, `append` or `replace` is one line of its own (`  create the block of AGENTS.md`, `  append the block of AGENTS.md`, `  replace the block of AGENTS.md`) and the end of the count; one that is refused is the warning `warning: the block in AGENTS.md was not written: <the reason in words>` ([a refused block](agent-files.md#a-refused-block)), and the run goes on. A refusal or a failure is one line on the error output, `updater: refused: <what>` or `updater: failed: <what>`, with every text that came from a remote place written so that no control character can hide in it. A request that GitHub answers with 5xx, or asks to wait for (the secondary limit, up to 60 seconds), or that fails to connect, is repeated, at most twice more, when it only reads; a request that writes is never repeated, because a second one may make a second pull request or a second comment. The one exception is the request that makes the pull request: after an answer 5xx or a connection that failed, the run looks for the pull request that GitHub may have made, and asks again once, only if there is none ([the pull request](#the-pull-request)).

## What it trusts, and what it never does

It trusts the **tag of a release, its manifest and the files at the commit of the tag**, and only to the extent that they agree: the manifest is for that tag, names the commit that the tag points at, and has the digest and size of every file that the contents API gives for that commit. It does not trust the release notes (they are fenced), the list of releases (it re-reads everything about the one it chooses), the paths in a manifest (the strictest rule), or the size of an answer (every read is bounded).

It **never runs** what it downloads, never writes a file that is not a path of the table above, never follows a link in the working tree (a link, or a link on the way, is a `path-blocked`), never pushes a branch other than `record-keeper/update`, never merges or approves anything, never changes a setting or a ruleset, and never prints the token.

**Release immutability protects the rest.** A manifest is an asset of the release it describes, so the digests protect against a download that went wrong, not against a release that was made to be wrong; the immutable release and its attestation make a swap after publication visible ([releases](releases.md#immutable-releases)), which is why they are switched on before the first real release. What stands against a bad release is the owners' approval of the pull request, which shows every changed file. An update brings new code that judges later pull requests, and that is an act that deserves to be read.

## What an update looks like to the check and to the owners

The update pull request is an ordinary pull request. The check runs on it from the base branch, as for any other. It changes the pin, the workflow files and the programs, so its acts are **`pin`, one `workflow` for each workflow file, and one `code` for each program** that it changes (and `settings` when it brings the settings file to a repository that has none, and **`instructions`** for the skill and for the block of `AGENTS.md` when they change: [the files that agents read](agent-files.md#the-check-and-the-audit)), and they are met by the **ordinary approval of the owners**, not by the bar for an amendment (the decision of 2026-11-07, [amendments](amendments.md)). The new check code judges the pull requests after it, not the update itself.

In the **single-owner mode** (`approvals: 1`) the pull request is authored by the owner's own account, because the token is the owner's. The author counts once as an approval, so **the owner's own pull request meets the approval and merging it is the only act** ([the design](design.md#single-owner-mode)). That is the mode working as designed, and not a second pair of eyes. If a second pair of eyes matters, give the updater an identity of its own (a machine user or a GitHub App); its pull requests then need an owner's approval. This page does not build either.

After the merge, **the announcements tell the owners** ([announcements](announcements.md)): the audit that runs on the push opens one issue, written by the bot, for the merge commit, with the acts `pin`, `workflow` and `code` in it and a mention of the owners and the witnesses. In the single-owner mode that issue, and the pull request, are what an owner has of the update.

## Troubleshooting

- **`digest-mismatch`, `size-mismatch`:** a file at the commit of the release is not the one in the manifest. Do not work round it; tell the maintainers of the kit.
- **`manifest-path`, `manifest-node`, `manifest-keys`:** the release is one that this updater does not read. Put the new updater in place by hand: fetch `updater.mjs` of the release, check its digest against the manifest, run it with `--local --target <tag>`, and open the pull request. The release notes of such a release say so.
- **`release-moved`:** the tag of the pinned release points at another commit now, or its manifest changed. Do not merge anything until the maintainers of the kit have said why.
- **`older-than-pin`:** an update never goes back. To go back, revert the merge of the update pull request; the next run goes forward again, so to stay where it is, disable the workflow.
- **`path-blocked`:** a folder or a link stands where the updater has to write a file. Move it.
- **`release-none`:** the list had no usable release for the channel. It is usually a problem of the API for a moment; run it again.
- **`updater: failed: POST /repos/<repo>/pulls answered 500` (or 502, or another 5xx), or `POST /repos/<repo>/pulls failed: <the reason>`:** the branch `record-keeper/update` was pushed, and GitHub failed to make the pull request. The run waits, looks for the pull request that GitHub may have made all the same, and asks once more if there is none ([the pull request](#the-pull-request)), so a red run now means that **both requests failed** (the message ends `(tried twice: the first try failed too, and no pull request was found between the two)` and is the message of the second answer), or that **the look for the pull request failed** (the message says so, and that the pull request may or may not exist). Then the retry is a person's: **run the workflow again** (`workflow_dispatch`). The run looks up the open pull request before it makes one, so the next run finds and updates the pull request if one was made, and makes it if not. A pull request that GitHub made while it answered the error is not a failure of this run. An updater of v1.3.0 or earlier gives up at the first answer, and the way out is the same. On 2026-11-25 this happened in three repositories, about five minutes after a GitHub incident ("degraded experiences across GitHub products") had been resolved: two runs failed with 500 and no pull request existed afterwards, one failed with 502 and the pull request existed afterwards. A run by hand in the two without a pull request made it.
- **The pull request has no checks:** it was opened with a token that cannot start them. Use `RECORD_KEEPER_TOKEN`.
- **`RECORD_KEEPER_TOKEN is not set`:** the secret is missing, or a run from a fork or by Dependabot, which get no secrets.
- **`the working tree is not at the head of ...`:** a push arrived between the checkout and the run. Run again.
- **A managed file differs from the release and nobody changed it:** `--target <the pinned tag>` rewrites it, through the same pull request.

## What is verified and what is not

**Tried:** the core, with the fixtures of [test/fixtures/update](../test/fixtures/update/README.md), and against a Python second implementation on random inputs, every branch of which was reached ([reference](../reference/README.md)); the runner, with a local server that plays GitHub (releases in pages, annotated tags, assets with and without a redirect, rate limits, 5xx, hostile answers) and a local bare repository as `origin`: the first adoption, an update that makes the branch and the pull request, a second run that updates the same pull request, nothing newer, a dry run that changes nothing, a digest that does not match, a list of releases that lies, the token that never appears, the branch name guard, and the answer 5xx (500, 502, 503, 504) or a lost connection to the request that makes the pull request, with the pull request made by the server before the answer was lost and with none made (the run waits, looks, uses the pull request or asks once more; the wait comes before the look; both requests failing; the look failing; an answer that is no 5xx failing at once; no other write repeated). The workflow is tried as a file, line by line, and on damaged copies ([test/updater-workflow.test.mjs](../test/updater-workflow.test.mjs)).

**Tried on GitHub, in a test repository, 2026-11-22 to 2026-11-24:**

- **A first adoption by hand** with `--local` from a published release. The contents API gave the files, the download of the manifest was answered in a way that the updater accepts, every file was verified against the manifest, the pin was written, and the dry runs said `current` and `unchanged`.
- **The updater with the repository secret `RECORD_KEEPER_TOKEN`** (a fine-grained token with the permissions of [the token](#the-token)): it pushed a branch, opened a pull request and pushed a change to a workflow file (with the permission Workflows), and the pull request it opened started the required checks. That a pull request opened by a workflow with its own token does not start them is documented behaviour and was not measured again.
- **A drift.** A changed managed file was reported as a warning, `managed-differs`, and mended by a repair pull request (`--target` set to the pinned version, titled `chore: repair Record Keeper vX`), after which the dry run said `unchanged`.
- **An update from an older pin to a newer release** (v1.0.0 to v1.1.0), end to end: dry run, real run, pull request, the owner's approval in the single-owner mode, merge, and then `unchanged`.

**Tried on GitHub, the update from v1.1.0 to v1.2.0, 2026-11-25 to 2026-11-26, in six repositories:** with a fine-grained token of the organisation as the secret `RECORD_KEEPER_TOKEN` (the permissions Contents, Pull requests and Workflows, all write), the updater made the pull request `chore: update Record Keeper v1.1.0 to v1.2.0` on the daily schedule in four repositories, and by a run by hand in two, after the scheduled run had failed with the answer 5xx to the request that makes the pull request ([troubleshooting](#troubleshooting)). One of the four was made by a scheduled run that was red afterwards for the same reason. Every pull request passed `Records integrity`, `Records setup check` and the repository's own checks, and was merged with a merge commit. Afterwards the audit that the push of the merge started said `0 violations`, the setup check said `0 errors, 0 warnings, 0 notices`, and the dry run of the updater said `current: v1.2.0 is the newest stable release`. The time of the scheduled runs is on [the page of the audit run](audit-run.md#what-was-verified-on-github).

**Tried on GitHub, the dry run for `v1.3.0`.** After `v1.3.0` was published, the dry run of the updater in a test repository that was on `v1.2.0` said `update v1.2.0 to v1.3.0 (stable)`.

**Not tried, because it needs GitHub:** that five seconds are enough for GitHub to list a pull request that it made while it answered 5xx (the number is a choice, not a measurement), what GitHub answers to a second request for a pull request that exists (a test answers 422 and the run fails with that answer), how the `Link` header looks when the list of releases has more than one page, that a push from a checkout that is one commit deep is accepted, and that the secret falls back as the checkout expects. A repository whose files are checked out with other line endings than the release has would see every managed file as a local change; the runner of GitHub does not change them, and nothing here has been tried on another system. A second adoption of a repository that has files of the kit at its root is not handled.

## Choices in this draft for you to decide

1. **The channels are `stable` and `prerelease`,** not `stable` and `next`. `prerelease` is the word of GitHub and of [releases](releases.md#versioning).
2. **The strictest rule for what a manifest may install:** managed files are `.github/record-keeper/<name>.mjs` and `.github/workflows/records-<name>.yml` only, templates are the three that exist. The builder of the manifest accepts anything below `.github/` and `docs/decisions/`. The cost is that a release that adds any other kind of file needs a new updater in place first (a major release, with a note). The alternative, to allow sub-folders and any `docs/decisions/*.md` template, lets a hostile manifest write more.
3. **The pin has four keys, all required, and the manifest has exactly eight,** with `schema` 1. A key that a later release adds is a new schema. The updater does not guess.
4. **The pin may be edited by hand for the channel only,** in a pull request (an act `pin`); `--channel` does it with the updater. The first adoption of a prerelease needs `--channel prerelease` or the line edited, to receive the next prerelease.
5. **The range of Node.js is read in a small grammar** (`>=` and `<` comparators); the kit's own `>=22` is in it. A range outside it is a refusal.
6. **An update never goes back, and there is no way to hold a version.** `--target` older than the pin is refused (`older-than-pin`). Going back is a revert of the merge, and a repository that wants to stay where it is closes the pull request and disables the workflow: a closed pull request is opened again by the next run that has an update.
7. **A pull request that has nothing to update to is closed with a comment,** not updated; the branch stays. The alternative is to leave it open, which leaves a stale pull request in the list when a release is withdrawn.
8. **A previous manifest that cannot be read is a warning, not a refusal.** The update goes on without the list of removals and of local changes, and the pull request says so. A failure of the network is not a warning.
9. **A local change is overwritten and reported,** not a refusal. The pull request shows it and the owners decide. The alternative, to refuse until a person resolves it, would stop every update on a repository where someone edited a file.
10. **The commit is made reproducible,** with the date of the base, so that a run that changes nothing pushes nothing. The cost is that the commit has the date of its base and not of the run.
11. **The release notes are fenced and cut at 6,000 characters; `@` becomes `(at)`.** The fence alone stops a mention; the second measure is against a fence that a later change of GitHub would not honour.
12. **One exception to "no redirect":** the download of the manifest is sent on once, without the token, to the API host or to `githubusercontent.com`. The documentation of the API says, as I know it, that this download answers with a redirect or with the body; I did not read it again for this draft, and there is no other way to get an asset. The alternative is to fail on it, which would make the updater useless. On GitHub the download of the manifest worked in the first adoption and in the update of the test repository (2026-11-22 to 2026-11-24), so GitHub answered in a way that the updater accepts.
13. **Two steps get the secret,** the checkout and the program, as decided. The alternative is for the program to give git the credentials itself and keep the secret in one step, with the checkout not persisting any; it was not built because it could not be tried without GitHub.
14. **No token: report and fail, only when there is something to write.** A repository whose secret is missing sees the first update as a red run, not a silent one. A run with nothing to do stays green.
15. **The updater does not read the settings,** so the templates of the records folder are always `docs/decisions` ones, and a repository with another folder deletes them from its first adoption. Reading `folder:` needs the whole subset of [settings](settings.md) in this file too.
16. **The first release is adopted from a download that is not verified** (`curl` of the file at the tag, compared with the digest in the manifest by the person). There is nothing before it to verify with; the immutable release and its attestation are what a person checks ([releases](releases.md#what-a-repository-can-verify)).
17. **The time is 05:41 UTC,** an arbitrary minute away from the audit at 03:17.
18. **A template is installed once,** at the first adoption and by the update that brings it, and not whenever it is missing. Without the settings the updater cannot know where a repository keeps its records, and a deleted template that came back with every update would be noise for a repository that keeps them elsewhere. The cost: a template that a repository deleted by mistake is not restored by an update.
19. **The title says `to`, not an arrow,** as ASCII: `chore: update Record Keeper v1.0.0 to v1.1.0`.
20. **The updater writes into a file that the repository owns, between two markers, and nowhere else in it** (M3d, [the files that agents read](agent-files.md)). The splice is a pure function that reads and writes bytes, so that nothing outside the markers can change; it is tried on thousands of files made of every sort of text against a second implementation. The cost: the one place where the updater changes a file that is not the kit's, and so the one place where a mistake would destroy a maintainer's text.
21. **A block that cannot be written does not stop the update:** the plan says `refused` with a reason, a warning is printed and put in the pull request as a problem, and the rest is written. The alternative is a refusal of the whole plan. A file that someone damaged would then stop every update, also the ones that mend the check.
22. **The functions that find and replace the block are exported by `updater.mjs`,** and the rules file imports them from there, because the updater is fetched alone and cannot import. The test that says the updater imports no file of the kit stays.
23. **`AGENTS.md` is read up to 1 MiB, as bytes,** and the block is written with line feeds. A file with a zero byte and no marker is not added to, and a file that ends inside a code fence is not added to either. Each of these is a reason in the table of [a refused block](agent-files.md#a-refused-block).
24. **The skill is one more path of the strictest rule,** and no more: the path rule grows by exactly `.claude/skills/record-a-decision/SKILL.md`, and a test tries thirty paths around it. `CLAUDE.md` is one more template, and `AGENTS.md` is the one destination of the kind `block`.
25. **The body of a repair has no release notes** (decided 2026-11-22). A repair installs the release that the repository is pinned to, so the notes describe nothing that it changes, and they filled the body with the history of the release before the one thing that a reader of a repair looks for, the files it changes. The body says what a repair is and links to the page of the release. The alternative was to keep the notes under a heading, as an update does, which is what it did until then. The cost: the link is built for github.com, the host of the releases of the kit, and not from the address of the API that the run uses.
26. **One exception to "a request that writes is never repeated":** the request that makes the pull request is made once more, after a look for the pull request, when GitHub answered it 5xx or the connection failed (decided 2026-11-26, after runs that failed with 500 or 502 and left a pull request in some repositories and none in others). The rule had a reason that stays: a second request may make a second pull request, and so the run waits five seconds and looks for the open pull request of the branch before it asks again, and asks at most once. The alternatives were to keep the rule whole, which leaves a person to run the workflow again after every such answer, and to look and never ask again, which still leaves the run red when GitHub made nothing. The cost: a run that fails now fails after about five seconds more, and if the look finds none while GitHub is still making the pull request, the second request may be answered with a refusal because the pull request exists, and the run is red though the pull request exists (a test answers 422 and shows that the run fails with that answer; what GitHub answers was not tried); the next run updates it. The other writes are not repeated: the comment that closes a pull request would make a second comment, and a look would have to read the comments; the update of the title and body, and the closing, set the same values and could be repeated without a look, but nothing in the runs that failed asks for it, and the next run does them.
