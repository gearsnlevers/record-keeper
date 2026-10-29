# Record Keeper: design

Status: draft for review (2026-10-28, revised 2026-10-29 after a threat review). Nothing is built. Decision [0001](decisions/0001-accepted-records-are-sealed-and-change-only-by-supersession-or-erratum.md) is the protocol; this page is how the kit enforces it.

## Why

Decision records bind people and coding agents. The rule that an accepted record is never edited, only superseded, is text in the README of each repository's records folder. Nothing enforces it:

- the validators check the format of a record and not what changed in it, and there are three copies (Issue Concierge, frodo-lib, frodo-cli) that have drifted apart: the Concierge's and frodo-lib's differ on about 190 lines, though they share one core (the statuses, the front matter keys, the section order, the 60-line limit, the file name pattern and the secret patterns);
- the comparison of the shared records between frodo-cli and frodo-lib runs weekly, only reads, and goes red without telling anyone;
- the records are copied between repositories by hand.

A decision that can change without notice is not a decision. The kit makes the protocol checkable, so that a breach is stopped where possible and found where not.

## What it is

A separate, versioned repository, delivered to a repository the way Issue Concierge is: the repository pins a released version, a pull-based updater opens one pull request when a newer release exists, and a maintainer merges it. What a release installs:

| Part | What it is |
| ---- | ---------- |
| Templates | the records folder skeleton: the `README.md` with the rules, the record template, the index |
| Validator | one script, `record-keeper.mjs`, with `validate`, `seal`, `check-pr` and `audit`; no dependencies |
| Workflows | `Records integrity` (on pull requests), `Records audit` (nightly and on every push to the default branch), the updater, and `Records setup check` |
| Setup check | `Records setup check` tells a repository when its installation is incomplete or wrong: no `CODEOWNERS` entry for the kit's settings, pin and workflow files, fewer owners listed than `approvals` needs (and a notice on every run while the single-owner mode is on), a ruleset that does not require `Records integrity`, a settings file it cannot use, a workflow that differs from the installed release. It prints notices and fails only on what would silently disable a layer. It is the kit's counterpart of the Concierge's deployment check. |
| Skill and instructions | the `record-a-decision` skill for Claude Code and Copilot, and a block for `AGENTS.md` |
| Pin and settings | two files, as the Concierge has: `.github/record-keeper.yml` is the pin and belongs to the updater; `.github/record-keeper/settings.yml` holds the folder, the owners and the other settings and belongs to the maintainers |
| Essence compactor | optional, a later release: finds records whose subject has moved on, or that say one thing in many places, and proposes a generalized or consolidated record to supersede them (see "The essence compactor") |

It is not a replacement for review. It checks whether a record is what was accepted, never whether it is right, and it does not check whether the code follows the record (see "Later").

## The protocol

Decided in record 0001; in short:

- A record is `proposed`, then `accepted` by the maintainers. Only an accepted record binds. A record is `accepted` exactly when it carries a seal that verifies, and a sealed record is never `proposed` again.
- Accepting writes a seal, with the generation of the protocol it was made under (`seal: sha256-g1:…`): a SHA-256 over the **sealed region**, the whole record except the keys `status`, `date` and `seal` and the sections `Known deviations` and `Errata`. The seal is a front matter key, so it travels with a record that is copied to another repository.
- After that a record may only change its status to `superseded by NNNN`, gain an entry in `Known deviations`, or gain an erratum.
- **The status is outside the seal, so another sealed record vouches for it.** `superseded by NNNN` holds only if record NNNN exists, is accepted with a verifying seal, has a higher number, and lists this record in its own sealed `supersedes:` key; supersession has no cycles. There is no bare `deprecated`: a record withdrawn without a replacement is superseded by a short record that says why, so every end of a binding record is a sealed, owner-approved record. (Why the status is not simply put into the seal: every supersession would change the seal and need a chain entry, copies of one record in several repositories would carry different seals, and a hash can be recomputed by whoever edits the file, so it is the successor's seal and the owners' approval that protect the status.)
- An erratum corrects sealed text (a typo, a broken link). It is a pull request that changes the text and the seal, which stays under the record's own generation, and adds an `Errata` entry with the previous seal, the new seal, the hash of the entry before it and the reason. It needs the owners' approval (see "Owners are the human half"). It cannot change `applies-to`, `repos`, `window` or `supersedes`: that is a new record. `Errata` and `Known deviations` are append-only: the check requires the existing entries to be byte-identical at the head. A deviation entry works as a waiver, so it needs the same approval, and it cites an issue, pull request or commit of this repository that the check can resolve (the issue or pull request exists, the commit is in the history of the default branch). It excuses exactly the violation that case caused, matched by the audit on that commit: never a later change, and never the record in general, so a note cannot become a standing waiver. The check cannot judge whether the excuse is valid; it can only make a blanket or invented one impossible. An erratum that changes more than whitespace stays open at least 48 hours, and the check posts its diff as a comment on the pull request. The entries of `Errata` form a chain from the first seal to the current one, and the audit lists every erratum with its diff.
- A changed decision is a new record, which may replace several. Numbers are never reused, and a record is never deleted or renamed.

