# Decision records

A decision record explains one lasting decision: why we chose it, what it means and what we gave up. Records are plain Markdown in the repository, so every contributor and every coding agent, whatever tool it uses, reads the same thing.

The records of this folder are kept trustworthy by [Record Keeper](https://github.com/gearsnlevers/record-keeper). An accepted record carries a seal, a pull request that changes a sealed record fails the check `Records integrity`, and a nightly audit finds what got past it. The protocol is [record 0001 of Record Keeper](https://github.com/gearsnlevers/record-keeper/blob/main/docs/decisions/0001-accepted-records-are-sealed-and-change-only-by-supersession-or-erratum.md), and this repository follows it.

## Rules

- An accepted record binds people and coding agents until a newer record supersedes it. An agent whose task conflicts with one stops and says so in the issue or pull request.
- Only a lasting decision gets a record: something you would be surprised to see reversed without discussion. Not minor implementation notes or routine refactors.
- A record is `proposed` while it is discussed. Accepting it is an act of the owners named in `.github/record-keeper/settings.yml`: the pull request sets `status: accepted` and writes the seal.
- An accepted record is not edited. Three changes are allowed: its status becomes `superseded by NNNN`, once the record NNNN that replaces it is accepted and sealed; an entry is added to `Known deviations`; and an erratum corrects the sealed text with a new seal and an entry in `Errata`. The acceptance of a record, a deviation entry and an erratum need the approval of the owners.
- A changed decision is a new record that names the records it replaces in `supersedes:`. Numbers are never reused, and a record is never deleted or renamed.
- A pull request that changes a decided behaviour adds or supersedes a record in the same pull request.
- Records are public. No credentials, tenant names, security-incident details or personal information.
- Write a record so that it stays true: state the rule, not a value that changes. Leave out "currently", "now" and "the latest", and any current version, count, size or line number. Date a fact that explains the decision ("on 2026-10-24 the pin was ...").
- `applies-to:` lists the path globs that the record binds, preferably folders and prefix globs, because files are renamed. Every item of an accepted record must match a file. A record without `applies-to:` binds the whole repository. `issues:` lists related issues and pull requests as `owner/repo#N`.

## Writing one

Copy `template.md` to `NNNN-short-title.md` (the next number, starting at 0001), fill it in (60 lines at most, not counting its `## Known deviations` and `## Errata` sections, which grow after acceptance) and add a row to the index. Besides the three required sections, a record may have `## Known deviations`, `## Alternatives considered` and `## Errata`. To accept it, set `status: accepted` and write its seal, which `node .github/record-keeper/record-keeper.mjs seal <file>` prints, as `seal:` in the front matter. `node .github/record-keeper/record-keeper.mjs validate` checks the format of the folder and the index.

## Index

| # | Title | Status |
| - | - | - |
