# Fixtures of the owners' approval

[docs/approvals.md](../../../docs/approvals.md) says how the kit counts the approvals of the owners and how it reads the reviews of a pull request. `cases.json` has two lists, and an implementation is correct when it gives, for every case, exactly the answer listed.

## `counts`: the approvals of the owners

| Field | Meaning |
| ----- | ------- |
| `id`, `note` | A unique name, and what the case shows. |
| `owners` | The owners of the settings of the base, as `{ "login", "id" }`, in the order of the settings. |
| `approvals` | The number of approvals that is needed. |
| `head` | The identifier of the head commit, in lower case. |
| `author` | The ID of the author of the pull request. |
| `reviews` | The reviews, as the reading of a reviews file gives them: `{ "id", "user", "state", "commit", "at" }`, with `user` the ID of the account or `null`, and `commit` and `at` text or `null`. The order is not meaningful. |
| `expect` | `have` (the count), `needed`, `met`, and for each owner, in order, `login`, `id` and `how`: `author`, `approved`, `none`, `changes`, `dismissed`, `other` or `earlier`. |

## `files`: a reviews file

| Field | Meaning |
| ----- | ------- |
| `id`, `note` | As above. |
| `text` | The file, as a string, or `hex` for a file that is not UTF-8. |
| `expect` | Either `reviews`: the list that reading the file gives, or `error`: the reason that reading it is refused with. For an entry the reason starts with `entry N:`, counting the reviews from 1 across pages. |

The command-line behaviour (exit codes, the line of the approvals, the act `owners`) is tested in [test/approval.test.mjs](../../approval.test.mjs) on top of the cases of [test/fixtures/change](../change/README.md), whose cases `w01` to `w23` show when the act `owners` is found.
