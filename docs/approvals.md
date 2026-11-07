# The owners' approval

Status: draft for review (M2.4). This page says when `record-keeper check-pr` lets an act through: how many owners must have approved a pull request, which reviews count, and what the command prints. It is the second half of [checking a change](checking-a-change.md), which finds the acts; this page decides whether they are approved. It is not part of the protocol, but it is the code behind the rule of [the design](design.md#owners-are-the-human-half): the owners of a repository are named accounts, matched by their numeric ID, and `approvals` of them must approve what binds.

The check never trusts the pull request about who approved it. The owners and the number needed come from the settings of the **base** ([settings](settings.md)), so a pull request cannot add an owner who then approves it. The reviews come from the caller, which reads them from GitHub with its own token; this page decides what they mean.

## The question

A change with an **act** (an acceptance, a change to the settings, a change to the pin) needs the approval of `approvals` distinct owners. For each owner of the base: does the pull request count as theirs, or did they approve the commit that is being judged?

A change without an act needs no approval from the kit. An ordinary record, including a new proposed one, is reviewed the way the repository reviews any change.

## Definitions

- **Owners, needed.** The `owners` and the `approvals` of the settings of the base, with the default for a setting that has a problem (nobody, and 2). An owner is `login/id`; owners are matched by `id` and never by login.
- **Head commit.** The full identifier of the commit that `--head` names: 40 hexadecimal digits, or 64 in a repository that uses SHA-256.
- **Author.** The numeric ID of the account that opened the pull request, as the caller gives it.
- **Review.** A review of the pull request as GitHub's REST API returns it, with the fields `id`, `user.id`, `state`, `commit_id` and `submitted_at`. Other fields are not read.
- **Decisive review.** A review whose `state` is neither `COMMENTED` nor `PENDING`. A comment does not approve and does not take an approval back; a pending review has not been submitted.
- **Latest reviews of an owner.** Of the decisive reviews whose `user.id` is the owner's ID, those that share the greatest `submitted_at`. Usually that is one review. When several share the second, all of them count, so that two reviews of one second cannot be put in an order the data does not give.

## How an owner counts

Each owner of the base gets one of these, the first that applies:

| Result | When | Counts |
| ------ | ---- | ------ |
| `author` | the owner's ID is the author's | yes |
| `none` | the owner has no decisive review | no |
| `changes` | one of the latest reviews has the state `CHANGES_REQUESTED` | no |
| `dismissed` | none of them requests changes, and one has the state `DISMISSED` | no |
| `other` | one has a state that is neither `APPROVED` nor one of the above | no |
| `earlier` | all of them are `APPROVED`, and one has a `commit_id` that is not the head commit | no |
| `approved` | all of them are `APPROVED` for the head commit | yes |

The **count** is the number of owners that count. The approval is **met** when the count is at least `approvals`. With no owner at all the count is 0, so it is never met: the settings of the base have to name the owners before any act can pass.

Three consequences follow from the table, and each is a choice (below). An approval of an earlier commit does not count, so a push to the branch takes the approvals back. A later review that requests changes takes an approval back. A later comment does not.

## What the caller gives

`record-keeper check-pr --base <revision> --head <revision> --reviews <file> --author <id> [--repo <path>]`.

`--reviews` is the file with the reviews as GitHub returns them for `GET /repos/{owner}/{repo}/pulls/{number}/reviews`: a JSON list of reviews, or a list of pages that are lists of reviews (what `gh api --paginate --slurp` writes). `--author` is the ID of the author, written in digits. Either both are given, or neither: without them every act is unapproved, as in [checking a change](checking-a-change.md#acts).

The file is refused, and the command exits 2, when:

- it is not one JSON document (`gh api --paginate` without `--slurp` writes one document for each page);
- it is not a list, or mixes reviews and pages, or holds a list inside a page;
- an entry is not a review: `id` is not a positive integer, `user` is neither `null` (an account that was deleted) nor an object with a positive integer `id`, `state` is not text, `commit_id` is neither `null` nor text, or, for a review that is not `PENDING`, `submitted_at` is not a time written like `2026-11-06T12:00:00Z`.

An entry that is refused is counted from 1 in the order of the reviews, and the message says which and why. An entry whose `user` is `null` is read and then ignored: no owner is a deleted account.

The kit does not check that the reviews belong to the pull request whose head it is judging, and it does not page: the caller reads every page. A caller that forgets a page loses approvals, which fails closed, and could miss a later request for changes, which does not. [The workflow](workflow.md) (M2.5) reads all the pages, and has a test for it.

## Which acts the approval can meet

| Act | Met by the approval |
| --- | ------------------- |
| `accept` | yes |
| `settings` | yes |
| `pin` | yes |
| `owners` | **no** |

The act `owners` is new here. It is found when the change touches the settings and the settings of the head differ from those of the base in a way the amendment bar governs: the set of owner IDs is not the same, or `approvals` is lower. (A change of login only, a different order, or a higher `approvals` is not.) Each side is read as the check reads settings: a setting with a problem has its default, so an `owners` line that the head breaks counts as no owners. The design says that a change to the owners meets the bar of an amendment, the approval of **all** owners after the pull request has been open seven days, and that lowering `approvals` meets it too (M2.7). This version cannot check the bar, so the act cannot be approved, and the command fails. A change that is also a `settings` act shows both.

## What it prints

Without `--reviews`, the output is that of [checking a change](checking-a-change.md#how-a-problem-is-reported), plus the act `owners` where it is found.

With `--reviews`, when there is an act, the command prints one more line, on the same stream as the count that follows it:

`approvals: 1 of 2 (alice/1001: author, bob/1002: none)`

It is the count, the number needed, and the result of each owner in the order of the settings, with the login of the settings and the ID. Without owners it prints `approvals: 0 of 2 (no owners)`. The act lines name an act that is not met:

```
docs/decisions/0007-seventh.md: needs the owners' approval (accept)
.github/record-keeper/settings.yml: needs the amendment bar, which this version cannot check (owners)
```

The count line gets ` approved` after the acts when every act is met (`docs/decisions: 0 problems, 1 act approved`), and that is the only case in which a command with acts exits 0. The command exits 1 when there is a problem or an act that is not met, and 2 for wrong usage, which also covers a reviews file that is refused and an author that is not a positive integer of at most 15 digits.

## What this does not do

- **It does not count days.** The seven days of an amendment (M2.7), the 48 hours of an erratum that changes prose (M2.6) and the approval of all owners are not checked. The act `owners` stands in for the first and the last until then.
- **It does not read the pull request.** It does not know whether the reviews are those of the pull request, whether they are complete, or when the pull request was opened. [The workflow](workflow.md) does (M2.5).
- **It cannot bootstrap.** A repository whose base has no owners cannot approve anything, the change that names the owners included. The first settings are installed by an administrator, before the check is required.
- **It cannot repair a broken `owners` or `approvals` line by approval.** While the base has a problem in either, the owners are nobody or the count is 2, and the change that repairs the line (which the [repair rule](checking-a-change.md#problems-in-the-settings) lets through as far as the settings go) is still an act that nobody can approve. An administrator repairs it. The alternative, reading the items that are fine, is choice 9 of the settings page.
- **It does not read teams.** Owners are named accounts.
- **It does not announce anything.** The bot's issue for an act is the audit's (M2.9).

## Choices in this draft for you to decide

1. **The caller reads the reviews and the kit reads a file.** The kit has no network code and no token, and every case is a file. The cost is a step in the workflow, and a caller that reads the wrong thing: the design counts on the workflow being default-branch code that reads the live reviews. The alternative is that the kit calls the API with the token of the job, which is more to attack and harder to test.
2. **A comment does not take an approval back.** The design says "whose latest review is an approval"; read literally, a reply to an inline comment (GitHub records it as a review that comments) would cancel the approval of the owner who wrote it. GitHub's own merge rule does not do that. A review that requests changes, or that is dismissed, does.
3. **Reviews of one second are all read.** When an owner approves and requests changes in the same second, the order is unknown, and the owner does not count.
4. **A state the kit does not know takes an approval back** (`other`), so that a state GitHub adds later fails closed for that owner and does not stop the whole check.
5. **The author counts as an approval of their own pull request,** as the design says. With `approvals: 1` the owner's own pull request is approved; with 2, the author and one other owner are needed.
6. **The act `owners` is new and cannot be met.** It closes the gap between M2.4 and M2.7: otherwise two owners could change the list of owners, or lower `approvals`, with no more than a settings approval, which the design says is not enough. The cost is that a legitimate change of owners needs an administrator until M2.7.
7. **No bootstrap.** See above. The alternative, letting a pull request name the first owners when the base has none, would let any change that gets past the normal review of the repository install owners, in a repository that has no protection to lose and in which the check is not yet required. I would not add it before the setup check exists.
8. **A review that does not fit is an error and not a skipped entry.** A skipped entry could be the review that requests changes.

## The fixtures

[test/fixtures/approval](../test/fixtures/approval/README.md) holds `cases.json`: owners, a count, a head commit, an author and a list of reviews, with the result of each owner and the count that the check must give; and reviews files with the answer, or the reason, that reading them must give.
