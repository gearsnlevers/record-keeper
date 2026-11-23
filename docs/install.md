# The install set and the layout of a repository

Status: draft for review (M3a, with the updater of M3b, the setup check of M3c and the files that agents read of M3d added). This page says what a repository gets when it installs the kit, where each file stands, which files are replaced by every update and which are copied once, what the check guards, and how `install.json` lists all of it. It is not part of the protocol. It is read with [the files of the check](protected-files.md), which says which of these files are acts, and with [releases](releases.md), which says how the list becomes a release. The updater that does the installing is [the updater](updater.md) (M3b), and [the setup check](setup-check.md) (M3c) says when what it installed is wrong; this page says what it puts where.

## The layout

A repository that installs the kit has these files, and no other file of the kit:

```
AGENTS.md                                  the repository's own file for agents; the kit owns only the block between two markers in it ([the files that agents read](agent-files.md))
CLAUDE.md                                  one line, `@AGENTS.md`, installed once when there is none
.claude/skills/record-a-decision/SKILL.md  the skill: how to propose, supersede and correct a record
.github/
  record-keeper.yml                        the pin: which release the repository wants (written by the updater)
  record-keeper/
    settings.yml                           the settings: the folder, the owners and the rest ([settings](settings.md))
    record-keeper.mjs                      the rules: validate, seal, check-pr, audit
    check-pull-request.mjs                 what the pull request workflow runs
    run-audit.mjs                          what the audit workflow runs
    setup-check.mjs                        what the setup check workflow runs: what is wrong with this installation
    updater.mjs                            what the updater workflow runs: the update, and the first adoption by hand
  workflows/
    records-integrity.yml                  the workflow that judges a pull request: the check `Records integrity`
    records-audit.yml                      the nightly audit
    records-setup-check.yml                the daily check of the installation, and of a pull request that changes it
    records-updater.yml                    the daily update: one branch and one pull request
docs/decisions/
  README.md                                the rules of the folder, and the index
  template.md                              the template of a record
  0001-....md                              the records of the repository
```

