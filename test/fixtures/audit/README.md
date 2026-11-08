# Fixtures of `audit`

[docs/audit.md](../../../docs/audit.md) says what the audit finds when it reads the whole history of a repository. `cases.json` has small histories (`histories`) and, for each, what `audit` must return. An implementation is correct when, for every history, it returns exactly these violations, excused violations, acts and cases, in this order.

| Field | Meaning |
| ----- | ------- |
| `id`, `note` | A unique name and what the history tests. |
| `commits` | The commits, oldest first. Each has an `id` (a label, not a commit id), its `parents` (labels; the first is the first parent), a `message`, and `changes`, what is done to the tree of the first parent to make its own tree (a first commit starts from nothing). The changes are those of the [change fixtures](../change/README.md). |
| `head` | The label of the commit to audit; the last commit if it is left out. |
| `from`, `since` | The options of the same name: a label, `@label@`, or a commit id written out. Absent when the audit is run without them. |
| `expect.judged` | The number of commits judged. |
| `expect.violations` | Each as `{ commit, kind, file, rule, detail, line? }`. `commit` is a label; `kind` is `commit`, `register`, `state` (the tip) or `history`; `file` is relative to the records folder and `null` for none. The `detail` of a V rule is left out. |
| `expect.excused` | The same, with `note: { file, number, case }`: the note that excuses it. |
| `expect.acts` | `{ commit, kind, path, pull }`: the acts that the commits carry, and the number of the pull request that the subject names or `null`. |
| `expect.cases` | `{ commit, kind, number }`: the issues and pull requests that new notes cite. |

An id of a commit that a later commit needs is written in the content or the message of that commit as `@label@`, and in this file as the id itself. Ids do not change between builds: the commits are made with one committer and time. In a `detail` or a `case` of the expected results the id is written `@label@` again.

The histories are built with `git fast-import`, so nothing is checked out. The test in [test/audit.test.mjs](../../audit.test.mjs) shows one way to do it.