## Amending the protocol

The protocol cannot be designed once and for all, so it carries its own way to change. The protocol is a record, so the base is there: a new record supersedes it. What is added is what must hold so that an amendment breaks nothing that exists, and a bar higher than for any other record.

**Generations.** The protocol has a generation number, `g1` for the first. A generation fixes the **canonical form** of a record before it is hashed (line endings, trailing whitespace, how the excluded keys and sections are cut out, with fixed test vectors) and the rules a record must meet to be accepted. Every seal names its generation, such as `sha256-g1:…`, and a record is verified by the rules of that generation, forever. Two consequences keep an amendment from being a flag day:

- a new generation, for example another hash or another sealed region, changes how records are accepted **from then on** and never invalidates an earlier seal, so nothing has to be re-sealed;
- **format rules bind a record when it is accepted**, and afterwards only its seal matters, so a stricter rule later does not turn the old records red.

**The amendment.** An amendment is a new record in this repository that **supersedes the current protocol record in full**, so one complete text is always in force (the alternative, numbered additions that must be read in order, is harder to read and to check). It ships with the code that implements it, in a release of the kit. The records README keeps a table of the generations: the generation, the record, and its status. The earlier protocol stays in the history as superseded.

**The bar.** Higher than for an ordinary record, because every other record is protected by these rules:

- the approval of **all owners** of the kit, each of the current head commit;
- the pull request has been **open at least seven days** before the last approval, so nobody is rushed. The check verifies both from the reviews and their timestamps;
- the waiting period can be **waived only when every owner approves and the record says why** (a front matter key `emergency:` with the reason, for a broken hash function, say), so the exception is visible in the record for good;
- **changing the amendment rule itself must meet the rule it replaces**, so the bar cannot be lowered by the lower bar.

**What cannot change quietly.** An amendment is a numbered, sealed, visible record. The protocols before it stay in the history. The incident log stays append-only. Every seal keeps verifying under the rules it was made under. An amendment is never retroactive.

**Ratification by each deployment** comes from the design as it is. A deployment never amends the protocol: it is the kit's. A new generation reaches a deployment as a kit release in an update pull request, and a change to the pin needs an owner's approval, so the deployment's owners ratify by approving it. The deployment stays on its generation until then. The kit verifies the seals of every generation for good, but creates a seal only under the generation that the deployment's base-branch pin names: an older generation, or one the kit does not know, fails closed, so a new record cannot be sealed under a weaker rule after the rule has been replaced. An update that brings a new generation or new check code, and any change to the list of owners, meet the amendment bar (all owners, seven days) in the deployment, because they are the deployment's own amendment.

## The layers

| # | Layer | What it does | What it cannot do | First release |
| - | ----- | ------------ | ----------------- | ------------- |
| 1 | Prevention | The required check `Records integrity` runs from the base branch and fails a pull request that breaks the protocol. `approvals` owners (two by default; named accounts matched by ID) must approve an erratum, an acceptance, a deviation entry and a change to the kit's settings, pin or workflow files: the check verifies the approvals, and `CODEOWNERS` covers the settings, pin and workflow files. | Stop an administrator, or a person with the bypass role, who merges past the check. | yes |
| 2 | Sealing | A record carries its seal, so any later change to it is visible to a hash comparison, and a copy can be verified on its own. | Say whether an allowed change was right. | yes |
| 3 | Detection | A nightly audit re-checks every record against its seal, the erratum chain and the history since the last audit, and again on every push to the default branch. | Look at what it cannot read: a rewritten history is only noticed because the audit remembers the last commit it saw. | yes |
| 4 | Logging | Each violation opens one deduplicated issue and is appended to an incident log. A deviation that a maintainer accepted lives in the record's `Known deviations`. | Decide whether a violation matters. | yes |
| 5 | Reaction | The audit opens a pull request that reverts the offending change, and the default branch shows a red status until it is resolved. A person merges it. | Revert by itself: no bot writes to the default branch. | later |

Layers 1 and 2 are the ones that cost a contributor something. Layers 3 and 4 exist because layer 1 can be bypassed by a person who is allowed to, and the audit must not trust anything in the repository that a bypass could have rewritten.

## How a pull request is checked

`Records integrity` is a workflow triggered by `pull_request_target`, which GitHub runs in the context of the **default branch** of the base repository, so a pull request cannot change the check it is judged by. The workflow therefore has to be on the default branch: in experiment E1 a copy that lived only on another base branch never ran. The pull request's base, which can be a release branch listed in `branches:`, is what the head is compared with. The rules for it:

