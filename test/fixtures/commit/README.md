# Fixtures of `validate --commit`

[docs/reading-a-commit.md](../../../docs/reading-a-commit.md) says how the kit reads the records folder of a commit and which rules apply to a commit. `cases.json` has one entry for each case, and an implementation is correct when, for every case, it reports exactly the problems listed: the same files and rules, the same number of times, and for T-02 and T-03 the same detail. The order does not matter.

Two sets of cases check an implementation of `validate --commit`:

- **Every case of the format page** ([test/fixtures/validate](../validate/README.md)) is put into a commit and checked as the folder `<id>` of its tree. It must give the answer in its own `cases.json`, V-04 included: the symbolic links a case declares are committed as links.
- **The cases here** add what only a commit can hold: a mode, a link or a submodule, a `.gitattributes` file, a file outside the folder, a folder that is a link.

## The fields of a case

| Field | Meaning |
| ----- | ------- |
| `id` | A unique name. |
| `base` | The case of the format page whose files are put in the folder, or `null` for none. |
| `folder` | The records folder to check, a path of the tree. |
| `place` | Optional. Where the files of `base` are put instead of `folder`, for the cases where the folder is a link. |
| `changes` | Optional. What is done to the tree, in order (below). |
| `expect` | The problems the case must produce, as `{ "file", "rule" }` (`file` is `null` for a problem of the folder as a whole), and a `detail` for T-02 and T-03. |
| `note` | What the case tests and why the answer is what it is. |

A change is one of these. A path is relative to the folder unless the change says `root`.

| Change | Meaning |
| ------ | ------- |
| `{ "mode": name, "to": mode }` | Sets the mode of a file of the base. |
| `{ "write": name, "content": text, "mode"? }` | Adds a file (mode `100644` unless it says otherwise). |
| `{ "symlink": name, "target": text }` | Adds a symbolic link, mode `120000`. |
| `{ "submodule": name }` | Adds a submodule, mode `160000`. |
| `{ "remove": name }` | Removes a file. |
| `{ "root": path, "content": text, "mode"? }` | Adds a file at a path of the tree. |
| `{ "root": path, "target": text }` | Adds a symbolic link at a path of the tree. |
| `{ "root": path, "submodule": true }` | Adds a submodule at a path of the tree. |

The trees are built with `git fast-import`, so nothing is checked out and the modes can be set directly. The test in [test/commit.test.mjs](../../commit.test.mjs) shows one way to do it.
