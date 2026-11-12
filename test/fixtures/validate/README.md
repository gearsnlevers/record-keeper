# Fixtures of `validate`

Each case is a small records folder, and `cases.json` says which problems the rules of [docs/record-format.md](../../../docs/record-format.md) must report for it. An implementation is correct when, for every case, it reports exactly those problems: the same files and the same rules, the same number of times. The order does not matter. If a case and the page disagree, the page wins and the case is a bug to report.

## What is here

- `cases.json` is the index. Its `cases` list has one entry per case.
- One folder per case, named by the `id` of the case. The folder is the records folder that is checked: `README.md`, `template.md`, the records and whatever else the case needs.

An entry has these fields:

| Field | Meaning |
| ----- | ------- |
| `id` | A unique name, which is also the name of the folder. |
| `folder` | The folder to check, relative to this directory. It is the `id`, except for the case of a folder that does not exist: the name `no-such-folder` stands for a path where there is nothing. |
| `expect` | The problems the case must produce, as a list of `{ "file", "rule" }`. `file` is the name of the file or folder the problem is about, relative to the records folder, or `null` when it is about the folder as a whole. For `V-09` the entry also has `"g1"`, the rule of generation g1 that the record breaks. The list is empty when the folder is valid. |
| `extra-keys` | Optional. The setting `extra-keys` for this case. |
| `shared-folder` | Optional. The setting `shared-folder` for this case. |
| `symlinks` | Optional. Symbolic links to create in a copy of the folder before it is checked, as `{ "name", "target" }`. They are not stored in the repository, because not every checkout can hold a symbolic link. |
| `note` | What the case tests and why the answer is what it is. |

## How the cases are named

| Name | What the case is |
| ---- | ---------------- |
| `ok…` | A valid folder that a rule could be mistaken to reject: another layout of the index, CRLF, an extra key, a folder that must not be looked at, a record of exactly 60 lines. |
| `badNN…` | A folder that breaks rule `V-NN`, and only that one unless the note says otherwise; the letter after the number tells the cases of one rule apart. |
| `multi…` | A folder with problems of several rules. `multi01-value-and-deprecated` has the two problems that records in the field have today. |

Almost every folder is the same small base (an index, a template, and three records of which one is superseded, one has every optional section and one has an Errata section) with one change. The folders that test a value-level rule, such as the dates, the names of the files, the credentials, the e-mail addresses, the issues, the statuses and the seals, hold one record for each value instead, so that one folder can try a dozen.

Names inside a folder never differ only in case, and none is a symbolic link, so that every checkout can hold them. The files are not text for git (`.gitattributes`): some have CRLF line endings or white space at the end of a line, and the answer depends on it.

## Checking an implementation

In Node.js, with `validate(folder, { extraKeys, sharedFolder })` standing for the implementation under test, which returns `[{ file, rule, g1? }]`:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { cases } = JSON.parse(fs.readFileSync('cases.json', 'utf8'));
const key = (p) => `${p.file ?? ''}|${p.rule}|${p.g1 ?? ''}`;
for (const c of cases) {
  const work = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'case-')), 'folder');
  if (fs.existsSync(c.folder)) fs.cpSync(c.folder, work, { recursive: true });
  for (const s of c.symlinks ?? []) fs.symlinkSync(s.target, path.join(work, s.name));
  const got = validate(work, { extraKeys: c['extra-keys'] ?? [], sharedFolder: c['shared-folder'] ?? 'shared' }).map(key).sort();
  const want = c.expect.map(key).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) console.log(`${c.id}: expected ${want}, got ${got}`);
}
```
