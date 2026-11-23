# Record Keeper

Keeps a repository's decision records trustworthy: templates, one validator, seals, an integrity check that runs from the base branch, and a nightly audit.

A decision record binds people and coding agents once it is accepted, and the rule that an accepted record is never edited, only superseded, is usually only text. Record Keeper makes it checkable: an accepted record carries a seal, a pull request that changes a sealed record fails a required check, and a nightly audit finds what got past it and reports it.

Status: in progress, milestone M3. The canonical form of a record (generation g1) is settled and published with test vectors, and `record-keeper.mjs` seals a record, verifies a seal, adds the first seals to the records that existed before the kit (`seal --adopt`), checks the format of a records folder, reads a records folder and the settings file from a commit, and judges a change (a head commit against a base commit). It counts the owners' approvals of a change from the reviews of its pull request, judges an erratum (with its 48 hours) and a deviation note, and the `Records integrity` workflow runs all of that on a pull request. It guards the files of the check as acts and holds an amendment of the protocol, and a change of the owners, to the bar of all owners and seven days. It refuses a record that applies to nothing and a change that leaves an `applies-to` item without a file, and `audit` reads the whole history for what a push round the check left behind. The workflow that runs the audit writes its incident issues, its log and the announcements of the acts that the owners approved. Milestone M3 makes it installable: `install.json` lists what a release installs and where, `tools/build-release-manifest.mjs` writes the manifest of digests of a release, and the `Release` workflow cuts one (it has not been run yet). The updater, `updater.mjs`, is built (M3b): it keeps a repository on a released version, with the first adoption by hand and then one branch and one pull request; it has been tried against a local server that plays GitHub and has not run against GitHub. The setup check, `setup-check.mjs`, is built (M3c): it tells a repository when its installation is incomplete or wrong (a ruleset that does not require the check, an audit that stopped, owners that GitHub does not know, `CODEOWNERS` that does not cover the files of the kit, a file that is not the release's), and fails only for the first two; it too has been tried against a local server and not against GitHub. The files that agents read are built (M3d): the skill `record-a-decision`, a block of text in `AGENTS.md` that the updater rewrites between two markers and nowhere else in the file, and a one-line `CLAUDE.md` installed once; a change to the skill or to the block is the act `instructions`, and none of it has been tried with a real agent. The first release is still to come.

```sh
node record-keeper.mjs seal <file>             # print the seal of a record
node record-keeper.mjs seal --verify <file>    # check the seal: line of a record against its text
node record-keeper.mjs seal --adopt [folder] [--write]
                                               # the first sealing of the records that existed before the kit (default docs/decisions):
                                               # a dry run that says which accepted or superseded records have no seal line and would get one;
                                               # with --write it adds that one line to each and changes no other byte
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
node record-keeper.mjs audit --head <revision> [--from <commit> | --adopted] [--since <commit>] [--evidence <file>] [--json]
                                               # read the whole history up to the head: judge every first-parent commit by the rules of check-pr,
                                               # keep the register of record numbers, and read the integrity of the tip; with the evidence of
                                               # the reviews, also judge whether the acts were approved
node record-keeper.mjs audit-plan --head <revision> [--adopted] --issues <file> --now <time> [--evidence <file>]
                                               # print as JSON what to do with the incident issues, the log and the record of the run
node check-pull-request.mjs --repo <owner/name> --pr <number>
                                               # what the pull request workflow runs: read the pull request from GitHub, then check-pr
node run-audit.mjs --repo <owner/name> [--dry-run]
                                               # what the audit workflow runs: evidence from GitHub, the plan, the log branch and the incident issues
node updater.mjs [--dry-run] [--target <tag>]
                                               # what the updater workflow runs: update to the newest release of the pinned channel: rebuild the branch
                                               # record-keeper/update and open or update the one pull request
node updater.mjs --local --source <owner/name> [--target <tag>] [--channel stable|prerelease]
                                               # the first adoption, by hand: write the verified files of a release and the pin into the working tree
node setup-check.mjs --repo <owner/name> [--json]
                                               # what the setup check workflow runs: read the working tree and GitHub (the read-only token of the workflow),
                                               # and say what is wrong with the installation of the kit, as annotations; fails only for a dead audit or a check that is not required
node setup-check.mjs --local                   # the same, from the files only, before anything is pushed
node tools/build-release-manifest.mjs --version <semver> --tag <tag> --commit <id> --out <file>
                                               # write the manifest of a release: the digest of every file of install.json
node tools/build-release-manifest.mjs --verify <manifest>
                                               # check a manifest against the files of the working tree
npm test                                       # the library, the command line, the test vectors and the fixtures
```

These are the paths of this repository, which keeps its programs at its root. A repository that installs the kit keeps them in `.github/record-keeper/`, next to its settings ([docs/install.md](docs/install.md)): `node .github/record-keeper/record-keeper.mjs validate`.

