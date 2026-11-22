<!-- record-keeper:begin -->
<!-- Managed by Record Keeper: the updater rewrites everything between the two markers, so a change made here is lost. Change the text in the kit. -->
## Decision records

Lasting decisions are kept as records in the folder named by `folder` in `.github/record-keeper/settings.yml` (`docs/decisions` when the setting is absent). Read its `README.md` and its index before you change behaviour that a record may cover.

- An accepted record binds people and coding agents. Never edit one. It changes only by a new record that supersedes it, by an erratum, or by an entry in its deviations section, and the owners approve all three.
- If your task conflicts with an accepted record, stop and say so in the issue or pull request. Do not work around the record.
- A pull request that changes a decided behaviour adds a record, or supersedes the old one, in the same pull request.
- To propose a decision, follow the `record-a-decision` skill in `.claude/skills/record-a-decision/SKILL.md`. Write the record with the status `proposed`.
- Never accept or seal a record. Accepting is an act of the owners, made in their own pull request.
- Numbers of records are never reused, and a record is never deleted, renamed or renumbered.
- Before you push a change to a record, run `node .github/record-keeper/record-keeper.mjs validate` (give the folder when it is not `docs/decisions`).
- Keep secrets, credentials, tenant names and personal data out of a record: it, its history and its pull request are read by many people.
<!-- record-keeper:end -->