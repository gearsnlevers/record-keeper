# Fixtures of the setup check

[docs/setup-check.md](../../../docs/setup-check.md) says how the core of the setup check decides, from what the runner read, what is wrong with the installation of the kit in a repository. `cases.json` has three lists, and an implementation is correct when it gives, for every case, exactly the answer listed. The names and the IDs in it are made up (`alice/1001`, `example/kit`, a ruleset `11`): no case is a real repository.

## `decisions`: the whole decision

| Field | Meaning |
| ----- | ------- |
| `id`, `note` | A unique name, and what the case shows. |
| `input` | What the runner read, below. |
| `expect.findings` | The findings as `{ code, severity, detail }`, errors first, then warnings, then notices, each group in the order the checks are made. The text of a finding is not part of the fixture: it is made from the code and the detail. |
| `expect.passed` | The checks that were made and found fine, in the order they are made. |

The input:

| Key | Meaning |
| --- | ------- |
| `now` | The time of the run, in milliseconds. |
| `local`, `own` | `--local`, and whether this is the kit's own repository (`install.json` at its root). With `local`, `github` is `null`. |
| `event`, `secretSet` | `GITHUB_EVENT_NAME` (or `null`), and what `HAS_RECORD_KEEPER_TOKEN` said: `true`, `false` or `null`. |
| `settings` | `{ state: "absent" }`, `{ state: "unreadable" }` or `{ state: "read", problems: [{ rule, line }], owners: [{ login, id }], approvals }`. |
| `codeowners` | `{ state: "absent" }`, `{ state: "unreadable", path }` or `{ state: "read", path, text }`: the place of the file that was found, and its text. |
| `pin` | `{ state: "absent" }`, `{ state: "refused", code }` or `{ state: "read", source, version, commit, channel }`. |
| `release` | The manifest of the pinned release: `{ state: "not-checked", why }`, `{ state: "unlisted" }`, `{ state: "no-asset" }`, `{ state: "refused", code }` or `{ state: "read", secrets, upToDate, files: [{ path, sha256, size }], blocks: [{ path, sha256, size }] }` (`upToDate` is `null` when the release does not say; `files` are the managed files and `blocks` the entries of the kind `block`, which is `AGENTS.md`, with the digest and size of the text between the markers). |
| `tree` | What the working tree holds at each managed path of the manifest: `{ kind: "absent" }`, `{ kind: "other" }` or `{ kind: "file", sha256, size }`; for the path of a block `{ kind: "large" }` (the file is larger than the check reads) or `{ kind: "block", state }` with `state` `none` (no markers), `refused` (with `why`, one of `partial-line`, `begin-without-end`, `end-without-begin`, `reversed` and `doubled`) or `one` (with the `sha256` and `size` of the block). A path that is not there is absent. |
| `auditWorkflow` | `"file"`, `"absent"` or `"other"`: what is at `.github/workflows/records-audit.yml`. |
| `github.repo` | `{ ok: true, branch }` or `{ ok: false, why }`. |
| `github.rules` | `{ ok: true, rules: [{ id, checks, strict }] }` (the rules of the type `required_status_checks`, with the ruleset of each) or `{ ok: false, why }`. |
| `github.classic` | `{ ok: true, requires }` (whether branch protection requires the check) or `{ ok: false, why }`. |
| `github.bypass` | By ruleset ID as text: `{ ok: true, name, actors: [{ type, id, mode }] }`, with `actors` `null` when the token was not shown the list, or `{ ok: false, why }`. |
| `github.accounts` | By the ID of an owner as text: `{ ok: true, login }` (`null` when no account has the ID) or `{ ok: false, why }`. |
| `github.lastRun` | `{ ok: true, state: "absent" }`, `{ ok: true, state: "unreadable", why }`, `{ ok: true, state: "record", at }` (`at` is the text, or `null`) or `{ ok: false, why }`. |
| `github.age` | `{ ok: true, at }` (the date of the oldest commit that touches the audit workflow, or `null` when none does) or `{ ok: false, why }`; it is there only when there is no record. |

The ids tell the part of the page: `h` the healthy repository and the age of the audit, `s` the settings and the owners, `a` the accounts, `c` `CODEOWNERS`, `r` the rules of the default branch, `l` `--local` and the kit's own repository, `p` the pin, the release, the installed files and the secret, `b` the files of the agents (the skill and the block of `AGENTS.md`), `u` the audit, `z` everything at once.

## `codeowners`: the syntax that is read

`text` of a `CODEOWNERS` file; `unreadable` the lines that the check does not read, each with its `line` and the `reason` it gives; `owners` the owners that the file gives each path named in it, in order (an empty list for a path that has none).

## `times`: UTC times

`text` and `expect`: the milliseconds that the text is, or `null` when it is not `YYYY-MM-DDTHH:MM:SSZ` of a real day of the years 1970 to 9999.

What a run does with these answers (which requests it makes, what it prints, the exit status) is tested in [test/setup-check-run.test.mjs](../../setup-check-run.test.mjs) and the files next to it.
