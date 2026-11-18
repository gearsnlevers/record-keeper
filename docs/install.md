# The install set and the layout of a repository

Status: draft for review (M3a). This page says what a repository gets when it installs the kit, where each file stands, which files are replaced by every update and which are copied once, what the check guards, and how `install.json` lists all of it. It is not part of the protocol. It is read with [the files of the check](protected-files.md), which says which of these files are acts, and with [releases](releases.md), which says how the list becomes a release. The updater that does the installing is M3b; this page says what it will have to put where.

## The layout

A repository that installs the kit has these files, and no other file of the kit:

```
.github/
  record-keeper.yml                        the pin: which release the repository wants (written by the updater, M3b)
  record-keeper/
    settings.yml                           the settings: the folder, the owners and the rest ([settings](settings.md))
    record-keeper.mjs                      the rules: validate, seal, check-pr, audit
    check-pull-request.mjs                 what the pull request workflow runs
    run-audit.mjs                          what the audit workflow runs
    setup-check.mjs                        later (M3c)
    updater.mjs                            later (M3b)
  workflows/
    records-integrity.yml                  the workflow that judges a pull request: the check `Records integrity`
    records-audit.yml                      the nightly audit
    records-setup-check.yml                later (M3c)
    records-updater.yml                    later (M3b)
docs/decisions/
  README.md                                the rules of the folder, and the index
  template.md                              the template of a record
  0001-....md                              the records of the repository
```

