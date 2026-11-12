# The files of the check

Status: draft for review (M2.7a). This page says which files make the check, why a change to them is an act, and a rule that keeps another workflow from standing in for the check. It is not part of the protocol. It is read with [checking a change](checking-a-change.md), whose acts and rules it extends, and with [the workflow](workflow.md), which says how the files run.

A pull request cannot change the check it is judged by: `pull_request_target` runs the workflow of the default branch ([the workflow](workflow.md)). But a pull request that is merged changes the check of the next one. So the files that make the check are guarded like the settings and the pin: a change to one is an **act**, and the owners must approve it. Until now only the settings and the pin were.

## The files

| Kind | Files | Act |
| ---- | ----- | --- |
| workflow | `.github/workflows/records-integrity.yml`, `.github/workflows/records-audit.yml` | `workflow` |
| code | `record-keeper.mjs`, `check-pull-request.mjs`, `run-audit.mjs` | `code` |

- The workflow files are the two workflows of the kit: the pull request check ([the workflow](workflow.md)) and the audit ([the audit run](audit-run.md)).
- The code files are the ones the workflows run, at the root of the repository, where the workflows call them: the rules, the program that reads a pull request (it only reads) and the program that runs the audit (it also writes the incident issues and the log branch, which is why it is a file of its own). The updater of M3 decides where a deployment keeps them; it changes this list together with the workflow that calls them, which is itself an act.
- The settings (`.github/record-keeper/settings.yml`) and the pin (`.github/record-keeper.yml`) stay acts of their own kind, as in [checking a change](checking-a-change.md#acts).
- A repository's own workflows (a `test.yml`, say) are not the kit's and are not guarded here.

## The acts

| Act | Found when | Path |
| --- | ---------- | ---- |
| `workflow` | a changed path is one of the workflow files, a folder in front of it, or something below it | that file |
| `code` | a changed path is one of the code files, a folder in front of it, or something below it | that file |

- **Changed path.** As for the settings and the pin: the paths of the files that differ between the two trees, without rename detection; a directory that replaces the file, or a file that replaces the directory, counts, and so does a file that is added, changed, removed, or given another mode or turned into a link.
- **One act for each file.** Two workflow files and a code file changed in one pull request are three acts. The order of the acts is `accept`, `erratum`, `deviation`, `settings`, `owners`, `pin`, `workflow`, `code`, then by path.
- **Met by the approval of the owners** ([approvals](approvals.md)), like the settings and the pin. They do not meet the bar of an amendment (M2.7b), which is for the owners and for a record that replaces the protocol.

## The rule

| Rule | A problem is reported when | Kind | Detail |
| ---- | -------------------------- | ---- | ------ |
| P-15 | a workflow file other than the kit's is added or changed and names the check | change | the path |

- **A workflow file** is a regular file (also with the executable mode) directly in `.github/workflows`, whose name ends in `.yml` or `.yaml` (the capitals of the extension do not matter). GitHub reads no other file. The kit's two workflow files are not looked at by this rule.
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
2. **The code files are guarded by their names.** The kit's own repository has them at the root, where its workflow runs them. A repository that moves them (M3) moves this list with them.
3. **The audit workflow is on the list before it exists.** A change that adds it is then already an act.
4. **One act for each file,** so the approval line and the list of acts say which file changed.
5. **A text match, not a reading of the YAML.** The kit has no YAML reader for workflows, and a reader that misses a spelling is worse than a pattern that matches too much: the rule fails closed on any mention, a comment included.
6. **The name of the file counts too,** so `records-integrity.yaml` is refused even if it is empty.
7. **Only the files the pull request adds or changes** are judged; the base is not audited by this rule (the audit of M2.8 reads the whole tree).

## The fixtures

[test/fixtures/change](../test/fixtures/change/README.md) holds the cases (the group `y`), with the tree `kit` that has the files of the check.
