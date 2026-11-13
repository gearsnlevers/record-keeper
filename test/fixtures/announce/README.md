# Fixtures of `announce-plan`

[docs/announcements.md](../../../docs/announcements.md) says how an act that the owners approved is announced: the issue that the audit opens for each commit, whom it mentions, how the diff is shown and cut, and the command `announce-plan` that makes the plan. `cases.json` has the list `cases`, and an implementation is correct when, for every case, it prints the document of `expect`.

| Field | Meaning |
| ----- | ------- |
| `id`, `note` | A unique name and what the case tests. The letter in front says the group: `a` which acts are announced, `b` only what the owners approved, `c` the issues that exist, `d` several commits, the limit of twenty, the start and the merges, `e` whom the issue tells, `f` the diff (escapes, the fence, the room), `g` what the plan refuses. |
| `commits` | The commits, oldest first, as for the [fixtures of the audit](../audit/README.md): an `id` (a label, not a commit id), `parents` (labels), a `message`, and `changes` to the tree of the first parent. |
| `evidence`, `evidenceRaw` | The evidence file ([the effects](../../../docs/audit-effects.md#evidence---evidence-file)): a JSON value, or the text of the file. |
| `issues`, `issuesRaw` | The issues file: a JSON value, or the text of the file. A list with no issue if both are absent. |
| `logins`, `loginsRaw`, `loginsHex` | The file `--logins`: a JSON value, the text of the file, or its bytes in hexadecimal. |
| `now` | The value of `--now`. |
| `expect` | `{ code: 0, plan }`: the document that `announce-plan` prints, or `{ code: 2, file, reason }` for an evidence, an issues or a logins file that does not fit (the message is `record-keeper: <path of the file>: <reason>`), or `{ code: 2, message }` for a history that cannot be audited. |

Every case is run with `--adopted`, and with the head the last commit. A commit id is written `@label@` anywhere in the evidence, the issues, the changes, the messages and the expectation; the test replaces it with the id of the commit it builds. Ids do not change between builds: the commits are made with a fixed committer and time.

The histories are built with `git fast-import`, so nothing is checked out. The test in [test/announce.test.mjs](../../announce.test.mjs) shows one way to do it. The expected plans are written by hand in [reference/build_announce_cases.py](../../../reference/build_announce_cases.py): the text of the issue from the words of the page, the diffs of small files by `difflib` with the object ids of git (and the text that git adds after the `@@` of a hunk), and the number of lines that fit in the room by a plain loop. The generator then computes every case with the Python reference, [reference/announce_ref.py](../../../reference/announce_ref.py), and stops when the two differ; the same cases are the test of the code in `record-keeper.mjs`.

To rebuild the file: `python3 reference/build_announce_cases.py test/fixtures/announce/cases.json`.
