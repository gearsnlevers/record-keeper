# The files that agents read

Status: draft for review (M3d). This page says what the kit installs for coding agents and for the people who work with them: the skill `record-a-decision`, a block of text in `AGENTS.md`, and the file `CLAUDE.md`. It says where each stands, how the updater writes it and what it never touches, how the pull request check, the audit and the setup check guard it, how the first adoption works, and what has not been tried. It is not part of the protocol. It is read with [the install set](install.md), which lists the files, with [the updater](updater.md), which writes them, with [the files of the check](protected-files.md), which guards them, and with [the setup check](setup-check.md), which says when they are not the release's. **None of it has been run against GitHub, and nothing here has been tried with a real agent:** the first live proof is M3e ([what is verified](#what-is-verified-and-what-is-not)).

The design promises "the `record-a-decision` skill for Claude Code and Copilot, and a block for `AGENTS.md`" ([the design](design.md#what-it-is)) and says that the rules agents read are guarded like the workflow files (threat 17 of [the threat review](design.md#threat-review)). Until M3d nothing of it existed. An agent that works in a repository with the kit reads the rules of the records folder only if something tells it to, and a rule that an agent reads is a rule that an adversary edits: the cheapest way round a binding record is to change what the agent is told.

## What is installed where

| File | Kind | What it is | What an update does |
| ---- | ---- | ---------- | ------------------- |
| `.claude/skills/record-a-decision/SKILL.md` | `managed` | the skill: how to propose, supersede and correct a record, in the order to do it | **replaces it** when it differs, and lists a local change in the pull request, like a program |
| `AGENTS.md` | `block` | the file that agents read at the root of a repository; the kit owns **only the text between two marker lines** in it | rewrites **only that text**; adds it at the end at the first adoption; creates the file when there is none; reads and changes nothing else in it |
| `CLAUDE.md` | `template` | one line, `@AGENTS.md`, so that Claude Code, which reads `CLAUDE.md` and not `AGENTS.md`, reads the block | installs it **once, when there is no `CLAUDE.md`**; never overwrites one that exists, also at the first adoption |

- **One place for the skill.** Claude Code and the GitHub Copilot cloud agent both read skills from `.claude/skills/<name>/SKILL.md` (documentation of the two products, not tried here: [what is verified](#what-is-verified-and-what-is-not)), so one file serves both. A change to a skill folder of another name is nobody's business here, and neither is another file in this one.
- **The skill is a managed file** and the **block is guarded where it is**, because both are text that an agent obeys. The kit installs no hook, no setting of an agent and no file of an agent's configuration.
- **The kit's own repository installs none of them.** It has `install.json` at its root and does not install itself ([the install set](install.md#the-layout)); it has no `AGENTS.md`, no `CLAUDE.md` and no skill of its own.

## The block

The block is this text, as the kit holds it in `templates/agents-block.md` and as a release hashes it: one **begin marker** line, text, and one **end marker** line, with no line feed after the end marker.

```
<!-- record-keeper:begin -->
<!-- Managed by Record Keeper: ... -->
## Decision records
...
<!-- record-keeper:end -->
```

The text says, in about fifteen lines of plain ASCII: where the records are (the folder named by `folder` in `.github/record-keeper/settings.yml`); that an accepted record binds and is never edited, only superseded, corrected by an erratum or noted in its deviations, each with the owners' approval; that an agent whose task conflicts with a record stops and says so; that it never accepts or seals a record, which is an act of the owners; that numbers are not reused; that it runs `record-keeper.mjs validate` before it pushes a change to a record; that no secret goes into a record; and where the skill is. It names no command that does not exist, and a test of the kit checks every command, path and link it names ([the tests](#the-tests)).

### How the markers are read

The file is read as bytes, one byte for one character, and nothing of it is decoded: the markers are ASCII, and every byte outside them is kept as it is, whatever it is (UTF-8, another encoding, a zero byte, line ends of any kind). A **marker** is

- the exact text `<!-- record-keeper:begin -->` or `<!-- record-keeper:end -->`,
- **alone on its line**, from the first byte of the line (no space or tab before it, none after it), with a carriage return allowed at the end of the line,
- **outside every fenced code block.**

A **fenced code block** is read as the part of Markdown that matters here: a line that starts with up to three spaces and then three or more backticks or three or more tildes opens a fence (a line of backticks with a backtick in the text after it does not); the fence ends at a line that starts with up to three spaces and then at least as many of the same character and nothing else but spaces and tabs, or at the end of the file. Lines inside a fence, and the lines of its two ends, are never read as markers: an example of the markers in a page of notes is an example. A fence indented by four spaces or more, or in a quotation (after a `>`), is not read as a fence, and a marker in one is a line that holds more than a marker.

What the file is then, the first that applies:

| State | When | What the updater does |
| ----- | ---- | --------------------- |
| refused, `partial-line` | a line outside a fence holds the text `record-keeper:begin` or `record-keeper:end` and is not exactly a marker (the text of a marker in prose, a marker with a space or a tab around it, a marker after other text, a byte order mark in front of it) | nothing |
| none | no marker | the block is added at the end |
| one | one begin marker, and after it one end marker | the text between them, markers included, becomes the block of the release |
| refused, `begin-without-end` | a begin marker and no end marker | nothing |
| refused, `end-without-begin` | an end marker and no begin marker | nothing |
| refused, `reversed` | one of each, the end marker first | nothing |
| refused, `doubled` | two or more begin markers or two or more end markers: two blocks, a block inside a block, a stray marker beside a block | nothing |

A **refused** file is the one thing the updater does not touch: no byte of it changes, and the update goes on without the block ([a refused block](#a-refused-block)). The names are the contract of this page and of the code; the words are not.

### What the updater writes

The function that does it takes the current bytes of the file (or none) and the bytes of the block of the release, and gives the new bytes or a reason. It is pure, and the same function is used by the updater, the check, the audit and the setup check ([the one function](#one-function-for-the-four-programs)).

| Action | When | The file becomes |
| ------ | ---- | ---------------- |
| `create` | there is no `AGENTS.md` | the block and a line feed |
| `append` | the file has no marker (state none) | the file, then a blank line (none when the file already ends in one, two line feeds when it does not end in one), then the block and a line feed |
| `replace` | one block, and it is not the block of the release | the bytes before the begin marker, the block of the release, the bytes after the end marker |
| `current` | one block, and it is the block of the release byte for byte | the file as it was: **nothing is written** |

- **Outside the two markers not a byte changes.** That is the property that matters, because the updater writes into a file that the maintainers own. The tests prove it with fixtures, with tests of the function on files made of every sort of text, and with a fuzz of 50,000 files against the second implementation ([the tests](#the-tests)).
- **The block is written as the release holds it,** with line feeds. A file that has CRLF line ends gets a block with line feeds in it, and the line ends outside the markers stay CRLF. The text after the end marker on its line (a carriage return, a line feed) is outside the block and stays.
- **An empty file** gets the block and a line feed (action `append`, no blank line before it).
- **The block that was put in is found again, and put in again changes nothing.** The tests state both for every outcome of the function.
- **Refusals that come from the file or the release, with no marker at all:** `not-text` (the file holds a zero byte and no marker: a file in UTF-16 would be spoiled by an ASCII text added to it), `fence` (the file ends inside a code fence, where the block would be taken for an example, and the next update would add another), and `invalid-block` (the text of the release is not one begin marker, text and one end marker, so it could not be found again). `not-a-file` (a folder, a link or something else at `AGENTS.md`) and `too-large` (more than 1 MiB) are the runner's: it does not follow a link and does not read more than the limit.

### One function for the four programs

A change to `AGENTS.md` is the act `instructions` only when **what agents read from the kit** changed, and the same words mean the same in the four programs, so one function says it (`blockChanged`): two versions of the file, or no file, are compared by their block, that is by the bytes from the first byte of the begin marker to the last byte of the end marker.

- A change **outside** the markers is nothing. So is moving the block, a change of line ends outside it, a change of the mode between file and executable, and a file with no block that becomes another file with no block.
- A change **inside** the markers, a change of a marker, a block that is added or taken out, and a file with a block that is deleted or created, are a change.
- A file whose markers are **refused** is compared whole: any change to it counts, and so does a change between it and a file with a block or with none, because the check cannot tell what the markers would have meant. (A repair of broken markers is therefore an act that the owners approve.)
- **A file that is not a regular file** before or after (a link, a folder, a submodule) is a change whenever it differs: a link can lead anywhere.

The pure functions live in `updater.mjs`, because the updater is fetched alone for the first adoption and cannot import another file of the kit; `record-keeper.mjs`, the rules that the check and the audit run, and `setup-check.mjs` import them from there ([the choices](#choices-in-this-draft-for-you-to-decide)).

## The skill

`templates/skills/record-a-decision/SKILL.md` is installed at `.claude/skills/record-a-decision/SKILL.md`. It is a procedure for an agent, or a maintainer, who has to record a decision in a repository that has the kit: when a record is warranted, where the folder is (`folder` in the settings), the template, the format by a link to [the format page](record-format.md), the validator, the one status an agent may write (`proposed`), supersession, an erratum for a typo, a deviation entry, the screen for sensitive content, and when to stop and ask. It links the pages and the protocol record of the kit by their full address and never restates them, so a repository that has the skill has no page of the kit in its tree and is sent to the kit's.

- **The shape of a skill** is the one of the skills that the maintainers' repositories already use: a front matter with a `name` that is the name of the folder and a `description` that is a plain YAML scalar of fewer than 1,000 characters, no `allowed-tools` (a skill never pre-approves a command), and a body of fewer than 500 lines.
- **It names no deployment** and no product that uses the kit; the tests of the install set say so for every file that a release installs.
- **A local change is overwritten and reported.** The skill is a managed file ([the updater](updater.md#what-is-managed-and-what-is-a-template)): the pull request of the next update lists a change that someone made under "Local changes this update overwrites". A rule of a repository that goes beyond the skill belongs in its own `AGENTS.md`, outside the markers, or in the records.

## `CLAUDE.md`

Claude Code reads `CLAUDE.md` and not `AGENTS.md` (what the documentation of the product says, as read for this draft; not tried here). The template is one line, `@AGENTS.md`, which makes `CLAUDE.md` import the file, so the block reaches Claude Code and the Copilot agent reads `AGENTS.md` itself.

- It is a **template**, installed once ([the updater](updater.md#what-is-managed-and-what-is-a-template)): when nothing is at `CLAUDE.md` and there is no pin yet (the first adoption) or the pinned release did not list it (the update that brings it). A repository that **has** a `CLAUDE.md` keeps it exactly as it is, at the first adoption too: nothing writes to it. A repository that deleted the file after a release that had it does not get it back.
- **An existing `CLAUDE.md` that does not import `AGENTS.md` leaves Claude Code without the block.** Nothing checks that. A line `@AGENTS.md` in it mends it, and the setup check does not look ([what it cannot do](#what-this-does-not-do)).
- A repository that keeps its Claude Code memory in `.claude/CLAUDE.md` has no `CLAUDE.md` at its root, and gets one; it removes the file from its first adoption pull request, as a repository with another records folder removes the templates of `docs/decisions`.
- A change to `CLAUDE.md` is no act: the repository owns it, as it owns the records README.

## The first adoption

The first adoption is the one change that nothing checks ([the updater](updater.md#first-adoption-by-hand)), so the maintainers read the whole diff, and for these files the diff is small and says exactly what changed. `updater.mjs --local` writes:

| Starting state | Result |
| -------------- | ------ |
| no `AGENTS.md`, no `CLAUDE.md` | `AGENTS.md` is the block and a line feed; `CLAUDE.md` is `@AGENTS.md`; the skill is added |
| an `AGENTS.md` with other content, an existing `CLAUDE.md` | the block is added at the end of `AGENTS.md`, after a blank line, and nothing else of the file changes; `CLAUDE.md` is not touched; the skill is added |
| an `AGENTS.md` with a broken marker | `AGENTS.md` is not written, the output says why (`warning: the block in AGENTS.md was not written: ...`), the rest of the adoption is written, and the pull request that the maintainers open says so |
| an `AGENTS.md` that already has the markers | the text between them is replaced, and since there is no pinned release to compare with, it is not reported as a local change |

The setup check, run with `--local` over any of these, reads the same files ([the setup check](#the-setup-check)).

## The update pull request

The update is the one pull request of [the updater](updater.md#the-pull-request), with these parts for the files of the agents:

- **Changes in this repository** lists the skill under Added or Changed like any managed file, `CLAUDE.md` under Templates installed, and under a heading of its own the block: `AGENTS.md is created, with the Record Keeper block in it`, `the Record Keeper block is added at the end of AGENTS.md, and nothing else in the file changes`, or `the Record Keeper block in AGENTS.md is replaced, and nothing outside the two markers changes`. A block that is current is not listed.
- **Local changes this update overwrites** lists `AGENTS.md (the text between the two markers)` when the block is replaced and it is not the block of the pinned release (an edit by hand, or a block that the updater did not write), and the skill when it was edited. Where the pinned release cannot be read, nothing is listed.
- **Warnings** carry a [refused block](#a-refused-block).
- **Approval:** the pull request changes the skill and the block, which are acts of the kind `instructions`, and the owners' ordinary approval meets them ([what the check does](#the-check-and-the-audit)).

### A refused block

When the markers of `AGENTS.md` are refused, or `AGENTS.md` is not a regular file or is larger than 1 MiB, or the text of the release is not a block, **the update goes on without the block.** The plan says `refused` with the reason, the output prints `warning: the block in AGENTS.md was not written: <reason in words>`, and the pull request has, under Warnings, **`Problem: the block in AGENTS.md was not written`** with the same words. Nothing is written to `AGENTS.md`, the rest of the update is written as always, and the setup check reports `block-unusable` every day until a person has repaired the file ([the setup check](#the-setup-check)). The alternative, to refuse the whole plan, would let one damaged marker stop every update, including an update of the code that judges the pull requests ([the choices](#choices-in-this-draft-for-you-to-decide), 4).

The words of the reasons:

| Reason | What it says |
| ------ | ------------ |
| `partial-line` | a line holds the text of a marker and more |
| `begin-without-end` | a begin marker has no end marker |
| `end-without-begin` | an end marker has no begin marker |
| `reversed` | the end marker comes before the begin marker |
| `doubled` | there is more than one begin marker or more than one end marker |
| `not-text` | the file holds a zero byte, so it is not text that the updater can add to |
| `fence` | the file ends inside a code fence, where the block would be taken for an example |
| `invalid-block` | the block of the release is not one begin marker, text and one end marker |
| `not-a-file` | `AGENTS.md` is not a regular file |
| `too-large` | `AGENTS.md` is larger than the updater reads (1 MiB) |

A person repairs it by hand: they take out the stray marker, or the whole damaged block with both markers, in an ordinary pull request (an act, so the owners approve it), and the next run of the updater adds the block again.

## The check and the audit

A change to the skill or to the block is the act **`instructions`**, the last of the acts ([checking a change](checking-a-change.md#acts), [the files of the check](protected-files.md)). The act is found by the code that finds every act, so the pull request check and the audit, which replays it on every commit of the default branch, find the same thing.

| A change | Act | Path |
| -------- | --- | ---- |
| a changed path is the skill, a folder in front of it, or something below it | `instructions` | `.claude/skills/record-a-decision/SKILL.md` |
| a changed path is `AGENTS.md` (or something below it, or it is a link or a folder before or after) and [the block changed](#one-function-for-the-four-programs) | `instructions` | `AGENTS.md` |
| any other change to `AGENTS.md`, any change to `CLAUDE.md`, another file in the folder of the skill or below `.claude` | none | |

- **It is met by the owners' ordinary approval** ([approvals](approvals.md)), like the workflow files, the programs, the settings and the pin. It is not an act of the bar for an amendment: the rules that agents read are guarded as the workflow files are, and no stricter.
- **It is announced** ([announcements](announcements.md)): the audit opens one issue, written by the bot, for each commit that carries an approved act of this kind, with the diff of the file, and mentions the owners and the witnesses. An update pull request that brings a new skill or block is announced with its other acts. The diff is the diff of the whole file, so an owner sees the text outside the block too.
- **The audit does not compare the files with a release.** That is the setup check's work, as it is for the workflow files. The audit finds that the files changed and that the owners approved ([the audit](audit.md#what-it-does-not-do)); design threat 17 ("hashed by the audit like the workflow files") is met by both together ([the choices](#choices-in-this-draft-for-you-to-decide), 12).
- **Nothing else changes in the check.** The records README is judged by the rules of the records folder, as before.

## The setup check

The skill is a managed file, so [the setup check](setup-check.md) compares it with the manifest of the pinned release by SHA-256 and size like every other, and says `managed-differs` when it is missing, is not a file or differs. The block is compared by the digest of its text:

| What the check reads | Finding |
| -------------------- | ------- |
| the block is the one of the pinned release | none, and `managed-files` is among the topics found fine |
| there is no `AGENTS.md`, or it is not a file | `managed-differs`, with `AGENTS.md (missing)` or `AGENTS.md (not a file)` |
| `AGENTS.md` has no markers | `managed-differs`, with `AGENTS.md (block missing)` |
| the block differs by digest or size | `managed-differs`, with `AGENTS.md (block differs)` |
| the markers are refused, or the file is larger than 1 MiB | **`block-unusable`**, with the reason as its detail |

`managed-differs` ends with the step that mends it: run the updater with `--target` set to the pinned version, which puts the block and the skill back. `block-unusable` is the one new finding of this page and is a warning, like every finding but two. Its text ends with the step: repair or take out the two marker lines and the text between them by hand, and run the updater. A healthy installation, one whose block is the release's, is told nothing on any event ([what a healthy installation is told](setup-check.md#what-a-healthy-installation-is-told)). `CLAUDE.md` is a template and is not compared. The repository of the kit has none of these files and is not looked at ([not looked at](setup-check.md#not-looked-at)).

## The tests

- [test/agent-files.test.mjs](../test/agent-files.test.mjs) and the fixtures of [test/fixtures/agent](../test/fixtures/agent/README.md): the markers, the fences, the actions, the refusals and the comparison, case by case; the property that nothing outside the markers changes, tried on thousands of files made of every sort of text; the property that a block that was put in is found and put in again changes nothing.
- The files that a release installs for the agents are tested as files ([test/agent-instructions.test.mjs](../test/agent-instructions.test.mjs)): the front matter of the skill, its size, that every path, command and link that the skill and the block name exists (the commands in the output of `record-keeper.mjs --help`, the links in the kit's own tree), that neither holds a secret, an e-mail address, a name of a deployment or a character that is not ASCII in the block, and that the block is one begin marker, text and one end marker with no line feed after it.
- The plan of the updater, the act of the check, the findings of the setup check and the manifest are tested with fixtures that a second implementation in Python gives the same answers for ([reference](../reference/README.md)), and with random inputs that the two implementations answer alike.

## What this does not do

- **It does not check that an agent reads the block,** or that an agent obeys it. It checks that the text is there and is the release's.
- **It does not look at `CLAUDE.md`.** An existing `CLAUDE.md` that does not import `AGENTS.md`, or a deleted one, is nobody's finding.
- **It does not guard the rest of `AGENTS.md`,** or the records README, which is judged by the rules of the records folder. A maintainer, or an agent, who edits the text outside the markers is not asked to have it approved by this check.
- **It does not remove a block.** A release that stops listing the block leaves the old block in `AGENTS.md`; a person takes it out. A release that does that is a major one, with a note ([releases](releases.md#versioning)).
- **It does not read nested files.** Only `AGENTS.md` at the root of the repository is looked at; a monorepo with an `AGENTS.md` in a folder has that file to itself.
- **It does not put the skill or the block anywhere else** (no `.github/copilot-instructions.md`, no `.github/instructions/`, no settings of an agent), and it adds no hook.
- **It does not cover the files with `CODEOWNERS`.** The setup check asks that six files are covered, as before ([choice 14](#choices-in-this-draft-for-you-to-decide)).

## What is verified and what is not

**Tried:** the pure functions, with the fixtures of [test/fixtures/agent](../test/fixtures/agent/README.md), with a Python second implementation on random files (50,000 scenarios, no difference, every branch and every line of the functions reached) and by mutation testing of the lines that decide ([reference](../reference/README.md)); the plan of the updater with the new kind, the new templates and the skill, with the fixtures of [test/fixtures/update](../test/fixtures/update/README.md); the runner against a local server that plays GitHub and temporary repositories (the first adoption in each of its starting states, an update, a block that is refused, a block that is current, a file that keeps its mode); the act of the check on temporary repositories ([test/fixtures/change](../test/fixtures/change/README.md)); the setup check's reading of the block; the announcement of the new act.

**Not tried, because it needs the products or GitHub:**

- **That Claude Code loads the skill from `.claude/skills/`, and that the Copilot cloud agent does.** This is what the documentation of the two products says, as read on the day of this draft. It was not run with either.
- **That Claude Code follows `@AGENTS.md` in `CLAUDE.md`** and that an agent obeys the block: documentation only.
- **That the update pull request that changes these files starts `Records integrity`, that the owners' approvals meet the act, and that the announcement is opened,** on GitHub. All of it is tried against a local server.
- **A real `AGENTS.md`.** The files of the maintainers' repositories were not used. Whether a real file has a marker in prose, a fence in a list, a byte order mark or other things that this page refuses is not known; a refusal is a warning that a person reads and not a failure.

## Choices in this draft for you to decide

1. **The skill is a managed file at one path** (the maintainer's decision). The alternative, a template, would let a repository adapt the skill and would never overwrite it; the cost is that a skill that a release improves reaches nobody, and the guard of the check would have nothing to compare it with. As a managed file, a local change is listed in the pull request and overwritten; the path rule of the updater grows by exactly this one path, and a test tries thirty paths around it.
2. **The block is a marked block that the updater rewrites** (the maintainer's decision). The alternatives: a file of its own for the rules, which `AGENTS.md` would have to import (not every agent follows an import); or the whole `AGENTS.md` as a managed file (it would overwrite the maintainers' own text).
3. **`CLAUDE.md` is a template with the one line `@AGENTS.md`** (the maintainer's decision). The cost is the one in the section above: a repository whose Claude Code memory is elsewhere, or whose `CLAUDE.md` does not import `AGENTS.md`, is not told.
4. **A refused block does not stop the update:** the update goes on without the block, the pull request says it as a problem, and the setup check reports it every day. The alternative is to **refuse the whole plan**, as the updater refuses a manifest that is wrong. The cost of that: a file that a person damaged, perhaps long ago, stops the updates of the check and of the audit too.
5. **A new act, `instructions`, placed last** in the order of the acts (after `code`) and announced like the others. The alternative is to reuse `code` for the skill and the block: one name less, and a diff of markdown announced as a change of code. A new name is free before the first release; it is a name in the announcements and in the pages that list the acts. Putting it last keeps the order of the others as it was.
6. **The functions that find, replace and compare the block are in `updater.mjs`,** and `record-keeper.mjs` and `setup-check.mjs` import them. The updater is fetched alone for the first adoption and cannot import a file ([the updater](updater.md#first-adoption-by-hand)), so it must hold them; the other programs already stand beside it, and the setup check already imports it. The alternatives are a copy in the rules file (two copies of a function that must agree to the byte, and a drift would be an attack surface) or a file of its own that the first adoption would have to fetch too. The cost: the rules file, which judges every pull request, now imports the updater, and a test of the kit says that the updater imports no other file of the kit.
7. **A marker must be alone on its line, exact, from the first byte.** A line that holds the text of a marker and more is refused (`partial-line`), also in prose. The alternative is to ignore such a line: then a marker that someone damaged would be ignored, and the updater would add a second block at the end, and the next update a third. The cost: a repository whose `AGENTS.md` talks about the markers in prose has to put them in a fence.
8. **A marker inside a code fence is an example,** and a file that ends inside an open fence is refused for an append (`fence`). The alternative, no fence rule, would let the updater overwrite the example of the markers in a page of notes, and the text after it. The fence rule is the small part of Markdown that the kit's own format page uses too (up to three spaces, three or more backticks or tildes, the same character to close); a fence indented by four spaces or more, or in a quotation, is not read, and the markers in one are then refused as `partial-line`, which is the safe side.
9. **The block is written with line feeds whatever the file uses.** A CRLF file gets mixed line ends, which no reader minds, and the block has the same digest in every repository, which the setup check compares. The alternative is to write the file's line ends, which would give the block a digest for every style and make the comparison read twice.
10. **A block that a release stops listing stays,** and so does the text in it. The alternative is that the updater removes the text between the markers; the kit has no case for it yet, and a repository that wants it gone is better served by a person who reads the diff.
11. **A block that was deleted comes back with the next update,** like a managed file, and there is no way to opt out. The updater does not read the settings ([the updater](updater.md#choices-in-this-draft-for-you-to-decide), 15), so a setting to switch it off would be a new reader. A repository that wants no block removes the entry from its adoption by hand and is told by the setup check until it does not follow the kit.
12. **The audit does not hash the skill and the block against the release;** it finds that they changed and that the owners approved, as it does for the workflow files. The design says the audit hashes both ([the design](design.md#the-nightly-audit-and-the-log)); this page and [the audit](audit.md#what-this-does-not-do) say what the code does, and two sentences of the design were corrected ([the design](design.md)). The setup check compares by hash, daily.
13. **A change to `AGENTS.md` that is not a regular file is an act,** and a change of the mode only is not. A link that replaces the file, or a folder, can lead anywhere, so it is guarded whole; a mode is not what an agent reads.
14. **`CODEOWNERS` is not asked to cover the skill and `AGENTS.md`.** The setup check asks for six files, as before, and its healthy installations are quiet. Adding two would give every installation whose `CODEOWNERS` says `/.github/` a warning on every run until it adds `/.claude/` and `/AGENTS.md`. The act is met by the owners' approval that `Records integrity` checks, whatever `CODEOWNERS` says; the code owners' review is an extra, and a repository that wants it adds the two lines.
15. **The setup check does not run on a pull request that changes `AGENTS.md` or the skill.** The paths of its workflow are unchanged, so a change to either is seen by the daily run, and by `Records integrity` at once. The alternative adds two paths to two guarded workflow files for a notice that the owners get from the check already.
16. **One new finding, `block-unusable`;** a missing, absent or differing block and a missing skill are `managed-differs`, with the words `(block missing)`, `(block differs)` and `(missing)` in its detail. The alternative is a finding of its own for each. A name that is hard to change after a release exists is the cost of every new finding, so there is one.
17. **`AGENTS.md` is read up to 1 MiB,** and a larger file is `too-large`. The alternative is no limit; the cost of that is a program that reads what a pull request can make as large as it likes.
18. **A file with a zero byte and no marker is never added to** (`not-text`), so a UTF-16 file is not spoiled. A file in another ASCII-compatible encoding (Latin-1) gets the block, which is ASCII, and the bytes of the file stay what they were. The alternative is to decode the file, which two implementations would read differently.
19. **The skill and the block link the kit's pages by their address on `main`,** not on a tag. A page that moves leaves a dead link in the skill until the next release; a test of the kit resolves every link in its own tree at the commit it tests.
20. **The kit's own repository gets no `AGENTS.md` or `CLAUDE.md` in this change.** It has none of its own and does not install itself; adding them is a decision of its own (the findings of this change say so).
21. **The marker texts are `<!-- record-keeper:begin -->` and `<!-- record-keeper:end -->`.** A name that a release has used cannot change without a major release, so these two are the ones to read twice.
22. **Only `AGENTS.md` at the root is a block.** The manifest allows no other destination for the kind, and the builder of the manifest refuses `AGENTS.md` as anything but a block, so it can never be replaced whole.
