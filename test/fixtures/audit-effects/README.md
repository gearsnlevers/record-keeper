# Fixtures of `audit-plan`

[docs/audit-effects.md](../../../docs/audit-effects.md) says how the acts of the history are checked against the reviews of the pull requests that merged them, and how the violations become a plan of issues, log lines and a record of the run. `cases.json` has small cases (`cases`) and, for each, what `audit-plan` must print or say.

| Field | Meaning |
| ----- | ------- |
| `id`, `note` | A unique name and what the case tests. The letter in front says the group: `a` where the audit starts, `b` acts against the evidence, `c` an evidence file that does not fit, `d` an issues file that does not fit, `e` what the plan does with the issues. |
| `commits` | The commits, oldest first, as for the [fixtures of the audit](../audit/README.md): an `id` (a label, not a commit id), `parents` (labels), a `message`, and `changes` to the tree of the first parent. |
| `head` | The label of the commit to audit; the last commit if it is left out. |
| `from`, `since`, `adopted` | The options `--from` and `--since` (a label, `@label@`, or a commit id written out), and the flag `--adopted`. Absent when the option is not given. |
| `evidence`, `evidenceRaw`, `evidenceHex` | The evidence file: a JSON value, the text of the file, or its bytes in hexadecimal. Absent when `--evidence` is not given. |
| `issues`, `issuesRaw` | The issues file: a JSON value, or the text of the file. A list with no issue if both are absent. |
| `now` | The value of `--now`. |
| `expect` | `{ code: 0, plan }`: the document that `audit-plan` prints, or `{ code: 2, file, reason }` for an evidence or an issues file that does not fit (the message is `record-keeper: <path of the file>: <reason>`), or `{ code: 2, message }` for any other error (`record-keeper: <message>`). |

A commit id is written `@label@` anywhere in the evidence, the issues, the changes, the messages and the expectation; the test replaces it with the id of the commit it builds. Ids do not change between builds: the commits are made with a fixed committer and time.

The histories are built with `git fast-import`, so nothing is checked out. The test in [test/audit-effects.test.mjs](../../audit-effects.test.mjs) shows one way to do it. The expected plans are written by hand in [reference/build_audit_effects_cases.py](../../../reference/build_audit_effects_cases.py), and computed again by the reference in `reference/audit_effects_ref.py`; the builder stops when the two differ.
