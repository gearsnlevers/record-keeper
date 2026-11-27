# The files of the check

Status: describes the released kit (v1.3.0 is the current release; written in M2.7a, with the files of a repository that installs the kit added in M3a, the setup check of M3c, and the files that agents read in M3d). This page says which files make the check, the skill and the block that agents read, where they stand, why a change to them is an act, and a rule that keeps another workflow from standing in for the check. It is not part of the protocol. It is read with [checking a change](checking-a-change.md), whose acts and rules it extends, and with [the workflow](workflow.md), which says how the files run.

A pull request cannot change the check it is judged by: `pull_request_target` runs the workflow of the default branch ([the workflow](workflow.md)). But a pull request that is merged changes the check of the next one. So the files that make the check are guarded like the settings and the pin: a change to one is an **act**, and the owners must approve it. Until now only the settings and the pin were.

## The files

| Kind | Files | Act |
| ---- | ----- | --- |
| workflow | `.github/workflows/records-integrity.yml`, `.github/workflows/records-audit.yml`, `.github/workflows/records-setup-check.yml`, `.github/workflows/records-updater.yml` | `workflow` |
| code | `record-keeper.mjs`, `check-pull-request.mjs`, `run-audit.mjs`, `setup-check.mjs`, `updater.mjs` | `code` |
| code | `.github/record-keeper/record-keeper.mjs`, `.github/record-keeper/check-pull-request.mjs`, `.github/record-keeper/run-audit.mjs`, `.github/record-keeper/setup-check.mjs`, `.github/record-keeper/updater.mjs` | `code` |
| instructions | `.claude/skills/record-a-decision/SKILL.md`, and the block between the two markers of `AGENTS.md` | `instructions` |

