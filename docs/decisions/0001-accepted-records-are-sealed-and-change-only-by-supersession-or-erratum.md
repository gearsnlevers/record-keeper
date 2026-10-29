---
status: proposed
date: 2026-10-28
decision-makers:
  - maintainers
applies-to:
  - docs/decisions/**
  - scripts/**
  - workflows/**
---

# Accepted records are sealed and change only by supersession or an approved erratum

## Context and problem statement

A decision record binds people and agents once it is accepted, and the rule that an accepted record is not edited is only text. Nothing detects an edit: the validators check format and not changes, three copies of the validator have drifted apart, and a weekly comparison of shared records goes red without telling anyone. A record that can change without notice is no longer a decision.

## Decision

- A record is `proposed` while it is discussed. Accepting it is the maintainers' act, made in the pull request that sets the status and writes the seal. Only an accepted record binds. A record is `accepted` exactly when it carries a seal that verifies, and a sealed record is never `proposed` again.
- The seal is a SHA-256 over the sealed region, written in the front matter as `seal:` together with the generation of the protocol it was made under, such as `sha256-g1:…`. The sealed region is the record without the keys `status`, `date` and `seal`, and without the sections `Known deviations` and `Errata`.
- After acceptance only these changes are allowed: the status becomes `superseded by NNNN`; an entry is added to `Known deviations`; an erratum is added. Any other change to a record is a violation, however small.
- The status is not covered by the seal, so another sealed record vouches for it: `superseded by NNNN` holds only if record NNNN exists, is accepted with a verifying seal, has a higher number, and lists this record in its own sealed `supersedes:` key. Supersession has no cycles. There is no bare `deprecated`: a record withdrawn without a replacement is superseded by a short record that says why.
- A changed decision is a new record that names the records it replaces, one or several. Numbers are never reused, and a record is never deleted or renamed.
- `Known deviations` and `Errata` are append-only. A deviation entry cites the issue, pull request or commit it excuses. An erratum entry carries the hash of the entry before it.
- An erratum is the only way to correct sealed text, such as a typo or a broken link. It changes the text and the seal, which stays under the record's own generation, and adds an entry with the previous seal, the new seal and the reason. The chain from the first seal to the current one must be unbroken. An erratum cannot change `applies-to`, `repos`, `window` or `supersedes`: that is a new record.
- An acceptance, an erratum, a deviation entry and a change to the kit's settings, pin or workflow files need **two distinct owners**: the owners who authored the pull request or approved its current head commit, each counted once.
- The protocol has a **generation**. A generation fixes how a region is cut out and normalised before it is hashed, and the rules a record must meet to be accepted. A record is verified by the rules of the generation of its seal, forever. A seal is created only under the generation that the base branch names; an older or unknown generation fails closed. A new generation never invalidates an earlier seal, and format rules bind a record when it is accepted.
- The protocol is **amended** by a new record that supersedes it in full, and by the code that implements it in a release of the kit. It needs the approval of **all owners**, and the pull request must have been open for at least seven days before the last approval. The waiting period may be waived only when every owner approves and the record says why. A change to the list of owners, and an update that brings a new generation or new check code, meet the same bar. Changing this rule must meet the rule it replaces.
- The checks decide whether the sealed region changed and whether the change is allowed. They never judge what a record says.
- A violation is reported and never repaired in place. The repair is a revert that a person merges, a deviation entry that explains it, or an erratum.
- The checks run from the base branch, so a pull request cannot weaken the rules it is judged by, and they run again on the default branch on a schedule, so that a bypass is found.
- Records are read through the kit's resolver, which verifies seal and status. A record that fails verification is not used and is reported.

## Consequences

- Every accepted record carries a seal. A record accepted before the kit is sealed once, in a pull request that changes nothing else, and the sealing is the one allowed addition of a `seal:`.
- A seal travels with its record, so a record that is copied to another repository can be verified there without its history. A valid seal proves that a record is intact, not that it was accepted: acceptance is the owners' approval in the repository that holds it.
- An amendment is never retroactive and never quiet: it is a numbered, sealed record, the earlier protocol stays in the history as superseded, and every seal keeps verifying under the rules it was made under.
- Correcting a typo costs a pull request with an erratum entry and two owners. That cost is the protection.
- The checks guarantee that a record is what was accepted, not that it is right, and not that the code follows it. A person with administrator rights can still change the repository and its checks; the audit finds it afterwards.
- The kit's own records are sealed by the kit, from the first one accepted.

## Alternatives considered

- Seals in a separate file, or git history alone: a separate file does not travel with a copied record, and history can be rewritten.
- Telling a typo from a change by a size heuristic: it would be wrong in both directions, so owners decide and the erratum records it.
- The status inside the seal: every supersession would change the seal and need a chain entry, copies of one record would disagree, and a hash can be recomputed by whoever edits the file, so the successor's seal is the better authority.
- Re-sealing every record at each amendment: one rule everywhere, but a migration of every record in every repository each time.
- Signed commits or tags per record: strong, but heavy for the repositories that adopt the kit, and a check still has to say what changed.
