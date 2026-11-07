# Where a record applies

Status: draft for review (M2.7c). This page says what the key `applies-to` of a record means to the check: the small dialect its items are written in, and two rules that keep a record from binding nothing: one when a record is accepted, and one when a change takes away the last file an item matches. It is not part of the protocol. It is read with [the format of a record](record-format.md), which says what the key is, and with [checking a change](checking-a-change.md), whose rules it extends.

A record binds the code it names. `applies-to` is a list of paths and patterns, relative to the root of the repository; a record **without** it binds the whole repository and is not looked at here. After acceptance the list cannot change: an erratum may not touch it (P-12), and a new list is a new record that supersedes the old one. So a record can be made to bind nothing in only one way, by moving the code, and the design says so: "moving the code is a way round the record". These rules close it.

## The dialect

An **item** is the text of one entry of the list, as the format page defines items. It **matches** a file when the whole path of the file, written with `/` from the root of the repository, fits the pattern, which is read from left to right:

| In the item | Matches |
| ----------- | ------- |
| `**/` | zero or more whole folders: nothing, or any run of characters that ends in `/` |
| `**` | any run of characters, `/` and nothing included |
| `*` | any run of characters but `/`, nothing included |
| any other character | itself |

- `**/` is read before `**`, and `**` before `*`. So `src/**` matches `src/a.ts` and `src/x/a.ts` and not `src`; `src/**/*.ts` matches `src/a.ts` as well as `src/x/y/a.ts`; `src/**/README.md` matches `src/README.md` and `src/docs/README.md`; `lib/*.mjs` matches `lib/a.mjs` and not `lib/x/a.mjs`; `a**b` matches `ab` and `a/x/b`.
- **Everything else is literal,** also `?`, `[`, `{`, `.` and a space. Capitals matter. An item with no `*` is one file name. An item that starts with `/` or `./`, ends with `/`, or has an empty part matches no file, because no path looks like that; it is **not** read as a folder.
- **Only regular files match,** also executable ones: not a folder, a symbolic link or a submodule. A file turned into a link no longer matches.
- The paths are read from the commit, not from a checkout.
- **An item cannot start with a star.** Generation g1 refuses a value that starts with `&`, `*`, `!`, `|` or `>` (G1-13), so a sealed list has no item such as `**/README.md` or `*.md`: it starts with a folder or a file name. The rules read the dialect in full all the same.

The 255 items of the `applies-to` lists in the records of the maintainers' repositories (66 different ones) are file names, `folder/**`, and three of the form `src/**/*.ts`; none uses `?`, a bracket, a brace or a negation. Every plain item names a file. The dialect is the least that reads them all.

## The rules

| Rule | A problem is reported when | Kind | Detail |
| ---- | -------------------------- | ---- | ------ |
| P-17 | a record becomes sealed and an item of its `applies-to` matches no file of the head | change | the item |
| P-18 | an item of an accepted record matched a file at the base and matches none at the head | change | the item |

- **P-17.** A record that is sealed at the head and was not at the base (also one that replaces the protocol) is judged against the files of the **head**, the tree it will be accepted into. An item that matches nothing there binds nothing from the first day. Each different item is reported once. The format binds at acceptance, and this is the part of it that needs the tree, which the format page lists as "not checked here".
- **P-18.** For a record that is sealed at the base with the status `accepted`, and is still `accepted` at the head: each different item that matches at least one regular file of the **base** and none of the **head** is reported. The detail is the item. An item that matched nothing at the base is not reported (that is old); an item that still matches a file is not, whatever else changed. A record that the change makes `superseded by` another, or deletes (P-01), is not judged: it no longer binds, and the way out of P-18 is exactly that: **a new record that supersedes this one, in the same pull request**, with the new `applies-to`.
- **The list is the base's.** An accepted record's list cannot change (P-02, P-12), so base and head have the same one.
- **No approval meets P-18.** It is a problem and not an act: there is no act that lets the owners say the record no longer applies. They write the record that says it.

## What this does not do

- **It does not know that code moved.** A file deleted and a new one with the same name satisfy it; a record that names `src/a.ts` is still satisfied when `src/a.ts` is replaced by a different program. It sees paths, not meaning.
- **It does not follow a rename.** A rename that keeps a matching file elsewhere (`src/**` and the file moves to `src/old/a.ts`) passes; one that leaves the pattern fails.
- **It does not judge a record without `applies-to`,** a record that is not accepted, or the records of the shared folder (P-08 stops a change there).
- **It does not stop a pattern that is too wide.** `**` matches every file; whether a record should bind everything is for its authors.
- **It does not read a list that the format refuses.** A `applies-to` that is a single value or a mixed entry (V-14, V-16) has no items.

## Choices in this draft (decided)

1. **A problem that no approval meets, resolved by superseding,** not an act. The design says the check "flags" the change. The alternative, an act the owners approve, lets one owner say that a record no longer applies, which is the way round the rule.
2. **P-17 at acceptance:** an item that matches nothing is refused. The alternative is to accept dead items and flag only a removal; a record could then bind nothing from its first day.
3. **The dialect** is `*`, `**` and `**/` (zero or more whole folders). The alternative reads `**` as any run only, as the kit's own test does today, and then `src/**/*.ts` would not match `src/a.ts`.
4. **Each item is judged,** not the record as a whole.
5. **Only regular files count.** A folder is not a file, so an item for a folder is written with `**`.

## The fixtures

[test/fixtures/change](../test/fixtures/change/README.md) holds the cases (the group `q`), with the trees `app` and `app-two`, and the tests of the dialect are in [test/applies.test.mjs](../test/applies.test.mjs).
