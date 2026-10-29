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
| Workflows | `Records integrity` (on pull requests), `Records audit` (nightly and on every push to the default branch), the updater, and `Records setup check` |
| Setup check | `Records setup check` tells a repository when its installation is incomplete or wrong: no `CODEOWNERS` entry for the kit's settings, pin and workflow files, fewer than two owners listed, a ruleset that does not require `Records integrity`, a settings file it cannot use, a workflow that differs from the installed release. It prints notices and fails only on what would silently disable a layer. It is the kit's counterpart of the Concierge's deployment check. |
| Skill and instructions | the `record-a-decision` skill for Claude Code and Copilot, and a block for `AGENTS.md` |
| Pin and settings | two files, as the Concierge has: `.github/record-keeper.yml` is the pin and belongs to the updater; `.github/record-keeper/settings.yml` holds the folder, the owners and the other settings and belongs to the maintainers |
| Essence compactor | optional, a later release: finds records whose subject has moved on, or that say one thing in many places, and proposes a generalized or consolidated record to supersede them (see "The essence compactor") |

It is not a replacement for review. It checks whether a record is what was accepted, never whether it is right, and it does not check whether the code follows the record (see "Later").

## The protocol

Decided in record 0001; in short:

- A record is `proposed`, then `accepted` by the maintainers. Only an accepted record binds.
- Accepting writes a seal: a SHA-256 over the **sealed region**, the whole record except the keys `status`, `date` and `seal` and the sections `Known deviations` and `Errata`. The seal is a front matter key, so it travels with a record that is copied to another repository.
- After that a record may only change its status to `superseded by NNNN` or `deprecated`, gain or lose a `Known deviations` note, or gain an erratum.
- An erratum corrects sealed text (a typo, a broken link). It is a pull request that changes the text and the seal and adds an `Errata` entry with the previous seal, the new seal and the reason, approved by an owner of the records. The entries form a chain from the first seal to the current one.
- A changed decision is a new record, which may replace several. Numbers are never reused, and a record is never deleted or renamed.

## The layers

| # | Layer | What it does | What it cannot do | First release |
| - | ----- | ------------ | ----------------- | ------------- |
| 1 | Prevention | The required check `Records integrity` runs from the base branch and fails a pull request that breaks the protocol. Owners (named accounts, at least two) must approve an erratum, an acceptance and a change to the kit's settings, pin or workflow files: the check verifies the approval, and `CODEOWNERS` covers those files. | Stop a person who may bypass the rules, or a push to the default branch that skips the pull request. | yes |
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

**Owners are the human half.** They are **named accounts, at least two** (`owners:` in the settings), and they approve three acts and nothing else:

- an **erratum**, a correction of sealed text;
- an **acceptance**, a record whose status becomes `accepted` and which gets its seal;
- a change to the kit's **settings, pin or workflow files**.

The check verifies these itself. With its read-only token it reads the reviews of the pull request and requires an approving review of the **current head commit** by a listed owner who is **not the author** of the pull request: an author's own approval does not count, and neither does an approval of an earlier commit. It can do that for named accounts. As far as is known the workflow token cannot read the membership of a team (untested), so a team could be enforced only through GitHub's own `CODEOWNERS` rule; that is why teams are optional later and not the default.

`CODEOWNERS` is the second line. It covers the kit's settings, pin and workflow files, and a ruleset requires the review of code owners for them. It does **not** cover the records folder: an ordinary record, including a new proposed one, is reviewed the way the repository reviews any change today (in Frodo, by a maintainer), so the kit adds no new gate to the everyday work of writing records. Two owners at least, because nobody can approve their own pull request: with a single owner every change would need a bypass.

## The nightly audit and the log

The audit is the same code run on the whole tree. It runs every night and on every push to the default branch. It reads the records, recomputes each seal, walks the erratum chain, and checks the commits since the last audited commit against the rules. It remembers the last commit it audited; if that commit is no longer an ancestor of the default branch, history was rewritten, which is a violation of its own.

When it finds a violation:

- one issue per record and kind of violation, titled `Records: 0012 changed after acceptance`, carrying a hidden marker so that the next run updates the same issue and closes it when the record is clean again;
- an entry in the incident log, appended to the file `incidents.jsonl` on the branch `record-keeper/log`. The branch is not the default branch, so writing to it is not a write to the default branch, and a ruleset forbids force pushes and deletion on it;
- a failing status on the head commit of the default branch, so that it shows red until the violation is resolved.