- **One folder for the kit's files.** The programs stand in `.github/record-keeper/`, next to the settings file that the maintainers own, so that the kit is one folder and one place to read. A repository that installs the kit has no `record-keeper.mjs` at its root.
- **The workflows stand where GitHub reads them,** in `.github/workflows/`, with the names above. Their names and the names of their jobs are what a ruleset requires, so a repository does not rename them.
- **The files for agents stand where agents read them:** the skill at the one path that Claude Code and the Copilot cloud agent read skills from, `AGENTS.md` and `CLAUDE.md` at the root. The kit writes into `AGENTS.md` only between its two markers.
- **The records stand in `docs/decisions/`** unless the settings say another folder ([settings](settings.md)). The files of the kit that go into the records folder are the README and the template of a record.
- **The pin is not in the folder,** because it is written by the updater and never edited by hand, while the folder holds the settings that people edit ([the design](design.md#configuration)).
- **The kit's own repository is not laid out this way.** It keeps its programs at its root, and its workflows call them there, so that it can run them without installing itself. The workflows of a repository that installs the kit are those of the kit with the paths of the programs changed, and nothing else ([the workflows](#the-workflows-of-a-repository)).

## Managed and template

Every file of the install set has a kind.

| Kind | What happens to it | Whose it is | Files |
| ---- | ------------------ | ----------- | ----- |
| `managed` | It is installed at the first adoption and **replaced by every update.** | the kit's | the programs in `.github/record-keeper/`, the workflows in `.github/workflows/`, the skill `.claude/skills/record-a-decision/SKILL.md` |
| `block` | The text between **two marker lines of a file that the repository owns** is written at the first adoption and **rewritten by every update**; nothing else in the file is read or changed. Only `AGENTS.md` is a block. | the kit's text, in the repository's file | `AGENTS.md` ([the files that agents read](agent-files.md)) |
| `template` | It is copied **once,** at the first adoption, and **never overwritten** afterwards. | the repository's | `.github/record-keeper/settings.yml`, `docs/decisions/README.md`, `docs/decisions/template.md`, `CLAUDE.md` |

- A managed file is never edited by hand: the next update replaces the edit. The check treats a change to one as an act that needs the owners' approval ([the files of the check](protected-files.md)), so a hand edit does not pass unseen either.
- A template is a start. The repository changes it as it likes (an owner is added to the settings, a rule is added to the README), and an update leaves it alone, because it holds what the repository decided. A change to the settings is still an act of its own kind, and a change to the records README is judged by the rules of the records folder.
- **A block is the one kind whose file is not the kit's.** The updater reads `AGENTS.md`, finds the two marker lines and replaces what is between them with the text of the release; where there are no markers it adds the block at the end, and where there is no file it makes one. It changes no byte outside the markers, and a file whose markers are broken (one missing, two of a kind, in the wrong order, or a line that holds more than a marker) is left as it is and reported ([the files that agents read](agent-files.md)). The check guards what the kit writes there and nothing else.
- A file that a later release adds as a template is copied by the update that brings it, once. A file that it adds as managed is installed and then replaced like the others. A file that a release removes from the install set, or renames, is a change that a person has to see, and it makes the next release a major one ([releases](releases.md#versioning)).

**The settings template is empty on purpose.** Every key of [the settings page](settings.md) is in it, commented out at its default, so that a repository that keeps `docs/decisions` needs no edit but its owners. Without owners no act can be approved, so the first owners are written by a person, and a pull request that names the first owners would be judged by a base that has none: the first settings file is made by an administrator ([the workflow](workflow.md#what-a-repository-must-set)).

**The README template has an empty index and no protocol generation.** The generations of the protocol are the kit's own: its records folder lists them, and a repository that installs the kit has no record of the protocol to list. The index is the table header and nothing after it, in the form that `validate` demands, and the first record adds the first row.

## What the check guards

| File | A change to it is | Met by |
| ---- | ----------------- | ------ |
| a managed program | the act `code`, one for each file | the approval of the owners |
| a managed workflow | the act `workflow`, one for each file | the approval of the owners |
| the skill, and the block of `AGENTS.md` | the act `instructions`: a change to the skill, or to the text between the markers or to a marker | the approval of the owners ([the files that agents read](agent-files.md#the-check-and-the-audit)) |
| `.github/record-keeper/settings.yml` | the act `settings`, and the act `owners` when the owners change or the number of approvals is lowered | the approval of the owners, and the bar for an amendment for `owners` ([amendments](amendments.md)) |
| `.github/record-keeper.yml` | the act `pin` | the approval of the owners |
| a record, the index, the template | judged by the rules of the records folder ([checking a change](checking-a-change.md)) | |

- **The guard lists both places.** The check guards the five programs at the root and the five in `.github/record-keeper/`, and the four workflows, whether the files exist or not. So a pull request that adds a program or a workflow of the kit later is an act, and no pull request has to change the guard. The reasons and the cost are on [the page of the files of the check](protected-files.md).
- **Every managed file is guarded, and every guarded path that is in the install set is managed or a block.** The tests of the kit say so ([test/install.test.mjs](../test/install.test.mjs)): a managed file that no act covered would be a file that the next update replaces without anyone being asked, and a guarded path that was a template would be a file that an update never touches and a person has to approve all the same. The skill is guarded as `instructions`, and `AGENTS.md`, a block, is guarded only where the kit writes in it. `CLAUDE.md` is a template and is not guarded.
- **An update is an ordinary pull request.** It changes the pin and the managed files together, and its acts are met by the ordinary approval of the owners, not by the bar for an amendment (the decision of 2026-11-07, [amendments](amendments.md)).

## `install.json`

The install set is one file at the root of the kit, `install.json`. The release manifest ([releases](releases.md#the-manifest)) is made from it and from nothing else, and so is whatever the updater installs.

```json
{
  "schema": 1,
  "generations": ["g1"],
  "files": [
    { "source": "record-keeper.mjs", "path": ".github/record-keeper/record-keeper.mjs", "kind": "managed" },
    { "source": "templates/agents-block.md", "path": "AGENTS.md", "kind": "block" },
    { "source": "templates/settings.yml", "path": ".github/record-keeper/settings.yml", "kind": "template" }
  ],
  "requires": { "secrets": ["RECORD_KEEPER_TOKEN"], "settings": ["owners"], "rulesets": [{ "branch": "default", "checks": ["Records integrity"], "up-to-date": true }] }
}
```

| Key | What it is |
| --- | ---------- |
| `schema` | The form of this file: `1`. A different number is refused. |
| `generations` | The generations of the protocol that this release reads and writes, like `g1`. A release that adds a generation is a major one ([releases](releases.md#versioning)). |
| `files` | The install set: for each file its `source` (a path in the kit), its `path` (the destination in a repository) and its `kind`: `managed`, `block` or `template`. For a block the `source` is the text of the block, from the begin marker to the end marker with no line feed after it, and its digest in the manifest is the digest of the block. |
| `requires` | What a repository must provide for the release to mean anything: `secrets` (names of repository secrets), `settings` (keys of the settings file that must be set), `rulesets` (what a ruleset on a branch must require). |

**What a path may be.** `source` and `path` are relative paths written with `/`, made of printable ASCII (a space is allowed inside a name). A path has no empty part, no `.` or `..`, no part that starts or ends with a space or ends with a dot, no `.git`, no backslash and no colon, and does not start with `/`. A `source` is a regular file of the kit: a symbolic link, on the way or at the end, is refused, because the release must hold what the manifest says it holds. A `path` is below `.github/` or `docs/decisions/`, or one of three files: the skill `.claude/skills/record-a-decision/SKILL.md`, `AGENTS.md` and `CLAUDE.md`; the kit does not write anywhere else. **`AGENTS.md` is installed as a block and as nothing else, and nothing but `AGENTS.md` is a block**: a managed `AGENTS.md` would replace a file that the maintainers own. Two paths that are the same but for capitals are one path, and a path that is a file may not have another path below it.

**What `requires` says today.** The workflows of the check, of the audit and of the setup check need nothing but the token that GitHub gives each run (the setup check is told only whether the secret below is set, and never receives it). The updater opens pull requests, which the workflow token may not do under the policy planned for the organisation ([the design](design.md#delivery-and-versions)), so it needs a secret of its own, `RECORD_KEEPER_TOKEN` ([the token](updater.md#the-token)), and `secrets` lists it. After the first release a new required secret makes a release a major one ([releases](releases.md#versioning)). A test keeps the list equal to the secrets that the installed workflows use. `settings` is `["owners"]`: without owners no act can be approved. `rulesets` is one entry: a ruleset on the default branch that requires the check `Records integrity` and requires branches to be up to date ([the workflow](workflow.md#what-a-repository-must-set)). The setup check is not on the list: it is not a required check and must not be made one ([the setup check](setup-check.md#what-fails-the-run-and-what-does-not)).

**A change to this file is read by a person.** It is the list of what a release writes into other people's repositories, so the order of `files` is the order in which a person reads it: the managed files first, then the block, then the templates. A test keeps it so.

## The workflows of a repository

The workflows that a repository installs are the kit's own with one change: the program is run where the install set puts it. `node check-pull-request.mjs` becomes `node .github/record-keeper/check-pull-request.mjs`, `node run-audit.mjs` becomes `node .github/record-keeper/run-audit.mjs`, `node setup-check.mjs` becomes `node .github/record-keeper/setup-check.mjs`, and a comment that names a page of the kit by its path (`docs/workflow.md`) names it by its address instead, because a repository does not have that page. Nothing else differs, and a test makes the second file from the first and fails when they drift ([test/install.test.mjs](../test/install.test.mjs)). The files stand in `templates/workflows/`, not in `.github/workflows/`, so that GitHub does not run them in the kit.

The tests of [the workflow](workflow.md#the-tests) and of [the audit run](audit-run.md) are run on both files, so a rule of the page holds for the version that a repository gets. The programs run from the folder with the repository as the working directory: they import `./record-keeper.mjs`, which imports `./updater.mjs` for the one function that finds the block of `AGENTS.md`, and the setup check also `./updater.mjs` and `./run-audit.mjs`, which stand in the same folder. Another test builds a repository with this layout, and runs `validate`, `config`, `seal`, the pull request check, the audit and the setup check from `.github/record-keeper/` against a local server that plays GitHub.

## First adoption

A repository gets the kit **once, by hand,** with `updater.mjs --local`; every later update is a pull request that the updater opens ([the updater](updater.md)). In order:

1. **The owners first.** Write `.github/record-keeper/settings.yml` with `owners` (and `approvals`) and commit it, as an administrator. Without owners no act can be approved, and a template is copied only where nothing is, so the updater keeps that file.
2. **Fetch the updater of the release** you adopt and run it with `--local --source gearsnlevers/record-keeper --target <tag>` from the root of the repository. It downloads every file at the commit of the tag, verifies it against the manifest, writes the managed files, installs the templates that are missing and writes the pin. It touches no branch and makes no pull request.
3. **Read the diff** (the first adoption is the one change that nothing checks, because the check is part of what it installs), open the pull request by hand, and have the owners approve and merge it.
4. **Create the secret `RECORD_KEEPER_TOKEN`** and set the ruleset in `requires`. Updates arrive from then on.

A repository that kept records before the kit has one step more, a second pull request that seals them ([adopting with records that already exist](#adopting-with-records-that-already-exist)).

The commands and what each can go wrong with are on [the page of the updater](updater.md#first-adoption-by-hand). It cannot be tried before the first release exists (M3e).

## Adopting with records that already exist

A repository that kept decision records before the kit has records that say `accepted` or `superseded by NNNN` and have no `seal:` line. The first adoption above does not touch them: it writes no file of the records folder but the README and the template, and only where there are none. They are not sealed in the sense of [checking a change](checking-a-change.md) until a pull request seals them, and until then a change that touches one fails the check with P-06. The first sealing is a pull request of its own, made by `seal --adopt`:

1. **The first pull request installs the kit** ([first adoption](#first-adoption)) and changes no record.
2. **Fix first, seal last, in the same pull request.** The seal covers every key of a record but `status`, `date` and `seal`, and every section but `Known deviations` and `Errata`, so a change to a record after it has its seal is a change to a sealed record, which the check refuses (P-02). Everything that has to change in the text of a record changes before it is sealed, and in the pull request that seals it: a record that says `accepted` and has no seal fails the check with P-06 when a change touches it, unless the change seals it, so the fixes cannot go in a pull request of their own. Run `node .github/record-keeper/record-keeper.mjs validate` (give the folder and the settings that the repository needs) and read what it says; `seal --adopt` fixes none of it. The pull request that seals is judged by more than `validate` says (step 5), and two of the problems that `validate` does not report are common: a record that is `superseded by NNNN` needs its successor to list it in a `supersedes:` key (P-04), and every `applies-to` item of a record that becomes sealed has to match a file of the repository (P-17).
3. **Look at what would be sealed:** `node .github/record-keeper/record-keeper.mjs seal --adopt` (give the folder when it is not `docs/decisions`). It is a dry run: it writes nothing, and says for each record `would seal`, `already has a seal`, `skipped (status ...)` or `cannot seal (...)`, and then how many of each. A record that `cannot seal` is a record that g1 rejects, or one that has no room for the line; the answer names the rule. The command exits 1 while there is one.
4. **The second pull request seals the records.** Make the fixes of step 2, run the same command with `--write` and read the diff: the seals are one added line, `seal: sha256-g1:...`, in each sealed record, and nothing else in the records that needed no fix. Then commit it and run the check on it as the workflow will: `node .github/record-keeper/record-keeper.mjs check-pr --base <the default branch> --head HEAD` (with `--reviews <file> --author <id>` to see the approvals as well, [approvals](approvals.md)). If it says that a record has to change, delete the `seal:` line of that record, change the record, and run `seal --adopt --write` again: it seals the records that have no seal line, and no other.
5. **The owners approve it.** The pull request check sees every sealed record as one that is not sealed at the base and is sealed at the head, which is the act `accept` ([checking a change](checking-a-change.md#acts)): each record is an act that the owners approve ([approvals](approvals.md)), and in the single-owner mode the author's own pull request counts ([the design](design.md#single-owner-mode)). The records are judged as records that are new to the check, by all the rules of the format and the rules of a sealed record, not only by what the change adds: a record that has a problem of its own (a status that is not allowed, a value where a list is wanted, a superseded record that nobody lists, an `applies-to` item without a file) fails the pull request with that problem until it is fixed in the same pull request, or the record is left unsealed and the problem stays.
6. **Another validator in the repository** (a script or a test that checks the records and rejects a key that is not in its own list) **has to be removed or changed in the same pull request that adds the seals,** or the key `seal` fails it there. If an update or a delivery puts that validator back, it has to stop first, or it undoes the pull request on the next run.

**What `seal --adopt [folder] [--write]` does.** The folder is `docs/decisions` unless it is given, and the command reads that folder and nothing below it (a shared folder is out of scope, as it is for `validate`). It looks at each file that is not `README.md`, `template.md` or a name that starts with a dot, in the order of the names, and says one of these:

| It says | When |
| ------- | ---- |
| `cannot seal (G1-nn: ...)` | g1 rejects the record. This is read first, so a record with a rule of g1 broken is listed under that rule whatever its status. |
| `skipped (status ...)`, `skipped (no status)` | its status is not `accepted` and not `superseded by NNNN`: `proposed`, `rejected`, `deprecated` and a status that is not one at all are not sealed. |
| `already has a seal` | the record has a `seal:` line of any value, valid or not. **It is never rewritten:** a wrong seal is the one thing that a person has to look at, and a command that wrote over it could hide a change. |
| `would seal`, and `sealed` with `--write` | the record is `accepted` or `superseded by NNNN` and has no seal line. |
| `cannot seal (V-10: ...)` | the line would make the record longer than the 60 lines that V-10 allows. A record that is exactly at the length has no room for the line; shorten it by one line, which an unsealed record allows, and run the command again. A record that is longer than that already is sealed all the same, and V-10 keeps reporting it as it did. |
| `cannot seal (V-04: ...)` | the entry is a symbolic link, or is neither a file nor a folder. It is not read and not written, and what it points at is not touched. |
| `skipped (not a record file)` | a regular file whose name is not `NNNN-short-title.md`. |

- **The line.** `seal: sha256-g1:<64 hexadecimal digits>` is added as the last line of the front matter, directly before the closing `---`, with the line ending of the line before it, as the record of the kit itself has it. **No other byte of the file changes:** a CRLF file stays CRLF, a missing final newline stays missing, trailing white space stays, and a key order that is not the order of the template stays. The seal does not cover `status`, `date` or `seal` ([generation g1](generation-g1.md)), so where the line goes does not change what it is, and a file that cannot take the line without another change is listed and left as it is. The seal is the one `seal <file>` prints; the command checks that the new bytes verify and that the old bytes are all still there before it writes.
- **A dry run is the default.** Nothing is written unless `--write` is given, and `--write` writes only the files that `would seal`. It writes every one it can and lists the others, so a folder in which one record cannot be sealed gets the rest sealed and exit status 1.
- **Exit status.** 0 when no record is listed as `cannot seal`; 1 when one is; 2 for wrong usage, a folder that is not there, a file that cannot be read (nothing is written then) and a file that cannot be written (the lines of the files written until then are printed with the error).
- **It is idempotent.** A second run finds a seal line in each record that the first one sealed and writes nothing, and a record that was changed in between is not sealed again: it has a seal line.
- **It does not accept anything.** It never changes a status and it does not judge a record. `validate` gives the same problems after it as before (the one rule that the line could add, V-10, is why a record at the length is listed), and the status vouching (a superseded record, and the record that supersedes it, which lists it) is judged by the pull request check, not by this command.

## What this page does not do

- **It does not install anything.** The first adoption, and the update that follows it, are [the updater](updater.md). It reads the manifest of the release it installs ([releases](releases.md)), which is made from `install.json`, and verifies every file it downloads against it.
- **It does not say what happens to a file that the repository changed,** but the updater does: a managed file that a person edited is replaced by the next update, and the update pull request lists it under "Local changes this update overwrites" ([the updater](updater.md#the-plan)).
- **It does not move the records folder.** The templates are installed where the default setting says, and the updater does not read the settings. A repository that keeps its records elsewhere (`folder:` in the settings) removes the two files of `docs/decisions/` from its first adoption pull request, and the updater does not bring them back ([the updater](updater.md#what-is-managed-and-what-is-a-template)).
- **It does not check the installation.** That is [the setup check](setup-check.md), whose program and workflow are two entries of `install.json` (added by M3c, with no change to the guard, as the updater's were by M3b).

## Choices in this draft for you to decide

1. **One folder, `.github/record-keeper/`, for the programs and the settings** (decided by the maintainer before this draft). The pin stays beside it as `.github/record-keeper.yml`.
2. **The guard lists both places, and the names at the root are guarded in every repository.** A file of a repository's own named `updater.mjs` at its root is guarded. See [the files of the check](protected-files.md#choices-in-this-draft-for-you-to-decide), choice 2.
3. **`install.json` is an object, not a bare list,** with `schema`, `generations`, `files` and `requires`. The manifest is made from it alone, so there is one file to read for what a release says, and a later field has a place. A bare list would be shorter and would need a second file for `requires`.
4. **`generations` and `requires` are in `install.json`,** not in the code of the manifest builder, so that a person changes them in the file that is reviewed as the list of what a release writes. A test compares `generations` with the generation that the code knows.
5. **A path is printable ASCII.** The kit's own paths are, and a rule that needed a table of Unicode would be read differently by the two implementations of the manifest. A name with a space is allowed, because a repository may have one.
6. **A destination is below `.github/` or `docs/decisions/` only.** The kit writes nowhere else. The records folder is only the default one; the updater does not read the settings, and a repository with another folder removes the templates of `docs/decisions/` by hand once ([the updater](updater.md#choices-in-this-draft-for-you-to-decide), choice 15).
7. **The settings are a template, not a managed file,** although the kit defines every key in it. They are the repository's: an update that replaced them would drop the owners.
8. **`requires.rulesets` includes "up to date".** The page of the workflow says a repository must set it, although the check does not depend on it (a stale head fails with P-09). Say so here too, or leave it out when you decide that it is only advice.
9. **The consumer workflows are made by a test, not by a script.** The test makes each from the kit's file and compares; the committed copy is the file that is installed. A script that rewrote the copy would be one more program to trust; the cost is that a change to a kit workflow is made twice, and the test says which line differs.
10. **The page of the workflow names its pages by address in the consumer version.** The alternative is to leave the path, which is a dead link in a repository, or to change the kit's own comments, which changes a guarded file for no reason of its own.
11. **A third kind, `block`, for the text of the kit in a file that the repository owns** (M3d). The alternatives were the whole `AGENTS.md` as a managed file (it would overwrite the maintainers' own text) and a file of its own for the rules that `AGENTS.md` imports (not every agent follows an import). The manifest says the kind and the one path it may have, and every reader of the manifest (the builder, the Python verifier, the updater, and the setup check through the updater) refuses a block anywhere else and `AGENTS.md` as anything else. The cost: a new kind is a thing an older updater refuses (`manifest-kind`), which is free before the first release and a major one after it ([releases](releases.md#versioning)).
12. **The skill and `CLAUDE.md` are not in a folder of the kit,** because agents read them where they are: `.claude/skills/record-a-decision/SKILL.md`, `AGENTS.md` and `CLAUDE.md` are the only paths outside `.github/` and `docs/decisions/` that the kit writes.
