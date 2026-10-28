# Record Keeper: design

Status: draft for review (2026-10-28). Nothing is built. Decision [0001](decisions/0001-accepted-records-are-sealed-and-change-only-by-supersession-or-erratum.md) is the protocol; this page is how the kit enforces it.

## Why

Decision records bind people and coding agents. The rule that an accepted record is never edited, only superseded, is text in the README of each repository's records folder. Nothing enforces it:

- the validators check the format of a record and not what changed in it, and there are three copies (Repo Concierge, frodo-lib, frodo-cli) that have drifted apart: the Concierge's and frodo-lib's differ on about 190 lines, though they share one core (the statuses, the front matter keys, the section order, the 60-line limit, the file name pattern and the secret patterns);
- the comparison of the shared records between frodo-cli and frodo-lib runs weekly, only reads, and goes red without telling anyone;
- the records are copied between repositories by hand.

A decision that can change without notice is not a decision. The kit makes the protocol checkable, so that a breach is stopped where possible and found where not.

## What it is

A separate, versioned repository, delivered to a repository the way Repo Concierge is: the repository pins a released version, a pull-based updater opens one pull request when a newer release exists, and a maintainer merges it. What a release installs:

| Part | What it is |
| ---- | ---------- |
| Templates | the records folder skeleton: the `README.md` with the rules, the record template, the index |
| Validator | one script, `record-keeper.mjs`, with `validate`, `seal`, `check-pr` and `audit`; no dependencies |
| Workflows | `Records integrity` (on pull requests), `Records audit` (nightly and on every push to the default branch), the updater |
| Skill and instructions | the `record-a-decision` skill for Claude Code and Copilot, and a block for `AGENTS.md` |
| Settings | one file, `.github/record-keeper.yml`: the pin, the folder, the owners, extra front matter keys |

It is not a replacement for review. It checks whether a record is what was accepted, never whether it is right, and it does not check whether the code follows the record (see "Later").

## The protocol

Decided in record 0001; in short:

- A record is `proposed`, then `accepted` by the maintainers. Only an accepted record binds.
- Accepting writes a seal: a SHA-256 over the **sealed region**, the whole record except the keys `status`, `date` and `seal` and the sections `Known deviations` and `Errata`. The seal is a front matter key, so it travels with a record that is copied to another repository.
- After that a record may only change its status to `superseded by NNNN` or `deprecated`, gain or lose a `Known deviations` note, or gain an erratum.
- An erratum corrects sealed text (a typo, a broken link). It is a pull request that changes the text and the seal and adds an `Errata` entry with the previous seal, the new seal and the reason, approved by an owner of the records. The entries form a chain from the first seal to the current one.
- A changed decision is a new record. Numbers are never reused, and a record is never deleted or renamed.

## The layers

| # | Layer | What it does | What it cannot do | First release |
| - | ----- | ------------ | ----------------- | ------------- |
| 1 | Prevention | The required check `Records integrity` runs from the base branch and fails a pull request that breaks the protocol. Owners of the records folder must review a change to it (`CODEOWNERS`). | Stop a person who may bypass the rules, or a push to the default branch that skips the pull request. | yes |
| 2 | Sealing | A record carries its seal, so any later change to it is visible to a hash comparison, and a copy can be verified on its own. | Say whether an allowed change was right. | yes |
| 3 | Detection | A nightly audit re-checks every record against its seal, the erratum chain and the history since the last audit, and again on every push to the default branch. | Look at what it cannot read: a rewritten history is only noticed because the audit remembers the last commit it saw. | yes |
| 4 | Logging | Each violation opens one deduplicated issue and is appended to an incident log. A deviation that a maintainer accepted lives in the record's `Known deviations`. | Decide whether a violation matters. | yes |
| 5 | Reaction | The audit opens a pull request that reverts the offending change, and the default branch shows a red status until it is resolved. A person merges it. | Revert by itself: no bot writes to the default branch. | later |