- It checks out the default branch, where the workflow comes from, and runs the validator from there. The head and the base of the pull request are fetched as data only (read with `git show`) and never executed, and the validator parses front matter with its own small parser, never with `eval` or a loader that runs code.
- Its token is read-only (`contents: read`, `pull-requests: read`). It reports through the status of its own job, so it needs nothing else.
- For every record it compares base and head. A record that is `accepted` at the base must have an unchanged sealed region and an unchanged `seal:`, unless the pull request is an erratum whose chain is valid. A new record may be `proposed` freely. A record that becomes `accepted` must carry a seal equal to the hash of its sealed region. Deleting, renaming, renumbering and moving a record back from `accepted` are failures.
- It also runs the format validation on the head: names and numbers, front matter, section order, length, credentials, and an index that lists every record with its status.
- A status that becomes `superseded by NNNN` must meet the vouching rule of record 0001 (the successor exists, is accepted and sealed, has a higher number and lists this record), and a record that arrives `accepted`, new or copied, is an acceptance.
- The name of the check, `Records integrity`, is stable, because a repository requires it by name.

**The check is hardened against the people it judges** (from the "Threat review"):

- **The real check must always report.** Tested (E1 to E3): a `skipped` or `neutral` result satisfies a required check, so the workflow has no `if:`; a `paths:` filter leaves the pull request blocked, which is safe but would block every pull request outside the records folder, so there is none; a cancelled or failed run blocks. A same-named job in the pull request, or a check posted through the API by any workflow with `checks: write`, cannot turn a failing real check green and cannot overwrite it, but it does satisfy the requirement when the real check reports nothing. Pinning the required check to the GitHub Actions integration changes nothing against that, because the competing workflow runs as the same app, so the design does not rely on it. A final verdict job runs `if: always()` and fails unless every job before it succeeded. A `[skip ci]` in the head commit only blocks a `pull_request` workflow (a denial, not a bypass), and the documentation says it does not stop a `pull_request_target` one. The window in which the real check is missing (an outage, a workflow an administrator disabled) is covered only by the audit on the next push.
- The ruleset requires up-to-date branches, so two pull requests that are valid alone cannot combine into an invalid tree (two records with one number, a record superseded by one that was withdrawn meanwhile). The check refuses a pull request that adds or renames a workflow or job so that it collides with the name of the check.
- It reads every record as a blob (`git cat-file`), never from a working tree, and refuses what makes the readers disagree: symlinks, submodules, executable modes, `.gitattributes` entries that touch the records folder, a records `README.md` in any other candidate folder, duplicate front matter keys, anchors, multi-line values for the excluded keys, and headings that only look like `## Errata` (inside a fence, in setext form).
- It flags a change that removes the last file an `applies-to` of an accepted record matches. Moving the code is a way round the record, and the Concierge already has a test with the same purpose.

**Owners are the human half.** They are **named accounts** (`owners:` in the settings, at least `approvals` of them, two by default), recorded with their **numeric user ID** and matched by it, because GitHub releases a login after a rename and anyone could then claim the old one. They approve four acts and nothing else:

- an **erratum**, a correction of sealed text;
- an **acceptance**, a record whose status becomes `accepted` and which gets its seal; a record that arrives already `accepted` (also by copy from another repository) counts as one;
- a **deviation entry**: a note in `Known deviations` works as a waiver, so it needs owners and cites the case it excuses;
- a change to the kit's **settings, pin or workflow files**.

The check verifies these itself. With its read-only token it reads the reviews of the pull request and requires **`approvals` distinct owners** (two by default, one in the single-owner mode): the owners who authored the pull request, or whose latest review is an approval of the **current head commit**, each counted once and matched by ID. An approval of an earlier commit does not count, and a later "changes requested" from the same owner cancels the approval. "Not the author" alone would not be a two-person rule: one owner could have another account or the coding agent open the pull request and then approve it, which is one owner and not two (the single-owner mode accepts exactly that, knowingly). It can do that for named accounts. As far as is known the workflow token cannot read the membership of a team (untested), so a team could be enforced only through GitHub's own `CODEOWNERS` rule; that is why teams are optional later and not the default.

`CODEOWNERS` is the second line. It covers the kit's settings, pin and workflow files, and a ruleset requires the review of code owners for them. It does **not** cover the records folder: an ordinary record, including a new proposed one, is reviewed the way the repository reviews any change today (in Frodo, by a maintainer), so the kit adds no new gate to the everyday work of writing records. By default there are at least two owners (the setting `approvals: 2`): nobody can approve their own pull request, and the author counts once. A deployment with one maintainer chooses the single-owner mode below.

**How the check learns about an approval.** Tested on 2026-10-29 (experiments E4 and E5 in "Prerequisites and what was verified"). `pull_request_target` has no review event, so it does not run again when a review arrives, and a `pull_request_review` workflow runs the pull request's own copy of the file, so it must never decide anything. What works is a **re-run** of `Records integrity` after the approvals: it reads the live reviews of the current head commit with a `pull-requests: read` token, replaces its earlier result, and is code of the default branch. Whoever can write may press Re-run, and nobody can forge an approval by doing so. That keeps a human lever and needs no extra token. Whether a `workflow_run` or `issue_comment` workflow of the default branch could do it by itself is untested.