The ways to resolve one are the ones the protocol names: a revert, an erratum, or a `Known deviations` note.

## The essence compactor

Introduced by the maintainer on 2026-10-28. A record is written about a moment, and the moment passes. frodo-cli's record 0030 says that interactive mode never prompts for what 4.x accepted, and spells out the realm default and the credential sources that count. Once 5 is fully released and the work moves to 6, "4.x" and "5.x" mean nothing to a newcomer, but the rule underneath is as true as ever: **a new version keeps what the previous one accepted, and a deliberate break is documented**. A record that has outlived its subject is noise: the Concierge's plan gate lists it under "Decisions that apply" and can hold a request for conflicting with it, and PR triage can flag a change for opposing it. The compactor keeps the set of records alive by finding such records and offering to replace them with their essence.

It has two jobs. **Generalizing** takes one record whose subject has moved on and states what lasts. **Consolidating** takes several records that say one thing in many places and replaces them with one. A project that keeps deciding things accumulates both: records pile up, small ones on a single subject (frodo-cli's 0022 to 0028 are seven records about what lives in the CLI instead of the library, and 0014 to 0020 are mostly about the interactive mode), and the older ones are overtaken. Cleaning up is part of the life of a set of records, not an exception to it.

### Two ideas

- **The impact window** is where a record still constrains a change. For each branch the repository maintains (`main`, and release branches if the settings list them) the window is `open` (the record applies), `closing` (its premise is ending, for example the version it protects has shipped), `closed` (what it covers is gone, or the premise has gone), or `unknown`. A record is only compacted when its window is closed on every branch where it is in force: a maintenance branch that still runs 4.x keeps record 0030 alive there.
- **The essence** is the lasting rule that a time-bound record is an instance of, stated without versions, counts, names of options or other values that will move. The rest of the record, the instances, belongs in code, tests and documentation, and stays readable in the superseded record.

### Compaction is a supersession

A sealed record is never rewritten, so the compactor never edits one. It proposes a **new record** that states the essence and supersedes the old one (or several old ones into a single new one). The old record stays in the repository with its status `superseded by NNNN`, and the new one names it in a `supersedes:` key that the validator cross-checks (each listed record must be `superseded by` this number). Where an accepted record already states the essence, the proposal has no new record: it only supersedes, or deprecates when nothing lasting remains.

### Consolidation

Several records become one, and each of them becomes `superseded by` it; the new record lists them in `supersedes:`. The scan looks for candidates by what the records have in common: overlapping `applies-to` globs, records that cite each other by number, titles about one component, and chains of supersession that have grown long. The agent, for a group of records:

- checks that they do not contradict each other, and **reports a contradiction instead of choosing**: which of two rules wins is a decision, so it goes to a maintainer;
- maps every rule of every original to the consolidated record, or lists it as dropped with the reason, in a **coverage table in the pull request** (not in the record), so that a reviewer sees what stops binding;
- carries forward or resolves the `Known deviations` of the originals, and lists them in the proposal;
- keeps to the 60-line limit. If a group cannot be said in one record within it, the proposal is several records, one per sub-subject, or to keep the records as they are. The limit is not raised for a consolidation: a record too long to check is the problem being cleaned up.

A consolidation can itself be consolidated later. The chain is followed by plain code: `record-keeper resolve 0030` prints the records that bind now in place of 0030.

### Three steps

1. **Scan** (plain code, no model). For each record and branch it gathers signals with their evidence: an `applies-to` glob that matches no file; a version or branch named in the record that the repository has moved past; cited issues and pull requests that are closed; paths that nobody has touched for a long time; a growing `Known deviations` section. A signal is not a verdict. A record with no signal is not assessed. The scan alone is useful: it keeps one issue, "Records to review", that lists the candidates with their evidence.
2. **Assessment** (a read-only agent, optional). For a candidate it reads the record, the code it covers on each branch, the related records and the history, and answers: the window per branch; the essence in one sentence; whether another record already holds it; what the generalization would lose.
3. **Proposal** (a draft pull request). The agent drafts the new record in the format the validator enforces (a rule rather than a value, at most 60 lines, no versions or counts) as `proposed`. It never writes a status or a seal. A maintainer who agrees runs `record-keeper accept NNNN`, plain code that sets the status, writes the seal, and sets the old records to `superseded by NNNN`; a maintainer who disagrees closes the pull request, and the compactor remembers (in its state on the log branch, not in any record) and does not propose that record again until it or the code it covers changes, or a review date set in the settings has passed.

Outcomes of a review: **supersede with a generalized record**; **supersede or deprecate without a new record** because the essence is already held or nothing lasting remains; **keep**, with a reason, because the window is still open on a maintained branch. A record is never deleted and never rewritten.

### A worked example (the shape, not a proposal)

Record 0030 states the rule as "4.x versus 5.x" and adds instances: the realm is never counted as missing, and a list of credential sources makes a command complete. The scan would flag it once the repository's version has moved past the line it names. The assessment would find the essence and the instances. A generalized record could read:

- A command line that ran successfully under the previous major version runs successfully under this one and does not prompt.
- A prompt or other new behaviour only takes the place of input the previous major version rejected.
- A deliberate break is documented where users look for upgrade notes, and decided in a record of its own.
- A test for new behaviour names the old command line that failed; a test for what must not change names the one that ran.

What it loses: the realm default and the credential sources. Those are instances of the rule: they belong in the code, in the tests and in the usage documentation, and the superseded record keeps them for anyone who needs the history.

### Guardrails

- **The agent is read-only and never merges.** It opens a draft pull request. Status, seal and supersession are written by plain code on a maintainer's command, so that the model is never the one that changes what binds.
- **A proposal shows its work:** the evidence from the scan, the essence, the window per branch, what is lost, and the records it replaces. A generalization that no check or reviewer could apply ("keep things compatible") is a worse record than the one it replaces; the agent is told to keep a rule only if a reviewer can check a change against it, and to propose keeping the record when it cannot.
- **It is off by default and costs credits only when it assesses**, with a budget and a limit on proposals per period. Report-only mode needs no model and no secret.
- **It never touches a record that is `proposed`**, and it does not compact records shared between repositories until the kit can carry a change to all the copies.

### Declared windows

A record that is time-bound from the start can say so. An optional `window:` key, part of the sealed region because it is part of the decision, states when the record stops applying, for example "until the 4.x line is no longer maintained". The skill asks for it when the decision names a version, a migration or a date. The scan reads it as a signal and the agent as evidence; the validator does not interpret it. A later step could make it executable like the `checks:` of "Later".

## After a supersession: edit, archive or keep

Cleaning up raises a question: what happens to the records that were replaced, and may a record ever be edited in place instead? The maintainer decided on 2026-10-28 to **keep them in place**. The three ways, and what each costs:

| Way | What it means | For | Against |
| --- | ------------- | --- | ------- |
| **Keep in place** (decided) | A replaced record stays where it is with the status `superseded by NNNN`. Its number is never reused. The index and the tools show the binding records first and the replaced ones as history. | URLs and citations stay valid; nothing is lost or moved; the seal and the history stay trivially verifiable. | The folder and the index grow. |
| **Archive** | A replaced record moves to an `archive/` folder after a period. Its number is never reused. | A short folder and index. | A move changes the path, and a link to the old path stops working. The Concierge's own rules have records cited as full GitHub URLs in public text and in triage comments. A stub left at the old path is a second file to maintain. |
| **Edit in place** | A record absorbs others and the others are deleted, or a record is reworded as the project changes. | A living document; the smallest folder. | It is what the protocol exists to prevent: what binds can change without a new decision, a citation of a number may mean something else next year, and a deleted number invites reuse. |

Common to all three: numbers are never reused, and a record is never deleted. The case for keeping in place is that the gates already ignore everything that is not `accepted` (the plan gate lists only records that bind, and PR triage judges against those), so a replaced record costs the gates nothing; the cost is to people reading the folder, and that is a matter of presentation. The kit handles it there: the index lists the binding records and the replaced ones in separate sections, and `record-keeper resolve` follows a number to what binds now. If the folder still grows too large, archiving can be added later, and then needs a rule for the links.

Editing in place is not allowed. The one exception is already in the protocol, the erratum: a typo or a broken link is corrected with an approved entry that chains the seals.

## Where the records live

The folder is a setting (`folder:`), because repositories differ: a repository whose `docs/` is generated output cannot keep records there. The default is `docs/decisions`, the usual convention and the first place the Concierge's gates look; the gates fall back to `decisions/` at the root, and the first folder with a `README.md` wins, never both. Other deployments may choose differently.

**For the maintainer's own repositories the location is one, `docs/decisions`** (the maintainer asked on 2026-10-28 for them all to be the same), with **one exception for now: frodo-lib**. Every repository already keeps its records in `docs/decisions` except frodo-lib, which keeps them in `decisions/` because its release step runs `npm run doc` and commits `docs`, and typedoc empties its output folder first. Frodo-lib therefore sets `folder: decisions`, and the kit works there unchanged. Ending the exception needs a small change on lib's side, which is not part of adopting the kit: generate the API documentation into a temporary folder and copy it into `docs/` with everything outside `docs/decisions` replaced. When that is done, lib moves its records and the exception goes. The alternative, the root `decisions/` for everyone, would have moved every other repository and broken the links to their records.

## Records shared by several repositories

Some records bind more than one repository. Frodo calls them *core* records and keeps the same file in a `core/` folder of each repository it binds, numbered apart from the local records and cited as "core NNNN" (core 0018 explains why: the gates read only the repository they run in, and one cross-repository decision cost three pull requests before). The kit keeps that design and makes it checkable. Its vocabulary is **shared**, not core: the folder is `shared/` inside the records folder, the citation is "shared NNNN", and the name is a setting. *Core* suggests importance, but the folder mixes contracts between repositories (the library is the brain, the public API is only the facade) with policies that merely apply in each repository (which packaging allowlist, which recording framework), while some local records are more fundamental than either. What sets a record apart is how many repositories it binds.

- **Scope is the `repos:` key.** A record that binds one repository is a local record and never goes into `shared/`. A local record becomes shared by a new shared record that supersedes it; it does not move.
- **`repos:` is authoritative.** A copy exists in exactly the repositories it lists. The check flags a missing copy and an unlisted copy, in every listed repository and not in a hard-coded pair. Today the Frodo records do not follow this: core 0008 binds frodo-cli and the tap but frodo-lib holds a copy, and core 0018 lists cli and lib but the tap holds a copy. Because `repos:` is part of the sealed text, correcting it is an erratum, or the copy is removed from the repository it does not bind.
- **Copies are verified by seal and by status.** Identical copies have identical seals. A difference opens an incident issue in the repository that finds it, instead of a red run nobody reads, and a status that differs between copies is tolerated for a grace period (a replaced record is updated repository by repository) and then reported.
- **Numbers are allocated across the listed repositories.** `record-keeper new --shared` takes the next number that is free in every repository it lists, including open pull requests, so that two pull requests cannot both claim the same one.
- **Mirror pull requests come later.** A shared record is decided once, in the repository where it originates; the kit then opens a mirror pull request in each other repository that `repos:` lists, and a maintainer merges each. This is what core 0018 turned down as too costly to build (a sync workflow to write and keep); the kit writes it once for everyone. It needs a token that can open pull requests in the other repositories.
- **Compaction of a shared record** is proposed once and carried to every copy by the same mirror pull requests.

## Configuration

Two files in the consuming repository, because they have different owners. The pin is written by the updater on its own branch; the settings are edited by hand. The Concierge keeps them apart for the same reason (`.github/concierge.yml` and `.github/agentic-workflows/settings.yml`, its record 0023: a repository tunes the gates with optional files and never by editing managed ones).

`.github/record-keeper.yml`, the pin, written by the updater and never edited by hand:

```yaml
source: gearsnlevers/record-keeper
version: v1.0.0
channel: stable
```

`.github/record-keeper/settings.yml`, the settings, edited by the maintainers; the kit ships a template with every key commented out at its default, so a repository that keeps `docs/decisions` needs no settings file:

```yaml
folder: docs/decisions            # where the records live; any folder works, but see "Where the records live"
shared-folder: shared             # the subfolder of `folder` for records that bind several repositories
owners: ['@alice', '@bob']        # at least two accounts: they approve an erratum, an acceptance and a change to the settings
extra-keys: []                    # front matter keys beyond the standard ones, for example repos
branches: [main]                  # the branches whose records are in force; the compactor judges the window on each
compactor: off                    # off, report (the scan only), or assist (the agent drafts proposals)
```

**The settings are protected like the records.** They decide what the check looks at, so a pull request that edited them could loosen the check that judges it (point `folder:` somewhere else, empty `owners:`). Therefore:

- the check and the audit read the settings and the pin **from the base branch**, never from the pull request;
- a pull request that changes either file fails `Records integrity` unless an owner has approved it, and `CODEOWNERS` lists both files and the kit's workflow files;
- an unreadable or unknown setting is reported and the default stays, as in the Concierge, except that a setting that would switch a layer off (an empty `owners:`, a `folder:` that does not exist) is an error and not a default;
- the setup check warns when `CODEOWNERS` does not cover those files, and when only one owner is listed (every change would then need a bypass).

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
3. The Frodo repositories are governed by their own maintainers: adopting is a pull request they review. In each of them the change that seals the records also renames `core/` to `shared/` and updates the citations, and frodo-lib, which stays on `decisions/` for now, only gets the rename. The shared records are verified across frodo-cli, frodo-lib and the tap, which replaces the weekly comparison of two repositories.

## Prerequisites and what was verified

- The repository must be **public** for the rulesets, required checks and `CODEOWNERS` enforcement that layer 1 needs on the Free plan, and for public repositories to consume it without extra tokens. The repository was made public on 2026-10-28.
- **Verified on 2026-10-28** on a public repository in a Free-plan organisation, by creating each rule through the API as a throwaway ruleset on a branch pattern that matches nothing and deleting it at once. **Accepted:** protection against deletion and force pushes, a required pull request with review from code owners, a required status check by name, restriction of updates, bypass actors by repository role in the modes `always` and `pull_request`, and the enforcement mode `evaluate` (a dry run). **Rejected:** push rules (restricting file paths, a maximum file size: "Source public repos cannot have push rules") and required workflows, a workflow of another repository that must pass (rejected with an empty reason even for a real workflow in the same organisation). So layer 1 works as designed. The file path push rule was never relied on. The rejection of required workflows means that the check cannot live in this repository and be forced onto the consumers: it runs from each consumer's own base branch, and the audit verifies that the installed workflow files match the release by their hashes.
- Every deployment needs **at least two owners**. The organisation here has two.
- A person with bypass rights can still push a change past the check. That is accepted: the audit finds it and the reaction proposes the revert.
- **Guard the guard.** The check lives in the consuming repository and could be edited there. The ruleset requires it, the check runs from the base branch, and the audit verifies that the workflow files themselves match the installed release by their hashes, as the updater already does for the Concierge.

## Milestones

| # | What | Outcome |
| - | ---- | ------- |
| M0 | This design, record 0001 and the repository | reviewed and accepted |
| M1 | The library: parse, seal, compare, validate, with tests | `record-keeper.mjs` with `validate` and `seal` |
| M2 | The pull request check and the audit with the log | the two workflows, the incident issue and the log branch |
| M3 | Release, updater and the setup check | a first release that a repository can install, and check |
| M4 | The Concierge adopts it | its validator deleted, its records sealed |
| M5 | The reaction: the revert pull request | layer 5 |
| M6 | frodo-lib, frodo-cli and the tap adopt it, with the shared-record check across them | their validators and the weekly comparison deleted; `core/` renamed to `shared/` |
| M7 | The compactor scan: signals for generalizing and for consolidating, the `window:` key, the "Records to review" issue, `supersedes:`, `accept` and `resolve` | report mode |
| M8 | The compactor agent: assessment and draft proposals; its engine and credentials are decided here | assist mode |
| M9 | Shared records: number allocation across repositories and the mirror pull requests | one decision, mirrored |

The first release is M1 to M3: layers 1 to 4.

## Decisions

Taken by the maintainer on 2026-10-28:

- The reaction to a violation is a **revert pull request that a person merges**, not a bypass bot. A direct revert can be reconsidered later.
- The first release includes **the nightly audit and the log**, not only the check. The revert pull request follows.
- **The Concierge adopts first**, the Frodo repositories after.
- **Records that bind several repositories are called *shared***, not core, with the folder name a setting. Frodo renames `core/` to `shared/` when it adopts the kit, in the same change that seals the records.
- **The kit opens the mirror pull requests** for a shared record, as a later feature; merging stays with a person.
- **The records of the maintainer's repositories all live in one location**, `docs/decisions`, **except frodo-lib for now**, which keeps `decisions/` until its documentation generation stops emptying `docs/`. Others may configure theirs.
- **The essence compactor** is part of the kit: it finds records whose subject has moved on and proposes a generalized record that supersedes them (the maintainer's idea, same day).

Proposed here, to be confirmed or changed in review:

- The seal is a **front matter key**, so it travels with a copied record; history is the second witness and not the first.
- Typos are corrected by an **erratum with a seal chain**, approved by an owner, with no size heuristic.
- The incident log is a **file on a separate branch**, so that no bot writes to the default branch.
- The updater is **duplicated** for the first release.
- The unified location is **`docs/decisions`**. Frodo-lib is an exception for now (decided by the maintainer), and ending the exception is a change to lib's documentation generation that the kit does not depend on.
- The first release includes a **setup check**, the kit's counterpart of the Concierge's deployment check; it was in the original idea and had been left out of this design.
- The kit is plain **Node.js with no dependencies**, like the Concierge's scripts. The compactor's agent is the one exception, an optional gh-aw workflow like the Concierge's gates.
- The compactor comes **after the first release**, **report mode first** (the scan and the issue, no model), then assist mode.
- The compactor **never rewrites a record**: it supersedes, and plain code writes the status and the seal on a maintainer's command.
- The compactor **consolidates** several records into one (the maintainer, same day), not only generalizes a single one.
- A replaced record **stays in place** with the status `superseded by NNNN`: it is never moved, deleted or edited, and its number is never reused. The index and the tools show what binds first and the replaced records as history. Editing a record in place is not allowed, and archiving is not done.
- A consolidated record keeps to the **same 60-line limit**. A group that does not fit becomes several records by sub-subject, or stays as it is.
- The **`window:` key** and the **`supersedes:` key** are part of the kit's record format.
- The repository is **public** and licensed **MIT** (the maintainer, 2026-10-28), with secret scanning, push protection, Dependabot security updates and private vulnerability reporting on.
- **Owners are named accounts, at least two, with a narrow scope**: they approve an erratum, an acceptance and a change to the settings, pin or workflow files; `CODEOWNERS` covers only the kit's settings, pin and workflow files; ordinary record pull requests keep the repository's normal review. Teams may follow later and work only through `CODEOWNERS`. For this repository the owners are the two organisation owners.
- **Where the compactor's agent runs, and with which credentials, is decided when M8 is built.** The first release and the compactor's report mode need no model and no secret.

Open:

- Whether the kit's own records are sealed from the first one accepted. Record 0001 proposes it.
- How often the scan runs, and how strict the signals are. A first guess is monthly, with the thresholds in the settings.
- Whether the compactor handles the shared records of frodo-cli and frodo-lib, which are the same files in both repositories, or leaves them until the kit carries shared records.

## Later

- **Executable checks.** A record may list a command in a `checks:` key that tests whether the code follows it. The audit runs them and reports a failure as a deviation, which is not a tampering. Records without checks stay advisory, as today, where PR triage reads them. A `window-check:` in the same style could say by exit code whether a record still applies.
- **One updater for any kit**, extracted from the Concierge's and this one's.
- **A generated index.** The index in each records README is hand-written and validated; it could be generated from the records.
- **Shared records** across repositories as a feature of the kit, replacing the folder of core records that frodo-cli and frodo-lib keep in step by hand.

## Risks

- **A false sense of safety.** A sealed record is the one that was accepted, not a correct one. The records are still read by people.
- **Cost of the erratum.** Fixing a typo needs a pull request and an owner. If that proves too heavy, the answer is a smaller protocol decided in a new record, not a quiet exception.
- **The audit's own trust.** It depends on the last audited commit it stored; if that store is lost, the first run audits the whole history again.
- **A lossy generalization.** A model can state the essence too broadly to be checkable, or too narrowly and miss why the record mattered. The proposal shows what it loses, a person accepts it, and the superseded record stays in the history.
- **Adoption pain.** Sealing existing records is a one-time pull request per repository, and the records of the Frodo repositories are numerous.