Layers 1 and 2 are the ones that cost a contributor something. Layers 3 and 4 exist because layer 1 can be bypassed by a person who is allowed to, and the audit must not trust anything in the repository that a bypass could have rewritten.

## How a pull request is checked

`Records integrity` is a workflow triggered by `pull_request_target`, which GitHub runs from the **base branch**, so a pull request cannot change the check it is judged by. The rules for it:

- It checks out the base branch and runs the validator from there. The head of the pull request is fetched as data only (read with `git show`) and never executed, and the validator parses front matter with its own small parser, never with `eval` or a loader that runs code.
- Its token is read-only (`contents: read`, `pull-requests: read`). It reports through the status of its own job, so it needs nothing else.
- For every record it compares base and head. A record that is `accepted` at the base must have an unchanged sealed region and an unchanged `seal:`, unless the pull request is an erratum whose chain is valid. A new record may be `proposed` freely. A record that becomes `accepted` must carry a seal equal to the hash of its sealed region. Deleting, renaming, renumbering and moving a record back from `accepted` are failures.
- It also runs the format validation on the head: names and numbers, front matter, section order, length, credentials, and an index that lists every record with its status.
- The name of the check, `Records integrity`, is stable, because a repository requires it by name.

`CODEOWNERS` supplies the human half. The folder of the records is owned by the people who may approve an erratum, and the ruleset requires their review for changes there.

## The nightly audit and the log

The audit is the same code run on the whole tree. It runs every night and on every push to the default branch. It reads the records, recomputes each seal, walks the erratum chain, and checks the commits since the last audited commit against the rules. It remembers the last commit it audited; if that commit is no longer an ancestor of the default branch, history was rewritten, which is a violation of its own.

When it finds a violation:

- one issue per record and kind of violation, titled `Records: 0012 changed after acceptance`, carrying a hidden marker so that the next run updates the same issue and closes it when the record is clean again;
- an entry in the incident log, appended to the file `incidents.jsonl` on the branch `record-keeper/log`. The branch is not the default branch, so writing to it is not a write to the default branch, and a ruleset forbids force pushes and deletion on it;
- a failing status on the head commit of the default branch, so that it shows red until the violation is resolved.

The ways to resolve one are the ones the protocol names: a revert, an erratum, or a `Known deviations` note.

## Configuration

One file in the consuming repository, `.github/record-keeper.yml`:

```yaml
source: gearsnlevers/record-keeper
version: v1.0.0
channel: stable
folder: docs/decisions            # or decisions/ at the root when docs/ is generated
owners: ['@org/records-owners']   # the people who approve an erratum; also written to CODEOWNERS
extra-keys: []                    # front matter keys beyond the standard ones, for example repos
```

The three existing validators differ only in such extras (frodo-lib has a `repos` key and handling for shared records; the Concierge has an e-mail check). The kit keeps the shared core and makes the extras settings, so a repository that needs one asks for it and does not fork the script.

## Delivery and versions

- Releases are semantic, immutable and attested, with a manifest of content hashes, produced by the same release actions the Concierge uses.
- The updater is a copy of the Concierge's updater, adapted to this kit's pin file. This duplicates code on purpose for the first release. Extracting one updater that serves any kit is worth doing once two kits exist, not before.
- A change to a rule is a new record in the kit and a new release, never a patch in a consumer. The updater rebuilds one branch and one pull request in each repository; a maintainer merges it.
- The updater and the reaction layer open pull requests, so they need a token that can, not the workflow token: the organisation policy planned for the Actions token disables pull request creation by Actions.

## One validator

Today the Concierge validates its records with its own script and its own tests; frodo-lib has its own; frodo-cli tests its records in `test/unit/DecisionRecords.test.js`. The kit's validator is extracted from the Concierge's, which has a test suite of its own, and takes from frodo-lib the handling of shared records as a setting. Each repository then deletes its copy.

## Adoption