### Single-owner mode

The maintainer's decision, 2026-10-29: a deployment with one maintainer sets `approvals: 1`. The owner list may then have one entry, and the owner's own pull request counts as the approval (the author counts once, as always), or the owner approves a pull request that someone else, or an agent, opened. The delays stay (seven days to amend the protocol, 48 hours for an erratum that changes prose) and so does the audit with its log and issues, because they cost the owner nothing. Lowering `approvals` meets the amendment bar, raising it needs one owner, and the setup check prints a notice on every run while the mode is on.

The mode is for **keeping the maintainer honest and the records in order**. The seal, the status vouching, the append-only sections, the numbering, the index, the resolver and the audit work as before. What it gives up:

| | Several owners | Single owner |
| - | - | - |
| An accidental edit, drift, a forgotten decision | held | held |
| A contributor or an agent changing what binds | held | held: a pull request that is not the owner's needs the owner's approval |
| One owner acting alone (accepting, an erratum, a waiver, the pin, the owner list) | held: a second owner is needed | **not held**: the owner is the whole authority |
| A stolen owner account or token, or automation that holds the owner's token | held: a second owner is needed | **not held**: one token is everything; only the delays and the audit stand against it |
| Another account, or the coding agent, opens a pull request for the owner to approve (attack 6) | held | meaningless: there is one person |
| An administrator bypass | residual risk | the same |

Automation is the subtle part. The Concierge's updater opens its pull requests with a personal access token, so they are authored by the owner's account and count as the owner's own: in this mode merging the update is the only human act left. If that matters, give automation an identity of its own (a machine user or a GitHub App), and its pull requests need the owner's approval. A deployment that later wants a second pair of eyes sets `approvals: 2` and adds an owner; nothing sealed changes. A later option is a `witnesses:` list of accounts that are told, by mention, about every acceptance, erratum, deviation entry and amendment.

## The nightly audit and the log

The audit is the same code run on the whole tree. It runs every night and on every push to the default branch. It reads the records, recomputes each seal, walks the erratum chain, and checks the commits since the last audited commit against the rules. It remembers the last commit it audited; if that commit is no longer an ancestor of the default branch, history was rewritten, which is a violation of its own. The remembered commit is only a speed-up, because anyone with write access can rewrite a file on the log branch: every night the audit also re-verifies each record against the whole history of its file, so moving the pointer past a bad commit hides nothing. It keeps a register of every record number that ever existed, so a number cannot come back. It trusts an incident issue only if its own bot authored it, because anyone can open an issue that carries the hidden marker and so make the audit update theirs. And it hashes the installed text that agents read (the rules in the records `README.md`, the `AGENTS.md` block) the way it hashes the workflow files.

When it finds a violation:

- one issue per record and kind of violation, titled `Records: 0012 changed after acceptance`, carrying a hidden marker so that the next run updates the same issue and closes it when the record is clean again;
- an entry in the incident log, appended to the file `incidents.jsonl` on the branch `record-keeper/log`. The branch is not the default branch, so writing to it is not a write to the default branch, and a ruleset forbids force pushes and deletion on it;
- a failing status on the head commit of the default branch, so that it shows red until the violation is resolved.

The ways to resolve one are the ones the protocol names: a revert, an erratum, or a `Known deviations` note. A note resolves only the violation of the commit it cites, so the next violation of the same record is reported again.

## What the gates read

The Concierge's gates and the coding agents read records, so the readers are part of what an adversary attacks: the cheapest way round a binding record is to make the reader not see it, or to feed it text it will obey. The rules for a reader:

- It reads a record through `record-keeper resolve`, plain code that verifies the seal and the status vouching and hands over the sealed region and the verified status. A model is not handed the raw file: `Known deviations` and `Errata` are unsealed text, so they are data and never instruction.
- A record that fails verification is not used and is reported, and a gate that would have used it holds the request (`plan-approval-required`) and says why. It does not go on as if no rule applied.
- The folder comes from the kit's settings on the base branch. The Concierge's rule today, the first of `docs/decisions/` and `decisions/` that has a `README.md`, lets a pull request that adds the other `README.md` make every record of a repository disappear for the gates; the check refuses such a file, and the gates read `folder:` instead.
- `applies-to` is matched by code, not by a model.

## Threat review

The design was attacked on 2026-10-29 by the person who wrote it, against four kinds of adversary: a contributor with a pull request, an agent or maintainer with write access, an owner (or a stolen owner account), and the supply chain of the kit itself. The seal held. What did not hold was the lifecycle (status, deviations, errata), the owner check, and the readers. What is in force now is in the sections above; this table keeps the reasoning and says what is still to be confirmed.

