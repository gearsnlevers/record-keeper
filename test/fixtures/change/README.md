# Fixtures of `check-pr`

[docs/checking-a-change.md](../../../docs/checking-a-change.md) says how the kit judges the records folder of a head commit against a base commit. `cases.json` has the small repositories (`trees`) and the cases (`cases`). An implementation is correct when, for every case, it reports exactly the settings problems, the problems and the acts listed, in the order listed.

## `trees`

Each tree is the content of a commit, as a list of files.

| Field | Meaning |
| ----- | ------- |
| `path` | The path in the tree. |
| `content` | The text of a regular file (mode `100644`). |
| `link` | Instead of `content`: a symbolic link (mode `120000`) with this target. |

## `cases`

| Field | Meaning |
| ----- | ------- |
| `id` | A unique name. The letter says the group: a nothing to report, b a new record, c accepting, d a sealed record that changes, e the status of a sealed record, f supersedes lists, g concurrent supersession, h the base must be under the head, i the shared folder, j older problems, k settings, r an erratum, s the chain of Errata, x a deviation note (the keys an erratum may not change are `k01` to `k07` of the later group; see the ids). |
| `base` | The tree of the base commit. |
| `parent` | Optional. How the head commit stands to the base: `child` (the default: the head is a commit on top of the base), `none` (an unrelated commit), `ahead` (the head is an ancestor of the base) or `same` (the head has the tree of the base). |
| `changes` | What is done to the tree of the base to make the tree of the head, in order (below). |
| `expect.settings` | The problems of the settings, as `{ "line", "rule", "detail" }`; `line` is `null` for a problem with none. |
| `expect.problems` | The problems of the records, as `{ "file", "rule", "detail" }`; `file` is relative to the records folder and `null` for a problem of the folder as a whole. `detail` is given where it is part of the answer (P-02 to P-07, T-02, T-03) and left out for a V rule. |
| `expect.acts` | The acts, as `{ "kind", "path" }`. |
| `cases` | Optional. The issues and pull requests that exist, as `{ "issue": [numbers], "pull": [numbers] }`: what `--cases` holds. Without it none exists. |
| `since` | Optional. When the head was first seen, `YYYY-MM-DDTHH:MM:SSZ`: what `--since` holds. Without it there is no clock. |
| `now` | Optional. The time the case is judged at; `2026-11-10T00:00:00Z` when it is left out. |
| `needs` | Optional. What `needs` must give: `{ "cases": [{ "kind", "number" }], "clock" }`; none and no clock when it is left out. |
| `note` | What the case tests and why the answer is what it is. |

A change is one of these. A path is relative to the root of the tree.

| Change | Meaning |
| ------ | ------- |
| `{ "write": path, "content": text, "mode"? }` | Adds a file or replaces a path (mode `100644` unless it says otherwise). |
| `{ "remove": path }` | Removes a path. |
| `{ "symlink": path, "target": text }` | Adds a symbolic link. |
| `{ "submodule": path }` | Adds a submodule. |

A commit that a deviation note cites is written as the id of a commit of the repository of the fixtures. Such an id is not known until the commits are made, so `@BASE@` stands for the id of the base commit of the case itself and `@BASE:id@` for that of another case; the file here has the ids written in.

A file that stands where a folder is needed for a later path is removed, so a change can put a folder where a link was.

The trees are built with `git fast-import`, so nothing is checked out and a mode or a link can be committed freely. The test in [test/change.test.mjs](../../change.test.mjs) shows one way to do it.
