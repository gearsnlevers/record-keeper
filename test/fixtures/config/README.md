# Fixtures of the settings file

[docs/settings.md](../../../docs/settings.md) says how the kit reads `.github/record-keeper/settings.yml`. `cases.json` has two lists of cases, and an implementation is correct when, for every case, it reads exactly the settings listed and reports exactly the problems listed, in the order listed.

## `texts`: the bytes of a settings file

| Field | Meaning |
| ----- | ------- |
| `id` | A unique name. `ok…` cases have no problem; the others are named for the rule they show. |
| `text` | The file, as a string. Non-ASCII characters are written as JSON escapes, so that a character that is invisible or that changes the direction of text can be seen in the file. |
| `hex` | The file as hexadecimal bytes, instead of `text`, for a file that is not valid UTF-8. |
| `expect.settings` | The five settings after reading: `folder`, `sharedFolder`, `extraKeys`, `owners` (a list of `{ "login", "id" }`) and `approvals`, each at its default when the file does not set it or has a problem with it. |
| `expect.problems` | The problems, as `{ "line", "rule", "detail" }`; `line` is `null` when a problem has none. The order is that of the lines. |
| `note` | What the case tests and why the answer is what it is. |

## `trees`: a settings file in a commit

Each case is a small tree, committed as one root commit, and the file is read from the commit.

| Field | Meaning |
| ----- | ------- |
| `id`, `note` | As above. |
| `files` | The entries of the tree: `{ "path", "content" }` for a file (with `"mode": "100755"` for an executable one, or `"hex"` instead of `content`), `{ "path", "link" }` for a symbolic link and `{ "path", "submodule": true }` for a submodule. |
| `expect` | As above. The file of every problem is the settings path, so it is not repeated. |

The trees are built with `git fast-import`, so nothing is checked out and a link or a submodule can stand anywhere. The test in [test/config.test.mjs](../../config.test.mjs) shows one way to do it.
