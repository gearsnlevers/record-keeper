# Reading a records folder from a commit

Status: draft for review (M2.1). This page says how the kit reads the records folder of a commit, and which problems a commit can have that a folder on disk cannot show. It is not part of the protocol. Like [the format of a record](record-format.md), a rule here changes what the kit accepts from then on and never what a seal means; a repository takes a changed rule by taking the kit release that carries it.

The pull request check and the audit judge what is committed. A checkout can differ from the commit in ways a reader does not see: a filter or an encoding rewrites bytes, a symbolic link is followed, an executable bit is set, a diff is hidden, another folder holds records that other tools read. So the kit reads the commit itself, through git, and not a working copy.

## How a commit is read

- A **revision** names a commit. The kit resolves it to the id of the commit. A revision that does not name a commit is wrong usage, not a problem of the records.
- The kit lists the tree of the commit and reads the contents of the files with git. It never checks the commit out, so no filter, no end-of-line conversion, no sparse checkout and no symbolic link takes part.
- An **entry** is one line of the tree, and its **kind** comes from its mode: `100644` is a file, `100755` an executable file, `040000` a directory, `120000` a symbolic link, `160000` a submodule, and any other mode is something else. A regular file is a file or an executable file.
- The **records folder** is a path of the tree written with `/`. It exists when the tree has a directory at that path. If a part of the path is a symbolic link, a submodule or a file, the folder does not exist in the tree (V-01): the kit follows nothing.
- A **name** is the bytes of the entry read as UTF-8. A name that is not valid UTF-8 is not the name of a record (V-05).
- The folder is judged by the rules V-01 to V-36 of [the format page](record-format.md), with the entries of the tree in place of the entries of a directory: a symbolic link, a submodule and anything else that is neither a regular file nor a directory is V-04. They give the same answers as for a folder on disk that holds the same files; the [fixtures](../test/fixtures/commit/README.md) check it for every case of the format page.

## The rules of a commit

A problem has a file (or none, for a folder other than the checked one), a rule and a message, as in the format page. The column "Once per" says how often a rule may be reported for one commit.

| Rule | A problem is reported when | Once per |
| ---- | -------------------------- | -------- |
| T-01 | a file of the records folder has the executable mode | file |
| T-02 | a file of the records folder has a git attribute other than `text` and `eol` | file |
| T-03 | a conventional records folder, other than the one checked, holds a `README.md` or a record file | folder |

- The T rules are applied only when the records folder exists in the commit; when it does not, V-01 is the only problem.
- A **file of the records folder** is an entry directly in the folder, whose name does not start with a dot, and that is a file or an executable file: the entries the V rules look at.
- The **attributes** of a file are what `git check-attr -a` reports for its path in a repository that holds only this commit, so the `.gitattributes` files of the commit, at any level, decide and nothing of the machine does: not `info/attributes`, not a global or system attributes file. They are read as committed and not from a checkout, where an attribute such as `working-tree-encoding` can re-encode the `.gitattributes` file itself and make it unreadable. Macros are expanded (`binary` stands for `-diff -merge -text`), and an attribute that is unset or set to a value counts as much as one that is set. The detail of T-02 lists them, sorted by name, as `name: value`; `text` and `eol` are left out of the list.
- The **conventional records folders** are `docs/decisions`, `docs/adr`, `docs/adrs`, `docs/architecture/decisions`, `doc/adr`, `doc/decisions`, `decisions`, `adr` and `adrs`. T-03 does not look at the folder that is checked, nor at a folder inside it. A folder **holds** a `README.md` or a record file when one of its direct entries is a file with the name `README.md`, or with the name of a record file (`NNNN-short-title.md`). The detail of T-03 is the path of that other folder.
- A symbolic link or a submodule is never followed or entered, so a conventional folder that is one holds nothing.

## How a problem is reported

`record-keeper validate --commit <revision> [folder] [--repo <path>]` checks the folder, a path of the tree (`docs/decisions` by default), as it is in the commit. `--repo` names the git repository, the current folder by default. The settings and the output are those of [the format page](record-format.md#how-a-problem-is-reported), and the T rules are reported like the V rules. It exits 0 when there is no problem, 1 when there is at least one, and 2 for wrong usage: also when the revision names no commit, when the repository cannot be read, or when `git` cannot be run. `validate` without `--commit` never reports a T rule: a folder on disk has neither a commit nor reliable modes.

## What changes for the repositories

Read as commits of their default branches, the records folders of the maintainers' repositories (the Issue Concierge, frodo-lib, frodo-cli, the tap, the umbrella repository, the five action repositories, and this one) have no T problem: none has an executable record, an attribute for its records folder, or a second folder of records. Each gives the same V problems as the folder on disk, taken from an extracted copy of the same commit.

## What this does not do

- It does not compare two commits, and it does not say whether a change is allowed. That is [checking a change](checking-a-change.md).
- It does not read the settings of a repository. The folder, the shared folder and the extra keys are options here; [the settings file](settings.md) states them, and `validate --commit <revision> --settings-from <revision>` reads them from a commit. The list of conventional folders is fixed.
- It does not look inside the shared folder or a submodule.

## Choices in this draft for you to decide

1. **The commit is read through git, never checked out.** `--commit` needs `git` on the path; `validate` of a folder needs nothing. A reader that works from a checkout cannot see what the commit holds, and a checkout is what a filter or a link changes.
2. **T-01 refuses the executable mode.** A record is text, and a mode change is a change no reader of the text sees. The cost is a file system that marks every file executable, where one command (`git update-index --chmod=-x`) puts it right. This is the weakest rule here; the alternative is to drop it.
3. **T-02 refuses every attribute except `text` and `eol`.** `filter`, `ident` and `working-tree-encoding` rewrite the bytes a working copy shows; `diff` (also through `binary`) and `linguist-generated` hide a change from a reviewer's diff; and the list of attributes that some tool honours is open-ended, so a short list of bad ones would miss the next. `text` and `eol` are allowed because g1 ignores line endings: they change neither a seal nor the words a reader sees, and refusing them would refuse the common `* text=auto`. None of the maintainers' repositories sets an attribute for its records folder today.
4. **T-03 uses a fixed list of conventional folders.** The point is that a second folder of records is a place where records bind, as far as another tool or an agent is concerned, and the kit does not judge it. The list stays fixed; a setting for more folders can be added when a repository needs one. A repository whose records live in a folder that is not on the list gets T-03 only for the folders that are.
5. **A symbolic link, a submodule or anything else in the folder is V-04, as on disk,** and a symbolic link in front of the folder (`docs` pointing elsewhere) makes the folder missing, not followed.

## The fixtures

[test/fixtures/commit](../test/fixtures/commit/README.md) holds `cases.json`: each case is a case of the format page, or a small tree, with the changes that make it a commit (a mode, a link, a submodule, an attributes file, a file outside the folder) and the problems the kit must report for it. Every case of the format page is also run as a commit and must give the same answer as the folder.