1. **Repo Concierge first.** It seals its existing records in one pull request that adds only `seal:` keys, installs the kit, and deletes its own validator. It is the first consumer and the test of the migration.
2. **frodo-lib and frodo-cli after** the kit has proven itself there. They replace their two validators and the weekly comparison of shared records; a seal makes a copied record verifiable, so the comparison becomes a check of seals.
3. The Frodo repositories are governed by their own maintainers: adopting is a pull request they review.

## Prerequisites and what is not verified

- The repository must be **public** for the rulesets, required checks and `CODEOWNERS` enforcement that layer 1 needs on the Free plan, and for public repositories to consume it without extra tokens. It is private while this draft is reviewed.
- **Not verified:** whether the Free plan allows everything layer 1 and the log branch need. GitHub's documentation is not clear on which rules need a paid plan (the file path restriction is a push rule, and push rules are documented for private and internal repositories on Team and Enterprise). The design does not depend on that rule: the check and the audit replace it. The plan: when the repository is public, create the ruleset through the API with each rule, and record which are accepted.
- A person with bypass rights can still push a change past the check. That is accepted: the audit finds it and the reaction proposes the revert.
- **Guard the guard.** The check lives in the consuming repository and could be edited there. The ruleset requires it, the check runs from the base branch, and the audit verifies that the workflow files themselves match the installed release by their hashes, as the updater already does for the Concierge.

## Milestones

| # | What | Outcome |
| - | ---- | ------- |
| M0 | This design, record 0001 and the repository | reviewed and accepted |
| M1 | The library: parse, seal, compare, validate, with tests | `record-keeper.mjs` with `validate` and `seal` |
| M2 | The pull request check and the audit with the log | the two workflows, the incident issue and the log branch |
| M3 | Release and updater | a first release that a repository can install |
| M4 | The Concierge adopts it | its validator deleted, its records sealed |
| M5 | The reaction: the revert pull request | layer 5 |
| M6 | frodo-lib and frodo-cli adopt it | their validators and the weekly comparison deleted |

The first release is M1 to M3: layers 1 to 4.

## Decisions

Taken by the maintainer on 2026-10-28:

- The reaction to a violation is a **revert pull request that a person merges**, not a bypass bot. A direct revert can be reconsidered later.
- The first release includes **the nightly audit and the log**, not only the check. The revert pull request follows.
- **The Concierge adopts first**, the Frodo repositories after.

Proposed here, to be confirmed or changed in review:

- The seal is a **front matter key**, so it travels with a copied record; history is the second witness and not the first.
- Typos are corrected by an **erratum with a seal chain**, approved by an owner, with no size heuristic.
- The incident log is a **file on a separate branch**, so that no bot writes to the default branch.
- The updater is **duplicated** for the first release.
- The kit is plain **Node.js with no dependencies**, like the Concierge's scripts.

Open:

- Making the repository **public**, which is needed for the first release and for testing the plan limits.
- A **licence**: the other repositories of the organisation have none.
- Who the **owners** are: the people whose review an erratum needs. The organisation has two owners.
- Whether the kit's own records are sealed from the first one accepted. Record 0001 proposes it.

## Later

- **Executable checks.** A record may list a command in a `checks:` key that tests whether the code follows it. The audit runs them and reports a failure as a deviation, which is not a tampering. Records without checks stay advisory, as today, where PR triage reads them.
- **One updater for any kit**, extracted from the Concierge's and this one's.
- **A generated index.** The index in each records README is hand-written and validated; it could be generated from the records.
- **Shared records** across repositories as a feature of the kit, replacing the folder of core records that frodo-cli and frodo-lib keep in step by hand.

## Risks

- **A false sense of safety.** A sealed record is the one that was accepted, not a correct one. The records are still read by people.
- **Cost of the erratum.** Fixing a typo needs a pull request and an owner. If that proves too heavy, the answer is a smaller protocol decided in a new record, not a quiet exception.
- **The audit's own trust.** It depends on the last audited commit it stored; if that store is lost, the first run audits the whole history again.
- **Adoption pain.** Sealing existing records is a one-time pull request per repository, and the records of the Frodo repositories are numerous.
