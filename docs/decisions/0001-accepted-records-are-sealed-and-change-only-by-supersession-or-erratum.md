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

- A record is `proposed` while it is discussed. Accepting it is the maintainers' act, made in the pull request that sets the status and writes the seal. Only an accepted record binds.
- The seal is a SHA-256 over the sealed region, written in the front matter as `seal:`. The sealed region is the record without the keys `status`, `date` and `seal`, and without the sections `Known deviations` and `Errata`.
- After acceptance only these changes are allowed: the status becomes `superseded by NNNN` or `deprecated`; a `Known deviations` note is added, edited or removed; an erratum is added. Any other change to a record is a violation, however small.
- A changed decision is a new record that names the one it replaces. Numbers are never reused, and a record is never deleted or renamed.
- An erratum is the only way to correct sealed text, such as a typo or a broken link. It is a pull request that changes the text and the seal and adds an entry to `Errata` with the previous seal, the new seal and the reason. A person who owns the records approves it. The entries form a chain from the first seal to the current one, and a break in the chain is a violation.
- The checks decide whether the sealed region changed and whether the change is allowed. They never judge what a record says.
- A violation is reported and never repaired in place. The repair is a revert that a person merges, a `Known deviations` note that explains it, or an erratum.
- The checks run from the base branch, so a pull request cannot weaken the rules it is judged by, and they run again on the default branch on a schedule, so that a bypass is found.

## Consequences

- Every accepted record carries a seal. A record accepted before the kit is sealed once, in a pull request that changes nothing else, and the sealing is the one allowed addition of a `seal:`.
- A seal travels with its record, so a record that is copied to another repository can be verified there without its history.
- Correcting a typo costs a pull request with an erratum entry. That cost is the protection.
- The checks guarantee that a record is what was accepted, not that it is right, and not that the code follows it.
- The kit's own records are sealed by the kit, from the first one accepted.

## Alternatives considered

- Seals in a separate file, or git history alone: a separate file does not travel with a copied record, and history can be rewritten.
- Telling a typo from a change by a size heuristic: it would be wrong in both directions, so a person decides and the erratum records it.
- Signed commits or tags per record: strong, but heavy for the repositories that adopt the kit, and a check still has to say what changed.
