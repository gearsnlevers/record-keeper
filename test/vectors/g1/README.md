# Test vectors of generation g1

A vector is a file holding the exact bytes of a record, and the answer an implementation of [generation g1](../../../docs/generation-g1.md) must give for it: the seal, or the rule that rejects the record. An implementation is correct when it gives the expected answer for every vector, byte for byte. If a vector and the page disagree, the page wins and the vector is a bug to report.

## What is here

- `vectors.json` is the index. Its `vectors` list has one entry per file.
- `seal/` holds the records that are sealed. `reject/` holds the records that are rejected.

An entry has these fields:

| Field | Meaning |
| ----- | ------- |
| `id` | A unique name, which is also the name of the file without `.record`. |
| `file` | The path of the record, relative to `vectors.json`. |
| `result` | `seal` if the record is sealed, `reject` if a rule rejects it. |
| `seal` | For a `seal` vector, the seal the record must get. |
| `rule` | For a `reject` vector, the first rule it breaks (`G1-01` to `G1-20`). |
| `note` | What the vector tests and why the answer is what it is. |
| `differs-from` | Optional. The id of another `seal` vector whose seal this one must not have. |

## How the vectors are named

| Name | What the answer is |
| ---- | ------------------ |
| `a…` | Sealed, with the same seal as `a01-base`: a difference that a seal must not see (line endings, trailing white space, blank lines, the excluded keys and sections, and so on). |
| `b…` | Sealed, with a seal of their own: edge cases of the canonical form, such as blank lines inside a code block. Some say `differs-from`. |
| `c…` | Sealed, with a seal of their own: records that look odd and are fine, such as non-ASCII text, an autolink or two tildes. |
| `d…` | Sealed, and a seal different from the vector they say `differs-from`: a change that a seal must see. |
| `rNN…` | Rejected by rule `G1-NN`; the letter after the number tells the cases of one rule apart. |
| `o…` | Rejected because of several rules at once: the note says which, and the lowest number is the one reported. |

## Checking an implementation

Read `vectors.json`, read each `file` as bytes, and compare. In Node.js, with `sealOrRule(bytes)` standing for the implementation under test, which returns `{ seal }` or `{ rule }`:

```js
import fs from 'node:fs';

const { vectors } = JSON.parse(fs.readFileSync('vectors.json', 'utf8'));
for (const vector of vectors) {
  const got = sealOrRule(fs.readFileSync(vector.file));
  const ok = vector.result === 'seal' ? got.seal === vector.seal : got.rule === vector.rule;
  if (!ok) console.log(`${vector.id}: expected ${vector.seal ?? vector.rule}, got ${got.seal ?? got.rule}`);
}
```

This repository's own library runs the vectors with `npm test` (`test/vectors.test.mjs`). That test also checks the set itself: every file is listed and every listed file exists, the `a` vectors really share one seal, every `differs-from` really differs, the number in an `rNN` name is the rule it expects, and each of the twenty rules is exercised.

## The files are binary

Several records contain what a text editor or git would "fix": CRLF line endings, a lone carriage return, a byte order mark, a NUL, bytes that are not UTF-8. `.gitattributes` says `*.record -text`, so git stores and checks them out as they are. Copy them as bytes, and do not open and save them in an editor.
