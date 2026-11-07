# The bar for an amendment

Status: draft for review (M2.7b). This page says which changes meet the bar that [record 0001](decisions/0001-accepted-records-are-sealed-and-change-only-by-supersession-or-erratum.md) and [the design](design.md#amending-the-protocol) set for amending the protocol, what the bar is, the front matter key `emergency:` that waives the waiting, and what `check-pr` prints. Until now the act `owners` could not be met by any approval; here it can. It is not part of the protocol. It is read with [checking a change](checking-a-change.md) and [approvals](approvals.md).

The bar is higher than for any other act, because every other record is protected by the rules that an amendment changes:

- **Every owner** of the settings of the base has approved the head commit, or opened the pull request (the author counts once, as always).
- The head commit has been **in front of the owners for seven days** before the last approval.
- The seven days may be **waived** only for an amendment of the protocol that says why in its own sealed text (`emergency:`), and every owner must still approve.

## Which changes meet the bar

| Act | Found when | Path |
| --- | ---------- | ---- |
| `owners` | the settings of the head name other owners, by ID, or a lower `approvals` ([checking a change](checking-a-change.md#acts)) | `.github/record-keeper/settings.yml` |
| `amendment` | a record becomes sealed at the head and lists in `supersedes` a **protocol record** of the base | the record |
| `amendment` | the set of protocol records in the README of the records folder is not the same at the head as at the base | `<folder>/README.md` |

- A **protocol record** is a record named in the **table of the generations** of the README of the records folder, as it is at the **base**: a row whose first cell is `g` and one or more digits and whose second cell contains a link written `[NNNN](`, such as `| g1 | [0001](0001-accepted-records-are-sealed.md) | accepted |`. The design has that table in the kit's own records folder: the generation, the record and its status. A repository whose README has no such row has no protocol record and so no amendment: a deployment never amends the protocol, the kit does ([the design](design.md#amending-the-protocol)).
- The table is read from the **base**, so a pull request cannot take the row away to escape the bar. A pull request that changes the set of numbers in the table (adds a generation, removes one, points a row at another record) is itself an amendment, the second row of the table above. Changing the status column, or the words around the table, is not.
- **An amendment replaces the act `accept`** for that record: the record is not listed twice. A record that is accepted and replaces no protocol record is an ordinary acceptance. So **accepting record 0001 itself is an ordinary acceptance**: it replaces nothing.
- **The pin, the workflow files and the code files keep the ordinary approval** ([the files of the check](protected-files.md)). The design would put an update that brings new check code under the bar; the check cannot read the pin to tell, and the decision of 2026-11-07 is to leave the pin as it is.
- Changing the rule that sets the bar is an amendment, a new record that supersedes the protocol, so it meets the bar as it stands at the base ("a change to this rule must meet the rule it replaces").

## What the bar is

For an act of these kinds, with `needed` the number of **owners** in the settings of the base (not `approvals`):

1. **Owners.** There is at least one owner. A base with no owner cannot approve an amendment: `no owners`.
2. **All of them.** Every owner counts as in [approvals](approvals.md): authored the pull request, or has as the latest decisive review an approval of the head commit. The count is `n of m owners` when some do not.
3. **The clock.** Unless the seven days are waived, the time from `--since` (the start of the first run of the check on the head commit, as for [the 48 hours](errata-and-deviations.md#the-48-hours)) to the **last approval** is at least seven days (604,800 seconds). `--since` is required: without it `no clock`.
4. **The last approval** is the latest `submitted_at` among the approving reviews of the owners that count. An owner who counts only because they opened the pull request has no review and no time. When no review counts (every owner is the author), the last approval is **now**: the clock runs until someone presses Re-run.

Because the clock is the first run on the **head commit**, every push starts it again, and an approval that came before the seven days were over does not help: the owners approve again, after the seven days. That is stricter than "open seven days" and is the point of the wait: the commit that is merged has been in front of the owners for a week.

## `emergency:`

`emergency:` is a standard key of a record, optional, a single value: the reason, written in the record, in at most 500 characters ([the format](record-format.md)). It is part of the sealed text.

- **The waiver.** An act `amendment` for a record that has `emergency:` is met without the seven days, when every owner has approved. It needs no `--since`. A line `<path>: the seven days were waived by the record (emergency)` is printed, so the log says so.
- **Only an amendment may use it.** A record that becomes sealed with `emergency:` and does not replace a protocol record is P-16: the key is not an excuse for anything but an amendment, and a reader who finds it in a record should be able to trust that the wait was waived there.
- **Not for the owners.** The act `owners` has no record to carry the key, and the act `amendment` for the README table has none either; neither can be waived. An emergency change of the owners goes through a record that replaces the protocol.

## The rule

| Rule | A problem is reported when | Kind | Detail |
| ---- | -------------------------- | ---- | ------ |
| P-16 | a record becomes sealed with the key `emergency:` and does not replace a protocol record | change | |

## What `check-pr` prints

An act of the bar that is not met is one line: `<path>: needs the amendment bar (<kind>): <reason>`, with the first reason that applies, in the order of the list above: `no reviews were given` (the command was not given `--reviews`), `no owners`, `n of m owners` (the number that count, and the number of owners), `no clock`, or `Nh of 168h` (the whole hours from `--since` to the last approval). An act of the bar that is met adds nothing to the lines, except the line of the waiver. The other acts are as before.

`needs` prints `clock` when an act of the bar is present and not waived.

## What this does not do

- **It does not judge that an amendment replaces the protocol "in full",** or that it ships with the code. A record that lists the protocol record in `supersedes` is an amendment to the check; whether its text is one complete text is for the owners.
- **It does not know a protocol that is not in the table.** The table is the register. A protocol record that is left out of it is an ordinary record.
- **It does not read the history.** A violation that happened before this pull request is for the audit (M2.8).
- **It does not stop two owners who are one person.** Two accounts of one maintainer meet the bar together; what stands against a stolen token is the seven days.

## Choices in this draft for you to decide

1. **The clock of the seven days is the first run of the check on the head commit,** not the creation of the pull request, so every push starts it again. It is the choice you made for the 48 hours. The alternative is the creation time, which lets an amendment be swapped after seven days.
2. **The last approval is the latest approving review; an author counts without a time, and with no review the time is now.** The alternative is to count the age of the pull request at the last review, which ignores the author.
3. **The protocol is read from the table of generations in the README of the base,** as the design has it. The alternative is a setting (`protocol:`), which every repository would have to keep in step with its records.
4. **A change of the set of numbers in the table is an amendment.** The status column is free, so accepting record 0001 can change it.
5. **An amendment replaces the act `accept`,** so the line says what the change is and the bar is the only one asked.
6. **`emergency:` is for an amendment only (P-16),** and cannot waive the owners' act. The alternative, a free key, lets a reason sit in a record that waived nothing.
7. **Every owner of the base,** whatever `approvals` says. With `approvals: 1` and two owners an ordinary act needs one; an amendment needs both.

## The fixtures

[test/fixtures/change](../test/fixtures/change/README.md) holds the cases that find the acts and P-16 (the group `z`); [test/fixtures/approval](../test/fixtures/approval/README.md) holds the cases of the bar itself (the group `m`).
