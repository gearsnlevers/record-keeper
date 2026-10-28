# Record Keeper

Keeps a repository's decision records trustworthy: templates, one validator, seals, an integrity check that runs from the base branch, and a nightly audit.

A decision record binds people and coding agents once it is accepted, and the rule that an accepted record is never edited, only superseded, is usually only text. Record Keeper makes it checkable: an accepted record carries a seal, a pull request that changes a sealed record fails a required check, and a nightly audit finds what got past it and reports it.

Status: design in review, nothing is built yet.

- [docs/design.md](docs/design.md): what it is, the layers, how a pull request is checked, the audit, delivery, adoption, and what is decided and what is open.
- [docs/decisions/](docs/decisions/README.md): the decisions of the kit itself. Record 0001 is the protocol.