| # | Attack | Defence | State |
| - | ------ | ------- | ----- |
| 1 | Set a record to `superseded by` a successor that is only `proposed` or does not exist: it stops binding, nothing replaces it | the vouching rule: the successor exists, is accepted and sealed, has a higher number and lists the record; no cycles | in the text |
| 2 | Deprecate a record with a one-line status change | no bare `deprecated`: a withdrawing record, sealed and owner-approved | in the text |
| 3 | A `Known deviations` note as a standing waiver, and as text a model obeys | the owners' approval; a citation the check resolves; a note excuses only the violation of the commit it cites; readers get the sealed region only. Append-only stops rewriting earlier entries, not adding one | in the text; the validity of a real citation is the owners' judgment |
| 4 | Rewrite a decision by erratum with one approval, or rewrite old `Errata` entries | the owners' approval; 48 hours open and the diff posted for a change beyond whitespace; append-only and hash-chained, which stops rewriting earlier entries; structured keys cannot change; the audit lists every erratum | in the text; two owners who agree on a bad erratum are a residual risk |
| 5 | Add the other candidate `README.md` so the gates read an empty folder | the check refuses it; the gates read `folder:` | in the text |
| 6 | One owner opens the pull request through another account or the coding agent and approves it | `approvals` distinct owners, counting the author once | in the text; the single-owner mode accepts it by design |
| 7 | Claim an owner's login after a rename | owners are matched by numeric ID | in the text; tested (E5): GitHub's documentation says an old username "becomes available for anyone else to claim" |
| 8 | Seal a new record under an older generation, or an unknown one | seals are created only under the generation of the base-branch pin; an unknown generation fails closed | in the text |
| 9 | Satisfy the required check with a job of the same name in the pull request, with a check posted through the API, or with a skipped job | the real check is a `pull_request_target` workflow of the default branch with no `if:` or `paths:`, and its verdict always reports and never ends skipped or neutral; a same-named job cannot outvote or overwrite a failing real check; pinning the integration does not help and is not used | tested (E1 to E3); the window in which the real check is missing is covered only by the audit |
| 10 | Make the check green after an approval arrives, with code the pull request controls | a re-run of the check after the approvals, which reads the live reviews with default-branch code; no decision is made in a `pull_request_review` workflow, which runs the pull request's own file | tested (E4); a `workflow_run` or `issue_comment` workflow and an `APPROVE` review remain untested |
| 11 | Change the owner list, or ship new check code through an ordinary update | both meet the amendment bar | in the text |
| 12 | Move the audit's remembered commit past a bad commit, or squat the incident marker | whole-history verification each night; the marker counts only on the bot's own issues | in the text |
| 13 | Race: two valid pull requests that combine into an invalid tree | up-to-date branches required | in the text |
| 14 | Make the reader and the check disagree about a file (duplicate keys, fake headings, byte-order marks, symlinks, `.gitattributes`) | one strict parser, blobs only, refusals listed above, adversarial test vectors in M1 | in the text; vectors in M1 |
| 15 | Move the code so that no `applies-to` matches | the check flags the change that removes the last match | in the text |
| 16 | Slip an `accepted` record in through a mirror pull request with a valid seal | a record that arrives `accepted` is an acceptance with the owners of the receiving repository | in the text |
| 17 | Edit the rules agents read (the records `README.md`, the `AGENTS.md` block) | hashed by the audit like the workflow files | in the text |
| 18 | Manufacture the compactor's signals (delete files, bump versions) to get a rule generalized away | the compactor only drafts; acceptance is the owners' | unchanged |
| 19 | An administrator bypasses the check and disables the audit in the same change | none inside the repository; `pull_request` bypass mode closes direct pushes | residual risk, accepted |
| 20 | In the single-owner mode: the owner alone, a stolen owner token, or automation that holds it | the delays (seven days, 48 hours), the audit and its log, and automation under an identity of its own | accepted by the deployment that chooses the mode ("Single-owner mode") |

What held without change: an edit of sealed text, deleting or renaming a record, weakening the check inside the pull request it judges, a force-push to the default branch, a stale approval, and a quiet amendment of the protocol.

## The essence compactor

Introduced by the maintainer on 2026-10-28. A record is written about a moment, and the moment passes. frodo-cli's record 0030 says that interactive mode never prompts for what 4.x accepted, and spells out the realm default and the credential sources that count. Once 5 is fully released and the work moves to 6, "4.x" and "5.x" mean nothing to a newcomer, but the rule underneath is as true as ever: **a new version keeps what the previous one accepted, and a deliberate break is documented**. A record that has outlived its subject is noise: the Concierge's plan gate lists it under "Decisions that apply" and can hold a request for conflicting with it, and PR triage can flag a change for opposing it. The compactor keeps the set of records alive by finding such records and offering to replace them with their essence.