- The workflow files are the workflows of the kit: the pull request check ([the workflow](workflow.md)), the audit ([the audit run](audit-run.md)), and the two that M3 adds, [the setup check](setup-check.md) and the updater. They stand at the same paths in the kit and in a repository that installs it.
- The code files are the ones the workflows run: the rules, the program that reads a pull request (it only reads), the program that runs the audit (it also writes the incident issues and the log branch, which is why it is a file of its own), and the two that M3 adds, the setup check and the updater. **They are guarded in both places they can stand.** The kit's own repository keeps them at the root, where its workflows call them. A repository that installs the kit keeps them in `.github/record-keeper/`, next to its settings file ([install](install.md)), and its workflows call them there. The same code judges both repositories, so the list holds both places, and a later milestone that adds a workflow or a program does not change the guard.
- **A file that does not exist yet is guarded all the same.** The setup check and the updater were in that case until M3c and M3b, which added `setup-check.mjs` and `records-setup-check.yml`, and `updater.mjs` and `records-updater.yml`, with no change to the guard. The setup check has a copy of its workflow in the kit itself, as the audit has, and the updater has none.
- **The names are exact.** A file that only looks like one (`record-keeper.mjs.bak`, `.github/record_keeper.mjs` or a program of the same name in another folder) is not guarded.
- The settings (`.github/record-keeper/settings.yml`) and the pin (`.github/record-keeper.yml`) stay acts of their own kind, as in [checking a change](checking-a-change.md#acts). The settings file lies in the same folder as the installed programs and is not mistaken for one: a change to it alone is the act `settings` and no act `code`, and a change to a program alone is no act `settings`. A change that replaces the folder `.github/record-keeper`, or `.github`, by a file is all of them at once, because every guarded path below it changed.
- **An update keeps the ordinary approval.** [The updater](updater.md) (M3b) changes the pin, the workflow files and the programs in one pull request. That is a set of acts `pin`, `workflow` and `code`, and the owners' ordinary approval meets them, not the bar for an amendment: the decision of 2026-11-07 ([amendments](amendments.md)). Nothing here changes it.
- **The files that agents read are guarded too, as the act `instructions`** (M3d, [the files that agents read](agent-files.md)). The skill is a managed file and is guarded like a workflow file: a change to it, to a folder in front of it or to something below it is the act, whether the file exists or not. `AGENTS.md` belongs to the repository, so only **what the kit writes in it** is guarded: a change to the text between the two markers, to a marker, or to a file that is not a regular file there is the act, and a change anywhere else in the file is nothing ([the one function that says it](agent-files.md#one-function-for-the-four-programs)). `CLAUDE.md` is a template and is not guarded.
- A repository's own workflows (a `test.yml`, say) are not the kit's and are not guarded here.

## The acts

| Act | Found when | Path |
| --- | ---------- | ---- |
| `workflow` | a changed path is one of the workflow files, a folder in front of it, or something below it | that file |
| `code` | a changed path is one of the code files, a folder in front of it, or something below it | that file |
| `instructions` | a changed path is the skill, a folder in front of it, or something below it; or `AGENTS.md` changed and its block, its markers or its being a regular file did | that file |

- **Changed path.** As for the settings and the pin: the paths of the files that differ between the two trees, without rename detection; a directory that replaces the file, or a file that replaces the directory, counts, and so does a file that is added, changed, removed, or given another mode or turned into a link.
- **One act for each file.** Two workflow files and a code file changed in one pull request are three acts. The order of the acts is `accept`, `erratum`, `deviation`, `settings`, `owners`, `pin`, `workflow`, `code`, `instructions`, then by path.
- **Met by the approval of the owners** ([approvals](approvals.md)), like the settings and the pin. They do not meet the bar of an amendment (M2.7b), which is for the owners and for a record that replaces the protocol.

## The rule

| Rule | A problem is reported when | Kind | Detail |
| ---- | -------------------------- | ---- | ------ |
| P-15 | a workflow file other than the kit's is added or changed and names the check | change | the path |

- **A workflow file** is a regular file (also with the executable mode) directly in `.github/workflows`, whose name ends in `.yml` or `.yaml` (the capitals of the extension do not matter). GitHub reads no other file. The kit's four workflow files are not looked at by this rule: they are acts of their own, and the setup check will name the check in its text. A copy of one of them with the extension `.yaml` is not the kit's, and this rule looks at it.
- **Names the check** is a match of the pattern `records` and `integrity`, with nothing or one space, hyphen or underscore between them, in capitals or not (the regular expression `/records[ _-]?integrity/i`), in the **name of the file** or anywhere in its **content**, read as bytes. A word in a comment counts. A name written so that no such text stands in the file (an escape, an expression of the workflow) is not found; see "What this does not do".
- **Only what the pull request adds or changes** is judged: a file that is removed is not, and a file that already named the check in the base and is not touched is not.
- **The problem is the pull request's, not a record's.** It has no file; the detail is the path of the workflow file, as for T-03: `docs/decisions: [P-15] ... (.github/workflows/other.yml)`.

## What this does not do

- **It does not read what a protected file says.** A change to the workflow that adds an `if:` is an act the owners approve; whether they notice is for them. The kit's own tests ([test/workflow.test.mjs](../test/workflow.test.mjs)) state what the workflow must and must not contain, and they run in the repository's own pipeline, but a pull request can change the test too.
- **It does not find every spelling of the name.** A job name can be built by the workflow's expressions or written with an escape. The real defence against a job of the same name is the ruleset: a same-named job cannot outvote or overwrite a failing real check, and only stands in when the real check does not report ([the design](design.md#how-a-pull-request-is-checked), E1 to E3).
- **It does not protect the ruleset,** which is not a file of the repository.
- **It cannot tell a harmless change from a harmful one,** so a change to a comment in a code file is an act too.
- **It is not the amendment bar** (M2.7b) and does not look at `applies-to` (M2.7c).

## Choices in this draft for you to decide

1. **The workflow and code files are acts met by the ordinary approval,** not by the amendment bar. The design lists the workflow files among the four acts the approval meets, and you decided the same for the pin. The bar is for the owners and for the protocol.
2. **The code files are guarded by their names, in both places.** The kit's own repository has them at the root, where its workflow runs them. A repository that installs the kit has them in `.github/record-keeper/` (decided by the maintainer before this draft, with the folder of the settings). Both lists are in the code, so the check is the same in every repository and a later milestone does not change it. The cost: a repository that has a file of its own at its root with one of those five names (`updater.mjs` is a likely one) is asked for the owners' approval when it changes it. The alternative, a list that depends on the settings, would make the guard a thing that the guarded can edit.
3. **The workflows and programs of later milestones are on the list before they exist.** A change that adds the audit workflow was already an act before M2.9; the setup check and the updater are now, in M3a, so that the pull requests that add them need no change to the guard.
4. **One act for each file,** so the approval line and the list of acts say which file changed.
5. **A text match, not a reading of the YAML.** The kit has no YAML reader for workflows, and a reader that misses a spelling is worse than a pattern that matches too much: the rule fails closed on any mention, a comment included.
6. **The name of the file counts too,** so `records-integrity.yaml` is refused even if it is empty.
7. **Only the files the pull request adds or changes** are judged; the base is not audited by this rule (the audit of M2.8 reads the whole tree).
8. **P-15 leaves the four workflow files alone,** as it left the two. A guarded workflow can name the check (the setup check asks whether `Records integrity` is required, in its program and on its page, and its workflow does not name it), and its change is an act that the owners must approve. A workflow of the same name with the extension `.yaml` is not guarded and is judged by P-15 if it names the check.
9. **The settings file is not a code file** although it stands in the folder of the programs. The two acts are different and are met by the same approval; keeping them apart keeps the announcement and the line of the check saying which of them changed.
10. **The skill and the block of `AGENTS.md` are a new act, `instructions`,** and not `code` or `workflow`: a file of text that an agent obeys is not a program, and the announcement and the line of the check should say what it is. It is met by the ordinary approval. `AGENTS.md` is guarded only where the kit writes in it, by one function that the updater, the check, the audit and the setup check share; the rest of the choices are in [the files that agents read](agent-files.md#choices-in-this-draft-for-you-to-decide).

## The fixtures

[test/fixtures/change](../test/fixtures/change/README.md) holds the cases (the group `y`, and the group `m` for the files that agents read), with the tree `kit` that has the files of the check.
