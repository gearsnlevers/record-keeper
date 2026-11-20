# Fixtures of the block of AGENTS.md

[docs/agent-files.md](../../../docs/agent-files.md) says how the kit finds the block of `AGENTS.md` between two marker lines, what the file becomes when a block is put into it, and when the text that agents read has changed. `cases.json` has `block` (the text of a block, as a release holds it) and three lists, and an implementation is correct when it gives, for every case, exactly the answer listed.

A file is **bytes**, written as a text when it is UTF-8 and as `{ "hex": ... }` when it is not; `null` is no file. The cases are built by [reference/build_agent_cases.py](../../../reference/build_agent_cases.py), with the answer of each written there by hand and checked against the second implementation, [reference/agent_ref.py](../../../reference/agent_ref.py).

## `reads`: where the block is

`id`, `note`, `input` (a file) and `expect`: `{ state: "none", fenced }` (no marker; `fenced` says that the file ends inside a code fence), `{ state: "one", start, end }` (the block is the bytes from `start` to `end`, the markers included) or `{ state: "refused", why }` with `why` one of `partial-line`, `begin-without-end`, `end-without-begin`, `reversed` and `doubled`.

## `splices`: what the file becomes

`id`, `note`, `current` (a file, or `null`), `block` (the block to put in) and `expect`: `{ ok: true, action, output }` with the action `create`, `append`, `replace` or `current` and the bytes of the new file, or `{ ok: false, why }` with `why` one of the reasons above and `not-text`, `fence` and `invalid-block`.

## `diffs`: has what agents read changed

`id`, `note`, `before` and `after` (files, or `null`) and `expect`, true when the block, or its markers, differ. A change outside the markers is not one; a file whose markers are refused is compared whole.