It has two jobs. **Generalizing** takes one record whose subject has moved on and states what lasts. **Consolidating** takes several records that say one thing in many places and replaces them with one. A project that keeps deciding things accumulates both: records pile up, small ones on a single subject (frodo-cli's 0022 to 0028 are seven records about what lives in the CLI instead of the library, and 0014 to 0020 are mostly about the interactive mode), and the older ones are overtaken. Cleaning up is part of the life of a set of records, not an exception to it.

### Two ideas

- **The impact window** is where a record still constrains a change. For each branch the repository maintains (`main`, and release branches if the settings list them) the window is `open` (the record applies), `closing` (its premise is ending, for example the version it protects has shipped), `closed` (what it covers is gone, or the premise has gone), or `unknown`. A record is only compacted when its window is closed on every branch where it is in force: a maintenance branch that still runs 4.x keeps record 0030 alive there.
- **The essence** is the lasting rule that a time-bound record is an instance of, stated without versions, counts, names of options or other values that will move. The rest of the record, the instances, belongs in code, tests and documentation, and stays readable in the superseded record.

### Compaction is a supersession

A sealed record is never rewritten, so the compactor never edits one. It proposes a **new record** that states the essence and supersedes the old one (or several old ones into a single new one). The old record stays in the repository with its status `superseded by NNNN`, and the new one names it in a `supersedes:` key that the validator cross-checks (each listed record must be `superseded by` this number). A supersession always needs a record, because a sealed record cannot gain a `supersedes:` key and the status is vouched for by the successor: where an accepted record already states the essence, the new record is short and points to it; when nothing lasting remains, it is a short record that withdraws the old one and says why.

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

Outcomes of a review: **supersede with a generalized record**; **supersede with a short record** because the essence is already held, or **withdraw with a short record** because nothing lasting remains; **keep**, with a reason, because the window is still open on a maintained branch. A record is never deleted and never rewritten.

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
- **Copies are verified by seal and by status.** Identical copies have identical seals. A difference opens an incident issue in the repository that finds it, instead of a red run nobody reads, and a status that differs between copies is tolerated for a grace period (a replaced record is updated repository by repository) and then reported. A seal proves that a copy is intact, not that the repository accepted it: a copy that arrives by mirror pull request is an acceptance there and needs that repository's owners' approval.
- **Numbers are allocated across the listed repositories.** `record-keeper new --shared` takes the next number that is free in every repository it lists, including open pull requests, so that two pull requests cannot both claim the same one.
- **Mirror pull requests come later.** A shared record is decided once, in the repository where it originates; the kit then opens a mirror pull request in each other repository that `repos:` lists, and a maintainer merges each. This is what core 0018 turned down as too costly to build (a sync workflow to write and keep); the kit writes it once for everyone. It needs a token that can open pull requests in the other repositories.
- **Compaction of a shared record** is proposed once and carried to every copy by the same mirror pull requests.

## Configuration

Two files in the consuming repository, because they have different owners. The pin is written by the updater on its own branch; the settings are edited by hand. The Issue Concierge keeps them apart for the same reason (`.github/issue-concierge.yml` and `.github/issue-concierge/settings.yml`, its records 0023 and 0038: a repository tunes the gates with optional files and never by editing managed ones, and the files are named for the product's kind).

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
owners: [{login: alice, id: 1001}, {login: bob, id: 1002}]   # accounts matched by numeric ID: they approve an erratum, an acceptance, a deviation entry and a change to the settings
approvals: 2                      # how many owners must approve: 2 by default; 1 is the single-owner mode ("Single-owner mode"), which the setup check reports on every run
extra-keys: []                    # front matter keys beyond the standard ones, for example repos
branches: [main]                  # the branches whose records are in force; the compactor judges the window on each
compactor: off                    # off, report (the scan only), or assist (the agent drafts proposals)
```

**The settings are protected like the records.** They decide what the check looks at, so a pull request that edited them could loosen the check that judges it (point `folder:` somewhere else, empty `owners:`). Therefore:

- the check and the audit read the settings and the pin **from the base branch**, never from the pull request;
- a pull request that changes either file fails `Records integrity` unless the owners (`approvals` of them) have approved it, `CODEOWNERS` lists both files and the kit's workflow files, and a change to `owners:` meets the amendment bar (all owners, seven days), because the owners are the root of that bar;
- an unreadable or unknown setting is reported and the default stays, as in the Concierge, except that a setting that would switch a layer off (an empty `owners:`, a `folder:` that does not exist) is an error and not a default;
- the setup check warns when `CODEOWNERS` does not cover those files, and when fewer owners are listed than `approvals` needs.

The three existing validators differ only in such extras (frodo-lib has a `repos` key and handling for shared records; the Concierge has an e-mail check). The kit keeps the shared core and makes the extras settings, so a repository that needs one asks for it and does not fork the script.

## Delivery and versions

- Releases are semantic, immutable and attested, with a manifest of content hashes, produced by the same release actions the Concierge uses.
- The updater is a copy of the Concierge's updater, adapted to this kit's pin file. This duplicates code on purpose for the first release. Extracting one updater that serves any kit is worth doing once two kits exist, not before.
- A change to a rule is a new record in the kit and a new release, never a patch in a consumer. The updater rebuilds one branch and one pull request in each repository; a maintainer merges it.
- The updater and the reaction layer open pull requests, so they need a token that can, not the workflow token: the organisation policy planned for the Actions token disables pull request creation by Actions.

## One validator

Today the Concierge validates its records with its own script and its own tests; frodo-lib has its own; frodo-cli tests its records in `test/unit/DecisionRecords.test.js`. The kit's validator is extracted from the Concierge's, which has a test suite of its own, and takes from frodo-lib the handling of shared records as a setting. Each repository then deletes its copy.

## Adoption

1. **Issue Concierge first.** It seals its existing records in one pull request that adds only `seal:` keys, installs the kit, and deletes its own validator. It is the first consumer and the test of the migration.
2. **frodo-lib and frodo-cli after** the kit has proven itself there. They replace their two validators and the weekly comparison of shared records; a seal makes a copied record verifiable, so the comparison becomes a check of seals.
3. The Frodo repositories are governed by their own maintainers: adopting is a pull request they review. In each of them the change that seals the records also renames `core/` to `shared/` and updates the citations, and frodo-lib, which stays on `decisions/` for now, only gets the rename. The shared records are verified across frodo-cli, frodo-lib and the tap, which replaces the weekly comparison of two repositories.

## Prerequisites and what was verified

- The repository must be **public** for the rulesets, required checks and `CODEOWNERS` enforcement that layer 1 needs on the Free plan, and for public repositories to consume it without extra tokens. The repository was made public on 2026-10-28.
- **Verified on 2026-10-28** on a public repository in a Free-plan organisation, by creating each rule through the API as a throwaway ruleset on a branch pattern that matches nothing and deleting it at once. **Accepted:** protection against deletion and force pushes, a required pull request with review from code owners, a required status check by name, restriction of updates, bypass actors by repository role in the modes `always` and `pull_request`, and the enforcement mode `evaluate` (a dry run). **Rejected:** push rules (restricting file paths, a maximum file size: "Source public repos cannot have push rules") and required workflows, a workflow of another repository that must pass (rejected with an empty reason even for a real workflow in the same organisation). So layer 1 works as designed. The file path push rule was never relied on. The rejection of required workflows means that the check cannot live in this repository and be forced onto the consumers: it runs from each consumer's own base branch, and the audit verifies that the installed workflow files match the release by their hashes.
- **Experiments on 2026-10-29** on throwaway branches, pull requests and one throwaway ruleset in this repository, all removed afterwards (the closed pull requests #2 to #17 remain, because GitHub does not delete them). A same-named job cannot outvote or overwrite a failing check but can stand in for a missing one (E1); `skipped` and `neutral` count as success, `cancelled`, failure and a `paths:` filter that excludes the pull request block, and a check posted through the API satisfies a ruleset pinned to the Actions integration (E2); `[skip ci]` in the head commit blocks a `pull_request` workflow (E3); a `pull_request_review` workflow runs the pull request's own copy of the file, and a re-run of the check reads the live reviews and replaces its result (E4); a read-only token reads `user.id`, `commit_id`, `state` and `submitted_at` of a review, and `author_association` reads `CONTRIBUTOR` for an organisation owner, so it is not used (E5). **Not tested** because the kit's workflow is not on `main` yet: a `pull_request_target` run for a pull request against another branch, a `workflow_run` or `issue_comment` workflow of the default branch, and an `APPROVE` review by a second account (GitHub refuses to approve one's own pull request). They belong to M2.
- A deployment needs **at least `approvals` owners**: two by default, one in the single-owner mode. This organisation has two owners and keeps the default for the kit's own repository.
- A person with bypass rights can still get a change past the check. The bypass role is set to the mode `pull_request`, which closes direct pushes: a bypass is then a merge that skips the check, and the audit finds it on the push to the default branch and the reaction proposes the revert. An administrator can still change the rulesets and disable the audit in the same change. That is the residual risk of this design, accepted; the only protection against it is a witness outside the repository.
- **Guard the guard.** The check lives in the consuming repository and could be edited there. The ruleset requires it, the check runs from the base branch, and the audit verifies that the workflow files themselves match the installed release by their hashes, as the updater already does for the Concierge.

## Milestones

| # | What | Outcome |
| - | ---- | ------- |
| M0 | This design, record 0001 and the repository | reviewed and accepted |
| M1 | The library: parse, seal, compare, validate, with tests, and the canonical form of generation g1 with fixed test vectors, among them adversarial ones (duplicate keys, fake headings, byte-order marks, symlinks, odd modes, `.gitattributes`) | `record-keeper.mjs` with `validate` and `seal` |
| M2 | The pull request check (the two-owner rule, the status vouching, the hardening of the check itself, the bar for amending the protocol) and the audit with the log | the two workflows, the incident issue and the log branch |
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
- Typos are corrected by an **erratum with a seal chain**, approved by the owners (`approvals`), with no size heuristic (the maintainer, 2026-10-28).
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
- **The protocol can be amended** (the maintainer, 2026-10-28), by a new record that supersedes it in full, with the approval of **all owners** after the pull request has been **open seven days**; the waiting period can be waived only with every owner's approval and a stated reason; changing that rule meets the old rule.
- **Old records are grandfathered by generation**: each is verified, and its format was checked, by the rules of the generation it was accepted under, forever, and nothing is re-sealed when a generation changes.
- The repository is **public** and licensed **MIT** (the maintainer, 2026-10-28), with secret scanning, push protection, Dependabot security updates and private vulnerability reporting on.
- **Owners are named accounts, at least `approvals` of them (two by default), matched by numeric ID, with a narrow scope**: `approvals` of them approve an erratum, an acceptance, a deviation entry and a change to the settings, pin or workflow files; `CODEOWNERS` covers only the kit's settings, pin and workflow files; ordinary record pull requests keep the repository's normal review. Teams may follow later and work only through `CODEOWNERS`. For this repository the owners are the two organisation owners.
- **Where the compactor's agent runs, and with which credentials, is decided when M8 is built.** The first release and the compactor's report mode need no model and no secret.

Taken by the maintainer on 2026-10-29:

- **A single-owner mode** (`approvals: 1`) for a deployment with one maintainer, with its risks stated in "Single-owner mode". The Issue Concierge uses it for now, since it has one maintainer; a project with several people, such as Frodo, keeps the default of two; the kit's own repository keeps two. The mode is for keeping the maintainer honest and the records in order.

Proposed after the threat review (2026-10-29), to be confirmed or changed in review; the reasoning is in the "Threat review":

- **No bare `deprecated`**: a record ends only by a sealed successor, which may be a short record that withdraws it.
- **The status is vouched for by the successor's seal** and not put into the seal.
- **The owners' approval** (`approvals` of them, two by default) for the four acts, matched by numeric ID, with the author counted once.
- **`Known deviations` and `Errata` are append-only**; a deviation entry needs the owners, cites a case the check resolves and excuses only the violation of that case; an erratum keeps the record's own generation, cannot change `applies-to`, `repos`, `window` or `supersedes`, and stays open 48 hours when it changes more than whitespace.
- **Seals are created only under the generation of the base-branch pin**; older generations only verify; an unknown one fails closed.
- **Readers go through the resolver**, and a gate holds a request instead of proceeding when a record fails verification.
- **The bypass role uses the mode `pull_request`**, and the administrator remains the residual risk.

Open:

- What the experiments could not test (see "Prerequisites and what was verified"): a `pull_request_target` run from the default branch for a pull request against another branch, a `workflow_run` or `issue_comment` workflow of the default branch, and an `APPROVE` review. They are done in M2, once the kit's workflow is on a default branch.
- Whether the kit's own records are sealed from the first one accepted. Record 0001 proposes it.
- How often the scan runs, and how strict the signals are. A first guess is monthly, with the thresholds in the settings.
- Whether the compactor handles the shared records of frodo-cli and frodo-lib, which are the same files in both repositories, or leaves them until the kit carries shared records.

## Later

- **Executable checks.** A record may list a command in a `checks:` key that tests whether the code follows it. The audit runs them and reports a failure as a deviation, which is not a tampering. Records without checks stay advisory, as today, where PR triage reads them. A `window-check:` in the same style could say by exit code whether a record still applies.
- **One updater for any kit**, extracted from the Concierge's and this one's.
- **A generated index.** The index in each records README is hand-written and validated; it could be generated from the records.
- **Shared records** across repositories as a feature of the kit, replacing the folder of core records that frodo-cli and frodo-lib keep in step by hand.

## Risks

- **A protocol that is too hard to change gets worked around.** The bar is high but finite, and it has an emergency path that leaves a visible trace.
- **A false sense of safety.** A sealed record is the one that was accepted, not a correct one. The records are still read by people.
- **Cost of the erratum.** Fixing a typo needs a pull request and an owner. If that proves too heavy, the answer is a smaller protocol decided in a new record, not a quiet exception.
- **Owners who agree on a bad erratum or a bad deviation** (in the single-owner mode, one owner). The checks decide whether a change is allowed, not whether it is right. What stands against it is the visibility (the diff comment, the audit's list of errata, the deviations in the record) and the waiting time, not prevention. This is the same trust in the owners that the amendment bar rests on.
- **The audit's own trust.** It depends on the last audited commit it stored; if that store is lost, the first run audits the whole history again.
- **A lossy generalization.** A model can state the essence too broadly to be checkable, or too narrowly and miss why the record mattered. The proposal shows what it loses, a person accepts it, and the superseded record stays in the history.
- **Adoption pain.** Sealing existing records is a one-time pull request per repository, and the records of the Frodo repositories are numerous.