It needs Node.js 22 or later and has no dependencies. `record-keeper.mjs` has no network code and writes a file only for `seal --adopt --write`, which adds one line to a record; `check-pull-request.mjs` only reads from GitHub and adds git objects and two refs to the clone it runs in; `run-audit.mjs` writes the incident issues of the repository and the branch `record-keeper/log`; `updater.mjs` writes the branch `record-keeper/update` and one pull request, and, by hand with `--local`, the files of a release into a working tree; `setup-check.mjs` reads the working tree and GitHub with a token that can only read, and writes nothing but the job summary. The updater is written to run on its own: it imports nothing of the kit. The setup check imports the updater, the rules file and the audit program, which stand next to it.

- [docs/design.md](docs/design.md): what it is, the layers, how a pull request is checked, the audit, delivery, adoption, and what is decided and what is open.
- [docs/decisions/](docs/decisions/README.md): the decisions of the kit itself. Record 0001 is the protocol.
- [docs/generation-g1.md](docs/generation-g1.md): the canonical form of a record that a seal of generation g1 is computed from, with [test vectors](test/vectors/g1/README.md).
- [docs/record-format.md](docs/record-format.md): the format of a record and its folder that `validate` checks, with [fixtures](test/fixtures/validate/README.md).
- [docs/reading-a-commit.md](docs/reading-a-commit.md): how the folder is read from a commit, and the rules of what a commit can hold, with [fixtures](test/fixtures/commit/README.md).
- [docs/settings.md](docs/settings.md): the settings file `.github/record-keeper/settings.yml`, the subset of YAML it is read in and what is wrong with a file, with [fixtures](test/fixtures/config/README.md).
- [docs/checking-a-change.md](docs/checking-a-change.md): how a change is judged, which changes a sealed record allows, what needs the owners' approval, with [fixtures](test/fixtures/change/README.md).
- [docs/audit.md](docs/audit.md): the audit core: what it reads, what it judges, what a note excuses, what it returns, with [fixtures](test/fixtures/audit/README.md).
- [docs/audit-effects.md](docs/audit-effects.md): what the audit does with what it finds: the acts checked against the reviews that merged them (A-03), and the plan of incident issues, log lines and the record of the run, with [fixtures](test/fixtures/audit-effects/README.md).
- [docs/announcements.md](docs/announcements.md): how an act that the owners approved is announced: an issue written by the bot for each commit, with the diff, mentioning the owners and the `witnesses`, and the command `announce-plan`, with [fixtures](test/fixtures/announce/README.md).
- [docs/audit-run.md](docs/audit-run.md): the audit run every night: the workflow, the program that asks GitHub for the evidence and writes the incident issues and the log branch, what it does when it cannot run, and the ruleset a repository must set on the log branch.
- [docs/applies-to.md](docs/applies-to.md): the dialect of the items of `applies-to`, and the two rules that keep a record from binding nothing.
- [docs/amendments.md](docs/amendments.md): the bar for an amendment of the protocol or of the owners (all owners, seven days), and the key `emergency:` that waives the wait.
- [docs/protected-files.md](docs/protected-files.md): the files that make the check, why a change to one is an act, and the rule against another workflow that names the check.
- [docs/errata-and-deviations.md](docs/errata-and-deviations.md): the entries of Errata and Known deviations, the erratum chain, the 48 hours, and what the check looks up outside the commits.
- [docs/approvals.md](docs/approvals.md): when the owners have approved a change: which reviews count, what the command prints, with [fixtures](test/fixtures/approval/README.md).
- [docs/install.md](docs/install.md): the install set and the layout of a repository that installs the kit: the folder `.github/record-keeper/`, files that an update replaces (managed) and files that are copied once (templates), what the check guards, `install.json`, the first adoption, and how a repository that kept records before the kit seals them (`seal --adopt`, with [fixtures](test/fixtures/adopt/README.md)).
- [docs/releases.md](docs/releases.md): how the kit is versioned, the release manifest and how it is verified, the `Release` workflow and its dry run, immutable releases, and what a repository can check of a release.
- [docs/updater.md](docs/updater.md): the updater: the pin, how a release is chosen and its manifest judged as untrusted data, what is replaced and what is copied once, the branch and the one pull request, the token, the first adoption by hand, what it trusts and what has not been tried, with [fixtures](test/fixtures/update/README.md).
- [docs/setup-check.md](docs/setup-check.md): the setup check: every finding with its code and its severity, what fails a run (a dead audit, a check that is not required) and what does not, what it reads and with which token, the part of `CODEOWNERS` it reads, the workflow, and what has not been tried, with [fixtures](test/fixtures/setup/README.md).
- [docs/agent-files.md](docs/agent-files.md): the files that agents read: the skill `record-a-decision`, the block of `AGENTS.md` that the updater rewrites between two markers (and never anything else in the file), `CLAUDE.md`, how the check, the audit and the setup check guard them, with [fixtures](test/fixtures/agent/README.md).
- [docs/workflow.md](docs/workflow.md): the `Records integrity` workflow: what it reads from GitHub, what it runs, when it cannot run, and what a repository must set for it to mean anything.
- [reference/](reference/README.md): the second implementations of the pages in Python and Node, the generators of the fixtures, the fuzz and the mutation scripts. Not part of the kit; `npm test` does not run it.

## License

[MIT](LICENSE).
