# Record Keeper

Keeps a repository's decision records trustworthy: templates, one validator, seals, an integrity check that runs from the base branch, and a nightly audit.

A decision record binds people and coding agents once it is accepted, and the rule that an accepted record is never edited, only superseded, is usually only text. Record Keeper makes it checkable: an accepted record carries a seal, a pull request that changes a sealed record fails a required check, and a nightly audit finds what got past it and reports it.

Status: in progress, milestone M1. The canonical form of a record (generation g1) is settled and published with test vectors, and `record-keeper.mjs` seals a record and verifies a seal. Nothing else is built yet: the checks, the audit and the updater are still design.

```sh
node record-keeper.mjs seal <file>             # print the seal of a record
node record-keeper.mjs seal --verify <file>    # check the seal: line of a record against its text
npm test                                       # the library, the command line and the test vectors
```

It needs Node.js 22 or later, has no dependencies and never writes a file.

- [docs/design.md](docs/design.md): what it is, the layers, how a pull request is checked, the audit, delivery, adoption, and what is decided and what is open.
- [docs/decisions/](docs/decisions/README.md): the decisions of the kit itself. Record 0001 is the protocol.
- [docs/generation-g1.md](docs/generation-g1.md): the canonical form of a record that a seal of generation g1 is computed from, with [test vectors](test/vectors/g1/README.md).
- [docs/record-format.md](docs/record-format.md): the format of a record and its folder that `validate` checks (draft), with [fixtures](test/fixtures/validate/README.md).

## License

[MIT](LICENSE).