- **One folder for the kit's files.** The programs stand in `.github/record-keeper/`, next to the settings file that the maintainers own, so that the kit is one folder and one place to read. A repository that installs the kit has no `record-keeper.mjs` at its root.
- **The workflows stand where GitHub reads them,** in `.github/workflows/`, with the names above. Their names and the names of their jobs are what a ruleset requires, so a repository does not rename them.
- **The records stand in `docs/decisions/`** unless the settings say another folder ([settings](settings.md)). The files of the kit that go into the records folder are the README and the template of a record.
- **The pin is not in the folder,** because it is written by the updater and never edited by hand, while the folder holds the settings that people edit ([the design](design.md#configuration)).
- **The kit's own repository is not laid out this way.** It keeps its programs at its root, and its workflows call them there, so that it can run them without installing itself. The workflows of a repository that installs the kit are those of the kit with the paths of the programs changed, and nothing else ([the workflows](#the-workflows-of-a-repository)).

## Managed and template

Every file of the install set has a kind.

| Kind | What happens to it | Whose it is | Files |
| ---- | ------------------ | ----------- | ----- |
| `managed` | It is installed at the first adoption and **replaced by every update.** | the kit's | the programs in `.github/record-keeper/`, the workflows in `.github/workflows/` |
| `template` | It is copied **once,** at the first adoption, and **never overwritten** afterwards. | the repository's | `.github/record-keeper/settings.yml`, `docs/decisions/README.md`, `docs/decisions/template.md` |

- A managed file is never edited by hand: the next update replaces the edit. The check treats a change to one as an act that needs the owners' approval ([the files of the check](protected-files.md)), so a hand edit does not pass unseen either.
- A template is a start. The repository changes it as it likes (an owner is added to the settings, a rule is added to the README), and an update leaves it alone, because it holds what the repository decided. A change to the settings is still an act of its own kind, and a change to the records README is judged by the rules of the records folder.
- A file that a later release adds as a template is copied by the update that brings it, once. A file that it adds as managed is installed and then replaced like the others. A file that a release removes from the install set, or renames, is a change that a person has to see, and it makes the next release a major one ([releases](releases.md#versioning)).

**The settings template is empty on purpose.** Every key of [the settings page](settings.md) is in it, commented out at its default, so that a repository that keeps `docs/decisions` needs no edit but its owners. Without owners no act can be approved, so the first owners are written by a person, and a pull request that names the first owners would be judged by a base that has none: the first settings file is made by an administrator ([the workflow](workflow.md#what-a-repository-must-set)).

**The README template has an empty index and no protocol generation.** The generations of the protocol are the kit's own: its records folder lists them, and a repository that installs the kit has no record of the protocol to list. The index is the table header and nothing after it, in the form that `validate` demands, and the first record adds the first row.

## What the check guards

| File | A change to it is | Met by |
| ---- | ----------------- | ------ |
| a managed program | the act `code`, one for each file | the approval of the owners |
| a managed workflow | the act `workflow`, one for each file | the approval of the owners |
| `.github/record-keeper/settings.yml` | the act `settings`, and the act `owners` when the owners change or the number of approvals is lowered | the approval of the owners, and the bar for an amendment for `owners` ([amendments](amendments.md)) |
| `.github/record-keeper.yml` | the act `pin` | the approval of the owners |
| a record, the index, the template | judged by the rules of the records folder ([checking a change](checking-a-change.md)) | |

- **The guard lists both places.** The check guards the five programs at the root and the five in `.github/record-keeper/`, and the four workflows, whether the files exist or not. So a pull request that adds the setup check or the updater later is an act, and no pull request has to change the guard. The reasons and the cost are on [the page of the files of the check](protected-files.md).
- **Every managed file is guarded, and every guarded path that is in the install set is managed.** The tests of the kit say so ([test/install.test.mjs](../test/install.test.mjs)): a managed file that no act covered would be a file that the next update replaces without anyone being asked, and a guarded path that was a template would be a file that an update never touches and a person has to approve all the same.
- **An update is an ordinary pull request.** It changes the pin and the managed files together, and its acts are met by the ordinary approval of the owners, not by the bar for an amendment (the decision of 2026-11-07, [amendments](amendments.md)).

## `install.json`

The install set is one file at the root of the kit, `install.json`. The release manifest ([releases](releases.md#the-manifest)) is made from it and from nothing else, and so is whatever the updater installs.

```json
{
  "schema": 1,
  "generations": ["g1"],
  "files": [
    { "source": "record-keeper.mjs", "path": ".github/record-keeper/record-keeper.mjs", "kind": "managed" },
    { "source": "templates/settings.yml", "path": ".github/record-keeper/settings.yml", "kind": "template" }
  ],
  "requires": { "secrets": [], "settings": ["owners"], "rulesets": [{ "branch": "default", "checks": ["Records integrity"], "up-to-date": true }] }
}
```

| Key | What it is |
| --- | ---------- |
| `schema` | The form of this file: `1`. A different number is refused. |
| `generations` | The generations of the protocol that this release reads and writes, like `g1`. A release that adds a generation is a major one ([releases](releases.md#versioning)). |
| `files` | The install set: for each file its `source` (a path in the kit), its `path` (the destination in a repository) and its `kind`. |
| `requires` | What a repository must provide for the release to mean anything: `secrets` (names of repository secrets), `settings` (keys of the settings file that must be set), `rulesets` (what a ruleset on a branch must require). |

**What a path may be.** `source` and `path` are relative paths written with `/`, made of printable ASCII (a space is allowed inside a name). A path has no empty part, no `.` or `..`, no part that starts or ends with a space or ends with a dot, no `.git`, no backslash and no colon, and does not start with `/`. A `source` is a regular file of the kit: a symbolic link, on the way or at the end, is refused, because the release must hold what the manifest says it holds. A `path` is below `.github/` or `docs/decisions/`; the kit does not write anywhere else. Two paths that are the same but for capitals are one path, and a path that is a file may not have another path below it.

**What `requires` says today.** The workflows need nothing but the token that GitHub gives each run, so `secrets` is `[]`. The updater (M3b) opens pull requests, which the workflow token may not do under the policy planned for the organisation ([the design](design.md#delivery-and-versions)), so it will need a secret of its own, `RECORD_KEEPER_TOKEN`; it is not listed now because nothing in this release uses it. M3b adds it to this list, and after the first release a new required secret makes a release a major one ([releases](releases.md#versioning)). `settings` is `["owners"]`: without owners no act can be approved. `rulesets` is one entry: a ruleset on the default branch that requires the check `Records integrity` and requires branches to be up to date ([the workflow](workflow.md#what-a-repository-must-set)); M3c adds the check `Records setup check`.

**A change to this file is read by a person.** It is the list of what a release writes into other people's repositories, so the order of `files` is the order in which a person reads it: the managed files first, then the templates. A test keeps it so.

## The workflows of a repository

The workflows that a repository installs are the kit's own with one change: the program is run where the install set puts it. `node check-pull-request.mjs` becomes `node .github/record-keeper/check-pull-request.mjs`, `node run-audit.mjs` becomes `node .github/record-keeper/run-audit.mjs`, and a comment that names a page of the kit by its path (`docs/workflow.md`) names it by its address instead, because a repository does not have that page. Nothing else differs, and a test makes the second file from the first and fails when they drift ([test/install.test.mjs](../test/install.test.mjs)). The files stand in `templates/workflows/`, not in `.github/workflows/`, so that GitHub does not run them in the kit.

The tests of [the workflow](workflow.md#the-tests) and of [the audit run](audit-run.md) are run on both files, so a rule of the page holds for the version that a repository gets. The programs run from the folder with the repository as the working directory: they import `./record-keeper.mjs` and need nothing else of the kit. Another test builds a repository with this layout, and runs `validate`, `config`, `seal`, the pull request check and the audit from `.github/record-keeper/` against a local server that plays GitHub.

## What this page does not do

- **It does not install anything.** The first adoption, and the update that follows it, are the updater (M3b). It reads `install.json` of the release it installs, and the manifest ([releases](releases.md)) to verify what it downloaded.
- **It does not say what happens to a file that the repository changed.** A managed file that a person edited is replaced by the next update; whether the update pull request lists it is for the updater to decide.
- **It does not move the records folder.** The templates are installed where the default setting says. A repository that keeps its records elsewhere (`folder:` in the settings) tells the updater at its first adoption; how is for M3b.
- **It does not install the setup check or the updater.** Their files are guarded already; their entries are added to `install.json` by M3c and M3b.

## Choices in this draft for you to decide

1. **One folder, `.github/record-keeper/`, for the programs and the settings** (decided by the maintainer before this draft). The pin stays beside it as `.github/record-keeper.yml`.
2. **The guard lists both places, and the names at the root are guarded in every repository.** A file of a repository's own named `updater.mjs` at its root is guarded. See [the files of the check](protected-files.md#choices-in-this-draft-for-you-to-decide), choice 2.
3. **`install.json` is an object, not a bare list,** with `schema`, `generations`, `files` and `requires`. The manifest is made from it alone, so there is one file to read for what a release says, and a later field has a place. A bare list would be shorter and would need a second file for `requires`.
4. **`generations` and `requires` are in `install.json`,** not in the code of the manifest builder, so that a person changes them in the file that is reviewed as the list of what a release writes. A test compares `generations` with the generation that the code knows.
5. **A path is printable ASCII.** The kit's own paths are, and a rule that needed a table of Unicode would be read differently by the two implementations of the manifest. A name with a space is allowed, because a repository may have one.
6. **A destination is below `.github/` or `docs/decisions/` only.** The kit writes nowhere else. The records folder is only the default one; a repository with another folder is a question for M3b.
7. **The settings are a template, not a managed file,** although the kit defines every key in it. They are the repository's: an update that replaced them would drop the owners.
8. **`requires.rulesets` includes "up to date".** The page of the workflow says a repository must set it, although the check does not depend on it (a stale head fails with P-09). Say so here too, or leave it out when you decide that it is only advice.
9. **The consumer workflows are made by a test, not by a script.** The test makes each from the kit's file and compares; the committed copy is the file that is installed. A script that rewrote the copy would be one more program to trust; the cost is that a change to a kit workflow is made twice, and the test says which line differs.
10. **The page of the workflow names its pages by address in the consumer version.** The alternative is to leave the path, which is a dead link in a repository, or to change the kit's own comments, which changes a guarded file for no reason of its own.
