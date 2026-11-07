# Record Keeper

Keeps a repository's decision records trustworthy: templates, one validator, seals, an integrity check that runs from the base branch, and a nightly audit.

A decision record binds people and coding agents once it is accepted, and the rule that an accepted record is never edited, only superseded, is usually only text. Record Keeper makes it checkable: an accepted record carries a seal, a pull request that changes a sealed record fails a required check, and a nightly audit finds what got past it and reports it.

Status: in progress, milestone M2. The canonical form of a record (generation g1) is settled and published with test vectors, and `record-keeper.mjs` seals a record, verifies a seal, checks the format of a records folder, reads a records folder and the settings file from a commit, and judges a change (a head commit against a base commit). It counts the owners' approvals of a change from the reviews of its pull request, judges an erratum (with its 48 hours) and a deviation note, and the `Records integrity` workflow runs all of that on a pull request. The protection of the workflows, the audit and the updater are still to come.

```sh
node record-keeper.mjs seal <file>             # print the seal of a record
node record-keeper.mjs seal --verify <file>    # check the seal: line of a record against its text
node record-keeper.mjs validate [folder]       # check the format of the records in a folder (default docs/decisions)
node record-keeper.mjs validate --commit <revision> [--settings-from <revision>]
                                               # the same for a commit of a git repository, with the settings of the second commit
node record-keeper.mjs config --commit <revision>
                                               # print the settings of a commit and what is wrong with its settings file
node record-keeper.mjs check-pr --base <revision> --head <revision> [--reviews <file> --author <id>] [--cases <file>] [--since <time>]
                                               # judge the records folder of the head against the base, with the settings of the base;
                                               # with the reviews of the pull request, also say whether the owners approved the acts;
                                               # with the issues and pull requests that exist and the time the head was first seen,
                                               # also judge deviation notes and the 48 hours of an erratum
node record-keeper.mjs needs --base <revision> --head <revision>
                                               # print what check-pr needs looked up: cited issues and pull requests, and the clock
node check-pull-request.mjs --repo <owner/name> --pr <number>
                                               # what the workflow runs: read the pull request from GitHub, then check-pr
npm test                                       # the library, the command line, the test vectors and the fixtures
```

It needs Node.js 22 or later and has no dependencies. `record-keeper.mjs` has no network code and never writes a file; `check-pull-request.mjs` only reads from GitHub and adds git objects and two refs to the clone it runs in.

- [docs/design.md](docs/design.md): what it is, the layers, how a pull request is checked, the audit, delivery, adoption, and what is decided and what is open.
- [docs/decisions/](docs/decisions/README.md): the decisions of the kit itself. Record 0001 is the protocol.
- [docs/generation-g1.md](docs/generation-g1.md): the canonical form of a record that a seal of generation g1 is computed from, with [test vectors](test/vectors/g1/README.md).
- [docs/record-format.md](docs/record-format.md): the format of a record and its folder that `validate` checks, with [fixtures](test/fixtures/validate/README.md).
- [docs/reading-a-commit.md](docs/reading-a-commit.md): how the folder is read from a commit, and the rules of what a commit can hold, with [fixtures](test/fixtures/commit/README.md).
- [docs/settings.md](docs/settings.md): the settings file `.github/record-keeper/settings.yml`, the subset of YAML it is read in and what is wrong with a file, with [fixtures](test/fixtures/config/README.md).
- [docs/checking-a-change.md](docs/checking-a-change.md): how a change is judged, which changes a sealed record allows, what needs the owners' approval, with [fixtures](test/fixtures/change/README.md).
- [docs/errata-and-deviations.md](docs/errata-and-deviations.md): the entries of Errata and Known deviations, the erratum chain, the 48 hours, and what the check looks up outside the commits.
- [docs/approvals.md](docs/approvals.md): when the owners have approved a change: which reviews count, what the command prints, with [fixtures](test/fixtures/approval/README.md).
- [docs/workflow.md](docs/workflow.md): the `Records integrity` workflow: what it reads from GitHub, what it runs, when it cannot run, and what a repository must set for it to mean anything.

## License

[MIT](LICENSE).
