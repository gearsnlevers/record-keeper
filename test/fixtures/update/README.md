# Fixtures of the updater

[docs/updater.md](../../../docs/updater.md) says how the core of the updater reads a pin, chooses a release, judges a manifest as untrusted data and builds the plan of an update, or says why it refuses. `cases.json` has four lists, and an implementation is correct when it gives, for every case, exactly the answer listed.

## `plans`: the whole decision

| Field | Meaning |
| ----- | ------- |
| `id`, `note` | A unique name, and what the case shows. |
| `input.pinText` | The text of `.github/record-keeper.yml`, or `null` when there is none. |
| `input.source`, `input.channel`, `input.target` | The options `--source`, `--channel` and `--target`, or `null`. |
| `input.releases` | What the source's API lists, as it lists it. Entries that are not releases are in it on purpose. |
| `input.tagCommit` | The commit that the tag of the chosen release points at. |
| `input.manifest` | The manifest of the chosen release, as text, or `{ "hex": ... }` for bytes that are not text. |
| `input.previous` | The manifest of the pinned release in the same forms, or `null` when it has none to read. |
| `input.node` | The version of Node.js that runs the updater. |
| `input.downloaded` | For each `source` of the manifest, the `sha256` and `size` of what was downloaded. |
| `input.tree` | For each path the working tree is asked about, `{ kind, sha256? }` with `kind` one of `absent`, `file`, `dir`, `link`, `other` and `blocked`. A path that is not there is `absent`. |
| `expect` | One of `{ status: "refused", code, detail }`, `{ status: "current", latest }`, and `{ status: "update" or "unchanged", source, channel, from, to, commit, added, changed, unchanged, templates, kept, remove, overwritten, pin, pinChanged, requires, warnings }`. The lists are paths in the order of their bytes. |

The ids tell the part of the page: `p` is the choice of the release and the plan, `m` the manifest, `f` the files that were downloaded, `t` the working tree.

## `pins`: the text of a pin

`text` and `expect`: `{ pin: { source, version, commit, channel } }` or `{ refused: { code, detail } }`.

## `tags`: the order of two tags

`a`, `b` and `expect`: `-1`, `0` or `1`, by semantic version precedence.

## `ranges`: the Node.js range of a manifest

`range`, `node` and `expect`: `parsed` is the list of `[operator, [major, minor, patch]]` that the range reads as (the numbers are digit strings), or `null` when the updater does not read it; `satisfied` is whether `node` satisfies it, or `null` when the range is not read.

What a run does with these answers (the branch, the pull request, the exit status, what is printed) is tested in [test/updater-run.test.mjs](../../updater-run.test.mjs).
