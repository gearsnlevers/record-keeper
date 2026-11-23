# Fixtures of `seal --adopt`

[docs/install.md](../../../docs/install.md#adopting-with-records-that-already-exist) says what the first sealing of the records that existed before the kit does: which records it seals, where the line goes, what it leaves alone and says, and that no other byte of a record changes. `cases.json` has one list, `cases`, and an implementation is correct when it gives, for every case, the lines and the bytes that the case lists. The cases are built by [reference/build_adopt_cases.py](../../../reference/build_adopt_cases.py), with the answer of each written there by hand and checked against the second implementation, [reference/adopt_ref.py](../../../reference/adopt_ref.py), which is written from the page and shares no code with `record-keeper.mjs`.

A case is a records folder. A file is **bytes**, written as `{ "text": ... }` when it is UTF-8 and as `{ "hex": ... }` when it is not.

| Field | Meaning |
| ----- | ------- |
| `id`, `note` | A unique name, and what the case shows. |
| `files` | The files of the folder, by name, besides the `README.md` and the `template.md` that every folder here has (a case may give its own). |
| `dry` | The lines that a dry run prints for the files, `<name>: <what it says>`, in the order of the names. The count and the hint that follow them are not listed. |
| `write` | The same for the run with `--write`: `sealed` where the dry run says `would seal`. |
| `after` | The files that are written, by name, with the bytes they become. A file that is not here is as it was. |
| `counts` | The four numbers of the count line: how many would be sealed, have a seal already, are skipped and cannot be sealed. |
| `code` | The exit status: 1 when a file `cannot seal`, else 0. |

The ids tell the part: `s` records that are sealed, `l` the length that V-10 allows, `k` records that are skipped for their status, `h` records that have a seal line already, `r` records that g1 rejects, `f` files that are not records, `m` whole folders.

Every file that is sealed is the old file and one added line: the builder checks it, and that the seal in the line is the seal of the old file and that the new file has a seal line that is left alone by a second run. The symbolic links of the command are not cases here, because not every checkout can hold one; [test/adopt.test.mjs](../../adopt.test.mjs) makes them.
